/**
 * Model pricing and COGS computation.
 *
 * This is where clean cost-of-goods finally comes from: real per-call token
 * splits priced against a known table, with the cache multipliers applied so
 * the numbers hold up once prompt caching enters the pipeline.
 */

import type { Cost, TokenUsage, TokenUsagePurpose } from "../types/index.js";

/** Per-million-token rates for a model, in US dollars. */
export interface ModelPricing {
  /** Dollars per 1M uncached input tokens. */
  inputPer1M: number;
  /** Dollars per 1M output tokens. */
  outputPer1M: number;
}

/**
 * Cache pricing multipliers, applied to a model's input rate. Cache writes cost
 * more than fresh input (the entry has to be created); cache reads cost a small
 * fraction. These are the standard Anthropic multipliers.
 */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/**
 * Pricing per 1M tokens (USD), keyed by exact Anthropic model ID.
 *
 * Source: Anthropic model pricing as of 2026-06. Keep these in sync when models
 * or prices change — COGS accuracy depends on it.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-fable-5": { inputPer1M: 10, outputPer1M: 50 },
  "claude-opus-4-8": { inputPer1M: 5, outputPer1M: 25 },
  "claude-opus-4-7": { inputPer1M: 5, outputPer1M: 25 },
  "claude-opus-4-6": { inputPer1M: 5, outputPer1M: 25 },
  "claude-sonnet-4-6": { inputPer1M: 3, outputPer1M: 15 },
  "claude-haiku-4-5": { inputPer1M: 1, outputPer1M: 5 },
};

/** Raw token counts from a single Anthropic API `usage` object. */
export interface RawUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/**
 * Thrown when a model ID has no pricing entry. Failing loudly here keeps a typo
 * from silently producing a $0 COGS number.
 */
export class UnknownModelPricingError extends Error {
  constructor(public readonly model: string) {
    super(
      `No pricing entry for model "${model}". Add it to MODEL_PRICING in src/llm/pricing.ts.`,
    );
    this.name = "UnknownModelPricingError";
  }
}

/** Look up pricing for a model, throwing if it is unknown. */
export function pricingFor(model: string): ModelPricing {
  const pricing = MODEL_PRICING[model];
  if (!pricing) throw new UnknownModelPricingError(model);
  return pricing;
}

/**
 * Compute the dollar cost of a single call from its raw token split and model.
 * Cache writes and reads are priced against the input rate with their
 * multipliers; uncached input and output use the base rates.
 */
export function computeCallCostUsd(model: string, usage: RawUsage): number {
  const { inputPer1M, outputPer1M } = pricingFor(model);
  const perInputToken = inputPer1M / 1_000_000;
  const perOutputToken = outputPer1M / 1_000_000;

  return (
    usage.inputTokens * perInputToken +
    usage.cacheCreationInputTokens * perInputToken * CACHE_WRITE_MULTIPLIER +
    usage.cacheReadInputTokens * perInputToken * CACHE_READ_MULTIPLIER +
    usage.outputTokens * perOutputToken
  );
}

/**
 * Build a fully-priced {@link TokenUsage} record from a raw API usage object.
 * This is the bridge from the SDK's `usage` shape to the engine's COGS shape.
 */
export function toTokenUsage(
  model: string,
  purpose: TokenUsagePurpose,
  usage: RawUsage,
): TokenUsage {
  return {
    model,
    purpose,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    costUsd: computeCallCostUsd(model, usage),
  };
}

const EMPTY_BY_PURPOSE: Record<TokenUsagePurpose, number> = {
  seam_detection: 0,
  critic: 0,
  synthesis: 0,
  verification: 0,
  other: 0,
};

/**
 * Sum a list of per-call {@link TokenUsage} records into an aggregate
 * {@link Cost}, broken down by model and by pipeline phase. This is the
 * bottom-line COGS that lands on a ReviewResult.
 */
export function aggregateCost(usages: TokenUsage[]): Cost {
  const cost: Cost = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationInputTokens: 0,
    totalCacheReadInputTokens: 0,
    totalCostUsd: 0,
    costUsdByModel: {},
    costUsdByPurpose: { ...EMPTY_BY_PURPOSE },
  };

  for (const u of usages) {
    cost.totalInputTokens += u.inputTokens;
    cost.totalOutputTokens += u.outputTokens;
    cost.totalCacheCreationInputTokens += u.cacheCreationInputTokens;
    cost.totalCacheReadInputTokens += u.cacheReadInputTokens;
    cost.totalCostUsd += u.costUsd;
    cost.costUsdByModel[u.model] = (cost.costUsdByModel[u.model] ?? 0) + u.costUsd;
    cost.costUsdByPurpose[u.purpose] =
      (cost.costUsdByPurpose[u.purpose] ?? 0) + u.costUsd;
  }

  return cost;
}
