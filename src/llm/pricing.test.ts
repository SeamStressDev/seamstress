/**
 * COGS math tests. Pure functions, no API key needed — `npm test` runs clean
 * without secrets. This is the cost primitive the validation runs never had
 * cleanly, so it's worth pinning down.
 */

import { describe, expect, it } from "vitest";
import {
  aggregateCost,
  computeCallCostUsd,
  pricingFor,
  toTokenUsage,
  UnknownModelPricingError,
} from "./pricing.js";

describe("pricingFor", () => {
  it("returns rates for a known model", () => {
    expect(pricingFor("claude-haiku-4-5")).toEqual({
      inputPer1M: 1,
      outputPer1M: 5,
    });
  });

  it("throws on an unknown model", () => {
    expect(() => pricingFor("claude-made-up")).toThrow(
      UnknownModelPricingError,
    );
  });

  // Regression: the Anthropic API echoes back the full dated model ID even when
  // the alias is requested, so the exact-match lookup threw UnknownModelPricing-
  // Error mid-COGS. pricingFor must resolve a dated ID to its alias's pricing.
  it("resolves a dated Haiku ID to the claude-haiku-4-5 pricing", () => {
    expect(pricingFor("claude-haiku-4-5-20251001")).toEqual({
      inputPer1M: 1,
      outputPer1M: 5,
    });
  });

  it("resolves a dated Opus ID to the claude-opus-4-8 pricing", () => {
    expect(pricingFor("claude-opus-4-8-20260115")).toEqual({
      inputPer1M: 5,
      outputPer1M: 25,
    });
  });

  it("still resolves an exact alias via the fast path", () => {
    expect(pricingFor("claude-opus-4-8")).toEqual({
      inputPer1M: 5,
      outputPer1M: 25,
    });
  });

  it("throws on a genuinely unknown model even with the prefix fallback", () => {
    expect(() => pricingFor("claude-nonexistent-9-9")).toThrow(
      UnknownModelPricingError,
    );
  });

  // A dated suffix must not let a near-miss alias win: claude-opus-4-8-...
  // shares the "claude-opus-4-" stem with 4-7/4-6 but only 4-8 is a prefix.
  it("picks the correct alias when sibling aliases share a stem", () => {
    expect(pricingFor("claude-opus-4-7-20260101")).toEqual(
      pricingFor("claude-opus-4-7"),
    );
    expect(pricingFor("claude-opus-4-6-20260101")).toEqual(
      pricingFor("claude-opus-4-6"),
    );
  });
});

describe("computeCallCostUsd", () => {
  it("prices uncached input and output at base rates", () => {
    // Haiku: $1/1M input, $5/1M output.
    // 1M input + 1M output = $1 + $5 = $6.
    const cost = computeCallCostUsd("claude-haiku-4-5", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    expect(cost).toBeCloseTo(6, 9);
  });

  it("applies cache write (1.25x) and read (0.1x) multipliers to the input rate", () => {
    // Haiku input $1/1M. 1M cache-write = $1.25; 1M cache-read = $0.10.
    const cost = computeCallCostUsd("claude-haiku-4-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 1_000_000,
      cacheReadInputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(1.35, 9);
  });
});

describe("aggregateCost", () => {
  it("sums usages and breaks cost down by model and purpose", () => {
    const usages = [
      toTokenUsage("claude-haiku-4-5", "seam_detection", {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      }),
      toTokenUsage("claude-opus-4-8", "verification", {
        inputTokens: 0,
        outputTokens: 1_000_000,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      }),
    ];

    const cost = aggregateCost(usages);

    // Haiku 1M input = $1; Opus 1M output = $25.
    expect(cost.totalCostUsd).toBeCloseTo(26, 9);
    expect(cost.totalInputTokens).toBe(1_000_000);
    expect(cost.totalOutputTokens).toBe(1_000_000);
    expect(cost.costUsdByModel["claude-haiku-4-5"]).toBeCloseTo(1, 9);
    expect(cost.costUsdByModel["claude-opus-4-8"]).toBeCloseTo(25, 9);
    expect(cost.costUsdByPurpose.seam_detection).toBeCloseTo(1, 9);
    expect(cost.costUsdByPurpose.verification).toBeCloseTo(25, 9);
    expect(cost.costUsdByPurpose.critic).toBe(0);
  });

  it("returns a zeroed cost for no usages", () => {
    const cost = aggregateCost([]);
    expect(cost.totalCostUsd).toBe(0);
    expect(cost.costUsdByPurpose.synthesis).toBe(0);
    expect(cost.costUsdByModel).toEqual({});
  });
});
