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
 * The review pipeline: given one assembled {@link Seam}, run blind critics →
 * synthesis → verification and assemble a ranked {@link ReviewResult} with clean
 * cost broken down by purpose. Seam *detection* (finding which code is a seam)
 * is Build 3 and explicitly not here — this takes a seam as input and reviews it.
 */

import { aggregateCost } from "../llm/index.js";
import type {
  BlastRadiusRank,
  Finding,
  ReviewResult,
  ReviewTarget,
  Seam,
  TokenUsage,
  VerificationResult,
} from "../types/index.js";
import type { ModelCaller, ReviewConfig } from "./config.js";
import { DEFAULT_REVIEW_CONFIG } from "./config.js";
import { DEFAULT_REVIEW_CONCURRENCY, mapWithConcurrency } from "./concurrency.js";
import type { FindingDraft } from "./parse.js";
import { calibrateSeverity } from "./severity.js";
import { runCritics, runSynthesis, runVerification } from "./stages.js";

/** Dependencies and options for a single review. */
export interface ReviewSeamOptions {
  /** The model caller (real {@link LlmClient} in prod, a fake in tests). */
  client: ModelCaller;
  /** What is being reviewed — recorded on the result. */
  target: ReviewTarget;
  /** Overrides {@link DEFAULT_REVIEW_CONFIG} when provided. */
  config?: ReviewConfig;
  /** Max seams reviewed concurrently in {@link reviewSeams}. */
  concurrency?: number;
}

/** Blast-radius sort key — most consequential first. */
const BLAST_RADIUS_ORDER: Record<BlastRadiusRank, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Map a synthesized draft onto a real {@link Finding}, assigning identity.
 * Optional fields are omitted (not set to `undefined`) to satisfy
 * `exactOptionalPropertyTypes` and keep the illegal "present-but-undefined"
 * state off the shape.
 */
function toFinding(draft: FindingDraft, seamId: string, index: number): Finding {
  return {
    id: `finding-${index + 1}`,
    seamId,
    description: draft.description,
    reasoning: draft.reasoning,
    blastRadius: draft.blastRadius,
    ...(draft.confidence !== undefined ? { confidence: draft.confidence } : {}),
    ...(draft.consequence !== undefined ? { consequence: draft.consequence } : {}),
    ...(draft.locations !== undefined ? { locations: draft.locations } : {}),
  };
}

/**
 * Rank drafts by blast radius (stable within a rank) and assign finding IDs in
 * that order, so `finding-1` is always the most consequential. Sorting here —
 * not trusting the model's ordering — makes the "ranked by blast radius"
 * contract on {@link ReviewResult} authoritative.
 */
export function rankAndIdentify(drafts: FindingDraft[], seamId: string): Finding[] {
  // Severity calibration: cap a latent/architectural finding (no cited reachable
  // path) at medium BEFORE ranking, so it doesn't outrank a genuinely-reachable
  // one. A reachability discount on blastRadius only — confidence is untouched.
  const calibrated = drafts.map((draft): FindingDraft => {
    const { blastRadius, capNote } = calibrateSeverity(draft);
    if (blastRadius === draft.blastRadius) return draft;
    return {
      ...draft,
      blastRadius,
      reasoning: capNote ? `${draft.reasoning} ${capNote}` : draft.reasoning,
    };
  });

  const ranked = [...calibrated].sort(
    (a, b) => BLAST_RADIUS_ORDER[a.blastRadius] - BLAST_RADIUS_ORDER[b.blastRadius],
  );
  return ranked.map((draft, i) => toFinding(draft, seamId, i));
}

/**
 * Review one seam end to end. Stages run in sequence (synthesis needs the
 * critics; verification needs the synthesized findings); within a stage, calls
 * fan out concurrently. Every call's usage is collected so {@link aggregateCost}
 * can break cost down by model AND by purpose, including verification cost as a
 * fraction of the review.
 */
