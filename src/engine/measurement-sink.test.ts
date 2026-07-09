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
 * Measurement sink tests (charter slice 1b). Pins the slice's promises:
 *
 *  1. GATE — capture happens only for allowlisted contexts, enforced at BOTH
 *     session creation and the scanRepo feed site (double gate).
 *  2. SHAPE — a benchmark-context run over a hand-computed corpus produces
 *     exactly the expected stratified aggregate row.
 *  3. SUPPRESSION — cells in [1, k) never surface at a named grain: bands
 *     collapse, rare signals lose their NAME into other_signals, histogram
 *     bins collapse to bands to totals; totals are conserved.
 *  4. CLOSED SCHEMA — the validator rejects unknown keys at every depth,
 *     non-vocabulary keys, path-shaped keys, free-text values, non-permitted
 *     contexts, and named-grain counts that violate the row's suppression_k.
 *  5. EPHEMERAL JOIN — the flushed ledger holds ONE aggregate line with no
 *     per-file structure: no scanned path appears anywhere in the serialized
 *     row, and the session destroys its join state at tally() (single-use).
 *  6. INERT — capture changes nothing about what scanRepo returns.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Finding, VerificationResult } from "../types/index.js";
import { scanRepo } from "./heuristic.js";
import {
  AGGREGATE_LEDGER_RELPATH,
  CaptureSession,
  SUPPRESSION_K,
  appendAggregateRow,
  emitAggregateRow,
  mergeTallies,
  registerReviewVerdicts,
  validateAggregateRow,
} from "./measurement-sink.js";
import type { AggregateRow, AggregateTally, ScoreBand, SignalCell } from "./measurement-sink.js";
import type { RunContext } from "./run-context.js";

const ALL_CONTEXTS: RunContext[] = ["benchmark", "self-audit", "gift-run", "user", "test"];

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Hand-computed corpus (scores verified against scoreSource directly):
 *   api/webhook.ts        → score 5 (mid),    hits [path:webhook, bonus:server]
 *   components/Button.tsx → score -3 (sub),   hits [penalty:ui]
 *   notes.ts              → score 0 (sub),    hits []
 *   api/auth/login.ts     → score 6 (strong), hits [path:auth, import:auth, bonus:server]
 * Candidates at threshold 3: webhook.ts, login.ts. No rescues.
 */
