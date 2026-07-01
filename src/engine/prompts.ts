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
 * Prompt construction for the three pipeline stages, and the placeholder-bug
 * guard that protects all of them.
 *
 * The single most important thing in this file is {@link assertSeamPresent}: in
 * the validation runs we twice sent a critic a prompt that did NOT contain the
 * real seam source (a placeholder slipped through), and got confident reviews of
 * nothing. Every prompt builder here routes through that assertion, which THROWS
 * rather than silently sending a hollow prompt.
 */

import type { Finding, Seam } from "../types/index.js";
import type { FindingDraft } from "./parse.js";

/** A built prompt: an optional system prompt plus the user message. */
export interface BuiltPrompt {
  system: string;
  user: string;
}

/**
 * Thrown when a prompt about to be dispatched does not actually contain the
 * seam's real source text. This is the guard against the placeholder bug that
 * bit the validation runs twice: a critic must never review source it wasn't
 * given. Hard failure, never a silent skip.
 */
export class PlaceholderPromptError extends Error {
  constructor(public readonly seamId: string) {
    super(
      `Refusing to dispatch a prompt for seam "${seamId}": the seam's real ` +
        `inputText is not present in the prompt. This is the placeholder-bug ` +
        `guard — the model would be reviewing source it was never given.`,
    );
    this.name = "PlaceholderPromptError";
  }
}

/**
 * The load-bearing guard. Assert the seam's real `inputText` is non-empty AND
 * literally present in the prompt string about to be sent. Call this on every
 * built prompt before dispatch. Throws {@link PlaceholderPromptError} otherwise.
 */
export function assertSeamPresent(prompt: string, seam: Seam): void {
  const source = seam.inputText.trim();
  if (source.length === 0 || !prompt.includes(seam.inputText)) {
    throw new PlaceholderPromptError(seam.id);
  }
}

/** Render a seam's source into the fenced block the prompts embed. */
function seamBlock(seam: Seam): string {
  const where = seam.sources
    .map((s) => {
      const range =
        s.startLine !== undefined
          ? `:${s.startLine}${s.endLine !== undefined ? `-${s.endLine}` : ""}`
          : "";
      return `${s.path}${range}`;
    })
    .join(", ");

  return (
    `Seam: ${seam.label} (kind: ${seam.kind})\n` +
    `Location(s): ${where}\n\n` +
    "----- BEGIN SEAM SOURCE -----\n" +
    seam.inputText +
    "\n----- END SEAM SOURCE -----"
  );
}

/** The discipline every critic shares, regardless of its decorrelating framing. */
export const CRITIC_SYSTEM =
  "You are a senior reviewer auditing one high-risk code seam — a boundary " +
  "where a mistake is expensive (auth, money, PII, deletion, critical " +
  "delivery). This is a focused investigation, not a checklist. Interrogate " +
  "the seam along these lenses:\n" +
  "- Can this silently fail — does the unhappy path swallow an error, return " +
  "early, or proceed as if it succeeded?\n" +
  "- Does the guard actually hold, or is it cosmetic — does the check gate the " +
  "dangerous operation, or merely look like it does while the operation runs " +
  "anyway?\n" +
  "- Is the isolation real or cosmetic — does a limit/quota/lock actually " +
  "constrain the effect, or is it decorative?\n" +
  "- Is there another shape or path — a second input, caller, or branch that " +
  "reaches the dangerous operation without passing the guard?\n" +
  "- What is the blast radius if you are wrong about it being safe?\n\n" +
  "Report only issues you can argue from the source shown. Do not invent " +
  "problems to fill a quota; if the seam is sound, say so with few or no " +
  "findings. Judge how sure you are (confidence) separately from how bad it " +
  "would be if real (blastRadius).";

/** JSON contract shared by the stages that emit finding drafts. */
const FINDING_JSON_CONTRACT =
  "Respond with ONLY a JSON object, no prose outside it, in this exact shape:\n" +
  "{\n" +
  '  "findings": [\n' +
  "    {\n" +
  '      "description": "what the issue is, plainly",\n' +
  '      "reasoning": "why it is an issue, argued from the source",\n' +
  '      "blastRadius": "critical | high | medium | low",\n' +
  '      "confidence": "high | medium | low",   // optional: how sure it is real\n' +
  '      "locations": [{ "path": "...", "startLine": 1, "endLine": 9 }]  // optional\n' +
  "    }\n" +
  "  ]\n" +
  "}\n" +
  "If the seam is sound, return { \"findings\": [] }.";

/**
 * Build one critic's prompt. `framing` is the decorrelating lens that biases
 * this critic toward a different failure mode than its peers (the prompt-level
 * decorrelation Build 2 uses in place of cross-model). Runs the placeholder
 * guard before returning.
 */
export function buildCriticPrompt(seam: Seam, framing: string): BuiltPrompt {
  const user =
    `${seamBlock(seam)}\n\n` +
    `Investigation emphasis for this pass: ${framing}\n\n` +
    `${FINDING_JSON_CONTRACT}`;

  assertSeamPresent(user, seam);
  return { system: CRITIC_SYSTEM, user };
}

