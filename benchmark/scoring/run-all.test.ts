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
 * run-all harness tests — synthetic fixture ledgers, NO pipeline, no git.
 * Blob resolution is injected as a map: commit -> per-entry blob id.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { RunAllDeps } from "./run-all.js";
import { assertNotBait, buildReport } from "./run-all.js";

const root = mkdtempSync(join(tmpdir(), "run-all-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A minimal ground truth: one must_find ("bug"), one asserted_claim trap. */
const GT = {
  must_find: [{ id: "the-bug", description: "d", match: { all_of: [["bug"]] } }],
  must_not_claim: [
    {
      id: "the-trap",
      description: "d",
      match: {
        asserted_claim: { subject: ["cosmetic"], predicate: ["fix"], within: 50 },
      },
    },
  ],
};

/** Projection whose single finding hits the must_find, verified_real. */
const GOOD_PROJECTION = {
  seams: [{ id: "s1", kind: "auth" }],
  findings: [
    {
      id: "f1",
      seamId: "s1",
      description: "the bug is here",
      reasoning: "because",
      blastRadius: "high",
      locations: [],
    },
  ],
  verifications: [
    {
      findingId: "f1",
      status: "verified_real",
      evidence: [{ quotedCode: "the bug", location: { path: "x.ts" } }],
      note: "",
    },
  ],
};

interface EntrySpec {
  id: string;
  validity?: string;
  rows?: object[];
  projections?: Record<string, object>; // "<date>-<mode>" -> projection
}

/** Lay a synthetic benchmark on disk under a fresh subdir; return its deps. */
function makeFixture(
  name: string,
  entries: EntrySpec[],
  blobs: Record<string, Record<string, string>>, // commit -> entryId -> blob
): RunAllDeps {
  const base = join(root, name);
  const entriesDir = join(base, "entries");
  const resultsDir = join(base, "results");
  const runsDir = join(base, "results", "runs");
  for (const e of entries) {
    mkdirSync(join(entriesDir, e.id), { recursive: true });
    writeFileSync(
      join(entriesDir, e.id, "entry.json"),
      JSON.stringify({ id: e.id, seam_kind: "auth", validity: e.validity ?? "proposed" }),
    );
    writeFileSync(join(entriesDir, e.id, "ground_truth.json"), JSON.stringify(GT));
    mkdirSync(resultsDir, { recursive: true });
    if (e.rows) {
      writeFileSync(
        join(resultsDir, `${e.id}.jsonl`),
        e.rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
      );
    }
    for (const [key, proj] of Object.entries(e.projections ?? {})) {
      mkdirSync(join(runsDir, e.id), { recursive: true });
      writeFileSync(join(runsDir, e.id, `${key}.projection.json`), JSON.stringify(proj));
    }
  }
  return {
    entriesDir,
    resultsDir,
    runsDir,
    blobAt: (commitish, repoRelPath) => {
      const entryId = repoRelPath.split("/")[2];
      return blobs[commitish]?.[entryId] ?? null;
    },
    lastCommitTouching: () => "curgt99",
  };
}

function row(date: string, gt: string, summary = "s", mode = "review-only"): object {
  return {
    date,
    engine_commit: "eng0001",
    ground_truth_commit: gt,
    mode,
    outcome: "x",
    scorer_summary: summary,
    cost_usd: 0.1,
  };
}

describe("representative-run selection (mirrors 002/003's real multi-row shape)", () => {
  it("(a) filters to current-GT-content rows and tiebreaks by JSONL append order, not date", () => {
    // Three same-date rows like 002: two under old GT content, last under current.
    // HEAD blob for e1 is "blobCUR"; old commits resolve to different blobs.
    const deps = makeFixture(
      "select",
      [
        {
          id: "e1",
          rows: [
            row("2026-07-03", "old1"),
            row("2026-07-03", "cur1"), // current content, appended earlier
            row("2026-07-03", "cur2"), // current content, appended LAST -> representative
          ],
          projections: { "2026-07-03-review-only": GOOD_PROJECTION },
        },
      ],
      {
        HEAD: { e1: "blobCUR" },
        old1: { e1: "blobOLD" },
        cur1: { e1: "blobCUR" },
        cur2: { e1: "blobCUR" },
      },
    );
    const report = buildReport(deps);
    expect(report.rows[0].status).toBe("scored");
    expect(report.rows[0].selected).toEqual({
      date: "2026-07-03",
      mode: "review-only",
      appendIndex: 2, // the LAST current row, though dates are identical
    });
    expect(report.rows[0].outcome).toBe("found");
  });

  it("(b) no current-GT row -> STALE showing BOTH commits", () => {
    const deps = makeFixture(
      "stale",
      [{ id: "e1", rows: [row("2026-07-01", "old1"), row("2026-07-02", "old2")] }],
      { HEAD: { e1: "blobCUR" }, old1: { e1: "blobOLD" }, old2: { e1: "blobOLD2" } },
    );
    const report = buildReport(deps);
    expect(report.rows[0].status).toBe("stale");
    expect(report.rows[0].stale).toEqual({
      rowGtCommits: ["old1", "old2"],
      currentGtCommit: "curgt99",
    });
    // Both sides visible in the human-readable body.
    expect(report.body).toContain("old1");
    expect(report.body).toContain("curgt99");
    // STALE is a flag, not a fail.
    expect(report.body).not.toMatch(/STALE.*fail/i);
  });

  it("(c) current row whose projection is absent -> ARTIFACT MISSING, not a fabricated score", () => {
    const deps = makeFixture(
      "missing",
      [{ id: "e1", rows: [row("2026-07-03", "cur1")] }], // no projections written
      { HEAD: { e1: "blobCUR" }, cur1: { e1: "blobCUR" } },
    );
    const report = buildReport(deps);
    expect(report.rows[0].status).toBe("artifact-missing");
    expect(report.body).toContain("ARTIFACT MISSING");
  });
});

describe("bait guard", () => {
  it("(d) throws loudly when a bait path reaches the scoring path", () => {
    expect(() => assertNotBait("/repo/benchmark/bait/idor-randomization/seam.json")).toThrow(
      /bait fixture handed to the scoring path/,
    );
    const deps = makeFixture("baitguard", [], { HEAD: {} });
    expect(() => buildReport({ ...deps, entriesDir: join("benchmark", "bait") })).toThrow(
      /bait fixture handed to the scoring path/,
    );
  });

  it("does not throw on ordinary entry paths", () => {
    expect(() => assertNotBait("/repo/benchmark/entries/001-x/entry.json")).not.toThrow();
  });
});

describe("report properties", () => {
  const mixedDeps = makeFixture(
    "mixed",
    [
      {
        id: "a-found",
        validity: "validated",
        rows: [row("2026-07-03", "cur1")],
        projections: { "2026-07-03-review-only": GOOD_PROJECTION },
      },
      { id: "b-stale", validity: "validated", rows: [row("2026-07-02", "old1")] },
      {
        id: "c-partial",
        validity: "proposed",
        rows: [row("2026-07-03", "cur1")],
        projections: {
          "2026-07-03-review-only": { ...GOOD_PROJECTION, findings: [], verifications: [] },
        },
      },
    ],
    {
      HEAD: { "a-found": "bA", "b-stale": "bB", "c-partial": "bC" },
      cur1: { "a-found": "bA", "c-partial": "bC" },
      old1: { "b-stale": "bOLD" },
    },
  );

  it("(mixed board) STALE gets its own line and is excluded from the scored numerator AND denominator", () => {
    const report = buildReport(mixedDeps);
    // 3 entries, 1 stale -> scored 2 of 3 (stale not in either side of the scored count).
    expect(report.body).toContain("scored 2 of 3 entries");
    expect(report.body).toContain("STALE (excluded from scored aggregate");
    expect(report.body).toContain("b-stale");
    // Outcomes aggregated by name; empty projection scores as missed.
    expect(report.body).toContain("found=1");
    expect(report.body).toContain("missed=1");
  });

  it("(e) determinism: identical report body on repeat", () => {
    const first = buildReport(mixedDeps).body;
    const second = buildReport(mixedDeps).body;
    expect(second).toBe(first);
    expect(first).not.toMatch(/\d{2}:\d{2}:\d{2}|Z\b/); // no clock in the body
  });

  it("(f) the aggregate reports OUTCOMES and never fuses entry validity into it", () => {
    const report = buildReport(mixedDeps);
    const aggregateLines = report.body
      .split("\n")
      .filter((l) => l.startsWith("aggregate") || l.startsWith("STALE") || l.startsWith("ARTIFACT"));
    expect(aggregateLines.length).toBeGreaterThan(0);
    for (const line of aggregateLines) {
      // The forbidden fusion: any "N/N validated"-style count, or the token at all.
      expect(line).not.toMatch(/validated/i);
      expect(line).not.toMatch(/\d+\s*\/\s*\d+\s+validated/i);
    }
    // Validity still exists — as a per-entry COLUMN.
    expect(report.body).toContain("| validated |");
    expect(report.body).toContain("| proposed |");
  });

  it("flags DRIFT when the re-scored summary differs from the ledger row's recorded summary", () => {
    const report = buildReport(mixedDeps);
    const aRow = report.rows.find((r) => r.id === "a-found");
    // Synthetic rows carry scorer_summary "s", which never matches a real summary.
    expect(aRow?.drift).toBe(true);
    expect(report.body).toContain("[DRIFT vs ledger row]");
  });
});
