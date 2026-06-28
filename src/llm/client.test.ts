/**
 * API client tests — protects the COGS-measurement path. Fully mocked: no real
 * API call is made, so these are free and deterministic. (The only real call in
 * this build is the smoke test in src/index.ts, run by hand with a key.)
 */

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
});
