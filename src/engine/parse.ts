/**
 * The wire shapes the pipeline asks models to emit, plus defensive extraction.
 *
 * Models return prose-wrapped JSON more often than not, so every model output in
 * the pipeline goes through {@link extractJsonObject} (tolerant extraction) and
 * then a zod schema (strict validation). Parsing never trusts the model: it
 * extracts what it can and fails loudly with a {@link ModelOutputParseError}
 * when it can't, rather than letting a malformed response poison a Finding.
 */

import { z } from "zod";
import {
  BlastRadiusRankSchema,
  ConfidenceSchema,
  SourceLocationSchema,
  VerificationEvidenceSchema,
} from "../types/index.js";

/**
 * A finding as a critic or synthesis *emits* it — the raw claim, before the
 * pipeline assigns it a stable `id` and `seamId`. Mapped onto a {@link Finding}
 * by the pipeline; deliberately the same field set minus the identity columns.
 */
export const FindingDraftSchema = z.object({
  /** What the issue is, in plain terms. */
  description: z.string().min(1),
  /** Why the reviewer believes this is an issue. */
  reasoning: z.string().min(1),
  /** Consequence if real (see BlastRadiusRankSchema). */
  blastRadius: BlastRadiusRankSchema,
  /** How sure the critic is the finding is real — optional. */
  confidence: ConfidenceSchema.optional(),
  /** Optional precise location(s) the finding points at. */
  locations: z.array(SourceLocationSchema).optional(),
});
export type FindingDraft = z.infer<typeof FindingDraftSchema>;

/** A single critic's structured response: a list of finding drafts. */
export const CriticResponseSchema = z.object({
  findings: z.array(FindingDraftSchema),
});
export type CriticResponse = z.infer<typeof CriticResponseSchema>;

/**
 * Synthesis output: the consolidated, deduped, blast-radius-ranked finding list
 * plus a human-readable summary of what the review concluded.
 */
export const SynthesisResponseSchema = z.object({
  summary: z.string().min(1),
  findings: z.array(FindingDraftSchema),
});
export type SynthesisResponse = z.infer<typeof SynthesisResponseSchema>;

/**
 * The verdict a verifier may reach. A subset of VerificationStatus that
 * EXCLUDES `unverified` — a verifier that actually ran always reaches a real
 * verdict. `unverified` is a *derived* state (no result), never a produced one.
 */
export const VerificationVerdictSchema = z.enum([
  "verified_real",
  "false_positive",
  "judgment_call",
]);
export type VerificationVerdict = z.infer<typeof VerificationVerdictSchema>;

/**
 * A verifier's structured response for one finding: the verdict, the real code
 * quoted as evidence, and a note explaining how the evidence supports it.
 */
export const VerificationResponseSchema = z.object({
  status: VerificationVerdictSchema,
  evidence: z.array(VerificationEvidenceSchema),
  note: z.string().min(1),
});
export type VerificationResponse = z.infer<typeof VerificationResponseSchema>;

/**
 * Thrown when a model's output cannot be coerced into the expected shape — no
 * JSON object found, unparseable JSON, or a zod validation failure. Carries the
 * raw text so the failure is debuggable rather than opaque.
 */
export class ModelOutputParseError extends Error {
  constructor(
    message: string,
    public readonly rawText: string,
  ) {
    super(message);
    this.name = "ModelOutputParseError";
  }
}

/**
 * Pull the first JSON object out of a model response, tolerant of the common
 * ways a model wraps it: a ```json fenced block, a plain ``` fenced block, or a
 * bare object embedded in prose. Returns the parsed (but un-validated) value.
 *
 * Strategy: prefer a fenced block if present; otherwise take the span from the
 * first `{` to the last `}`. Either way the result is `JSON.parse`d, so a
 * genuinely malformed response throws rather than silently returning junk.
 */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? sliceFirstObject(text);

  if (candidate === undefined) {
    throw new ModelOutputParseError(
      "No JSON object found in model output.",
      text,
    );
  }

  try {
    return JSON.parse(candidate.trim());
  } catch (err) {
    throw new ModelOutputParseError(
      `Model output was not valid JSON: ${(err as Error).message}`,
      text,
    );
  }
}

/** The substring from the first `{` to the last `}`, or undefined if absent. */
function sliceFirstObject(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return undefined;
  return text.slice(start, end + 1);
}

/**
 * Extract + zod-validate a model response in one step. Throws
 * {@link ModelOutputParseError} (with the raw text) on either an extraction
 * failure or a schema-validation failure, so callers get one error type.
 */
export function parseModelJson<T>(text: string, schema: z.ZodType<T>): T {
  const raw = extractJsonObject(text);
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ModelOutputParseError(
      `Model output did not match the expected shape: ${result.error.message}`,
      text,
    );
  }
  return result.data;
}