export async function reviewSeam(
  seam: Seam,
  options: ReviewSeamOptions,
): Promise<ReviewResult> {
  const { client, target } = options;
  const config = options.config ?? DEFAULT_REVIEW_CONFIG;
  const usages: TokenUsage[] = [];

  // Stage 1 — blind critics (concurrent, independent).
  const criticOutcomes = await runCritics(seam, client, config);
  for (const outcome of criticOutcomes) usages.push(outcome.usage);
  const criticDrafts = criticOutcomes.flatMap((o) => o.drafts);

  // Stage 2 — synthesis (one call, judgment over the pooled drafts).
  const synthesis = await runSynthesis(seam, criticDrafts, client, config);
  usages.push(synthesis.usage);

  // Rank + assign identity (code is authoritative on ordering).
  const findings = rankAndIdentify(synthesis.drafts, seam.id);

  // Stage 3 — verify every finding against the real source (concurrent).
  const verificationOutcomes = await Promise.all(
    findings.map((finding) => runVerification(seam, finding, client, config)),
  );
  const verifications: VerificationResult[] = [];
  for (const outcome of verificationOutcomes) {
    verifications.push(outcome.result);
    usages.push(outcome.usage);
  }

  return {
    target,
    seams: [seam],
    findings,
    verifications,
    usages,
    cost: aggregateCost(usages),
    synthesis: synthesis.summary,
  };
}

/**
 * Merge per-seam reviews into one pooled {@link ReviewResult}. Finding IDs are
 * namespaced so the merged `findings` / `verifications` don't collide across
 * seams and `effectiveStatus` still resolves each finding to its own
 * verification. `extraUsages` lets a caller fold in upstream cost (e.g.
 * detection) when pooling totals.
 *
 * TRUST-GATE INVARIANT (added after the trust-gate trio): the namespace prefix
 * is keyed on the seam's POSITION (`s<i>:`), not just `seam.id`. Two distinct
 * source paths can slugify to the SAME `seam.id` (`seamIdFor` lowercases and
 * collapses non-alphanumerics, so `a/Check.ts` and `a-check.ts` both become
 * `seam-a-check-ts`). A shared `seam.id:` prefix would alias `finding-1` across
 * the two seams, and the first-match `.find()` in `effectiveStatus` / the report
 * would bind ONE finding's verification + evidence to the OTHER finding — the
 * "evidence attaches to the wrong finding" catastrophe. The index is unique by
 * construction, so no slug collision can ever produce a duplicate finding ID.
 *
 * Exported so the end-to-end map can reuse the exact same merge after its own
 * per-seam-isolated review loop.
 */
export function mergeReviews(
  pairs: ReadonlyArray<{ seam: Seam; result: ReviewResult }>,
  target: ReviewTarget,
  extraUsages: readonly TokenUsage[] = [],
): ReviewResult {
  const seams: Seam[] = [];
  const findings: Finding[] = [];
  const verifications: VerificationResult[] = [];
  const usages: TokenUsage[] = [...extraUsages];
  const summaries: string[] = [];

  pairs.forEach(({ seam, result }, i) => {
    seams.push(seam);
    // Position-keyed prefix — unique even when two seams share a slugged id.
    const prefix = `s${i}:${seam.id}:`;
    for (const f of result.findings) findings.push({ ...f, id: `${prefix}${f.id}` });
    for (const v of result.verifications) {
      verifications.push({ ...v, findingId: `${prefix}${v.findingId}` });
    }
    usages.push(...result.usages);
    if (result.findings.length > 0 || result.synthesis) {
      summaries.push(`[${seam.label}] ${result.synthesis}`);
    }
  });

  return {
    target,
    seams,
    findings,
    verifications,
    usages,
    cost: aggregateCost(usages),
    synthesis: summaries.join("\n\n"),
  };
}

/**
 * Review MANY seams and pool the result into one {@link ReviewResult} with cost
 * aggregated across all of them — the clean join between detection (which
 * produces many seams) and review (Build 2's per-seam pipeline). Resolves the
 * Build 2 awkward-spot where each seam reviewed into its own cost silo.
 *
 * Reviews run with BOUNDED concurrency (default {@link DEFAULT_REVIEW_CONCURRENCY})
 * rather than an unbounded `Promise.all`, so a many-seam repo doesn't burst the
 * API. Strict: a seam review that throws propagates (the end-to-end map adds
 * per-seam isolation on top).
 */
export async function reviewSeams(
  seams: Seam[],
  options: ReviewSeamOptions,
): Promise<ReviewResult> {
  const concurrency = options.concurrency ?? DEFAULT_REVIEW_CONCURRENCY;
  const results = await mapWithConcurrency(seams, concurrency, (seam) =>
    reviewSeam(seam, options),
  );
  return mergeReviews(
    seams.map((seam, i) => ({ seam, result: results[i]! })),
    options.target,
  );
}
