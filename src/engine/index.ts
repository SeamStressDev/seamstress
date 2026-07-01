/**
 * The review engine: given an assembled {@link Seam}, run blind critics →
 * synthesis → verification and produce a ranked {@link ReviewResult} with clean
 * COGS broken down by purpose. The validation-run flow, ported into software.
 *
 * Seam *detection* is Build 3 and deliberately not here; the engine takes a seam
 * as input and reviews it.
 */

export { reviewSeam, reviewSeams, mergeReviews, rankAndIdentify } from "./pipeline.js";
export type { ReviewSeamOptions } from "./pipeline.js";

// --- End-to-end seam-map (Build 4) ---
export { mapSeams, assessCoverage } from "./map.js";
export type {
  SeamMap,
  MapSeamsOptions,
  CoverageSignal,
  ErroredSeam,
} from "./map.js";
export { renderSeamMap, renderSeamMapHtml, renderCostSummary } from "./report.js";
export { mapWithConcurrency, DEFAULT_REVIEW_CONCURRENCY } from "./concurrency.js";
export { sourceFileStats } from "./heuristic.js";

// --- Detector (Build 3) ---
export { detectSeams } from "./detector.js";
export type { DetectSeamsOptions, DetectSeamsResult } from "./detector.js";
export {
  scanRepo,
  scoreSource,
  readCandidateSource,
  candidateLabel,
  DEFAULT_CANDIDATE_THRESHOLD,
  SAFETY_NET_MIN_SHAPES,
} from "./heuristic.js";
export type { Candidate, ScanOptions } from "./heuristic.js";
export {
  judgeCandidate,
  judgeCandidates,
  buildDetectionPrompt,
  DetectionResponseSchema,
  DEFAULT_DETECTION_MODEL,
  DEFAULT_DETECTOR_CONFIG,
} from "./detection.js";
export type {
  CandidateSource,
  JudgedCandidate,
  DetectionResult,
  DetectorConfig,
  DetectionResponse,
} from "./detection.js";
export { assembleSeam, blindConclusions, MAX_INPUT_TEXT_CHARS } from "./assembly.js";

export {
  DEFAULT_REVIEW_CONFIG,
  DEFAULT_CRITICS,
  DEFAULT_CRITIC_MODEL,
  DEFAULT_JUDGE_MODEL,
  DEFAULT_VERIFICATION_MODEL,
} from "./config.js";
export type { ModelCaller, ReviewConfig, CriticSpec } from "./config.js";

export { runCritics, runSynthesis, runVerification } from "./stages.js";
export type {
  CriticOutcome,
  SynthesisOutcome,
  VerificationOutcome,
} from "./stages.js";

export {
  assertSeamPresent,
  buildCriticPrompt,
  buildSynthesisPrompt,
  buildVerificationPrompt,
  PlaceholderPromptError,
  CRITIC_SYSTEM,
  SYNTHESIS_SYSTEM,
  VERIFICATION_SYSTEM,
} from "./prompts.js";
export type { BuiltPrompt } from "./prompts.js";

export {
  extractJsonObject,
  parseModelJson,
  ModelOutputParseError,
  FindingDraftSchema,
  CriticResponseSchema,
  SynthesisResponseSchema,
  VerificationResponseSchema,
  VerificationVerdictSchema,
} from "./parse.js";
export type {
  FindingDraft,
  CriticResponse,
  SynthesisResponse,
  VerificationResponse,
  VerificationVerdict,
} from "./parse.js";
