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
 * Thin Anthropic Messages API client wrapper.
 *
 * This is the primitive every part of the review pipeline calls. It does one
 * thing: make a single model call and return the response text **plus the real
 * token usage** (input/output split, model) so COGS is captured at the source
 * rather than discarded. Nothing about critics, synthesis, or verification
 * lives here — just the call, usage capture, and basic error handling.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { TokenUsage, TokenUsagePurpose } from "../types/index.js";
import { toTokenUsage } from "./pricing.js";
import { DEFAULT_MAX_RETRIES, withRetry } from "./retry.js";

/** Default cheap model for smoke tests and trivial calls. */
export const DEFAULT_SMOKE_MODEL = "claude-haiku-4-5";

/** Parameters for a single model call. */
export interface CallModelParams {
  /** Exact model ID, e.g. `claude-opus-4-8`. Must have a pricing entry. */
  model: string;
  /** Conversation messages, in Anthropic Messages API shape. */
  messages: Anthropic.MessageParam[];
  /** Optional system prompt. */
  system?: string;
  /** Output token cap. Defaults to a conservative 4096. */
  maxTokens?: number;
  /**
   * Which pipeline phase this call belongs to, for COGS attribution. Defaults
   * to `other`.
   */
  purpose?: TokenUsagePurpose;
}

/** Result of a single model call: the text and the real, priced usage. */
export interface CallModelResult {
  /** Concatenated text of all text blocks in the response. */
  text: string;
  /** Real token usage and computed dollar cost for this call. */
  usage: TokenUsage;
  /** Why the model stopped (`end_turn`, `max_tokens`, `refusal`, ...). */
  stopReason: string | null;
}

/**
 * The minimal structural shape of an Anthropic Messages response that the usage
 * extractor needs. Anthropic.Message is structurally compatible; declaring the
 * subset keeps {@link extractCallResult} (and its tests) independent of the full
 * SDK response type.
 */
export interface ModelResponseLike {
  model: string;
  stop_reason: string | null;
  content: ReadonlyArray<{ type: string; text?: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
}

/**
 * Pure function: turn a raw Anthropic response into a {@link CallModelResult}.
 *
 * This is the COGS-measurement path — it pulls the real input/output token
 * split and the model ID out of the response and prices them. Kept pure and
 * exported so it can be unit-tested without touching the network.
 */
export function extractCallResult(
  response: ModelResponseLike,
  purpose: TokenUsagePurpose,
): CallModelResult {
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");

  const usage = toTokenUsage(response.model, purpose, {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
  });

  return { text, usage, stopReason: response.stop_reason };
}

/**
 * Thrown when no API key is available. Surfaced explicitly so the failure mode
 * is "you forgot to set ANTHROPIC_API_KEY" rather than an opaque SDK error.
 */
export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.",
    );
    this.name = "MissingApiKeyError";
  }
}

/** Construction options for {@link LlmClient}. */
export interface LlmClientOptions {
  /** Explicit API key. Falls back to `ANTHROPIC_API_KEY` when omitted. */
  apiKey?: string;
  /** Inject a pre-built (or mock) Anthropic client — used by tests. */
  client?: Anthropic;
  /**
   * Max retries on transient API errors, on top of the initial attempt
   * (default {@link DEFAULT_MAX_RETRIES}). We own retry at this layer and turn
   * the SDK's own retry OFF so there is exactly one bounded layer.
   */
  maxRetries?: number;
  /** Sleep used between retries; injectable so tests don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * A thin wrapper over the Anthropic SDK. Reads the API key from the environment
 * (`ANTHROPIC_API_KEY`) — it is never hardcoded and never logged. Every call is
 * wrapped in bounded retry-with-backoff (see `retry.ts`) so a transient blip
 * mid-review doesn't tank the whole run.
 */
export class LlmClient {
  private readonly client: Anthropic;
  private readonly maxRetries: number;
  private readonly sleep: ((ms: number) => Promise<void>) | undefined;

  constructor(options: LlmClientOptions = {}) {
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.sleep = options.sleep;

    if (options.client) {
      this.client = options.client;
      return;
    }
    const key = options.apiKey ?? process.env["ANTHROPIC_API_KEY"];
    if (!key) throw new MissingApiKeyError();
    // maxRetries: 0 disables the SDK's own retry — we retry at the app layer
    // (one bounded layer, deterministically testable) instead of stacking two.
    this.client = new Anthropic({ apiKey: key, maxRetries: 0 });
  }

  /**
   * Make one model call, retrying transient failures with backoff. Returns the
   * response text plus the real token usage — the clean COGS primitive the whole
   * engine bills against. Permanent errors (400/401/...) fail fast on the first
   * attempt; a transient error that survives the retry budget propagates to the
   * caller (the run fails cleanly, not silently).
   */
  async callModel(params: CallModelParams): Promise<CallModelResult> {
    const { model, messages, system, maxTokens = 4096, purpose = "other" } =
      params;

    const response = await withRetry(
      () =>
        this.client.messages.create({
          model,
          max_tokens: maxTokens,
          ...(system !== undefined ? { system } : {}),
          messages,
        }),
      {
        maxRetries: this.maxRetries,
        ...(this.sleep !== undefined ? { sleep: this.sleep } : {}),
      },
    );

    return extractCallResult(response, purpose);
  }
}
