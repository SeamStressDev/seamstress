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
import { resolveRunContext } from "./run-context.js";
import type { RunContext } from "./run-context.js";

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
  /** Whose code this run examines; unspecified resolves to "user" (no-capture). */
  runContext?: RunContext;
}

/** A detection run plus the raw candidate list (for reporting recall/precision). */
export interface DetectSeamsResult extends DetectionResult {
  /** The heuristic candidates considered (after the maxCandidates cap). */
  candidates: Candidate[];
  /** Total candidates the heuristic produced before the cap. */
  candidatesFound: number;
  /** The resolved run context this detection ran under. */
  runContext: RunContext;
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

  // Resolve once at the boundary; the top-level option wins over scan options.
  const runContext = resolveRunContext(options.runContext ?? options.scan?.runContext);
  const allCandidates = scanRepo(repoPath, { ...(options.scan ?? {}), runContext });
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
    runContext,
  };
}
