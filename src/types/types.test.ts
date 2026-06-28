/**
 * Data-model tests. These shapes are the contract the whole engine builds
 * against, so they're the highest-value tests in this foundation: valid objects
 * of each shape parse; invalid ones (bad enum, missing required field, wrong
 * type) reject. All runtime — no API calls.
 */

import { describe, expect, it } from "vitest";
import {
  effectiveStatus,
  FindingSchema,
  ReviewResultSchema,
  SeamSchema,
  VerificationResultSchema,
} from "./index.js";
import type { Finding, VerificationResult } from "./index.js";

const validSeam = {
  id: "seam-1",
  kind: "money_path",
  label: "withdraw() balance check",
  sources: [{ path: "src/wallet/withdraw.ts", startLine: 40, endLine: 58 }],
  inputText: "function withdraw(...) { ... }",
};

const validFinding = {
  id: "finding-1",
  seamId: "seam-1",
  description: "Balance check uses < instead of <=, allowing one-cent overdraw.",
  blastRadius: "critical",
  reasoning: "The guard permits balance === amount - 1 to pass.",
};

const validVerification = {
  findingId: "finding-1",
  status: "verified_real",
  evidence: [
    {
      quotedCode: "if (balance < amount) throw new Error();",
      location: { path: "src/wallet/withdraw.ts", startLine: 44 },
    },
  ],
  note: "Confirmed: strict < lets an exact-balance withdrawal through.",
};

describe("SeamSchema", () => {
  it("parses a valid seam", () => {
    expect(SeamSchema.parse(validSeam).kind).toBe("money_path");
  });

  it("rejects an unknown kind", () => {
    expect(SeamSchema.safeParse({ ...validSeam, kind: "crypto" }).success).toBe(
      false,
    );
  });

  it("rejects an empty sources array", () => {
    expect(SeamSchema.safeParse({ ...validSeam, sources: [] }).success).toBe(
      false,
    );
  });

  it("rejects a missing required field", () => {
    const { inputText: _omit, ...withoutInput } = validSeam;
    expect(SeamSchema.safeParse(withoutInput).success).toBe(false);
  });
});

describe("FindingSchema", () => {
  it("parses a valid finding", () => {
    expect(FindingSchema.parse(validFinding).blastRadius).toBe("critical");
  });

  it("rejects an unknown blast-radius rank", () => {
    expect(
      FindingSchema.safeParse({ ...validFinding, blastRadius: "catastrophic" })
        .success,
    ).toBe(false);
  });

  it("rejects a non-string description", () => {
    expect(
      FindingSchema.safeParse({ ...validFinding, description: 42 }).success,
    ).toBe(false);
  });

  // Decision 1: a Finding carries NO verificationStatus field. The illegal
  // state "verified with no evidence" is unrepresentable — there is no field to
  // set. zod strips unknown keys, so an attempt to smuggle one in is dropped.
  it("has no verificationStatus field (status is derived, never stored)", () => {
    expect("verificationStatus" in FindingSchema.shape).toBe(false);
    const parsed = FindingSchema.parse({
      ...validFinding,
      verificationStatus: "verified_real",
    });
    expect("verificationStatus" in parsed).toBe(false);
  });

  // Decision 2: confidence is OPTIONAL — findings parse with and without it.
  it("parses a finding without confidence", () => {
    expect(FindingSchema.parse(validFinding).confidence).toBeUndefined();
  });

  it("parses a finding with a valid confidence", () => {
    expect(
      FindingSchema.parse({ ...validFinding, confidence: "high" }).confidence,
    ).toBe("high");
  });

  it("rejects an unknown confidence level", () => {
    expect(
      FindingSchema.safeParse({ ...validFinding, confidence: "certain" })
        .success,
    ).toBe(false);
  });
});

