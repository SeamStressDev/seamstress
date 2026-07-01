/**
 * End-to-end seam-map tests — fully mocked, no filesystem-network, no key. The
 * detector and review both call the same fake ModelCaller; mapSeams runs against
 * a real temp repo on disk (so the heuristic + coverage signal exercise real
 * file enumeration), but every model call is canned.
 */

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { toTokenUsage } from "../llm/index.js";
import type { CallModelParams, CallModelResult } from "../llm/index.js";
import type { ModelCaller } from "./config.js";
import { mapWithConcurrency } from "./concurrency.js";
import { assessCoverage, mapSeams } from "./map.js";
import type { SeamMap } from "./map.js";
import { renderSeamMap } from "./report.js";
import type { BlastRadiusRank, Cost, Finding, Seam, SeamKind, VerificationResult } from "../types/index.js";

const ZERO_COST: Cost = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCacheCreationInputTokens: 0,
  totalCacheReadInputTokens: 0,
  totalCostUsd: 0,
  costUsdByModel: {},
  costUsdByPurpose: { seam_detection: 0, critic: 0, synthesis: 0, verification: 0, other: 0 },
};

/** Build a synthetic SeamMap from (description, blastRadius, verified?, consequence?) tuples for render tests. */
function mapFrom(
  specs: { desc: string; blast: BlastRadiusRank; verified: boolean; consequence?: string }[],
  seamKind: SeamKind = "auth",
): SeamMap {
  const seam: Seam = {
    id: "seam-1",
    kind: seamKind,
    label: "actions/role.ts",
    sources: [{ path: "actions/role.ts", startLine: 1, endLine: 9 }],
    inputText: "x",
  };
  const findings: Finding[] = specs.map((s, i) => ({
    id: `seam-1:finding-${i + 1}`,
    seamId: "seam-1",
    description: s.desc,
    reasoning: "r",
    blastRadius: s.blast,
    ...(s.consequence !== undefined ? { consequence: s.consequence } : {}),
  }));
  const verifications: VerificationResult[] = specs.map((s, i) => ({
    findingId: `seam-1:finding-${i + 1}`,
    status: s.verified ? "verified_real" : "judgment_call",
    evidence: [{ quotedCode: `code-${i}`, location: { path: "actions/role.ts", startLine: 1 } }],
    note: "n",
  }));
  return {
    repoPath: "/x",
    filesScanned: 10,
    candidatesFound: 1,
    seams: [seam],
    review: {
      target: { repo: "demo", commit: "c" },
      seams: [seam],
      findings,
      verifications,
      usages: [],
      cost: ZERO_COST,
      synthesis: "s",
    },
    erroredSeams: [],
    detectionCost: ZERO_COST,
    reviewCost: ZERO_COST,
    totalCost: ZERO_COST,
    coverage: { stack: "JavaScript/TypeScript", wellTuned: true, caveat: null },
  };
}

/** Slice out the executive-summary section ("What matters most" → next "## "). */
function execSummary(report: string): string {
  const start = report.indexOf("## ⚡ What matters most");
  const after = report.indexOf("\n## ", start + 1);
  return report.slice(start, after === -1 ? undefined : after);
}

describe("renderSeamMap — executive summary leads with the punch (Fix 1)", () => {
  const CRIT = "anyone logged in can set their own role to admin";
  const HIGH = "priceId is accepted from the caller with no allowlist";
  const LOW = "error masking hides the real failure cause";
  const JUDG = "depends on whether cascade deletes are intended";

  const report = renderSeamMap(
    mapFrom([
      { desc: CRIT, blast: "critical", verified: true },
      { desc: HIGH, blast: "high", verified: true },
      { desc: LOW, blast: "low", verified: true },
      { desc: JUDG, blast: "medium", verified: false },
    ]),
  );

  it("puts the critical + high verified findings in the executive summary", () => {
    const exec = execSummary(report);
    expect(exec).toContain(CRIT);
    expect(exec).toContain(HIGH);
    expect(exec).toMatch(/could get you owned/i);
  });

  it("does NOT put the low-severity tail or judgment calls in the executive summary", () => {
    const exec = execSummary(report);
    expect(exec).not.toContain(LOW);
    expect(exec).not.toContain(JUDG);
  });

  it("still includes the low tail and judgment calls, collapsed, further down", () => {
    // They remain in the report (honest) — just demoted below the headline.
    const tail = report.slice(report.indexOf("Lower-severity"));
    expect(tail).toContain(LOW);
    expect(report).toContain(JUDG);
    expect(report.indexOf(CRIT)).toBeLessThan(report.indexOf(LOW));
  });

  it("renders the honest 'none found' summary when there are no criticals/highs", () => {
    const r = renderSeamMap(
      mapFrom([
        { desc: LOW, blast: "low", verified: true },
        { desc: JUDG, blast: "medium", verified: false },
      ]),
    );
    const exec = execSummary(r);
    expect(exec).toMatch(/no critical or high-severity issues found/i);
    expect(exec).not.toContain(LOW); // tail still demoted out of the summary
    expect(r).toContain(LOW); // but present below
  });

  it("caps the collapsed tail with a '+N more' line", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      desc: `low note ${i}`,
      blast: "low" as BlastRadiusRank,
      verified: true,
    }));
    const r = renderSeamMap(mapFrom([{ desc: CRIT, blast: "critical", verified: true }, ...many]));
    expect(r).toMatch(/and \d+ more lower-severity/i);
  });
});

