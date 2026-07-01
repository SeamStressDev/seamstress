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
export {
  withRetry,
  isRetryableError,
  computeBackoffMs,
  DEFAULT_MAX_RETRIES,
} from "./retry.js";
export type { RetryOptions, BackoffOptions } from "./retry.js";
