/**
 * Review-pipeline tests. The LLM is fully mocked — a fake {@link ModelCaller}
 * returns canned, purpose-keyed responses — so these are free, deterministic,
 * and need no API key. They pin the behavior that made the validation runs
 * trustworthy: the blind/independent critic stage, the placeholder guard, the
 * derive-don't-store status rule, and clean COGS attribution by purpose.
 */

import { describe, expect, it, vi } from "vitest";
import { toTokenUsage } from "../llm/index.js";
import { effectiveStatus, type Finding, type Seam } from "../types/index.js";
import type { CallModelParams, CallModelResult } from "../llm/index.js";
import type { ModelCaller } from "./config.js";
import {
  assertSeamPresent,
  buildCriticPrompt,
  PlaceholderPromptError,
} from "./prompts.js";
import {
  extractJsonObject,
  ModelOutputParseError,
  parseModelJson,
  CriticResponseSchema,
} from "./parse.js";
import { runCritics, runVerification } from "./stages.js";
import { rankAndIdentify, reviewSeam } from "./pipeline.js";
import { DEFAULT_REVIEW_CONFIG } from "./config.js";

describe("default config — verification tier (Phase 1 decision)", () => {
  it("verifies on Sonnet by default, synthesizes on Opus", () => {
    // Phase 1 (docs/seamstress-phase1-verification-tier.md): verification dropped
    // to Sonnet — same verdicts + evidence on critical/high findings, ~54% cheaper.
    // Synthesis judgment stays on the top tier. This guards the deliberate split.
    expect(DEFAULT_REVIEW_CONFIG.verificationModel).toBe("claude-sonnet-4-6");
    expect(DEFAULT_REVIEW_CONFIG.synthesisModel).toBe("claude-opus-4-8");
  });
});

const SEAM: Seam = {
  id: "seam-1",
  kind: "safety_delivery",
  label: "sendCriticalEmail() quota guard",
  sources: [{ path: "src/email/send.ts", startLine: 10, endLine: 40 }],
  inputText:
    "async function sendCriticalEmail(to, body) {\n" +
    "  if (await overQuota(to)) log('quota exceeded');\n" +
    "  await resend.emails.send({ to, body });\n" +
    "}",
};

/** Canned model text, keyed by the call's purpose. */
type ByPurpose = Partial<Record<string, string>>;

/**
 * A fake ModelCaller: returns the canned text for each call's `purpose`, priced
 * through the real {@link toTokenUsage} so COGS is non-zero and attributed.
 */
function fakeClient(byPurpose: ByPurpose, model = "claude-haiku-4-5"): ModelCaller {
  return {
    async callModel(params: CallModelParams): Promise<CallModelResult> {
      const purpose = params.purpose ?? "other";
      const text = byPurpose[purpose] ?? "{}";
      return {
        text,
        stopReason: "end_turn",
        usage: toTokenUsage(model, purpose, {
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        }),
      };
    },
  };
}

const CRITIC_JSON = JSON.stringify({
  findings: [
    {
      description: "Quota check is cosmetic — it logs but does not block the send.",
      reasoning: "overQuota() result is only passed to log(); send runs regardless.",
      blastRadius: "high",
      confidence: "high",
    },
  ],
});

const SYNTHESIS_JSON = JSON.stringify({
  summary: "One real cosmetic-guard issue: the quota check never blocks the send.",
  findings: [
    {
      description: "A lower-severity logging nit.",
      reasoning: "Minor.",
      blastRadius: "low",
    },
    {
      description: "Quota check is cosmetic — it logs but does not block the send.",
      reasoning: "overQuota() is only logged; the send is unconditional.",
      blastRadius: "critical",
      confidence: "high",
    },
  ],
});

const VERIFICATION_JSON = JSON.stringify({
  status: "verified_real",
  evidence: [
    {
      quotedCode: "if (await overQuota(to)) log('quota exceeded');",
      location: { path: "src/email/send.ts", startLine: 11 },
    },
  ],
  note: "The guard only logs; the send on the next line is unconditional.",
});

