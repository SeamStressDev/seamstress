/**
 * The top-level output of a full seam review.
 */

import { z } from "zod";
import { CostSchema, TokenUsageSchema } from "./cost.js";
import { FindingSchema } from "./finding.js";
import { SeamSchema } from "./seam.js";

/**
 * Identifies exactly what was reviewed, so a result can be tied back to a
 * precise point in history.
 */
export const ReviewTargetSchema = z.object({
  /** Repo identifier, e.g. `SeamStressDev/seamstress` or a clone path. */
  repo: z.string().min(1),
  /** The commit SHA reviewed. */
  commit: z.string().min(1),
});
export type ReviewTarget = z.infer<typeof ReviewTargetSchema>;

/**
 * The complete output of reviewing a target's seams: what was reviewed, the
 * seams found, the ranked findings, the full COGS accounting, and a synthesis.
 */
export const ReviewResultSchema = z.object({
  /** What was reviewed (repo + commit). */
  target: ReviewTargetSchema,
  /** The high-risk boundaries the engine identified and reviewed. */
  seams: z.array(SeamSchema),
  /**
   * Every finding surfaced, ordered by blast radius (most consequential first).
   * Ordering is the producer's responsibility; consumers can rely on it.
   */
  findings: z.array(FindingSchema),
  /**
   * Every model call made during the review, in order. The raw per-call COGS
   * primitive — the aggregate in {@link ReviewResultSchema} `cost` is derived
   * from this.
   */
  usages: z.array(TokenUsageSchema),
  /** Aggregated COGS for the whole review, derived from `usages`. */
  cost: CostSchema,
  /** Human-readable synthesis summarizing what the review concluded. */
  synthesis: z.string(),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
