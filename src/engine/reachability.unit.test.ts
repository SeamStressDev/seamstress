/**
 * Unit tests for the pure `gateReachabilityClaim` helper — called directly, no
 * model, no pipeline. Deterministic source/claim in, possibly-down-scoped
 * VerificationResult out.
 */

import { describe, expect, it } from "vitest";
import type { VerificationResult } from "../types/index.js";
import { gateReachabilityClaim } from "./reachability.js";

const SOURCE =
  "const RANK: Record<PlanTier, number> = { free: 0, pro: 1, plus: 2 };\n\n" +
  "export const FEATURE_MIN_PLAN: Record<FeatureKey, PlanTier> = { ai_chat: 'free' };\n";

const verifiedReal: VerificationResult = {
  findingId: "finding-1",
  status: "verified_real",
  evidence: [{ quotedCode: "const RANK = {...}", location: { path: "x.ts", startLine: 1 } }],
  note: "the const object is mutable",
};

describe("gateReachabilityClaim (pure)", () => {
  it("down-scopes a reachability claim about a NON-exported symbol", () => {
    const finding = {
      description: "RANK is mutable; any importing module can overwrite it.",
      reasoning: "external code can reassign RANK entries.",
    };
    const out = gateReachabilityClaim(finding, verifiedReal, SOURCE);
    expect(out.status).toBe("judgment_call");
    expect(out.note).toMatch(/not exported/i);
    expect(out.note).toContain("RANK");
  });

  it("leaves a reachability claim about an EXPORTED symbol unchanged (no over-correction)", () => {
    const finding = {
      description: "FEATURE_MIN_PLAN is mutable; any importing module can overwrite it.",
      reasoning: "FEATURE_MIN_PLAN is exported, so external code can reassign its entries.",
    };
    const out = gateReachabilityClaim(finding, verifiedReal, SOURCE);
    expect(out).toBe(verifiedReal); // identical reference — untouched
    expect(out.status).toBe("verified_real");
  });

  it("leaves a NON-reachability claim unchanged (no external-reach assertion)", () => {
    const finding = {
      description: "RANK uses a strict < comparison that is off by one.",
      reasoning: "the boundary check at the index lookup is wrong.",
    };
    const out = gateReachabilityClaim(finding, verifiedReal, SOURCE);
    expect(out.status).toBe("verified_real");
  });

  it("leaves a reachability claim that names no declared symbol unchanged (unextractable)", () => {
    const finding = {
      description: "any importing module can overwrite the global config object.",
      reasoning: "external code can reassign entries somewhere in the app.",
    };
    const out = gateReachabilityClaim(finding, verifiedReal, SOURCE);
    expect(out.status).toBe("verified_real");
  });

  it("down-scopes a multi-symbol claim, naming ONLY the unexported symbol (the real multi-symbol shape)", () => {
    // The real multi-symbol case: one claim names BOTH symbols — RANK (not
    // exported) and FEATURE_MIN_PLAN (exported). It must down-scope (RANK fails),
    // and the note must finger RANK only, not mislabel FEATURE_MIN_PLAN.
    const finding = {
      description:
        "RANK and FEATURE_MIN_PLAN are plain const objects whose properties are mutable at runtime; any importing module can overwrite entries and silently rewrite every feature gate.",
      reasoning: "Both are mutable objects, so external code can reassign their entries.",
    };
    const out = gateReachabilityClaim(finding, verifiedReal, SOURCE);
    expect(out.status).toBe("judgment_call");
    expect(out.note).toContain("RANK");
    expect(out.note).not.toContain("FEATURE_MIN_PLAN"); // the exported half must NOT be fingered
  });

  it("does not touch a verdict that is already not verified_real", () => {
    const judgment: VerificationResult = { ...verifiedReal, status: "judgment_call" };
    const finding = {
      description: "RANK; any importing module can overwrite it.",
      reasoning: "external code can reach RANK.",
    };
    expect(gateReachabilityClaim(finding, judgment, SOURCE).status).toBe("judgment_call");
  });
});
