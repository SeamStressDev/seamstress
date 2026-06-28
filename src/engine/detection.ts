/**
 * Stage 2 of the detector — LLM judgment, with PER-FILE ISOLATION.
 *
 * Each heuristic candidate gets one LLM call (default Sonnet — Phase 1's verified
 * tier, adequate to classify/reject): is this a real seam, and if so what kind?
 * The system prompt states the Phase 2 precision lesson to the judge — flag only
 * files that *implement or guard* a high-risk operation, not files that merely
 * render UI that triggers one.
 *
 * Per-file isolation is the Phase 2 carry-forward: in the validation pass a
 * single `confidence`-omitted response aborted the WHOLE scan. Here every
 * candidate's call+parse is wrapped so one bad response (malformed JSON, schema
 * miss, or a terminal API error that survived retry) records that file as
 * errored and the scan continues. Never all-or-nothing. This is the parse-axis
 * analog of the retry work (which isolates transient *API* failures).
 */

import { z } from "zod";
import { aggregateCost } from "../llm/index.js";
import { SeamKindSchema } from "../types/index.js";
import type { Cost, Seam, SeamKind, TokenUsage } from "../types/index.js";
import type { ModelCaller } from "./config.js";
import { assembleSeam } from "./assembly.js";
import type { Candidate } from "./heuristic.js";
import { extractJsonObject } from "./parse.js";
import { PlaceholderPromptError } from "./prompts.js";

/** Default model for seam judgment — Sonnet, per Phase 1. */
export const DEFAULT_DETECTION_MODEL = "claude-sonnet-4-6";

/** Configuration for the judgment stage. */
export interface DetectorConfig {
  /** Model that judges each candidate. */
  judgeModel: string;
  /** Output-token cap per judgment call. */
  maxTokens: number;
}

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  judgeModel: DEFAULT_DETECTION_MODEL,
  maxTokens: 600,
};

/**
 * The judge's response. `confidence` is OPTIONAL (Phase 2 found models omit it)
 * and `kind` is null when the file is not a seam. Tolerant by design so a
 * well-formed-but-sparse answer still parses.
 */
export const DetectionResponseSchema = z.object({
  isSeam: z.boolean(),
  kind: SeamKindSchema.nullable(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  reasoning: z.string(),
});
export type DetectionResponse = z.infer<typeof DetectionResponseSchema>;

const DETECTION_SYSTEM =
  "You triage source files for a seam-scoped code reviewer. A SEAM is a high-risk " +
  "boundary where a mistake is EXPENSIVE: an auth/authorization check, a money path " +
  "(payments, billing, refunds, balances), PII handling, data deletion, or critical " +
  "delivery (a notification that MUST arrive). Most files are NOT seams — UI " +
  "components, config, presentational pages, navigation, loading states. Be " +
  "disciplined: flagging everything is useless. Flag a file ONLY if it IMPLEMENTS or " +
  "GUARDS a high-risk operation — NOT if it merely renders UI that triggers one " +
  "(a form or button whose server action lives elsewhere is NOT the seam; the action " +
  "is). Classify by the harm a bug would cause.";

/** A candidate paired with its real source — the unit the judge sees. */
export interface CandidateSource {
  candidate: Candidate;
  source: string;
}

/** Per-candidate outcome: a confirmed seam, a rejection, or an isolated error. */
export interface JudgedCandidate {
  path: string;
  /** The judge's verdict, or null if the call/parse errored. */
  response: DetectionResponse | null;
  /** Assembled seam when confirmed, else null. */
  seam: Seam | null;
  /** Error message when this candidate was isolated out, else null. */
  error: string | null;
  /** Token usage for the call, if it completed (even if parsing then failed). */
  usage: TokenUsage | null;
}

/** Build the judgment prompt and assert the real source is in it (placeholder guard). */
export function buildDetectionPrompt(cs: CandidateSource): string {
  const { candidate, source } = cs;
  const user =
    `File: ${candidate.path}\n\n` +
    "----- BEGIN SOURCE -----\n" +
    source +
    "\n----- END SOURCE -----\n\n" +
    "Is this file a high-risk seam? Respond with ONLY a JSON object:\n" +
    '{ "isSeam": true|false, "kind": "auth|money_path|pii|data_deletion|safety_delivery|other"|null, ' +
    '"confidence": "high|medium|low", "reasoning": "one sentence: the risky operation it implements/guards, or why it is not a seam" }';

  if (source.trim().length === 0 || !user.includes(source)) {
    throw new PlaceholderPromptError(candidate.path);
  }
  return user;
}

/**
 * Judge ONE candidate. Always resolves (never throws): a call or parse failure
 * is captured on the returned {@link JudgedCandidate} as `error`, so the caller
 * can keep going. This is the per-file isolation boundary.
 */
export async function judgeCandidate(
  cs: CandidateSource,
  client: ModelCaller,
  config: DetectorConfig = DEFAULT_DETECTOR_CONFIG,
): Promise<JudgedCandidate> {
  const path = cs.candidate.path;
  let usage: TokenUsage | null = null;
  try {
    const user = buildDetectionPrompt(cs);
    const result = await client.callModel({
      model: config.judgeModel,
      system: DETECTION_SYSTEM,
      maxTokens: config.maxTokens,
      purpose: "seam_detection",
      messages: [{ role: "user", content: user }],
    });
    usage = result.usage;

    const parsed = DetectionResponseSchema.parse(extractJsonObject(result.text));
    const seam =
      parsed.isSeam && parsed.kind !== null
        ? assembleSeam(cs.candidate, cs.source, parsed.kind as SeamKind)
        : null;
    return { path, response: parsed, seam, error: null, usage };
  } catch (err) {
    // Isolate: record and continue. One bad file never aborts the scan.
    return { path, response: null, seam: null, error: String(err).slice(0, 200), usage };
  }
}

/** The full output of a detection run. */
export interface DetectionResult {
  /** Confirmed seams, ready to feed reviewSeams. */
  seams: Seam[];
  /** Every candidate's outcome (confirmed, rejected, or errored). */
  judged: JudgedCandidate[];
  /** Candidates that errored out (isolated), for visibility. */
  errors: JudgedCandidate[];
  /** Per-call usage across the run. */
  usages: TokenUsage[];
  /** Aggregated detection COGS. */
  cost: Cost;
}

/**
 * Judge a batch of candidates with per-file isolation, then collect the
 * confirmed seams and pooled COGS. Candidates run concurrently; a failure in one
 * never rejects the batch (each {@link judgeCandidate} resolves).
 */
export async function judgeCandidates(
  candidates: CandidateSource[],
  client: ModelCaller,
  config: DetectorConfig = DEFAULT_DETECTOR_CONFIG,
): Promise<DetectionResult> {
  const judged = await Promise.all(
    candidates.map((cs) => judgeCandidate(cs, client, config)),
  );

  const usages = judged.map((j) => j.usage).filter((u): u is TokenUsage => u !== null);
  return {
    seams: judged.map((j) => j.seam).filter((s): s is Seam => s !== null),
    judged,
    errors: judged.filter((j) => j.error !== null),
    usages,
    cost: aggregateCost(usages),
  };
}
