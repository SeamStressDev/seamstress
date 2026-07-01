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
 * API client tests — protects the COGS-measurement path. Fully mocked: no real
 * API call is made, so these are free and deterministic. (The only real call in
 * this build is the smoke test in src/index.ts, run by hand with a key.)
 */

import AnthropicSdk from "@anthropic-ai/sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  extractCallResult,
  LlmClient,
  MissingApiKeyError,
  type ModelResponseLike,
} from "./client.js";

/** A realistic Anthropic Messages response, shaped for the extractor. */
const mockResponse: ModelResponseLike = {
  model: "claude-haiku-4-5",
  stop_reason: "end_turn",
  content: [
    { type: "text", text: "SeamStress online." },
    { type: "tool_use" }, // non-text block must be ignored, not crash
  ],
  usage: {
    input_tokens: 123,
    output_tokens: 7,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
};

describe("extractCallResult", () => {
  it("extracts the input/output token split and model into TokenUsage", () => {
    const result = extractCallResult(mockResponse, "seam_detection");

    // This is the load-bearing assertion the reversion proof targets: the real
    // token split and model must land in the usage record correctly.
    expect(result.usage.model).toBe("claude-haiku-4-5");
    expect(result.usage.inputTokens).toBe(123);
    expect(result.usage.outputTokens).toBe(7);
    expect(result.usage.purpose).toBe("seam_detection");
    // Haiku: $1/1M in, $5/1M out → 123*1e-6 + 7*5e-6 = 0.000158.
    expect(result.usage.costUsd).toBeCloseTo(0.000158, 9);
  });

  it("concatenates only text blocks and preserves stop_reason", () => {
    const result = extractCallResult(mockResponse, "other");
    expect(result.text).toBe("SeamStress online.");
    expect(result.stopReason).toBe("end_turn");
  });

  it("defaults missing cache token fields to zero", () => {
    const result = extractCallResult(
      {
        ...mockResponse,
        usage: { input_tokens: 10, output_tokens: 2 },
      },
      "other",
    );
    expect(result.usage.cacheCreationInputTokens).toBe(0);
    expect(result.usage.cacheReadInputTokens).toBe(0);
  });
});

describe("LlmClient", () => {
  it("throws MissingApiKeyError when no key and no client is provided", () => {
    const prev = process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    try {
      expect(() => new LlmClient()).toThrow(MissingApiKeyError);
    } finally {
      if (prev !== undefined) process.env["ANTHROPIC_API_KEY"] = prev;
    }
  });

  it("wires the response through callModel into a priced result", async () => {
    const create = vi.fn().mockResolvedValue(mockResponse);
    const fakeClient = { messages: { create } } as unknown as Anthropic;
    const llm = new LlmClient({ client: fakeClient });

    const result = await llm.callModel({
      model: "claude-haiku-4-5",
      purpose: "critic",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(create).toHaveBeenCalledOnce();
    expect(result.usage.inputTokens).toBe(123);
    expect(result.usage.purpose).toBe("critic");
    expect(result.text).toBe("SeamStress online.");
  });

  it("propagates API errors instead of swallowing them", async () => {
    const create = vi.fn().mockRejectedValue(new Error("overloaded_error"));
    const fakeClient = { messages: { create } } as unknown as Anthropic;
    const llm = new LlmClient({ client: fakeClient });

    await expect(
      llm.callModel({
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow("overloaded_error");
  });

  it("retries a transient failure through callModel and then succeeds", async () => {
    // The primitive is wrapped in bounded retry, so every pipeline stage inherits
    // it. A 503 on the first attempt should be retried (no real wait — sleep is a
    // no-op) and the call should still resolve to a priced result.
    const create = vi
      .fn()
      .mockRejectedValueOnce(
        new AnthropicSdk.APIError(503, undefined, "overloaded", new Headers()),
      )
      .mockResolvedValue(mockResponse);
    const fakeClient = { messages: { create } } as unknown as Anthropic;
    const llm = new LlmClient({ client: fakeClient, sleep: async () => {} });

    const result = await llm.callModel({
      model: "claude-haiku-4-5",
      purpose: "critic",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(create).toHaveBeenCalledTimes(2); // one retry, then success
    expect(result.usage.inputTokens).toBe(123);
  });

  it("does not retry a permanent 401 through callModel", async () => {
    const create = vi
      .fn()
      .mockRejectedValue(
        new AnthropicSdk.APIError(401, undefined, "unauthorized", new Headers()),
      );
    const fakeClient = { messages: { create } } as unknown as Anthropic;
    const llm = new LlmClient({ client: fakeClient, sleep: async () => {} });

    await expect(
      llm.callModel({
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toBeInstanceOf(AnthropicSdk.APIError);
    expect(create).toHaveBeenCalledTimes(1); // failed fast, no wasted retries
  });
});
