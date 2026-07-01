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
 * Retry/resilience tests — the dry-run lesson, pinned. Fully mocked and fast: a
 * no-op `sleep` is injected so nothing actually waits, and errors are simulated
 * rather than provoked over the network. No API key needed.
 *
 * The load-bearing property is DISCRIMINATION: retry the transient class
 * (connection/timeout, 408/409/429, 5xx) and fail fast on permanent errors
 * (400/401/403/404). The reversion proof below targets exactly that.
 */

import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  computeBackoffMs,
  DEFAULT_MAX_RETRIES,
  isRetryableError,
  withRetry,
} from "./retry.js";

/** Build an APIError with a given HTTP status (and optional headers). */
function apiError(status: number, headers?: Headers): Anthropic.APIError {
  return new Anthropic.APIError(status, undefined, `status ${status}`, headers ?? new Headers());
}

/** Never sleep in tests — keep the suite instant. */
const noSleep = async (): Promise<void> => {};

describe("isRetryableError — the transient/permanent split", () => {
  it("retries connection and timeout errors (no HTTP status)", () => {
    expect(isRetryableError(new Anthropic.APIConnectionError({ message: "reset" }))).toBe(true);
    expect(isRetryableError(new Anthropic.APIConnectionTimeoutError())).toBe(true);
  });

  it("retries 408, 409, 429, and all 5xx", () => {
    for (const status of [408, 409, 429, 500, 502, 503, 529]) {
      expect(isRetryableError(apiError(status))).toBe(true);
    }
  });

  it("does NOT retry permanent 4xx (400/401/403/404/422)", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isRetryableError(apiError(status))).toBe(false);
    }
  });

  it("retries raw socket errors (ECONNRESET et al.)", () => {
    const econnreset = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    expect(isRetryableError(econnreset)).toBe(true);
  });

  it("does not retry a user abort or a plain Error with no transient code", () => {
    expect(isRetryableError(new Anthropic.APIUserAbortError())).toBe(false);
    expect(isRetryableError(new Error("just a bug"))).toBe(false);
  });
});

describe("withRetry — retries then succeeds", () => {
  it("returns the success result after transient failures, calling fn the expected times", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(apiError(503))
      .mockRejectedValueOnce(new Anthropic.APIConnectionError({ message: "reset" }))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { maxRetries: 3, sleep: noSleep });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3); // 2 transient failures + 1 success
  });
});

describe("withRetry — bounded: gives up after the budget", () => {
  it("stops after exactly maxRetries+1 attempts and propagates the final error", async () => {
    const maxRetries = 3;
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(apiError(529));

    await expect(withRetry(fn, { maxRetries, sleep: noSleep })).rejects.toBeInstanceOf(
      Anthropic.APIError,
    );
    // Bounded, never infinite: initial attempt + maxRetries retries.
    expect(fn).toHaveBeenCalledTimes(maxRetries + 1);
  });

  it("defaults the budget to DEFAULT_MAX_RETRIES", async () => {
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(apiError(500));
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(DEFAULT_MAX_RETRIES + 1);
  });
});

describe("withRetry — does NOT retry permanent errors", () => {
  it("fails on the first attempt for a 400, calling fn exactly once", async () => {
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(apiError(400));

    await expect(withRetry(fn, { maxRetries: 5, sleep: noSleep })).rejects.toBeInstanceOf(
      Anthropic.APIError,
    );
    expect(fn).toHaveBeenCalledTimes(1); // no wasted retries on a permanent error
  });

  it("fails on the first attempt for a 401", async () => {
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(apiError(401));
    await expect(withRetry(fn, { maxRetries: 5, sleep: noSleep })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("withRetry — backoff", () => {
  it("waits between attempts using exponential backoff (and never actually sleeps long in tests)", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
    };
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(apiError(503))
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValue("ok");

    // random=()=>0 removes jitter so the backoff is exactly base*2^attempt.
    await withRetry(fn, { maxRetries: 3, sleep, baseDelayMs: 500, random: () => 0 });

    expect(sleeps).toEqual([500, 1000]); // attempt 0 → 500ms, attempt 1 → 1000ms
  });

  it("honors a server retry-after-ms header over computed backoff", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
    };
    const headers = new Headers({ "retry-after-ms": "250" });
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(apiError(429, headers))
      .mockResolvedValue("ok");

    await withRetry(fn, { maxRetries: 3, sleep, baseDelayMs: 5000 });

    expect(sleeps).toEqual([250]); // obeyed the server, not the 5000ms base
  });
});

describe("computeBackoffMs — pure exponential + jitter", () => {
  it("doubles each attempt and clamps to maxDelayMs (jitter removed)", () => {
    const opts = { baseDelayMs: 500, maxDelayMs: 8000, random: () => 0 };
    expect(computeBackoffMs(0, opts)).toBe(500);
    expect(computeBackoffMs(1, opts)).toBe(1000);
    expect(computeBackoffMs(2, opts)).toBe(2000);
    expect(computeBackoffMs(10, opts)).toBe(8000); // clamped
  });

  it("applies at most 25% jitter, never extending the delay", () => {
    const max = computeBackoffMs(2, { baseDelayMs: 500, random: () => 1 }); // most jitter
    const min = computeBackoffMs(2, { baseDelayMs: 500, random: () => 0 }); // no jitter
    expect(min).toBe(2000);
    expect(max).toBeCloseTo(1500, 6); // 2000 * (1 - 0.25)
    expect(max).toBeLessThanOrEqual(min);
  });
});