export const SYNTHESIS_SYSTEM =
  "You are the synthesis reviewer. Several blind critics independently audited " +
  "the same seam; you receive their findings. Your job is JUDGMENT, not " +
  "tallying: do NOT resolve disagreement by majority vote. Merge findings that " +
  "describe the same underlying issue into one, drop those the source clearly " +
  "refutes, and keep a genuine issue even if only one critic raised it. Rank " +
  "the consolidated list by blast radius, most consequential first. Argue from " +
  "the seam source, which is included.\n\n" +
  "SEVERITY RUBRIC (blastRadius). critical/high is reserved for a CONCRETE, " +
  "CURRENTLY-REACHABLE bad outcome — a real code path, input, or ordinary " +
  "operation that actually produces the harm (e.g. 'two concurrent uploads both " +
  "pass the check', 'any authenticated user can call X with their own id'). A " +
  "LATENT / architectural / 'harden-this' concern — the schema 'structurally " +
  "permits' a bad row, 'nothing prevents' a future misuse, a mutable export that " +
  "no code actually overwrites, a missing check constraint with no path that " +
  "creates the bad state — caps at MEDIUM, no matter how large the impact would " +
  "be IF it happened. Magnitude-if-it-happened alone is NOT sufficient for " +
  "critical/high; the bad outcome must be reachable now. For each finding also " +
  "classify `reachability`: 'reachable' if you can name the triggering path, " +
  "'latent' otherwise. This is separate from confidence (whether the claim is " +
  "true) — a true claim can still be latent.";

/**
 * Build the synthesis prompt: the seam source plus the blind critics' raw
 * findings, asking for one consolidated ranked list. Runs the placeholder guard.
 */
export function buildSynthesisPrompt(
  seam: Seam,
  criticDrafts: FindingDraft[],
): BuiltPrompt {
  const criticJson = JSON.stringify({ findings: criticDrafts }, null, 2);

  const user =
    `${seamBlock(seam)}\n\n` +
    "The blind critics produced these findings (unconsolidated, possibly " +
    "overlapping or contradictory):\n\n" +
    "```json\n" +
    `${criticJson}\n` +
    "```\n\n" +
    "Consolidate them into one ranked list. Dedupe overlapping findings, " +
    "resolve disagreement by reasoning against the source, and order by blast " +
    "radius (most consequential first).\n\n" +
    "For each finding, also write a `consequence`: ONE plain-language sentence " +
    "stating what actually happens if THIS specific issue is real — the concrete " +
    "effect on the app or its users, grounded in this finding and the real code. " +
    "It must be specific to the finding itself, NOT a generic statement about its " +
    "category (e.g. an access/isolation bug must read as an access/isolation " +
    "effect, even if the surrounding code touches billing). No jargon.\n\n" +
    "Respond with ONLY a JSON object in this exact shape:\n" +
    "{\n" +
    '  "summary": "1-3 sentences on what the review concluded",\n' +
    '  "findings": [ { "description", "reasoning", "blastRadius", ' +
    '"reachability": "reachable | latent", "consequence", "confidence"?, ' +
    '"locations"? } ]\n' +
    "}";

  assertSeamPresent(user, seam);
  return { system: SYNTHESIS_SYSTEM, user };
}

export const VERIFICATION_SYSTEM =
  "You are the verification reviewer — the trust gate. A finding is just a " +
  "claim until checked against the real code. Check THIS finding against the " +
  "seam source and reach one verdict:\n" +
  "- verified_real: the source confirms the issue. Quote the exact code that " +
  "proves it.\n" +
  "- false_positive: the source actually handles it. Quote the code that " +
  "handles it.\n" +
  "- judgment_call: real but contestable — it depends on intent or context a " +
  "human owns. Quote the relevant code and say what it hinges on.\n\n" +
  "Every verdict MUST quote real code from the seam as evidence. Never claim a " +
  "verdict you cannot ground in a quote.";

/**
 * Build the verification prompt for one finding against the seam source. Runs
 * the placeholder guard.
 */
export function buildVerificationPrompt(
  seam: Seam,
  finding: Finding,
): BuiltPrompt {
  const findingJson = JSON.stringify(
    {
      description: finding.description,
      reasoning: finding.reasoning,
      blastRadius: finding.blastRadius,
      ...(finding.locations ? { locations: finding.locations } : {}),
    },
    null,
    2,
  );

  const user =
    `${seamBlock(seam)}\n\n` +
    "Verify this finding against the seam source above:\n\n" +
    "```json\n" +
    `${findingJson}\n` +
    "```\n\n" +
    "Respond with ONLY a JSON object in this exact shape:\n" +
    "{\n" +
    '  "status": "verified_real | false_positive | judgment_call",\n' +
    '  "evidence": [{ "quotedCode": "...", "location": { "path": "...", ' +
    '"startLine": 1 } }],\n' +
    '  "note": "how the evidence supports the verdict"\n' +
    "}";

  assertSeamPresent(user, seam);
  return { system: VERIFICATION_SYSTEM, user };
}
