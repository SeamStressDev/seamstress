/**
 * Detector tests — fully mocked, no filesystem-dependent network, no API key.
 * The heuristic is pure (scored on synthetic source strings); the judge is a
 * fake ModelCaller returning canned JSON. Pins the Phase 2 refinements
 * (server-scope + content safety net), the precision discipline, per-file
 * isolation, conclusion-blinding, and the reviewSeams COGS pooling.
 */

import { describe, expect, it } from "vitest";
import { toTokenUsage } from "../llm/index.js";
import { SeamSchema, effectiveStatus } from "../types/index.js";
import type { Finding, ReviewResult, Seam, VerificationResult } from "../types/index.js";
import type { CallModelParams, CallModelResult } from "../llm/index.js";
import type { ModelCaller } from "./config.js";
import { scoreSource, DEFAULT_CANDIDATE_THRESHOLD } from "./heuristic.js";
import type { Candidate } from "./heuristic.js";
import {
  judgeCandidate,
  judgeCandidates,
  buildDetectionPrompt,
} from "./detection.js";
import type { CandidateSource } from "./detection.js";
import { assembleSeam, blindConclusions } from "./assembly.js";
import { reviewSeams, mergeReviews } from "./pipeline.js";
import { PlaceholderPromptError } from "./prompts.js";

function candidate(path: string, lines = 30): Candidate {
  return { path, score: 5, hits: [], lines, viaSafetyNet: false };
}

/** A fake judge returning canned JSON, priced through real toTokenUsage. */
function fakeJudge(byPath: (path: string) => string): ModelCaller {
  return {
    async callModel(params: CallModelParams): Promise<CallModelResult> {
      const content = String(params.messages[0]?.content ?? "");
      const path = content.match(/File: (.+)/)?.[1] ?? "";
      return {
        text: byPath(path),
        stopReason: "end_turn",
        usage: toTokenUsage("claude-sonnet-4-6", "seam_detection", {
          inputTokens: 100,
          outputTokens: 30,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        }),
      };
    },
  };
}

describe("heuristic — server-scope refinement", () => {
  it("scores a server-side money-path file as a candidate", () => {
    const c = scoreSource(
      "actions/generate-user-stripe.ts",
      `"use server";\nimport { stripe } from "@/lib/stripe";\nawait stripe.checkout.sessions.create({});`,
    );
    expect(c.score).toBeGreaterThanOrEqual(DEFAULT_CANDIDATE_THRESHOLD);
    expect(c.hits).toContain("bonus:server");
  });

  it("does NOT score a pure-UI trigger component as a candidate", () => {
    // The Phase 2 false-positive class: a component that merely TRIGGERS a
    // server action. The UI penalty must push it below threshold.
    const c = scoreSource(
      "components/forms/billing-form-button.tsx",
      `export function BillingButton() { return <button onClick={() => generateUserStripe()}>Upgrade</button>; }`,
    );
    expect(c.score).toBeLessThan(DEFAULT_CANDIDATE_THRESHOLD);
    expect(c.hits).toContain("penalty:ui");
  });

  it("nominates a non-JS auth seam (Django JWT backend) the old JS-tuned signals missed", () => {
    // Build 3 non-Stripe finding: the heuristic, tuned on JS/Stripe idioms,
    // dropped Django's authentication backend. Backend-language files get the
    // server bonus and cross-stack auth idioms now register.
    const c = scoreSource(
      "conduit/apps/authentication/backends.py",
      `import jwt\nfrom django.conf import settings\n` +
        `def authenticate(self, request):\n  token = request.META.get('HTTP_AUTHORIZATION')\n` +
        `  payload = jwt.decode(token, settings.SECRET_KEY)\n  return (user, token)`,
    );
    expect(c.score).toBeGreaterThanOrEqual(DEFAULT_CANDIDATE_THRESHOLD);
    expect(c.hits).toContain("bonus:server");
  });

  it("nominates a DRF view with declarative permissions + deletion (no imperative if-check)", () => {
    const c = scoreSource(
      "conduit/apps/articles/views.py",
      `class ArticleViewSet(viewsets.ModelViewSet):\n` +
        `  permission_classes = [IsAuthenticatedOrReadOnly]\n` +
        `  def perform_destroy(self, instance):\n    instance.delete()`,
    );
    expect(c.score).toBeGreaterThanOrEqual(DEFAULT_CANDIDATE_THRESHOLD);
  });

  it("does not penalize a server file that merely contains the word 'view' (e.g. Django)", () => {
    const c = scoreSource(
      "app/views.py",
      `def delete_account(request):\n  if request.user.is_staff:\n    Account.objects.filter(id=request.user.id).delete()`,
    );
    expect(c.hits).not.toContain("penalty:ui");
  });
});

