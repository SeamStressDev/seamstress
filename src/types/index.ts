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
 * The findings data model — the contract the whole engine is built against.
 *
 * Shapes are zod schemas (runtime-validatable at the eventual API boundary)
 * with their TS types inferred from them. These are deliberately the
 * load-bearing part of the foundation: the review pipeline (critics →
 * synthesis → verification) lands on top of them in the next build.
 */

// Runtime schemas (values).
export { TokenUsagePurposeSchema, TokenUsageSchema, CostSchema } from "./cost.js";
export { SeamKindSchema, SourceLocationSchema, SeamSchema } from "./seam.js";
export {
  BlastRadiusRankSchema,
  VerificationStatusSchema,
  ConfidenceSchema,
  FindingSchema,
} from "./finding.js";
export {
  VerificationEvidenceSchema,
  VerificationResultSchema,
} from "./verification.js";
export { ReviewTargetSchema, ReviewResultSchema } from "./review.js";

// Derivations over the shapes.
export { effectiveStatus } from "./status.js";

// Inferred types.
export type { TokenUsage, TokenUsagePurpose, Cost } from "./cost.js";
export type { Seam, SeamKind, SourceLocation } from "./seam.js";
export type {
  Finding,
  BlastRadiusRank,
  VerificationStatus,
  Confidence,
} from "./finding.js";
export type {
  VerificationResult,
  VerificationEvidence,
} from "./verification.js";
export type { ReviewResult, ReviewTarget } from "./review.js";