describe("effectiveStatus (Decision 1: derived, not stored)", () => {
  const finding = FindingSchema.parse(validFinding) as Finding;

  it("derives `unverified` when no verification result exists", () => {
    expect(effectiveStatus(finding, [])).toBe("unverified");
  });

  it("derives the result's status when a matching verification exists", () => {
    const verification: VerificationResult = {
      findingId: "finding-1",
      status: "verified_real",
      evidence: [
        {
          quotedCode: "if (balance < amount) throw new Error();",
          location: { path: "src/wallet/withdraw.ts", startLine: 44 },
        },
      ],
      note: "Confirmed against the real guard.",
    };
    expect(effectiveStatus(finding, [verification])).toBe("verified_real");
  });

  it("ignores verification results for other findings", () => {
    const other: VerificationResult = {
      findingId: "finding-99",
      status: "false_positive",
      evidence: [],
      note: "Belongs to a different finding.",
    };
    expect(effectiveStatus(finding, [other])).toBe("unverified");
  });

  // TRUST-GATE REGRESSION (trust-gate trio, finding #1 — the confident-lie path).
  // A verified_real result with no usable quoted code must NOT certify a finding
  // as verified — the schema permits evidence-less results, the authority refuses
  // to trust them. Without this, such a finding renders in the headline under
  // "the exact lines quoted as proof" with no proof attached.
  it("refuses verified_real when the evidence array is empty", () => {
    const noEvidence: VerificationResult = {
      findingId: "finding-1",
      status: "verified_real",
      evidence: [],
      note: "claims verified but quotes nothing",
    };
    expect(effectiveStatus(finding, [noEvidence])).toBe("unverified");
  });

  it("refuses verified_real when the only evidence has an empty/whitespace quote", () => {
    const blankQuote: VerificationResult = {
      findingId: "finding-1",
      status: "verified_real",
      evidence: [{ quotedCode: "   \n  ", location: { path: "x.ts", startLine: 1 } }],
      note: "claims verified but the quote is blank",
    };
    expect(effectiveStatus(finding, [blankQuote])).toBe("unverified");
  });

  it("still certifies a verdict backed by real quoted code", () => {
    const real: VerificationResult = {
      findingId: "finding-1",
      status: "verified_real",
      evidence: [{ quotedCode: "if (a < b) throw;", location: { path: "x.ts", startLine: 1 } }],
      note: "real proof",
    };
    expect(effectiveStatus(finding, [real])).toBe("verified_real");
  });
});

describe("VerificationResultSchema", () => {
  it("parses a valid verification result", () => {
    expect(VerificationResultSchema.parse(validVerification).status).toBe(
      "verified_real",
    );
  });

  it("rejects an unknown status", () => {
    expect(
      VerificationResultSchema.safeParse({
        ...validVerification,
        status: "looks_fine",
      }).success,
    ).toBe(false);
  });
});

describe("ReviewResultSchema", () => {
  const validReview = {
    target: { repo: "SeamStressDev/seamstress", commit: "93eabba" },
    seams: [validSeam],
    findings: [validFinding],
    verifications: [validVerification],
    usages: [
      {
        model: "claude-haiku-4-5",
        purpose: "seam_detection",
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: 0.00035,
      },
    ],
    cost: {
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCacheCreationInputTokens: 0,
      totalCacheReadInputTokens: 0,
      totalCostUsd: 0.00035,
      costUsdByModel: { "claude-haiku-4-5": 0.00035 },
      costUsdByPurpose: {
        seam_detection: 0.00035,
        critic: 0,
        synthesis: 0,
        verification: 0,
        other: 0,
      },
    },
    synthesis: "One critical money-path finding, verified real.",
  };

  it("parses a fully-populated review result", () => {
    expect(ReviewResultSchema.parse(validReview).findings).toHaveLength(1);
  });

  it("rejects a review with a malformed nested finding", () => {
    expect(
      ReviewResultSchema.safeParse({
        ...validReview,
        findings: [{ ...validFinding, blastRadius: "nope" }],
      }).success,
    ).toBe(false);
  });
});