const tmpRepos: string[] = [];
afterAll(() => tmpRepos.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Write a throwaway repo with the given files and return its path. */
function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "seam-map-"));
  tmpRepos.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

/** A fake caller: detection confirms every candidate as a seam; review yields one verified finding. */
function fakeClient(): ModelCaller {
  return {
    async callModel(params: CallModelParams): Promise<CallModelResult> {
      const purpose = params.purpose ?? "other";
      let text = "{}";
      if (purpose === "seam_detection") {
        text = JSON.stringify({ isSeam: true, kind: "money_path", confidence: "high", reasoning: "handles payments" });
      } else if (purpose === "critic") {
        text = JSON.stringify({ findings: [{ description: "anyone logged in can change their own role to admin", reasoning: "no ownership check", blastRadius: "critical" }] });
      } else if (purpose === "synthesis") {
        text = JSON.stringify({ summary: "one critical access issue", findings: [{ description: "anyone logged in can change their own role to admin", reasoning: "no ownership check", blastRadius: "critical" }] });
      } else if (purpose === "verification") {
        text = JSON.stringify({ status: "verified_real", evidence: [{ quotedCode: "if (session.id === userId) setRole(role)", location: { path: "actions/role.ts", startLine: 3 } }], note: "confirmed" });
      }
      return {
        text,
        stopReason: "end_turn",
        usage: toTokenUsage("claude-sonnet-4-6", purpose, { inputTokens: 40, outputTokens: 15, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }),
      };
    },
  };
}

