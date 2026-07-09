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
 * The end-to-end seam-map: repo path in → readable risk map out.
 *
 * Wires the whole engine: detectSeams (Build 3) → reviewSeams (Build 2), with
 * three things the map needs that the pieces didn't have on their own:
 *
 * - BOUNDED CONCURRENCY + PER-SEAM ISOLATION — many-seam repos review through a
 *   small pool, and one seam's review blowing up records that seam as errored
 *   without tanking the whole map (the review analog of detection's per-file
 *   isolation).
 * - A COVERAGE SIGNAL — the heuristic's recall ceiling is per-stack and a missed
 *   seam is otherwise SILENT. The map detects the repo's stack and, when it is
 *   not one of the validated stacks (JS/TS, Python), says so honestly in the
 *   output. A map that silently under-reports risk is worse than no map.
 * - POOLED cost across detection + review.
 */

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { aggregateCost } from "../llm/index.js";
import type { Cost, ReviewResult, ReviewTarget, Seam, TokenUsage } from "../types/index.js";
import type { DetectorConfig } from "./detection.js";
import type { ModelCaller, ReviewConfig } from "./config.js";
import { detectSeams } from "./detector.js";
import { sourceFileStats } from "./heuristic.js";
import type { ScanCapture } from "./heuristic.js";
import type { RunContext } from "./run-context.js";
import { mergeReviews, reviewSeam } from "./pipeline.js";
import { DEFAULT_REVIEW_CONCURRENCY, mapWithConcurrency } from "./concurrency.js";

/** How well the heuristic's signal set is expected to cover a repo's stack. */
export interface CoverageSignal {
  /** Human label for the detected stack, e.g. "JavaScript/TypeScript". */
  stack: string;
  /** True when the stack is one the detector has been validated on. */
  wellTuned: boolean;
  /** Honest caveat for the report when not well-tuned, else null. */
  caveat: string | null;
}

/** A seam whose review failed and was isolated out of the map. */
export interface ErroredSeam {
  seamId: string;
  label: string;
  error: string;
}

/** The full structured seam-map for a repo. */
export interface SeamMap {
  repoPath: string;
  /** Total source files scanned by the heuristic. */
  filesScanned: number;
  /** High-risk candidate files the heuristic surfaced. */
  candidatesFound: number;
  /** Seams the detector confirmed (all of them, incl. ones reviewed clean). */
  seams: Seam[];
  /** The pooled review over the seams that reviewed successfully. */
  review: ReviewResult;
  /** Seams whose review was isolated out by an error. */
  erroredSeams: ErroredSeam[];
  /** Detection-stage cost only. */
  detectionCost: Cost;
  /** Review-stage cost only. */
  reviewCost: Cost;
  /** Detection + review combined. */
  totalCost: Cost;
  /** The honest stack-coverage signal. */
  coverage: CoverageSignal;
  /** The resolved run context this map was built under. */
  runContext: RunContext;
}

/** Options for {@link mapSeams}. */
export interface MapSeamsOptions {
  client: ModelCaller;
  /** Review target; defaults to repo basename + a best-effort commit. */
  target?: ReviewTarget;
  /** Detector config (judge model, etc.). */
  detectorConfig?: DetectorConfig;
  /** Review config (critic/synthesis/verification models). */
  reviewConfig?: ReviewConfig;
  /** Max seams reviewed concurrently (default {@link DEFAULT_REVIEW_CONCURRENCY}). */
  concurrency?: number;
  /** Cap candidates judged during detection. */
  maxCandidates?: number;
  /** Whose code this run examines; unspecified resolves to "user" (no-capture). */
  runContext?: RunContext;
  /**
   * Measurement capture session (slice 1b), threaded to the detection scan.
   * Fed only when the run context is capture-permitted — the gate lives at
   * the scan site. The CALLER owns verdict registration and the flush;
   * mapSeams itself never writes measurement data.
   */
  capture?: ScanCapture;
}

/** Manifest files that pin a stack, in priority order. */
const STACK_MANIFESTS: { file: string; stack: string; wellTuned: boolean }[] = [
  { file: "manage.py", stack: "Python (Django)", wellTuned: true },
  { file: "pyproject.toml", stack: "Python", wellTuned: true },
  { file: "requirements.txt", stack: "Python", wellTuned: true },
  { file: "next.config.js", stack: "JavaScript/TypeScript (Next.js)", wellTuned: true },
  { file: "next.config.mjs", stack: "JavaScript/TypeScript (Next.js)", wellTuned: true },
  { file: "Gemfile", stack: "Ruby", wellTuned: false },
  { file: "go.mod", stack: "Go", wellTuned: false },
  { file: "composer.json", stack: "PHP", wellTuned: false },
  { file: "pom.xml", stack: "Java", wellTuned: false },
  { file: "Cargo.toml", stack: "Rust", wellTuned: false },
];