describe("assertSeamPresent — the placeholder-bug guard", () => {
  it("throws when the prompt does NOT contain the seam's real source", () => {
    // The bug that bit the validation runs twice: a prompt with a placeholder
    // instead of the real source. The guard must hard-fail, not silently skip.
    expect(() =>
      assertSeamPresent("Review this seam: <SEAM_SOURCE_GOES_HERE>", SEAM),
    ).toThrow(PlaceholderPromptError);
  });

  it("throws when the seam's inputText is empty (vacuously 'present')", () => {
    const emptySeam: Seam = { ...SEAM, inputText: "" };
    expect(() => assertSeamPresent("any prompt at all", emptySeam)).toThrow(
      PlaceholderPromptError,
    );
  });

  it("passes when the real source is embedded, and buildCriticPrompt embeds it", () => {
    const { user } = buildCriticPrompt(SEAM, "any framing");
    expect(user).toContain(SEAM.inputText);
    expect(() => assertSeamPresent(user, SEAM)).not.toThrow();
  });
});

describe("extractJsonObject — defensive parsing", () => {
  it("extracts a bare JSON object", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("extracts JSON from a ```json fenced block with surrounding prose", () => {
    const wrapped = 'Here you go:\n```json\n{"a":2}\n```\nHope that helps!';
    expect(extractJsonObject(wrapped)).toEqual({ a: 2 });
  });

  it("extracts a JSON object embedded in prose without fences", () => {
    expect(extractJsonObject('I think {"a":3} is right.')).toEqual({ a: 3 });
  });

  it("throws ModelOutputParseError on text with no JSON object", () => {
    expect(() => extractJsonObject("no json here at all")).toThrow(
      ModelOutputParseError,
    );
  });

  it("throws ModelOutputParseError on malformed JSON (does not crash)", () => {
    expect(() => extractJsonObject('{"a": }')).toThrow(ModelOutputParseError);
  });
});

describe("critic stage — parsing model output into drafts", () => {
  it("maps a well-formed critic response to valid finding drafts", async () => {
    const client = fakeClient({ critic: CRITIC_JSON });
    const outcomes = await runCritics(SEAM, client, {
      critics: [{ model: "claude-haiku-4-5", label: "c1", framing: "f" }],
      synthesisModel: "claude-haiku-4-5",
      verificationModel: "claude-haiku-4-5",
      maxTokens: 1024,
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.drafts[0]?.blastRadius).toBe("high");
    expect(outcomes[0]?.drafts[0]?.confidence).toBe("high");
    expect(outcomes[0]?.usage.purpose).toBe("critic");
  });

  it("parses a wrapped/prose-padded critic response defensively", () => {
    const wrapped = "Sure!\n```json\n" + CRITIC_JSON + "\n```";
    const parsed = parseModelJson(wrapped, CriticResponseSchema);
    expect(parsed.findings).toHaveLength(1);
  });

  it("fails cleanly (typed error) on a malformed critic response", async () => {
    const client = fakeClient({ critic: "the model forgot to answer in JSON" });
    await expect(
      runCritics(SEAM, client, {
        critics: [{ model: "claude-haiku-4-5", label: "c1", framing: "f" }],
        synthesisModel: "claude-haiku-4-5",
        verificationModel: "claude-haiku-4-5",
        maxTokens: 1024,
      }),
    ).rejects.toThrow(ModelOutputParseError);
  });

  it("runs each critic blind — no critic sees another's findings", async () => {
    const seen: string[] = [];
    const client: ModelCaller = {
      async callModel(params) {
        const content = params.messages[0]?.content;
        seen.push(typeof content === "string" ? content : JSON.stringify(content));
        return {
          text: CRITIC_JSON,
          stopReason: "end_turn",
          usage: toTokenUsage("claude-haiku-4-5", "critic", {
            inputTokens: 1,
            outputTokens: 1,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
          }),
        };
      },
    };
    await runCritics(SEAM, client, {
      critics: [
        { model: "claude-haiku-4-5", label: "c1", framing: "silent failure" },
        { model: "claude-haiku-4-5", label: "c2", framing: "cosmetic guard" },
      ],
      synthesisModel: "claude-haiku-4-5",
      verificationModel: "claude-haiku-4-5",
      maxTokens: 1024,
    });
    // Neither critic's prompt mentions the OTHER critic's framing or findings.
    expect(seen[0]).toContain("silent failure");
    expect(seen[0]).not.toContain("cosmetic guard");
    expect(seen[1]).toContain("cosmetic guard");
    expect(seen[1]).not.toContain("silent failure");
  });
});

describe("rankAndIdentify — blast-radius ranking + identity (Stage 2 output)", () => {
  it("sorts most-consequential-first and assigns stable IDs in that order", () => {
    const findings = rankAndIdentify(
      [
        { description: "low one", reasoning: "r", blastRadius: "low" },
        { description: "critical one", reasoning: "r", blastRadius: "critical" },
        { description: "medium one", reasoning: "r", blastRadius: "medium" },
      ],
      "seam-1",
    );
    expect(findings.map((f) => f.blastRadius)).toEqual([
      "critical",
      "medium",
      "low",
    ]);
    expect(findings[0]?.id).toBe("finding-1");
    expect(findings[0]?.description).toBe("critical one");
    expect(findings.every((f) => f.seamId === "seam-1")).toBe(true);
  });

  it("omits optional confidence/locations rather than setting them undefined", () => {
    const [finding] = rankAndIdentify(
      [{ description: "d", reasoning: "r", blastRadius: "high" }],
      "seam-1",
    );
    expect("confidence" in (finding as Finding)).toBe(false);
    expect("locations" in (finding as Finding)).toBe(false);
  });
});

describe("verification stage — maps to VerificationResult + derived status", () => {
  const finding: Finding = {
    id: "finding-1",
    seamId: "seam-1",
    description: "Quota check is cosmetic.",
    reasoning: "Only logs.",
    blastRadius: "critical",
  };

  it("maps a verification response to a VerificationResult for the finding", async () => {
    const client = fakeClient({ verification: VERIFICATION_JSON });
    const { result, usage } = await runVerification(
      SEAM,
      finding,
      client,
      {
        critics: [],
        synthesisModel: "claude-haiku-4-5",
        verificationModel: "claude-haiku-4-5",
        maxTokens: 1024,
      },
    );
    expect(result.findingId).toBe("finding-1");
    expect(result.status).toBe("verified_real");
    expect(result.evidence[0]?.quotedCode).toContain("overQuota");
    expect(usage.purpose).toBe("verification");
    // The result is the authority: effectiveStatus now derives verified_real.
    expect(effectiveStatus(finding, [result])).toBe("verified_real");
  });

  it("a finding with no verification derives unverified", () => {
    expect(effectiveStatus(finding, [])).toBe("unverified");
  });
});

describe("reviewSeam — full mocked pipeline + COGS by purpose", () => {
  it("produces a ranked, verified ReviewResult with cost attributed per purpose", async () => {
    const client = fakeClient({
      critic: CRITIC_JSON,
      synthesis: SYNTHESIS_JSON,
      verification: VERIFICATION_JSON,
    });
    const spy = vi.spyOn(client, "callModel");

    const result = await reviewSeam(SEAM, {
      client,
      target: { repo: "SeamStressDev/seamstress", commit: "test" },
      config: {
        critics: [
          { model: "claude-haiku-4-5", label: "c1", framing: "a" },
          { model: "claude-haiku-4-5", label: "c2", framing: "b" },
          { model: "claude-haiku-4-5", label: "c3", framing: "c" },
        ],
        synthesisModel: "claude-haiku-4-5",
        verificationModel: "claude-haiku-4-5",
        maxTokens: 1024,
      },
    });

    // 3 critics + 1 synthesis + 1 verification per synthesized finding (2) = 6.
    expect(spy).toHaveBeenCalledTimes(6);

    // Findings ranked by blast radius; the cosmetic-guard issue leads.
    expect(result.findings[0]?.blastRadius).toBe("critical");
    expect(result.findings[0]?.description).toContain("cosmetic");

    // One verification per finding, each carrying quoted evidence.
    expect(result.verifications).toHaveLength(result.findings.length);
    expect(
      result.findings.every(
        (f) => effectiveStatus(f, result.verifications) === "verified_real",
      ),
    ).toBe(true);

    // COGS attribution: every stage shows up with non-zero cost (the headline —
    // verification cost is finally a measured fraction of the review).
    const byPurpose = result.cost.costUsdByPurpose;
    expect(byPurpose.critic).toBeGreaterThan(0);
    expect(byPurpose.synthesis).toBeGreaterThan(0);
    expect(byPurpose.verification).toBeGreaterThan(0);
    expect(result.cost.totalCostUsd).toBeCloseTo(
      byPurpose.critic + byPurpose.synthesis + byPurpose.verification,
      9,
    );
    expect(result.synthesis).toContain("cosmetic-guard");
  });
});
