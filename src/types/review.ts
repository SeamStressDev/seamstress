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
 * The top-level output of a full seam review.
 */

import { z } from "zod";
import { CostSchema, TokenUsageSchema } from "./cost.js";
import { FindingSchema } from "./finding.js";
import { SeamSchema } from "./seam.js";
import { VerificationResultSchema } from "./verification.js";

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
 * seams found, the ranked findings, the full cost accounting, and a synthesis.
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
   * The verification results — the SOLE authority for finding status (Decision
   * 1). A finding's effective status is derived by looking it up here via
   * `effectiveStatus`; a finding with no entry here is `unverified`. Carrying
   * these on the result is what makes that derivation possible downstream.
   */
  verifications: z.array(VerificationResultSchema),
  /**
   * Every model call made during the review, in order. The raw per-call cost
   * primitive — the aggregate in {@link ReviewResultSchema} `cost` is derived
   * from this.
   */
  usages: z.array(TokenUsageSchema),
  /** Aggregated cost for the whole review, derived from `usages`. */
  cost: CostSchema,
  /** Human-readable synthesis summarizing what the review concluded. */
  synthesis: z.string(),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
