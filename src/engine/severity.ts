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
 * Severity calibration — the reachability/exploitability discount (Iteration C).
 *
 * Severity (`blastRadius`) is assigned on impact-magnitude-IF-real, with no
 * signal for whether the bad outcome is currently REACHABLE. So a true-but-
 * LATENT architectural concern ("structurally permits…", "nothing prevents…",
 * "no … constraint") with large hypothetical impact rates `critical` identically
 * to an immediately-triggerable exploit. Four real cases shipped this way — a
 * service-role client with no structural import guard, a mutable exported config
 * object, a schema that structurally permits a privileged row, and a fixed-key
 * webhook upsert — and had to be hand-rejected.
 *
 * This is a PROGRAMMATIC enforcement (the model under-discounts exactly this even
 * when instructed — the reachability-gate precedent): a finding rated
 * critical/high whose harm is latent and has no cited reachable path is capped at
 * `medium`. The companion prompt-side rubric (in prompts.ts) reduces how often an
 * inflated label is emitted and produces the `reachability` signal; this function
 * is the deterministic safety net for the labels that slip through.
 *
 * It adds a reachability discount to the `blastRadius` judgment ONLY — it does not
 * touch `confidence` (is the claim true), which stays a separate axis.
 *
 * Pure: no I/O, no model calls, deterministic string/regex analysis only.
 */

import type { BlastRadiusRank } from "../types/index.js";

/** The rank a latent, non-reachable finding is capped to. */
const LATENT_CAP: BlastRadiusRank = "medium";

/**
 * Marker phrases that describe a hypothetical/structural possibility rather than
 * a demonstrated bad outcome. Presence alone does NOT cap — see the trigger check.
 */
const LATENT_MARKERS: RegExp[] = [
  /\bstructurally permits\b/i,
  /\bnothing (?:structural\w*\s+)?prevents\b/i,
  /\bno\b[^.\n]{0,40}\b(?:check\s+)?constraint\b/i,
  /\bany\b[^.\n]{0,40}\b(?:module|caller|code|importer)\b[^.\n]{0,20}\b(?:could|can|may)\b/i,
  /\bin theory\b/i,
  /\bwould allow\b/i,
  /\bis not enforced\b|\bonly (?:a |an )?(?:advisory|documentation) (?:comment|convention)\b/i,
  /\bpermits? (?:a |the )?(?:row|state|combination)\b/i,
];

/**
 * Phrases that cite a CONCRETE, currently-reachable trigger — a real input,
 * operation, or code path that produces the harm. If any of these is present the
 * finding is reachable and is NEVER capped, regardless of latent-sounding words
 * elsewhere (the over-match guard: "nothing prevents two concurrent uploads…").
 */
const CONCRETE_TRIGGERS: RegExp[] = [
  /\bif a (?:user|caller|request|client)\b/i,
  /\b(?:two|multiple|concurrent|simultaneous|parallel)\b[^.\n]{0,40}\b(?:request|call|upload|delivery|deliveries|confirm|transaction|write|submit)/i,
  /\ba (?:double|second|repeat)[- ](?:submit|click|call|request|delivery)\b/i,
  /\b(?:an?\s+)?attacker\b/i,
  /\bdeferred confirm\b|\bafter the account fills\b/i,
  /\b(?:user|caller|client)-(?:supplied|controlled|provided)\b/i,
  /\bon (?:every|each)\b[^.\n]{0,30}\b(?:request|checkout|call|upload|webhook|event)/i,
  /\bcan (?:call|invoke|trigger|reach|open|submit|upload)\b/i,
];

/** A finding/draft slice this function needs to judge severity. */
export interface SeverityInput {
  blastRadius: BlastRadiusRank;
  description: string;
  reasoning: string;
  /** Model-emitted reachability classification, when the rubric produced it. */
  reachability?: "reachable" | "latent" | undefined;
}

/** Does the text cite a concrete, currently-reachable trigger? */
function hasConcreteTrigger(text: string): boolean {
  return CONCRETE_TRIGGERS.some((re) => re.test(text));
}

/** Does the text read as latent/architectural (marker present)? */
function hasLatentMarker(text: string): boolean {
  return LATENT_MARKERS.some((re) => re.test(text));
}

/**
 * Decide whether a finding is latent (architectural, no demonstrated reachable
 * path). Prefers the model's structured `reachability` signal; falls back to
 * marker-vs-trigger text analysis. A cited concrete trigger always wins → not
 * latent, even with latent-sounding words.
 */
function isLatent(input: SeverityInput): boolean {
  const text = `${input.description}\n${input.reasoning}`;
  if (hasConcreteTrigger(text)) return false; // reachable beats everything
  if (input.reachability === "reachable") return false;
  if (input.reachability === "latent") return true;
  return hasLatentMarker(text);
}

/** Rank order, for the cap comparison (lower index = more severe). */
const RANK_ORDER: BlastRadiusRank[] = ["critical", "high", "medium", "low"];

/**
 * Calibrate a finding's severity: cap a latent, non-reachable critical/high
 * finding at `medium`; otherwise return the blast radius unchanged. Pure.
 *
 * Returns the (possibly lowered) blastRadius plus, when capped, a one-line note
 * to append explaining why.
 */
export function calibrateSeverity(
  input: SeverityInput,
): { blastRadius: BlastRadiusRank; capNote: string | null } {
  const isElevated = input.blastRadius === "critical" || input.blastRadius === "high";
  if (!isElevated || !isLatent(input)) {
    return { blastRadius: input.blastRadius, capNote: null };
  }
  // Only lower — never raise. (medium/low already returned above via isElevated.)
  const capped = RANK_ORDER.indexOf(LATENT_CAP) > RANK_ORDER.indexOf(input.blastRadius)
    ? LATENT_CAP
    : input.blastRadius;
  return {
    blastRadius: capped,
    capNote:
      "[SeamStress severity calibration: capped to medium — this is a latent/" +
      "architectural concern with no cited, currently-reachable path that produces " +
      "the harm. Impact-if-it-happened alone does not earn critical/high.]",
  };
}
