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
