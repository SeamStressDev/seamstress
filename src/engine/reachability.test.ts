/**
 * Reachability-claim gate — pins the mutable-exported-config defect.
 *
 * A verification verdict that asserts EXTERNAL reachability of a symbol ("any
 * importing module can overwrite X") must be confirmed against the source: X has
 * to actually be exported. If it isn't, the reachability claim is unconfirmed and
 * the verdict must not stand as `verified_real`. This is a PROGRAMMATIC check —
 * the model already failed at exactly this judgment, so we check the source.
 *
 * Deterministic: the model is a fake that returns a canned "verified_real"; the
 * gate's behavior is driven entirely by the synthetic source + claim.
 */

import { describe, expect, it } from "vitest";
import { toTokenUsage } from "../llm/index.js";
import type { CallModelParams, CallModelResult } from "../llm/index.js";
import type { Finding, Seam } from "../types/index.js";
import type { ModelCaller } from "./config.js";
import { runVerification } from "./stages.js";

// Mirrors lib/billing/feature-access.ts: a non-exported mutable const (RANK) and
// an exported one (FEATURE_MIN_PLAN).
const SOURCE =
  'const RANK: Record<PlanTier, number> = { free: 0, pro: 1, plus: 2 };\n\n' +
  "export const FEATURE_MIN_PLAN: Record<FeatureKey, PlanTier> = {\n" +
  '  ai_chat: "free",\n' +
  '  voice_coach: "plus",\n' +
  "};\n";

const RANK_LINE = "const RANK: Record<PlanTier, number> = { free: 0, pro: 1, plus: 2 };";
const FMP_LINE = "export const FEATURE_MIN_PLAN: Record<FeatureKey, PlanTier> = {";

const seam: Seam = {
  id: "seam-feature-access",
  kind: "other",
  label: "lib/billing/feature-access.ts",
  sources: [{ path: "lib/billing/feature-access.ts", startLine: 1, endLine: 6 }],
  inputText: SOURCE,
};

const config = {
  critics: [],
  synthesisModel: "claude-haiku-4-5",
  verificationModel: "claude-haiku-4-5",
  maxTokens: 512,
};

/** A fake verifier that always returns verified_real, quoting `quote`. */
function verifyingClient(quote: string): ModelCaller {
  return {
    async callModel(_params: CallModelParams): Promise<CallModelResult> {
      return {
        text: JSON.stringify({
          status: "verified_real",
          evidence: [{ quotedCode: quote, location: { path: "lib/billing/feature-access.ts", startLine: 1 } }],
          note: "the const object's properties are mutable at runtime",
        }),
        stopReason: "end_turn",
        usage: toTokenUsage("claude-haiku-4-5", "verification", {
          inputTokens: 30,
          outputTokens: 10,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        }),
      };
    },
  };
}

// Case A — the RANK bug: a reachability claim about a NON-exported symbol.
const findingA: Finding = {
  id: "finding-1",
  seamId: seam.id,
  description: "RANK is a mutable const object; any importing module can overwrite it and silently rewrite every feature gate.",
  reasoning: "RANK is declared const but its properties are mutable, so external code can reassign its entries.",
  blastRadius: "critical",
};

// Case B — the FEATURE_MIN_PLAN case: the same claim about an EXPORTED symbol.
const findingB: Finding = {
  id: "finding-1",
  seamId: seam.id,
  description: "FEATURE_MIN_PLAN is a mutable const object; any importing module can overwrite it and silently rewrite every feature gate.",
  reasoning: "FEATURE_MIN_PLAN is exported and its properties are mutable, so any importing module can reassign its entries.",
  blastRadius: "critical",
};

describe("reachability gate — external-reachability claims require an exported symbol", () => {
  it("Case A: a reachability claim about a NON-exported symbol must not stand as verified_real", async () => {
    const { result } = await runVerification(seam, findingA, verifyingClient(RANK_LINE), config);
    // RANK is module-private; "any importing module can overwrite it" is false.
    // The verdict must be down-scoped off the verified headline.
    expect(result.status).not.toBe("verified_real");
    expect(result.status).toBe("judgment_call");
  });

  it("Case B: the same reachability claim about an EXPORTED symbol must stand (no over-correction)", async () => {
    const { result } = await runVerification(seam, findingB, verifyingClient(FMP_LINE), config);
    // FEATURE_MIN_PLAN is genuinely externally mutable — the claim is true.
    expect(result.status).toBe("verified_real");
  });
});
