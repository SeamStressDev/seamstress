/**
 * Data-model tests. These shapes are the contract the whole engine builds
 * against, so they're the highest-value tests in this foundation: valid objects
 * of each shape parse; invalid ones (bad enum, missing required field, wrong
 * type) reject. All runtime — no API calls.
 */

import { describe, expect, it } from "vitest";
import {
  FindingSchema,
  ReviewResultSchema,
  SeamSchema,
  VerificationResultSchema,
} from "./index.js";

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
  verificationStatus: "unverified",
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

  it("rejects an unknown verification status", () => {
    expect(
      FindingSchema.safeParse({ ...validFinding, verificationStatus: "maybe" })
        .success,
    ).toBe(false);
  });

  it("rejects a non-string description", () => {
    expect(
      FindingSchema.safeParse({ ...validFinding, description: 42 }).success,
    ).toBe(false);
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