/** Extension → (stack label, validated?). Fallback when no manifest pins it. */
const EXT_STACK: Record<string, { stack: string; wellTuned: boolean }> = {
  ".ts": { stack: "JavaScript/TypeScript", wellTuned: true },
  ".tsx": { stack: "JavaScript/TypeScript", wellTuned: true },
  ".js": { stack: "JavaScript/TypeScript", wellTuned: true },
  ".jsx": { stack: "JavaScript/TypeScript", wellTuned: true },
  ".py": { stack: "Python", wellTuned: true },
  ".rb": { stack: "Ruby", wellTuned: false },
  ".go": { stack: "Go", wellTuned: false },
  ".php": { stack: "PHP", wellTuned: false },
  ".java": { stack: "Java", wellTuned: false },
  ".rs": { stack: "Rust", wellTuned: false },
};

const NOT_TUNED_CAVEAT =
  "Detection coverage may be incomplete for this stack — SeamStress is validated " +
  "on JavaScript/TypeScript (Next.js) and Python (Django). On other stacks the " +
  "pre-filter may miss real seams; treat this map as a floor on the risk, not a " +
  "complete inventory.";

/**
 * Decide how well the detector's signals fit this repo's stack. Prefers a
 * manifest (most reliable), falling back to the dominant source extension. PURE
 * given the inputs, so it is unit-testable.
 */
export function assessCoverage(
  repoPath: string,
  byExt: Record<string, number>,
): CoverageSignal {
  for (const m of STACK_MANIFESTS) {
    if (existsSync(join(repoPath, m.file))) {
      return { stack: m.stack, wellTuned: m.wellTuned, caveat: m.wellTuned ? null : NOT_TUNED_CAVEAT };
    }
  }

  const dominant = Object.entries(byExt).sort((a, b) => b[1] - a[1])[0]?.[0];
  const hit = dominant ? EXT_STACK[dominant] : undefined;
  if (hit) {
    return { stack: hit.stack, wellTuned: hit.wellTuned, caveat: hit.wellTuned ? null : NOT_TUNED_CAVEAT };
  }
  return { stack: "unknown", wellTuned: false, caveat: NOT_TUNED_CAVEAT };
}

/** Best-effort review target from a repo path (commit is left as working-tree). */
function defaultTarget(repoPath: string): ReviewTarget {
  return { repo: basename(repoPath.replace(/\/+$/, "")) || "repo", commit: "working-tree" };
}

/**
 * Build the end-to-end seam-map for a repo: detect → review (bounded, isolated)
 * → assemble. Never throws for a single seam's review failure; that seam is
 * reported as errored and the rest of the map is produced.
 */
export async function mapSeams(repoPath: string, options: MapSeamsOptions): Promise<SeamMap> {
  const { client } = options;
  const target = options.target ?? defaultTarget(repoPath);
  const concurrency = options.concurrency ?? DEFAULT_REVIEW_CONCURRENCY;

  const stats = sourceFileStats(repoPath);
  const coverage = assessCoverage(repoPath, stats.byExt);

  // Stage 1 — detect.
  const detection = await detectSeams(repoPath, {
    client,
    ...(options.detectorConfig ? { config: options.detectorConfig } : {}),
    ...(options.maxCandidates !== undefined ? { maxCandidates: options.maxCandidates } : {}),
    ...(options.runContext !== undefined ? { runContext: options.runContext } : {}),
    ...(options.capture !== undefined ? { scan: { capture: options.capture } } : {}),
  });

  // Stage 2 — review with bounded concurrency + per-seam isolation.
  const outcomes = await mapWithConcurrency(detection.seams, concurrency, async (seam) => {
    try {
      const result = await reviewSeam(seam, {
        client,
        target,
        ...(options.reviewConfig ? { config: options.reviewConfig } : {}),
      });
      return { seam, result, error: null as string | null };
    } catch (err) {
      return { seam, result: null as ReviewResult | null, error: String(err).slice(0, 200) };
    }
  });

  const reviewed = outcomes
    .filter((o): o is { seam: Seam; result: ReviewResult; error: null } => o.result !== null)
    .map((o) => ({ seam: o.seam, result: o.result }));
  const erroredSeams: ErroredSeam[] = outcomes
    .filter((o) => o.result === null)
    .map((o) => ({ seamId: o.seam.id, label: o.seam.label, error: o.error ?? "unknown error" }));

  const review = mergeReviews(reviewed, target);
  const reviewUsages: TokenUsage[] = review.usages;
  const totalUsages = [...detection.usages, ...reviewUsages];

  return {
    repoPath,
    filesScanned: stats.scanned,
    candidatesFound: detection.candidatesFound,
    seams: detection.seams,
    review,
    erroredSeams,
    detectionCost: detection.cost,
    reviewCost: review.cost,
    totalCost: aggregateCost(totalUsages),
    coverage,
    runContext: detection.runContext,
  };
}
