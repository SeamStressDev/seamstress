/**
 * The LLM layer: a thin Anthropic API client and the pricing/COGS primitives
 * the rest of the engine bills against.
 */

export {
  LlmClient,
  MissingApiKeyError,
  DEFAULT_SMOKE_MODEL,
  extractCallResult,
} from "./client.js";
export type {
  CallModelParams,
  CallModelResult,
  LlmClientOptions,
  ModelResponseLike,
} from "./client.js";
export {
  MODEL_PRICING,
  UnknownModelPricingError,
  pricingFor,
  computeCallCostUsd,
  toTokenUsage,
  aggregateCost,
} from "./pricing.js";
export type { ModelPricing, RawUsage } from "./pricing.js";
