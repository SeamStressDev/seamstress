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
 * Token accounting and COGS (cost of goods sold) shapes.
 *
 * Every model call the engine makes returns a {@link TokenUsage} record. The
 * validation runs could only ever see an aggregate token count; because the
 * engine now calls the Anthropic API directly, we capture the real
 * input/output split (and the cache split) per call, so COGS is finally
 * measured cleanly — including the seam-detection and verification costs the
 * earlier runs left unmetered.
 *
 * Shapes are defined as zod schemas so they double as runtime validators at the
 * eventual API boundary; the exported TS types are inferred from them, so the
 * schema is the single source of truth.
 */

import { z } from "zod";

/**
 * Which phase of the review pipeline a model call belongs to. Lets us attribute
 * COGS to the part of the pipeline that incurred it (e.g. "verification cost us
 * 40% of the run") rather than only knowing the run total.
 */
export const TokenUsagePurposeSchema = z.enum([
  "seam_detection",
  "critic",
  "synthesis",
  "verification",
  "other",
]);
export type TokenUsagePurpose = z.infer<typeof TokenUsagePurposeSchema>;

/**
 * The real token usage and computed dollar cost of a single model call.
 *
 * Token fields mirror the Anthropic Messages API `usage` object so nothing is
 * lost in translation. `costUsd` is the fully-computed dollar cost for this one
 * call, accounting for the input/output split and the cache-read/cache-write
 * pricing multipliers (see `src/llm/pricing.ts`).
 */
export const TokenUsageSchema = z.object({
  /** The exact model ID that served the call, e.g. `claude-opus-4-8`. */
  model: z.string().min(1),
  /** Which pipeline phase incurred this call. */
  purpose: TokenUsagePurposeSchema,
  /** Uncached input tokens, billed at the model's full input rate. */
  inputTokens: z.number().int().nonnegative(),
  /** Output tokens generated, billed at the model's output rate. */
  outputTokens: z.number().int().nonnegative(),
  /** Tokens written to the prompt cache this call (~1.25x input rate). */
  cacheCreationInputTokens: z.number().int().nonnegative(),
  /** Tokens served from the prompt cache this call (~0.1x input rate). */
  cacheReadInputTokens: z.number().int().nonnegative(),
  /** Fully-computed dollar cost of this single call. */
  costUsd: z.number().nonnegative(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/**
 * Aggregated COGS across all model calls in a review. Produced by summing the
 * per-call {@link TokenUsage} records (see `src/llm/pricing.ts#aggregateCost`).
 * This is what surfaces on a {@link ReviewResult} as the bottom-line cost.
 */
export const CostSchema = z.object({
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalCacheCreationInputTokens: z.number().int().nonnegative(),
  totalCacheReadInputTokens: z.number().int().nonnegative(),
  /** Bottom-line dollar cost of the whole review. */
  totalCostUsd: z.number().nonnegative(),
  /** Dollar cost broken down by model ID, for mix analysis. */
  costUsdByModel: z.record(z.string(), z.number()),
  /** Dollar cost broken down by pipeline phase, for COGS attribution. */
  costUsdByPurpose: z.record(TokenUsagePurposeSchema, z.number()),
});
export type Cost = z.infer<typeof CostSchema>;