describe("heuristic — content safety net (the value-prop tension)", () => {
  it("rescues a signal-LIGHT but risk-SHAPED file with no obvious keywords", () => {
    // No stripe/auth/webhook keywords at all — a generically named util doing
    // permission-gated money math + a delete. The keyword score alone is ~0;
    // the safety net must lift it to candidacy so the wedge's non-obvious seams
    // are not silently filtered out.
    const c = scoreSource(
      "lib/ledger.ts",
      `export function settle(account, amount) {\n` +
        `  if (account.owner !== currentActor) return;\n` +
        `  account.balance -= amount;\n` +
        `  entries.delete(account.id);\n` +
        `}`,
    );
    expect(c.score).toBeGreaterThanOrEqual(DEFAULT_CANDIDATE_THRESHOLD);
    expect(c.viaSafetyNet).toBe(true);
    expect(c.hits).toEqual(
      expect.arrayContaining(["shape:access-branch", "shape:money-math", "shape:db-delete"]),
    );
  });

  it("does not rescue a trivial file with no risk shapes", () => {
    const c = scoreSource("lib/format.ts", `export const upper = (s) => s.toUpperCase();`);
    expect(c.score).toBeLessThan(DEFAULT_CANDIDATE_THRESHOLD);
  });
});

describe("LLM judgment — mapping, rejection, FP discipline", () => {
  const SEAM_JSON = JSON.stringify({
    isSeam: true,
    kind: "money_path",
    confidence: "high",
    reasoning: "Creates a Stripe checkout session.",
  });
  const NOT_SEAM_JSON = JSON.stringify({
    isSeam: false,
    kind: null,
    reasoning: "Presentational button that only triggers a server action.",
  });

  it("maps a confirmed-seam response to a valid Seam", async () => {
    const cs: CandidateSource = {
      candidate: candidate("actions/generate-user-stripe.ts"),
      source: 'await stripe.checkout.sessions.create({});',
    };
    const judged = await judgeCandidate(cs, fakeJudge(() => SEAM_JSON));
    expect(judged.seam).not.toBeNull();
    expect(() => SeamSchema.parse(judged.seam)).not.toThrow();
    expect(judged.seam?.kind).toBe("money_path");
    expect(judged.error).toBeNull();
  });

  it("rejects a not-a-seam response (no Seam produced)", async () => {
    const cs: CandidateSource = {
      candidate: candidate("components/forms/billing-form-button.tsx"),
      source: "export function BillingButton() { return null; }",
    };
    const judged = await judgeCandidate(cs, fakeJudge(() => NOT_SEAM_JSON));
    expect(judged.seam).toBeNull();
    expect(judged.response?.isSeam).toBe(false);
    expect(judged.error).toBeNull();
  });

  it("asserts the real source is in the detection prompt (placeholder guard)", () => {
    expect(() =>
      buildDetectionPrompt({ candidate: candidate("x.ts"), source: "" }),
    ).toThrow(PlaceholderPromptError);
  });
});

describe("per-file isolation — one bad response does not abort the batch", () => {
  const batch: CandidateSource[] = [
    { candidate: candidate("actions/a.ts"), source: "await stripe.charges.create();" },
    { candidate: candidate("actions/b.ts"), source: "if (user.role) db.user.delete();" },
    { candidate: candidate("actions/c.ts"), source: "await stripe.refunds.create();" },
  ];

  // b.ts returns malformed JSON (and confidence-omitted shape); a.ts and c.ts are fine.
  const judge = fakeJudge((path) =>
    path === "actions/b.ts"
      ? "the model forgot to answer in JSON"
      : JSON.stringify({ isSeam: true, kind: "money_path", reasoning: "ok" }),
  );

  it("completes the batch, isolating the malformed candidate while the others produce seams", async () => {
    const result = await judgeCandidates(batch, judge);
    // The batch did NOT abort: all three judged, two seams, one isolated error.
    expect(result.judged).toHaveLength(3);
    expect(result.seams).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe("actions/b.ts");
    // Cost still pooled across the calls that completed.
    expect(result.cost.totalCostUsd).toBeGreaterThan(0);
  });
});

describe("seam assembly + conclusion-blinding", () => {
  it("assembles a schema-valid Seam with sources and non-empty inputText", () => {
    const seam = assembleSeam(candidate("actions/x.ts", 12), "const x = 1;\n", "auth");
    expect(() => SeamSchema.parse(seam)).not.toThrow();
    expect(seam.sources[0]?.path).toBe("actions/x.ts");
    expect(seam.inputText.length).toBeGreaterThan(0);
  });

  it("blinds conclusion-stating comments while preserving the code", () => {
    const source =
      `function guard(u) {\n` +
      `  // this is cosmetic — the check below is a no-op\n` +
      `  if (u.role) allow(); // intentionally insecure\n` +
      `  return true;\n` +
      `}`;
    const blinded = blindConclusions(source);
    expect(blinded).not.toMatch(/cosmetic/i);
    expect(blinded).not.toMatch(/insecure/i);
    expect(blinded).toContain("if (u.role) allow();"); // code intact
    expect(blinded).toContain("redacted for blind review");
  });

  it("leaves ordinary comments untouched", () => {
    const source = `// compute the running total\nconst total = a + b;`;
    expect(blindConclusions(source)).toBe(source);
  });
});

