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
