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
 * Review-pipeline configuration and the minimal model-calling dependency.
 *
 * Defaults encode the Build-2 decorrelation choice: 3 blind critics on the SAME
 * model, decorrelated by FRAMING (each critic is biased toward a different
 * failure mode) rather than by model. The per-critic `model` field is the clean
 * seam to go cross-model later — set distinct models per critic and the pipeline
 * runs them unchanged. The validation runs used cross-model; same-model+framing
 * is the lower-complexity stand-in we commit now.
 */

import type { CallModelParams, CallModelResult } from "../llm/index.js";

/**
 * The slice of {@link LlmClient} the pipeline needs. Declaring the structural
 * subset (rather than depending on the concrete class) is what lets tests inject
 * a fake caller with no network and no API key.
 */
export interface ModelCaller {
  callModel(params: CallModelParams): Promise<CallModelResult>;
}

/** One critic: which model runs it, a label for attribution, its framing lens. */
export interface CriticSpec {
  /** Model ID — must have a pricing entry. Vary per critic to go cross-model. */
  model: string;
  /** Stable label for logs/attribution, e.g. `critic-silent-failure`. */
  label: string;
  /** The decorrelating investigation emphasis handed to this critic. */
  framing: string;
}

/** Full configuration for one review run. */
export interface ReviewConfig {
  /** The blind critics to run, in order. Defaults to {@link DEFAULT_CRITICS}. */
  critics: CriticSpec[];
  /** Model for the single synthesis call. */
  synthesisModel: string;
  /** Model for each per-finding verification call. */
  verificationModel: string;
  /** Output-token cap for every call in the run. */
  maxTokens: number;
}

/** Default critic model — capable enough for the seam-review lenses, mid-cost. */
export const DEFAULT_CRITIC_MODEL = "claude-sonnet-4-6";
/** Default model for synthesis — the consolidation judgment runs on the top tier. */
export const DEFAULT_JUDGE_MODEL = "claude-opus-4-8";
/**
 * Default model for verification. Sonnet, not Opus: the Phase 1 tier experiment
 * (docs/seamstress-phase1-verification-tier.md) found Sonnet reproduced every
 * verdict on the critical/high findings with equally rigorous real-source
 * evidence at ~54% lower cost — its only divergences from Opus were
 * verified_real/judgment_call boundary calls on lower-priority findings, not the
 * false-positive failure mode that matters for the trust gate.
 */
export const DEFAULT_VERIFICATION_MODEL = "claude-sonnet-4-6";

/**
 * The three default critics. Same model, decorrelated by framing — each leans
 * into a distinct failure mode so the three passes don't collapse into one.
 */
export const DEFAULT_CRITICS: CriticSpec[] = [
  {
    model: DEFAULT_CRITIC_MODEL,
    label: "critic-silent-failure",
    framing:
      "silent failure and error handling — what happens on the unhappy path, " +
      "swallowed errors, early returns that look like success.",
  },
  {
    model: DEFAULT_CRITIC_MODEL,
    label: "critic-cosmetic-guard",
    framing:
      "whether the guard/limit/isolation actually constrains the dangerous " +
      "operation or is merely cosmetic — decorative checks that don't gate the " +
      "effect they appear to.",
  },
  {
    model: DEFAULT_CRITIC_MODEL,
    label: "critic-alternate-path",
    framing:
      "alternate shapes and paths — a second input, caller, or branch that " +
      "reaches the dangerous operation without passing the guard.",
  },
];

/** The default configuration: 3 framing-decorrelated critics + opus judging. */
export const DEFAULT_REVIEW_CONFIG: ReviewConfig = {
  critics: DEFAULT_CRITICS,
  synthesisModel: DEFAULT_JUDGE_MODEL,
  verificationModel: DEFAULT_VERIFICATION_MODEL,
  maxTokens: 4096,
};
