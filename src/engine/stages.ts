/**
 * The three pipeline stages as independent, individually-testable functions:
 * blind critics → synthesis → verification. Each takes the model caller as a
 * dependency, returns its structured product plus the {@link TokenUsage} records
 * it incurred (tagged with the right `purpose` for COGS attribution), and does
 * no orchestration of its own — `pipeline.ts` wires them together.
 */

import type {
  Finding,
  Seam,
  TokenUsage,
  VerificationResult,
} from "../types/index.js";
import type { ModelCaller, ReviewConfig } from "./config.js";
import {
  CriticResponseSchema,
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
      const result = await client.callModel({
        model: critic.model,
        system,
        maxTokens: config.maxTokens,
        purpose: "critic",
        messages: [{ role: "user", content: user }],
      });
      const parsed = parseModelJson(result.text, CriticResponseSchema);
      return { label: critic.label, drafts: parsed.findings, usage: result.usage };
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
  const result = await client.callModel({
    model: config.synthesisModel,
    system,
    maxTokens: config.maxTokens,
    purpose: "synthesis",
    messages: [{ role: "user", content: user }],
  });
  const parsed = parseModelJson(result.text, SynthesisResponseSchema);
  return { summary: parsed.summary, drafts: parsed.findings, usage: result.usage };
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
  const result = await client.callModel({
    model: config.verificationModel,
    system,
    maxTokens: config.maxTokens,
    purpose: "verification",
    messages: [{ role: "user", content: user }],
  });
  const parsed = parseModelJson(result.text, VerificationResponseSchema);
  return {
    result: {
      findingId: finding.id,
      status: parsed.status,
      evidence: parsed.evidence,
      note: parsed.note,
    },
    usage: result.usage,
  };
}
