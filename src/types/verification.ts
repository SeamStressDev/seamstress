/**
 * The outcome of checking a finding against the real code.
 */

import { z } from "zod";
import { VerificationStatusSchema } from "./finding.js";
import { SourceLocationSchema } from "./seam.js";

/**
 * A single piece of evidence used to confirm or refute a finding: real code
 * quoted from the repo, with the location it came from. Verification stands or
 * falls on grounding claims in actual code, so evidence carries both the quote
 * and where it lives.
 */
export const VerificationEvidenceSchema = z.object({
  /** The verbatim code that confirms or refutes the finding. */
  quotedCode: z.string(),
  /** Where the quoted code lives in the repo. */
  location: SourceLocationSchema,
});
export type VerificationEvidence = z.infer<typeof VerificationEvidenceSchema>;

/**
 * The result of verifying one {@link Finding} against the real code.
 */
export const VerificationResultSchema = z.object({
  /** The finding this verifies (references {@link Finding}.id). */
  findingId: z.string().min(1),
  /** The verdict reached (see {@link VerificationStatusSchema}). */
  status: VerificationStatusSchema,
  /** Real code quoted to support the verdict — confirming or refuting. */
  evidence: z.array(VerificationEvidenceSchema),
  /** Reviewer's note explaining the verdict and how the evidence supports it. */
  note: z.string(),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
