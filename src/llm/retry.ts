/*
 * SeamStress — seam-scoped code review engine.
 * Copyright (C) 2026 SeamStress contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Bounded retry with exponential backoff for transient API failures.
 *
 * The validation dry-runs taught us that long multi-call operations die on
 * transient errors (ECONNRESET, 502s) partway through an expensive run. The
 * pipeline makes 5-15 sequential calls per review; the detector will make many
 * more. One transient blip should not tank the whole review.
 *
 * The Anthropic SDK already retries this error class well — but only on its own
 * transport path, which our dependency-injection seam (an injected mock client)
 * bypasses, and which can't be exercised deterministically in tests. So we own
 * retry at the application layer, wrapping the `callModel` primitive, and DISABLE
 * the SDK's own retry (maxRetries: 0 in client.ts) so there is exactly one
 * layer. {@link isRetryableError} deliberately mirrors the SDK's classification.
 *
 * The split is the whole point: retry the *transient* class (connection/timeout,
 * 408/409/429, 5xx) and fail FAST on *permanent* errors (400/401/403/404), which
 * fail identically on retry and only waste calls and money.
 */

import Anthropic from "@anthropic-ai/sdk";

/** Default retry budget: this many retries ON TOP of the initial attempt. */
export const DEFAULT_MAX_RETRIES = 3;

/** Base backoff before the first retry, in ms. Doubles each subsequent retry. */
const DEFAULT_BASE_DELAY_MS = 500;
/** Backoff ceiling, in ms — exponential growth is clamped here. */
const DEFAULT_MAX_DELAY_MS = 8_000;

/**
 * HTTP statuses that are transient and worth retrying even though they are < 500:
 * request timeout, lock conflict, and rate limit. Everything ≥ 500 is also
 * retried (see {@link isRetryableError}); all other 4xx are permanent.
 */
const RETRYABLE_STATUSES = new Set([408, 409, 429]);

/** Raw Node/undici socket error codes that signal a transient network blip. */
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

/**
 * The load-bearing predicate: is this error worth retrying? PURE and exported so
 * it is unit-testable and reversion-proofable on its own. Retries the transient
 * class only:
 *
 * - connection / timeout errors (no HTTP status) — {@link Anthropic.APIConnectionError}
 *   and its timeout subclass;
 * - HTTP 408 / 409 / 429, and any 5xx (500/502/503/529 overloaded);
 * - raw socket errors (ECONNRESET et al.) that reached us unwrapped.
 *
 * Returns `false` for permanent failures — 400/401/403/404/422 and other 4xx,
 * and user aborts — which fail identically on retry.
 */
export function isRetryableError(err: unknown): boolean {
  // Connection failures and timeouts carry no HTTP status; always transient.
  // (APIConnectionTimeoutError extends APIConnectionError, so both match here.)
  if (err instanceof Anthropic.APIConnectionError) return true;

  // HTTP status errors: retry the transient statuses + all server errors.
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    // A user abort (and other status-less APIErrors) is not retryable.
    if (typeof status !== "number") return false;
    return RETRYABLE_STATUSES.has(status) || status >= 500;
  }

  // Raw socket errors that never got wrapped (e.g. a mock or a non-SDK path).
  if (isTransientNetworkError(err)) return true;

  return false;
}

/** True for a bare Error carrying a transient socket `code` like ECONNRESET. */
function isTransientNetworkError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && TRANSIENT_NETWORK_CODES.has(code);
}

/** Tunables for {@link computeBackoffMs} — injectable so tests stay deterministic. */
export interface BackoffOptions {
  /** Base delay before the first retry, ms (default 500). */
  baseDelayMs?: number;
  /** Maximum delay, ms — exponential growth is clamped to this (default 8000). */
  maxDelayMs?: number;
  /** Randomness source for jitter; injectable for deterministic tests. */
  random?: () => number;
}

/**
 * Exponential backoff with jitter for a given zero-based retry attempt. Pure:
 * `base * 2^attempt`, clamped to `maxDelayMs`, then reduced by up to 25% of
 * jitter (matching the SDK) so concurrent calls don't retry in lockstep.
 */
export function computeBackoffMs(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const max = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const random = options.random ?? Math.random;
  const exponential = Math.min(base * 2 ** attempt, max);
  const jitter = 1 - random() * 0.25; // shave up to 25%, never extend
  return exponential * jitter;
}

/** Options for {@link withRetry}. */
export interface RetryOptions extends BackoffOptions {
  /** Max retries on top of the initial attempt (default {@link DEFAULT_MAX_RETRIES}). */
  maxRetries?: number;
  /** Which errors to retry; defaults to {@link isRetryableError}. */
  isRetryable?: (err: unknown) => boolean;
  /** Sleep implementation; injectable so tests don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

/** Real sleep — the default when none is injected. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * If the server told us how long to wait (a `retry-after-ms` or `retry-after`
 * header on an APIError), honor it — it beats a blind exponential guess for
 * rate limits. Returns ms, or undefined when there is no usable hint.
 */
function serverRetryAfterMs(err: unknown): number | undefined {
  if (!(err instanceof Anthropic.APIError)) return undefined;
  const headers = err.headers;
  if (!headers || typeof headers.get !== "function") return undefined;

  const ms = headers.get("retry-after-ms");
  if (ms !== null) {
    const parsed = Number.parseFloat(ms);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  const seconds = headers.get("retry-after");
  if (seconds !== null) {
    const parsed = Number.parseFloat(seconds);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed * 1000;
  }
  return undefined;
}

/**
 * Run `fn`, retrying it on transient failures with exponential backoff. Bounded:
 * after `maxRetries` retries are exhausted the last error PROPAGATES (the run
 * fails cleanly, never silently, never infinitely). Permanent errors are not
 * retried at all — they throw on the first attempt. The backoff prefers a
 * server-provided `retry-after`, falling back to {@link computeBackoffMs}.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const isRetryable = options.isRetryable ?? isRetryableError;
  const sleep = options.sleep ?? defaultSleep;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries || !isRetryable(err)) throw err;
      const delay = serverRetryAfterMs(err) ?? computeBackoffMs(attempt, options);
      await sleep(delay);
      attempt += 1;
    }
  }
}
