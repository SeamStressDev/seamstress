/**
 * The seam detector — top-level orchestration: scan (heuristic) → read source →
 * judge (per-file-isolated LLM) → assemble Seam[]. Given a repo path it produces
 * the high-risk boundaries ready to feed {@link reviewSeams}. It does NOT review
 * them (that is Build 2) or wire the end-to-end map (that is the next build).
 */

import { readCandidateSource, scanRepo } from "./heuristic.js";
import type { Candidate, ScanOptions } from "./heuristic.js";
import { judgeCandidates, DEFAULT_DETECTOR_CONFIG } from "./detection.js";
import type {
  CandidateSource,
  DetectionResult,
  DetectorConfig,
} from "./detection.js";
import type { ModelCaller } from "./config.js";

/** Options for {@link detectSeams}. */
export interface DetectSeamsOptions {
  /** The model caller (real LlmClient in prod, a fake in tests). */
  client: ModelCaller;
  /** Judgment config; defaults to {@link DEFAULT_DETECTOR_CONFIG}. */
  config?: DetectorConfig;
  /** Heuristic scan options (threshold, file cap). */
  scan?: ScanOptions;
  /** Hard cap on candidates judged, bounding LLM cost on large repos. */
  maxCandidates?: number;
}

/** A detection run plus the raw candidate list (for reporting recall/precision). */
export interface DetectSeamsResult extends DetectionResult {
  /** The heuristic candidates considered (after the maxCandidates cap). */
  candidates: Candidate[];
  /** Total candidates the heuristic produced before the cap. */
  candidatesFound: number;
}

/**
 * Detect seams in a repo. Stage 1 (heuristic) is free; Stage 2 (judgment) costs
 * one call per candidate. Reading a candidate's source that fails is isolated —
 * that candidate is dropped from the batch, never aborting the run.
 */
export async function detectSeams(
  repoPath: string,
  options: DetectSeamsOptions,
): Promise<DetectSeamsResult> {
  const config = options.config ?? DEFAULT_DETECTOR_CONFIG;

  const allCandidates = scanRepo(repoPath, options.scan ?? {});
  const candidates =
    options.maxCandidates !== undefined
      ? allCandidates.slice(0, options.maxCandidates)
      : allCandidates;

  // Read each candidate's real source; a read failure isolates that file out.
  const withSource: CandidateSource[] = [];
  for (const candidate of candidates) {
    try {
      withSource.push({ candidate, source: readCandidateSource(repoPath, candidate) });
    } catch {
      // Unreadable candidate — skip it, keep scanning the rest.
    }
  }

  const detection = await judgeCandidates(withSource, options.client, config);
  return {
    ...detection,
    candidates,
    candidatesFound: allCandidates.length,
  };
}
