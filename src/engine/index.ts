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
 * The review engine: given an assembled {@link Seam}, run blind critics →
 * synthesis → verification and produce a ranked {@link ReviewResult} with clean
 * cost accounting broken down by purpose.
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
export { projectSeamMap, projectReview } from "./projection.js";
export type { FindingsProjection } from "./projection.js";
export { mapWithConcurrency, DEFAULT_REVIEW_CONCURRENCY } from "./concurrency.js";
export { sourceFileStats } from "./heuristic.js";

// --- Detector (Build 3) ---
export { detectSeams } from "./detector.js";
export type { DetectSeamsOptions, DetectSeamsResult } from "./detector.js";

// --- Run context (measurement charter, slice 1a) ---
export { resolveRunContext, isCapturePermitted } from "./run-context.js";
export type { RunContext } from "./run-context.js";
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