const CORPUS_PATHS = ["api/webhook.ts", "components/Button.tsx", "notes.ts", "api/auth/login.ts"];
function makeCorpus(): string {
  const dir = mkdtempSync(join(tmpdir(), "seamstress-sink-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "api", "auth"), { recursive: true });
  mkdirSync(join(dir, "components"), { recursive: true });
  writeFileSync(join(dir, "api", "webhook.ts"), "export {}");
  writeFileSync(join(dir, "components", "Button.tsx"), "export {}");
  writeFileSync(join(dir, "notes.ts"), "export {}");
  writeFileSync(join(dir, "api", "auth", "login.ts"), 'import jwt from "jsonwebtoken";');
  return dir;
}

const META = { date: "2026-07-09", engineCommit: "abc1234" };

const cell = (fired: number, confirmed = 0, refuted = 0): SignalCell => ({
  fired,
  confirmed_real: confirmed,
  refuted,
});

/** Build a tally directly (for suppression tests where counts must be large). */
function syntheticTally(
  perSignal: Record<string, Partial<Record<ScoreBand, SignalCell>>>,
  histogram: Partial<Record<"confirmed_real" | "refuted" | "unverified", Record<string, number>>>,
  scalars: { filesScanned: number; candidatesFound: number; rescueCount: number },
): AggregateTally {
  return {
    runContext: "benchmark",
    threshold: 3,
    ...scalars,
    perSignal: new Map(
      Object.entries(perSignal).map(([label, byBand]) => [
        label,
        new Map(Object.entries(byBand) as [ScoreBand, SignalCell][]),
      ]),
    ),
    histogram: new Map(
      Object.entries(histogram).map(([outcome, bins]) => [
        outcome as "confirmed_real" | "refuted" | "unverified",
        new Map(Object.entries(bins)),
      ]),
    ),
  };
}

describe("capture gate (1a allowlist, double-enforced)", () => {
  it("CaptureSession.begin is null for every non-permitted context, including unspecified", () => {
    for (const context of ALL_CONTEXTS) {
      const session = CaptureSession.begin(context);
      if (context === "benchmark" || context === "self-audit") {
        expect(session, context).not.toBeNull();
        expect(session!.runContext).toBe(context);
      } else {
        expect(session, context).toBeNull();
      }
    }
    expect(CaptureSession.begin(undefined)).toBeNull();
  });

  it("scanRepo refuses to feed a session under a non-permitted or unspecified context", () => {
    const dir = makeCorpus();
    // A benchmark session wrongly handed to non-permitted scans: the SITE gate
    // must hold on its own. The session ends up never fed — tally() throws.
    const session = CaptureSession.begin("benchmark")!;
    scanRepo(dir, { runContext: "user", capture: session });
    scanRepo(dir, { runContext: "gift-run", capture: session });
    scanRepo(dir, { runContext: "test", capture: session });
    scanRepo(dir, { capture: session }); // unspecified → "user"
    expect(() => session.tally()).toThrow(/never ran or its context was not capture-permitted/);
  });

  it("user-context and unspecified runs produce NO capture artifact", () => {
    const dir = makeCorpus();
    // No session can even exist for these contexts; nothing to flush, nothing
    // written. (The ledger write path is only reachable through a session.)
    expect(CaptureSession.begin("user")).toBeNull();
    expect(CaptureSession.begin(undefined)).toBeNull();
    // And the scan itself never creates one implicitly:
    const candidates = scanRepo(dir, { runContext: "user" });
    expect(candidates.map((c) => c.path).sort()).toEqual(["api/auth/login.ts", "api/webhook.ts"]);
  });
});

describe("capture is inert on detection", () => {
  it("scanRepo returns identical candidates with capture on and off", () => {
    const dir = makeCorpus();
    const session = CaptureSession.begin("benchmark")!;
    const withCapture = scanRepo(dir, { runContext: "benchmark", capture: session });
    const without = scanRepo(dir, { runContext: "benchmark" });
    const plain = scanRepo(dir, {});
    expect(withCapture).toEqual(without);
    expect(withCapture).toEqual(plain);
  });
});

describe("end-to-end shape on the hand-computed corpus", () => {
  it("emits exactly the expected suppressed row (k=5 pools everything small)", () => {
    const dir = makeCorpus();
    const session = CaptureSession.begin("benchmark")!;
    scanRepo(dir, { runContext: "benchmark", capture: session });
    session.recordVerdict("api/auth/login.ts", "confirmed_real");
    const row = emitAggregateRow(session.tally(), META);

    // Hand-computed: 5 signal firings pool (every per-signal count < 5); the
    // pool conserves totals: fired 1(webhook)+2(server)+1(ui)+1(auth)+1(import:auth)=6,
    // confirmed 3 (login.ts carries three labels). Histogram cells all < 5 →
    // collapse through bands to outcome totals.
    expect(row).toEqual({
      date: "2026-07-09",
      engine_commit: "abc1234",
      run_context: "benchmark",
      threshold: 3,
      suppression_k: 5,
      files_scanned: 4,
      candidates_found: 2,
      rescue_count: 0,
      per_signal: {
        other_signals: { all: { fired: 6, confirmed_real: 3, refuted: 0 } },
      },
      score_histogram: {
        confirmed_real: { all: 1 },
        unverified: { all: 3 },
      },
    });
  });

  it("flushes ONE aggregate line in which no per-file structure survives", () => {
    const dir = makeCorpus();
    const ledgerDir = mkdtempSync(join(tmpdir(), "seamstress-ledger-"));
    tempDirs.push(ledgerDir);
    const ledgerPath = join(ledgerDir, "signal-aggregates.jsonl");

    const session = CaptureSession.begin("benchmark")!;
    scanRepo(dir, { runContext: "benchmark", capture: session });
    session.recordVerdict("api/auth/login.ts", "confirmed_real");
    appendAggregateRow(ledgerPath, emitAggregateRow(session.tally(), META));

    const lines = readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l !== "");
    expect(lines).toHaveLength(1);
    const serialized = lines[0]!;
    // The explicit per-file test (ruling of 2026-07-09): nothing path-shaped
    // survives the flush — not the scanned paths, not their fragments.
    for (const path of CORPUS_PATHS) {
      expect(serialized).not.toContain(path);
      expect(serialized).not.toContain(path.split("/").pop()!);
    }
    expect(serialized).not.toContain("/");
    validateAggregateRow(JSON.parse(serialized));

    // The join state is destroyed at tally(): the session is single-use and
    // cannot be read, fed, or re-tallied afterwards.
    expect(() => session.tally()).toThrow(/single-use/);
    expect(() => session.recordVerdict("api/webhook.ts", "refuted")).toThrow(/single-use/);
  });
});

describe("cell suppression ladders (k = 5)", () => {
  it("keeps publishable band splits, collapses mixed signals, name-pools rare ones", () => {
    const tally = syntheticTally(
      {
        // every count 0 or ≥ 5 → full band split survives
        "path:auth": { sub: cell(9), mid: cell(5, 5), strong: cell(6, 6) },
        // band cells < 5 but total publishable → collapses to "all"
        "path:delete": { sub: cell(3), mid: cell(4) },
        // total {12, 2, 0} has a count in [1,5) → loses its NAME into the pool
        "path:webhook": { mid: cell(12, 2) },
        // rare signal → pooled
        "kw:sql-destruct": { mid: cell(2) },
      },
      {
        unverified: { "≤0": 22, "1": 8, "2": 5 }, // all ≥ 5 → fine bins survive
        confirmed_real: { "6": 5, "7": 5 }, // fine bins survive
        refuted: { "3": 2, "4": 9 }, // bin 2 < 5 → bands: mid = 11 → survives as band
      },
      { filesScanned: 60, candidatesFound: 20, rescueCount: 2 },
    );
    const row = emitAggregateRow(tally, META);

    expect(row.per_signal).toEqual({
      "path:auth": {
        sub: { fired: 9, confirmed_real: 0, refuted: 0 },
        mid: { fired: 5, confirmed_real: 5, refuted: 0 },
        strong: { fired: 6, confirmed_real: 6, refuted: 0 },
      },
      "path:delete": { all: { fired: 7, confirmed_real: 0, refuted: 0 } },
      other_signals: { all: { fired: 14, confirmed_real: 2, refuted: 0 } },
    });
    expect(row.score_histogram).toEqual({
      unverified: { "≤0": 22, "1": 8, "2": 5 },
      confirmed_real: { "6": 5, "7": 5 },
      refuted: { mid: 11 },
    });
    // Run-level scalars stay exact even below k (design J2).
    expect(row.rescue_count).toBe(2);
  });

  it("uses the row's own context to select k", () => {
    expect(SUPPRESSION_K.benchmark).toBe(5);
    expect(SUPPRESSION_K["self-audit"]).toBe(5);
  });
});

describe("merge across a sweep (suppress-after-sum)", () => {
  it("sums tallies so cells suppressed per-entry can survive the merged row", () => {
    // fired 3 per entry — pooled if emitted alone; across two entries the sum
    // is 6 ≥ k and the signal keeps its name. Suppress-after-sum is why the
    // sweep merges tallies instead of merging rows.
    const a = syntheticTally(
      { "path:auth": { mid: cell(3) } },
      { unverified: { "3": 3 } },
      { filesScanned: 10, candidatesFound: 3, rescueCount: 0 },
    );
    const b = syntheticTally(
      { "path:auth": { mid: cell(3) } },
      { unverified: { "3": 3 } },
      { filesScanned: 8, candidatesFound: 3, rescueCount: 0 },
    );
    const row = emitAggregateRow(mergeTallies([a, b]), META);
    expect(row.files_scanned).toBe(18);
    expect(row.per_signal).toEqual({
      "path:auth": { mid: { fired: 6, confirmed_real: 0, refuted: 0 } },
    });
    expect(row.score_histogram).toEqual({ unverified: { "3": 6 } });
  });

  it("refuses to merge across contexts or thresholds", () => {
    const a = syntheticTally({}, {}, { filesScanned: 1, candidatesFound: 0, rescueCount: 0 });
    const b = { ...syntheticTally({}, {}, { filesScanned: 1, candidatesFound: 0, rescueCount: 0 }), threshold: 4 };
    expect(() => mergeTallies([a, b])).toThrow(/contexts or thresholds/);
    const c = {
      ...syntheticTally({}, {}, { filesScanned: 1, candidatesFound: 0, rescueCount: 0 }),
      runContext: "self-audit" as const,
    };
    expect(() => mergeTallies([a, c])).toThrow(/contexts or thresholds/);
  });
});

describe("verdict registration from a review", () => {
  const finding = (id: string, path: string): Finding => ({
    id,
    seamId: "seam-1",
    description: "d",
    reasoning: "r",
    blastRadius: "high",
    locations: [{ path, startLine: 1, endLine: 2 }],
  });
  const verification = (
    findingId: string,
    status: VerificationResult["status"],
    quotedCode = "const x = 1;",
  ): VerificationResult => ({
    findingId,
    status,
    evidence: [{ quotedCode, location: { path: "p", startLine: 1, endLine: 1 } }],
    note: "n",
  });

  it("maps trust-gated statuses to verdicts; confirmed_real wins over refuted", () => {
    const dir = makeCorpus();
    const session = CaptureSession.begin("benchmark")!;
    scanRepo(dir, { runContext: "benchmark", capture: session });
    registerReviewVerdicts(
      session,
      [
        finding("f1", "api/auth/login.ts"), // verified_real → confirmed_real
        finding("f2", "api/webhook.ts"), // false_positive → refuted
        finding("f3", "api/webhook.ts"), // verified_real, but NO real evidence → ignored
        finding("f4", "notes.ts"), // judgment_call → ignored
      ],
      [
        verification("f1", "verified_real"),
        verification("f2", "false_positive"),
        verification("f3", "verified_real", "   "), // trust gate: whitespace quote
        verification("f4", "judgment_call"),
      ],
    );
    const row = emitAggregateRow(session.tally(), META);
    // login.ts (3 labels) confirmed; webhook.ts (2 labels) refuted — f3's
    // evidence-less verified_real must NOT rescue it; notes.ts stays unverified.
    expect(row.per_signal).toEqual({
      other_signals: { all: { fired: 6, confirmed_real: 3, refuted: 2 } },
    });
    expect(row.score_histogram).toEqual({
      confirmed_real: { all: 1 },
      refuted: { all: 1 },
      unverified: { all: 2 },
    });
  });
});

describe("closed schema (structural anti-injection)", () => {
  function validRow(): AggregateRow {
    return {
      date: "2026-07-09",
      engine_commit: "abc1234",
      run_context: "benchmark",
      threshold: 3,
      suppression_k: 5,
      files_scanned: 60,
      candidates_found: 20,
      rescue_count: 2,
      per_signal: {
        "path:auth": { mid: { fired: 5, confirmed_real: 5, refuted: 0 } },
        other_signals: { all: { fired: 3, confirmed_real: 0, refuted: 0 } },
      },
      score_histogram: { unverified: { "≤0": 22, "1": 8 } },
    };
  }

  it("accepts the valid row", () => {
    expect(() => validateAggregateRow(validRow())).not.toThrow();
  });

  it("rejects unknown fields at every depth (no field can smuggle content)", () => {
    expect(() => validateAggregateRow({ ...validRow(), notes: "free text" })).toThrow(/unknown field/);
    const pathKey = validRow();
    pathKey.per_signal["src/billing/charge.ts"] = { mid: { fired: 5, confirmed_real: 0, refuted: 0 } };
    expect(() => validateAggregateRow(pathKey)).toThrow(/not an engine signal label/);
    const weirdBand = validRow();
    weirdBand.per_signal["path:auth"] = { "src/x.ts": { fired: 5, confirmed_real: 0, refuted: 0 } };
    expect(() => validateAggregateRow(weirdBand)).toThrow(/band vocabulary/);
    const extraCellField = validRow();
    (extraCellField.per_signal["path:auth"]!.mid as unknown as Record<string, unknown>).snippet = "x";
    expect(() => validateAggregateRow(extraCellField)).toThrow(/exactly fired\/confirmed_real\/refuted/);
    const badOutcome = validRow();
    badOutcome.score_histogram["comment"] = { all: 5 };
    expect(() => validateAggregateRow(badOutcome)).toThrow(/not an outcome/);
  });

  it("rejects non-numeric values and malformed metadata", () => {
    const strCount = validRow();
    (strCount.per_signal["path:auth"]!.mid as unknown as Record<string, unknown>).fired = "5";
    expect(() => validateAggregateRow(strCount)).toThrow(/non-negative integer/);
    expect(() => validateAggregateRow({ ...validRow(), date: "July 9, 2026" })).toThrow(/YYYY-MM-DD/);
    expect(() => validateAggregateRow({ ...validRow(), engine_commit: "not-a-hash!" })).toThrow(/hex/);
  });

  it("rejects rows claiming a non-permitted context", () => {
    expect(() => validateAggregateRow({ ...validRow(), run_context: "user" })).toThrow(
      /not a capture-permitted context/,
    );
    expect(() => validateAggregateRow({ ...validRow(), run_context: "gift-run" })).toThrow(
      /not a capture-permitted context/,
    );
  });

  it("enforces the row's own suppression_k on named grains (belt and braces)", () => {
    const leaky = validRow();
    leaky.per_signal["kw:sql-destruct"] = { mid: { fired: 1, confirmed_real: 0, refuted: 0 } };
    expect(() => validateAggregateRow(leaky)).toThrow(/violates suppression_k/);
    const leakyBin = validRow();
    leakyBin.score_histogram["refuted"] = { "3": 2 };
    expect(() => validateAggregateRow(leakyBin)).toThrow(/violates suppression_k/);
    // The anonymous pool and collapsed totals are the designed exceptions.
    const pooled = validRow();
    pooled.per_signal["other_signals"] = { all: { fired: 2, confirmed_real: 1, refuted: 0 } };
    expect(() => validateAggregateRow(pooled)).not.toThrow();
    const collapsed = validRow();
    collapsed.score_histogram["refuted"] = { all: 2 };
    expect(() => validateAggregateRow(collapsed)).not.toThrow();
  });

  it("rejects verdict counts exceeding fired, and impossible scalar relations", () => {
    const impossible = validRow();
    impossible.per_signal["path:auth"] = { mid: { fired: 5, confirmed_real: 5, refuted: 5 } };
    expect(() => validateAggregateRow(impossible)).toThrow(/exceed fired/);
    expect(() => validateAggregateRow({ ...validRow(), candidates_found: 100 })).toThrow(
      /exceeds files_scanned/,
    );
  });

  it("pins the ledger location constant", () => {
    expect(AGGREGATE_LEDGER_RELPATH).toBe("benchmark/results/signal-aggregates.jsonl");
  });
});
