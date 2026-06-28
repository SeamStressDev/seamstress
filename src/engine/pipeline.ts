/**
 * The review pipeline: given one assembled {@link Seam}, run blind critics →
 * synthesis → verification and assemble a ranked {@link ReviewResult} with clean
 * COGS broken down by purpose. This is the validation-run flow ported into
 * committed software. Seam *detection* (finding which code is a seam) is Build 3
 * and explicitly not here — this takes a seam as input and reviews it.
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
import type { FindingDraft } from "./parse.js";
import { runCritics, runSynthesis, runVerification } from "./stages.js";

/** Dependencies and options for a single review. */
export interface ReviewSeamOptions {
  /** The model caller (real {@link LlmClient} in prod, a fake in tests). */
  client: ModelCaller;
  /** What is being reviewed — recorded on the result. */
  target: ReviewTarget;
  /** Overrides {@link DEFAULT_REVIEW_CONFIG} when provided. */
  config?: ReviewConfig;
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
  const ranked = [...drafts].sort(
    (a, b) => BLAST_RADIUS_ORDER[a.blastRadius] - BLAST_RADIUS_ORDER[b.blastRadius],
  );
  return ranked.map((draft, i) => toFinding(draft, seamId, i));
}

/**
 * Review one seam end to end. Stages run in sequence (synthesis needs the
 * critics; verification needs the synthesized findings); within a stage, calls
 * fan out concurrently. Every call's usage is collected so {@link aggregateCost}
 * can break COGS down by model AND by purpose — the first time verification cost
 * is measured as a fraction of the review.
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
