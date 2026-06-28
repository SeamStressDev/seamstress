/**
 * A seam: a high-risk boundary in the codebase that the engine reviews.
 *
 * Seams are the unit of review. Rather than reviewing a whole diff uniformly,
 * the engine identifies the boundaries where a mistake is expensive — auth
 * checks, money paths, PII handling, deletion — and focuses disciplined,
 * cross-model judgment there.
 */

import { z } from "zod";

/**
 * The category of high-risk boundary. Keyed on the *kind of harm* a bug at this
 * boundary would cause, which is what drives how much scrutiny it warrants.
 */
export const SeamKindSchema = z.enum([
  "auth",
  "money_path",
  "pii",
  "data_deletion",
  "safety_delivery",
  "other",
]);
export type SeamKind = z.infer<typeof SeamKindSchema>;

/**
 * A pointer into the source: a file, with an optional line range. A seam may
 * span several of these (e.g. a check in one file, the call site in another).
 */
export const SourceLocationSchema = z.object({
  /** Repo-relative path to the file, e.g. `src/auth/session.ts`. */
  path: z.string().min(1),
  /** 1-indexed first line of the relevant range, inclusive. Omit for whole-file. */
  startLine: z.number().int().positive().optional(),
  /** 1-indexed last line of the relevant range, inclusive. Omit for whole-file. */
  endLine: z.number().int().positive().optional(),
});
export type SourceLocation = z.infer<typeof SourceLocationSchema>;

/**
 * A high-risk boundary under review.
 */
export const SeamSchema = z.object({
  /** Stable identifier for this seam within a review. */
  id: z.string().min(1),
  /** What category of boundary this is — drives the harm model. */
  kind: SeamKindSchema,
  /** Short human-readable label, e.g. "withdraw() balance check". */
  label: z.string(),
  /** Where in the source this seam lives. At least one location. */
  sources: z.array(SourceLocationSchema).min(1),
  /**
   * The assembled context handed to the reviewing models: the seam's code plus
   * whatever surrounding context (callers, related checks) was gathered to make
   * it reviewable in isolation.
   */
  inputText: z.string(),
});
export type Seam = z.infer<typeof SeamSchema>;
