/**
 * A finding: something a review surfaced about a seam.
 */

import { z } from "zod";
import { SourceLocationSchema } from "./seam.js";

/**
 * How bad it is if this finding is real — keyed on **blast radius**, i.e. "what
 * happens if this is wrong," not on severity-in-the-abstract. A subtle typo on
 * a money path can be `critical`; a glaring issue with no real consequence is
 * `low`. This is deliberately a consequence scale, not a code-smell scale.
 */
export const BlastRadiusRankSchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
]);
export type BlastRadiusRank = z.infer<typeof BlastRadiusRankSchema>;

/**
 * Where a finding stands once checked against the real code. Mirrors exactly the
 * classification the validation runs used, so results stay comparable:
 *
 * - `unverified`     — surfaced by a reviewer but not yet checked against code.
 * - `verified_real`  — confirmed against the real code; it is a true issue.
 * - `false_positive` — checked and refuted; the code is actually fine.
 * - `judgment_call`  — real but contestable; depends on intent/context a human owns.
 *
 * NOTE: this status is **not** a field on {@link Finding}. A finding is inherently
 * unverified; its effective status is *derived* from whether a
 * {@link VerificationResult} exists for it. See {@link effectiveStatus} in
 * `status.ts`. This is deliberate: there is no way to represent a "verified"
 * finding with no evidence backing it — exactly the unverified-confident-claim
 * anti-pattern SeamStress exists to catch.
 */
export const VerificationStatusSchema = z.enum([
  "unverified",
  "verified_real",
  "false_positive",
  "judgment_call",
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

/**
 * How sure the critic is that a finding is *real* — distinct from
 * {@link BlastRadiusRankSchema}, which is how bad it would be *if* real.
 * Probability vs. consequence. Optional: a critic populates it when it has a
 * genuine read on likelihood, and absence is fine. Build 2 keeps ranking
 * blast-radius-ordered; this field captures the signal for later
 * probability×consequence weighting without committing to that machinery yet.
 */
export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/**
 * Something a review surfaced about a {@link Seam}.
 *
 * A `Finding` carries no verification status of its own — it is the raw claim a
 * critic made. Whether it has been confirmed against real code is derived from
 * the presence of a {@link VerificationResult} (see {@link effectiveStatus}).
 */
export const FindingSchema = z.object({
  /** Stable identifier for this finding within a review. */
  id: z.string().min(1),
  /** The seam this finding belongs to (references {@link Seam}.id). */
  seamId: z.string().min(1),
  /** What the issue is, in plain terms. */
  description: z.string(),
  /** Optional precise location(s) the finding points at, if narrower than the seam. */
  locations: z.array(SourceLocationSchema).optional(),
  /** How bad it is if real — consequence-keyed (see {@link BlastRadiusRankSchema}). */
  blastRadius: BlastRadiusRankSchema,
  /** Why the reviewer believes this is an issue — the chain of reasoning. */
  reasoning: z.string(),
  /**
   * One plain-language sentence on what actually happens if this specific issue
   * is real — emitted by the analyzing model, grounded in THIS finding and the
   * real code, NOT in the seam's category. Optional. The report displays this
   * directly; it must never be synthesized from the seam `kind` (that produced
   * mislabeled consequences — an isolation bug reading as "money can move the
   * wrong way" because its seam was filed under money_path).
   */
  consequence: z.string().optional(),
  /** How sure the critic is the finding is real, if offered (see {@link ConfidenceSchema}). */
  confidence: ConfidenceSchema.optional(),
});
export type Finding = z.infer<typeof FindingSchema>;