describe("mapWithConcurrency — bounded concurrency", () => {
  it("never exceeds the concurrency cap", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async (i) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return i;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("preserves input order in results", async () => {
    const out = await mapWithConcurrency([10, 20, 30], 2, async (x) => x * 2);
    expect(out).toEqual([20, 40, 60]);
  });
});

describe("assessCoverage — honest stack signal", () => {
  it("flags no caveat for a validated stack (TypeScript)", () => {
    const c = assessCoverage("/nonexistent", { ".ts": 10, ".tsx": 3 });
    expect(c.wellTuned).toBe(true);
    expect(c.caveat).toBeNull();
  });

  it("flags a caveat for an unfamiliar stack (Go)", () => {
    const c = assessCoverage("/nonexistent", { ".go": 12 });
    expect(c.wellTuned).toBe(false);
    expect(c.caveat).toMatch(/coverage may be incomplete/i);
  });
});

describe("mapSeams — end-to-end orchestration", () => {
  it("detects, reviews, pools COGS (detection + review), and surfaces seams", async () => {
    const repo = makeRepo({
      "package.json": '{"name":"x"}',
      "actions/role.ts": '"use server";\nimport { auth } from "@/auth";\nexport async function setRole(userId, role) { if (session.id === userId) db.user.update(); }',
      "components/Button.tsx": "export const Button = () => <button>hi</button>;",
    });

    const map = await mapSeams(repo, { client: fakeClient() });

    expect(map.seams.length).toBeGreaterThanOrEqual(1);
    expect(map.coverage.wellTuned).toBe(true); // package.json + .ts
    // Pooled cost: total = detection + review, and > 0.
    expect(map.detectionCost.totalCostUsd).toBeGreaterThan(0);
    expect(map.reviewCost.totalCostUsd).toBeGreaterThan(0);
    expect(map.totalCost.totalCostUsd).toBeCloseTo(
      map.detectionCost.totalCostUsd + map.reviewCost.totalCostUsd,
      9,
    );
    expect(map.erroredSeams).toHaveLength(0);
  });
});

describe("mapSeams — per-seam isolation", () => {
  // A client that throws ONLY while reviewing seam B's source (so one seam's
  // review fails); detection + the other seam succeed.
  function isolationClient(failToken: string): ModelCaller {
    const base = fakeClient();
    return {
      async callModel(params: CallModelParams): Promise<CallModelResult> {
        const content = String(params.messages[0]?.content ?? "");
        if (params.purpose === "critic" && content.includes(failToken)) {
          throw new Error("terminal review failure for one seam");
        }
        return base.callModel(params);
      },
    };
  }

  it("isolates a failing seam's review while the others still produce the map", async () => {
    const repo = makeRepo({
      "actions/good.ts": '"use server";\nimport { stripe } from "stripe";\nawait stripe.charges.create();',
      "actions/bad.ts": '"use server";\nimport { stripe } from "stripe";\nawait stripe.refunds.create(); // POISON_SEAM',
    });

    const map = await mapSeams(repo, { client: isolationClient("POISON_SEAM") });

    // The map did NOT abort: both seams detected, one reviewed, one isolated.
    expect(map.seams.length).toBeGreaterThanOrEqual(2);
    expect(map.erroredSeams.length).toBeGreaterThanOrEqual(1);
    expect(map.erroredSeams.some((e) => e.label.includes("bad.ts"))).toBe(true);
    // The surviving seam still produced its review/findings.
    expect(map.review.findings.length).toBeGreaterThanOrEqual(1);
  });
});

describe("renderSeamMap — builder-facing report", () => {
  let map: SeamMap;

  it("renders verified findings prominently with quoted evidence, in plain language", async () => {
    const repo = makeRepo({
      "manage.py": "import django",
      "app/auth/views.py": "def set_role(request):\n  if request.user.id == target: user.is_admin = True\n  user.save()",
    });
    map = await mapSeams(repo, { client: fakeClient() });
    const report = renderSeamMap(map);

    // The verified finding's plain description is in the headline section.
    expect(report).toContain("Verified issues");
    expect(report).toContain("anyone logged in can change their own role to admin");
    // Quoted real code is shown as proof (the trust signal).
    expect(report).toContain("setRole");
    // No internal jargon leaks into the builder-facing text.
    expect(report).not.toMatch(/synthesis/i);
    expect(report).not.toMatch(/\bIDOR\b/);
    expect(report).not.toMatch(/blast radius/i);
    // COGS is NOT in the builder-facing report.
    expect(report).not.toMatch(/\$\d|COGS|token/i);
  });

  it("softens jargon (IDOR) into plain phrasing", () => {
    // A finding whose model text used 'IDOR' must be softened in the render.
    const m: SeamMap = {
      ...map,
      review: {
        ...map.review,
        findings: [{ id: "s:finding-1", seamId: map.seams[0]!.id, description: "an IDOR lets one user read another's invoices", reasoning: "r", blastRadius: "high" }],
        verifications: [{ findingId: "s:finding-1", status: "verified_real", evidence: [{ quotedCode: "getInvoice(req.query.id)", location: { path: "x", startLine: 1 } }], note: "n" }],
      },
    };
    const report = renderSeamMap(m);
    expect(report).not.toMatch(/\bIDOR\b/);
    expect(report).toMatch(/broken access control/i);
  });

  it("includes the coverage caveat for an unfamiliar stack", async () => {
    const repo = makeRepo({ "go.mod": "module x", "main.go": "package main\nfunc Charge(){}" });
    const goMap = await mapSeams(repo, { client: fakeClient() });
    const report = renderSeamMap(goMap);
    expect(report).toMatch(/Coverage note/i);
    expect(report).toMatch(/incomplete/i);
  });

  it("does not show a false caveat for a validated stack", () => {
    expect(renderSeamMap(map)).not.toMatch(/Coverage note/i);
  });
});

describe("renderSeamMap — consequence is bound to the finding, not the seam kind", () => {
  // The kind-mismatch shape: an isolation finding that lives on a money_path seam.
  // Its consequence must read as isolation/access — NOT the kind-derived
  // "money can move the wrong way" that the old kind-keyed lookup produced.
  const ISOLATION_CONSEQUENCE =
    "one logged-in tenant could act on another tenant's domain — a cross-tenant access problem.";

  const map = mapFrom(
    [{ desc: "refreshMyDomainStatus loads a tenant with no owner_id filter", blast: "high", verified: true, consequence: ISOLATION_CONSEQUENCE }],
    "money_path", // the seam was filed under money — the consequence must NOT inherit that
  );
  const report = renderSeamMap(map);

  it("renders the finding's OWN consequence under 'If this is wrong'", () => {
    expect(report).toContain(`**If this is wrong:** ${ISOLATION_CONSEQUENCE}`);
  });

  it("does NOT render the seam-kind generic consequence (no money-mislabel)", () => {
    expect(report).not.toMatch(/money can move the wrong way/i);
    // The Area line still reflects the seam's category — that part is legitimate.
    expect(report).toContain("**Area:** Money & billing");
  });

  it("omits the consequence line entirely when a finding carries none (no kind fallback)", () => {
    const r = renderSeamMap(mapFrom([{ desc: "some finding", blast: "critical", verified: true }], "auth"));
    expect(r).not.toContain("**If this is wrong:**");
    expect(r).not.toMatch(/the wrong person can get in/i); // the old auth-kind generic
  });
});