describe("reviewSeams — pools COGS across multiple seams", () => {
  const seamA = assembleSeam(candidate("actions/a.ts"), "await charge();", "money_path");
  const seamB = assembleSeam(candidate("actions/b.ts"), "if (role) allow();", "auth");

  // Fake review client: critic/synthesis/verification by purpose, one finding each.
  const client: ModelCaller = {
    async callModel(params: CallModelParams): Promise<CallModelResult> {
      const purpose = params.purpose ?? "other";
      const text =
        purpose === "critic"
          ? JSON.stringify({ findings: [{ description: "d", reasoning: "r", blastRadius: "high" }] })
          : purpose === "synthesis"
            ? JSON.stringify({ summary: "s", findings: [{ description: "d", reasoning: "r", blastRadius: "high" }] })
            : JSON.stringify({ status: "verified_real", evidence: [{ quotedCode: "charge()", location: { path: "actions/a.ts", startLine: 1 } }], note: "n" });
      return {
        text,
        stopReason: "end_turn",
        usage: toTokenUsage("claude-haiku-4-5", purpose, {
          inputTokens: 50,
          outputTokens: 20,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        }),
      };
    },
  };

  it("merges seams with namespaced finding IDs and summed cost", async () => {
    const result = await reviewSeams([seamA, seamB], {
      client,
      target: { repo: "r", commit: "c" },
      config: {
        critics: [{ model: "claude-haiku-4-5", label: "c", framing: "f" }],
        synthesisModel: "claude-haiku-4-5",
        verificationModel: "claude-haiku-4-5",
        maxTokens: 512,
      },
    });

    expect(result.seams).toHaveLength(2);
    // Finding IDs namespaced by position + seam — no collision across seams.
    expect(result.findings.map((f) => f.id)).toEqual([
      `s0:${seamA.id}:finding-1`,
      `s1:${seamB.id}:finding-1`,
    ]);
    // effectiveStatus still resolves each finding to its own verification.
    expect(result.findings.every((f) => effectiveStatus(f, result.verifications) === "verified_real")).toBe(true);
    // Pooled cost = sum of every call across both seams (2 seams * 3 calls).
    expect(result.usages).toHaveLength(6);
    expect(result.cost.totalCostUsd).toBeCloseTo(
      result.usages.reduce((n, u) => n + u.costUsd, 0),
      9,
    );
  });

  // TRUST-GATE REGRESSION (trust-gate trio, finding #2 — the misattachment path).
  // Two distinct paths can slugify to the SAME seam.id; a seam-id-only prefix
  // would alias their finding-1s, and first-match .find() would bind one seam's
  // verification + evidence to the OTHER seam's finding. The position-keyed
  // prefix must keep each finding bound to its own verdict.
  it("keeps verifications bound to the right finding when two seams share a slugged id", () => {
    const dupId = "seam-collide";
    const mk = (kind: "money_path" | "auth", status: "verified_real" | "false_positive", quote: string) => ({
      seam: { id: dupId, kind, label: `${kind}.ts`, sources: [{ path: `${kind}.ts` }], inputText: "x" } as Seam,
      result: {
        target: { repo: "r", commit: "c" },
        seams: [],
        findings: [{ id: "finding-1", seamId: dupId, description: `${kind} issue`, reasoning: "r", blastRadius: "critical" } as Finding],
        verifications: [{ findingId: "finding-1", status, evidence: [{ quotedCode: quote, location: { path: `${kind}.ts`, startLine: 1 } }], note: "n" }] as VerificationResult[],
        usages: [],
        cost: { totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationInputTokens: 0, totalCacheReadInputTokens: 0, totalCostUsd: 0, costUsdByModel: {}, costUsdByPurpose: { seam_detection: 0, critic: 0, synthesis: 0, verification: 0, other: 0 } },
        synthesis: "s",
      } as ReviewResult,
    });

    // Seam A: verified_real (quote "AAA"). Seam B (same slugged id): false_positive (quote "BBB").
    const merged = mergeReviews([mk("money_path", "verified_real", "AAA"), mk("auth", "false_positive", "BBB")], { repo: "r", commit: "c" });

    const [fA, fB] = merged.findings;
    // Each finding resolves to ITS OWN verdict — not the first one for both.
    expect(effectiveStatus(fA!, merged.verifications)).toBe("verified_real");
    expect(effectiveStatus(fB!, merged.verifications)).toBe("false_positive");
    // And to its own evidence (no cross-bound proof).
    const evA = merged.verifications.find((v) => v.findingId === fA!.id)?.evidence[0]?.quotedCode;
    const evB = merged.verifications.find((v) => v.findingId === fB!.id)?.evidence[0]?.quotedCode;
    expect(evA).toBe("AAA");
    expect(evB).toBe("BBB");
  });
});
