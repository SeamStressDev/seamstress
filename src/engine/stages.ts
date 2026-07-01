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
 * The three pipeline stages as independent, individually-testable functions:
 * blind critics → synthesis → verification. Each takes the model caller as a
 * dependency, returns its structured product plus the {@link TokenUsage} records
 * it incurred (tagged with the right `purpose` for COGS attribution), and does
 * no orchestration of its own — `pipeline.ts` wires them together.
 */

import type { z } from "zod";
import type { CallModelParams } from "../llm/index.js";
import type {
  Finding,
  Seam,
  TokenUsage,
  VerificationResult,
} from "../types/index.js";
import type { ModelCaller, ReviewConfig } from "./config.js";
import {
  CriticResponseSchema,
  ModelOutputParseError,
  parseModelJson,
  SynthesisResponseSchema,
  VerificationResponseSchema,
  type FindingDraft,
} from "./parse.js";
import {
  buildCriticPrompt,
  buildSynthesisPrompt,
  buildVerificationPrompt,
} from "./prompts.js";
import { gateReachabilityClaim } from "./reachability.js";

/**
 * Re-attempts on a malformed RESPONSE, on top of the initial attempt. This is
 * DISTINCT from {@link withRetry} in the LLM client, which retries transient
 * TRANSPORT failures (connection/5xx). A parse failure is a well-delivered but
 * malformed answer that usually parses fine on a re-ask (default sampling
 * temperature makes the re-issued call vary), so a couple of cheap re-asks keep
 * a single bad response from punting an entire seam — exactly the gap that left
 * a money-path seam unreviewed in the live run.
 */
export const DEFAULT_PARSE_RETRIES = 2;

/** Sum repeated attempts into one usage so wasted re-asks still count toward COGS. */
function mergeUsages(usages: TokenUsage[]): TokenUsage {
  const first = usages[0]!;
  if (usages.length === 1) return first;
  return {
    model: first.model,
    purpose: first.purpose,
    inputTokens: usages.reduce((n, u) => n + u.inputTokens, 0),
    outputTokens: usages.reduce((n, u) => n + u.outputTokens, 0),
    cacheCreationInputTokens: usages.reduce((n, u) => n + u.cacheCreationInputTokens, 0),
    cacheReadInputTokens: usages.reduce((n, u) => n + u.cacheReadInputTokens, 0),
    costUsd: usages.reduce((n, u) => n + u.costUsd, 0),
  };
}

/**
 * Call the model and parse its output, re-issuing the call up to `parseRetries`
 * times on a {@link ModelOutputParseError} before giving up. The returned usage
 * sums every attempt (re-asks aren't free). A non-parse error (e.g. a terminal
 * API failure that already exhausted transport retries) propagates immediately —
 * this layer only retries malformed responses. If the budget is exhausted the
 * last parse error throws, and the caller's per-seam isolation takes over.
 */
async function callModelAndParse<T>(
  client: ModelCaller,
  params: CallModelParams,
  schema: z.ZodType<T>,
  parseRetries: number = DEFAULT_PARSE_RETRIES,
): Promise<{ parsed: T; usage: TokenUsage }> {
  const usages: TokenUsage[] = [];
  let lastError: unknown;
  for (let attempt = 0; attempt <= parseRetries; attempt += 1) {
    const result = await client.callModel(params);
    usages.push(result.usage);
    try {
      return { parsed: parseModelJson(result.text, schema), usage: mergeUsages(usages) };
    } catch (err) {
      if (!(err instanceof ModelOutputParseError)) throw err;
      lastError = err; // malformed — re-ask
    }
  }
  throw lastError;
}

/** What one critic produced: its drafts plus the usage its call incurred. */
export interface CriticOutcome {
  label: string;
  drafts: FindingDraft[];
  usage: TokenUsage;
}

/**
 * Stage 1 — run the blind critics. Each critic is an INDEPENDENT call that sees
 * only the seam source and its own framing, never its peers' findings; that
 * blindness is the decorrelation that makes the consolidated result trustworthy.
 * The placeholder guard fires inside {@link buildCriticPrompt} before any
 * dispatch. Critics run concurrently — they share no state.
 */
export async function runCritics(
  seam: Seam,
  client: ModelCaller,
  config: ReviewConfig,
): Promise<CriticOutcome[]> {
  return Promise.all(
    config.critics.map(async (critic): Promise<CriticOutcome> => {
      const { system, user } = buildCriticPrompt(seam, critic.framing);
      const { parsed, usage } = await callModelAndParse(
        client,
        {
          model: critic.model,
          system,
          maxTokens: config.maxTokens,
          purpose: "critic",
          messages: [{ role: "user", content: user }],
        },
        CriticResponseSchema,
      );
      return { label: critic.label, drafts: parsed.findings, usage };
    }),
  );
}

/** What synthesis produced: ranked drafts, a summary, and its call's usage. */
export interface SynthesisOutcome {
  summary: string;
  drafts: FindingDraft[];
  usage: TokenUsage;
}

/**
 * Stage 2 — synthesis. One call reads ALL critic drafts and returns the
 * consolidated, deduped, blast-radius-ranked list. Judgment, not voting: the
 * prompt forbids majority-tally resolution. (`pipeline.ts` re-sorts the result
 * to make blast-radius order authoritative regardless of the model.)
 */
export async function runSynthesis(
  seam: Seam,
  criticDrafts: FindingDraft[],
  client: ModelCaller,
  config: ReviewConfig,
): Promise<SynthesisOutcome> {
  const { system, user } = buildSynthesisPrompt(seam, criticDrafts);
  const { parsed, usage } = await callModelAndParse(
    client,
    {
      model: config.synthesisModel,
      system,
      maxTokens: config.maxTokens,
      purpose: "synthesis",
      messages: [{ role: "user", content: user }],
    },
    SynthesisResponseSchema,
  );
  return { summary: parsed.summary, drafts: parsed.findings, usage };
}

/** One verification: the result for a finding plus the call's usage. */
export interface VerificationOutcome {
  result: VerificationResult;
  usage: TokenUsage;
}

/**
 * Stage 3 — verify ONE finding against the real seam source. Produces a
 * {@link VerificationResult} carrying quoted-code evidence; the model is
 * constrained to the three real verdicts (never `unverified`, which is a derived
 * absence-of-result state, not a verdict). One call per finding.
 */
export async function runVerification(
  seam: Seam,
  finding: Finding,
  client: ModelCaller,
  config: ReviewConfig,
): Promise<VerificationOutcome> {
  const { system, user } = buildVerificationPrompt(seam, finding);
  const { parsed, usage } = await callModelAndParse(
    client,
    {
      model: config.verificationModel,
      system,
      maxTokens: config.maxTokens,
      purpose: "verification",
      messages: [{ role: "user", content: user }],
    },
    VerificationResponseSchema,
  );
  // Programmatic reachability gate: down-scope a verified_real verdict whose
  // external-reachability claim ("any importing module can overwrite X") names a
  // symbol that isn't actually exported. The model already failed at exactly
  // this judgment in a real-world audit, so we check the source, not the prose.
  const result = gateReachabilityClaim(finding, {
    findingId: finding.id,
    status: parsed.status,
    evidence: parsed.evidence,
    note: parsed.note,
  }, seam.inputText);

  return { result, usage };
}
