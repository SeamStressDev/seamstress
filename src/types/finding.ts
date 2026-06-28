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
 */
export const VerificationStatusSchema = z.enum([
  "unverified",
  "verified_real",
  "false_positive",
  "judgment_call",
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

/**
 * Something a review surfaced about a {@link Seam}.
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
  /** Where this finding stands after verification (see {@link VerificationStatusSchema}). */
  verificationStatus: VerificationStatusSchema,
});
export type Finding = z.infer<typeof FindingSchema>;
