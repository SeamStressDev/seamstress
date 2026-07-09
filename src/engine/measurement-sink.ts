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
 * Measurement sink — charter build slice 1b (charter rows A1/A2).
 *
 * Captures the heuristic's per-signal behavior as STRATIFIED AGGREGATES:
 * counts bucketed by signal × score band × verified-real outcome, plus a
 * per-outcome score histogram over ALL scanned files. One append-only JSONL
 * row per capture-permitted run. Capture only: nothing here reads back into
 * detection, scoring, or the trust gate.
 *
 * Design of record: seam-scaffold/.seamstress-slice-1b-capture-design.md
 * (rev 2 post-adjudication) plus the in-session rulings of 2026-07-09:
 * repo-category stratification DROPPED for v1 (no identity, no classifier);
 * suppression k uniform and conservatively high — the sink is "accumulating,
 * not yet queryable" until corpus volume justifies lowering it.
 *
 * The privacy mechanism, in order of operation:
 *  1. GATE — a session exists only for allowlisted contexts (the 1a
 *     predicate), and scanRepo independently re-checks the predicate at the
 *     feed site.
 *  2. EPHEMERAL JOIN — per-file records (path → score/hits) live ONLY in this
 *     process's memory, solely so late-arriving verdicts can join back to
 *     files. They are destroyed at tally(); no per-file record is ever
 *     serialized, and a consumed session cannot be read again.
 *  3. SUPPRESSION — any stratified count in [1, k) is never emitted at that
 *     grain. Signal cells collapse band-split → signal total → the anonymous
 *     "other_signals" pool (which withholds the signal's NAME, not just its
 *     split — the existence-assertion is what k-anonymity removes). Histogram
 *     cells collapse fine bin → coarse band → outcome total. Run-level
 *     scalars stay exact (design judgment call J2: unlocated cardinalities).
 *  4. CLOSED SCHEMA — every emitted key and value is validated against
 *     build-time-closed vocabularies before append. There is no free-text
 *     field, no path field, no field whose type can carry a string sourced
 *     from scanned content; the validator throws on any unknown key. This is
 *     the structural anti-injection guarantee: the data type cannot encode
 *     an injection surface, for any future consumer.
 */

import { appendFileSync } from "node:fs";
import { effectiveStatus } from "../types/index.js";
import type { Finding, VerificationResult } from "../types/index.js";
import { SIGNAL_LABELS } from "./heuristic.js";
import type { Candidate, ScanCapture } from "./heuristic.js";
import { isCapturePermitted, resolveRunContext } from "./run-context.js";
import type { RunContext } from "./run-context.js";

/** The contexts that can ever produce a row — the 1a allowlist, as a type. */
export type CaptureContext = "benchmark" | "self-audit";

/** Score bands. Closed vocabulary; "all" is the collapsed (suppressed) grain. */
export type ScoreBand = "sub" | "mid" | "strong";
const BANDS: readonly ScoreBand[] = ["sub", "mid", "strong"];

/**
 * Band edges are SCHEMA constants owned by the 1b design, not engine
 * constants: anchored to DEFAULT_CANDIDATE_THRESHOLD (3) and the measured
 * 0/13-noise-at-6+ line. (The charter A2 row's "STRONG_BAND_MIN" names no
 * engine code — see the design doc's corrections section.)
 */
const BAND_MID_MIN = 3;
const BAND_STRONG_MIN = 6;

/** Fine histogram bins. Closed set; scores go negative via UI/non-runtime penalties. */
const BINS: readonly string[] = ["≤0", "1", "2", "3", "4", "5", "6", "7", "8", "9+"];

/** Verified-real outcomes. Benchmark rows: ground-truth verdicts (pipeline-
 *  independent). Self-audit rows: the pipeline's own verification gate, which
 *  is NOT independent confirmation — the ledger README carries that caveat. */
export type VerdictOutcome = "confirmed_real" | "refuted" | "unverified";
const OUTCOMES: readonly VerdictOutcome[] = ["confirmed_real", "refuted", "unverified"];

/**
 * Minimum cell count k, selected by run context. RULING IN FORCE (2026-07-09):
 * both values sit at the conservative uniform 5 — most cells suppress at
 * current corpus size, deliberately; the sink accumulates with the correct
 * stratified shape from birth and becomes queryable only when volume justifies
 * lowering a value here. Lowering is a recorded decision (design-doc
 * annotation), never a silent edit. Kept per-context so a future per-context
 * ruling (design J1) is a one-line change with no schema retrofit.
 */
export const SUPPRESSION_K: Readonly<Record<CaptureContext, number>> = {
  benchmark: 5,
  "self-audit": 5,
};

/** Single sink for both contexts (one schema, one retention policy), relative
 *  to the ENGINE repo root. Gitignored until a commit ruling says otherwise. */
export const AGGREGATE_LEDGER_RELPATH = "benchmark/results/signal-aggregates.jsonl";

/** One stratified cell: firings of one signal in one band, split by outcome. */
export interface SignalCell {
  fired: number;
  confirmed_real: number;
  refuted: number;
}

const zeroCell = (): SignalCell => ({ fired: 0, confirmed_real: 0, refuted: 0 });

function bandOf(score: number): ScoreBand {
  if (score >= BAND_STRONG_MIN) return "strong";
  if (score >= BAND_MID_MIN) return "mid";
  return "sub";
}

function binOf(score: number): string {
  if (score <= 0) return "≤0";
  if (score >= 9) return "9+";
  return String(score);
}

/**
 * A path-free aggregate: what survives a session after tally(). Mergeable
 * across scan units (the benchmark sweep merges one tally per entry into one
 * row) BEFORE suppression — suppress-after-sum, never sum-after-suppress.
 */
export interface AggregateTally {
  runContext: CaptureContext;
  threshold: number;
  filesScanned: number;
  candidatesFound: number;
  rescueCount: number;
  /** signal label → band → cell. */
  perSignal: Map<string, Map<ScoreBand, SignalCell>>;
  /** outcome → fine bin → count, over ALL scanned files. */
  histogram: Map<VerdictOutcome, Map<string, number>>;
}

/**
 * An in-memory capture session for ONE scan unit (one repo/fixture scan).
 * Holds the per-file join state that lets verdicts arriving later in the run
 * attach to scanned files; tally() converts it to a path-free aggregate and
 * destroys the join state. A session is single-use.
 */
export class CaptureSession implements ScanCapture {
  readonly runContext: CaptureContext;
  private threshold: number | null = null;
  private files = new Map<string, { score: number; hits: string[]; viaSafetyNet: boolean }>();
  private verdicts = new Map<string, "confirmed_real" | "refuted">();
  private consumed = false;

  private constructor(runContext: CaptureContext) {
    this.runContext = runContext;
  }

  /**
   * The ONLY way to obtain a session: null for every context outside the 1a
   * allowlist, including unspecified. First half of the double gate (scanRepo
   * re-checks the predicate at the feed site).
   */
  static begin(context: RunContext | undefined): CaptureSession | null {
    if (!isCapturePermitted(context)) return null;
    return new CaptureSession(resolveRunContext(context) as CaptureContext);
  }

  private assertLive(op: string): void {
    if (this.consumed) {
      throw new Error(`CaptureSession.${op} after tally(): sessions are single-use`);
    }
  }

  noteThreshold(threshold: number): void {
    this.assertLive("noteThreshold");
    this.threshold = threshold;
  }

  recordFile(candidate: Candidate): void {
    this.assertLive("recordFile");
    this.files.set(candidate.path, {
      score: candidate.score,
      hits: [...candidate.hits],
      viaSafetyNet: candidate.viaSafetyNet,
    });
  }

  /**
   * Attach a verdict to a scanned file. confirmed_real wins over refuted for
   * the same path (a file with one real finding and one refuted finding IS a
   * real seam site); verdicts for paths this session never scanned are
   * ignored (nothing to attribute them to).
   */
  recordVerdict(path: string, verdict: "confirmed_real" | "refuted"): void {
    this.assertLive("recordVerdict");
    if (this.verdicts.get(path) === "confirmed_real") return;
    this.verdicts.set(path, verdict);
  }

  /**
   * Aggregate and DESTROY: returns the path-free tally and clears the
   * per-file join state. After this call the session holds nothing and every
   * further use throws — the ephemeral join cannot outlive its purpose.
   */
  tally(): AggregateTally {
    this.assertLive("tally");
    if (this.threshold === null) {
      throw new Error(
        "CaptureSession.tally() before any scan fed this session — " +
          "either the scan never ran or its context was not capture-permitted",
      );
    }
    this.consumed = true;

    const perSignal = new Map<string, Map<ScoreBand, SignalCell>>();
    const histogram = new Map<VerdictOutcome, Map<string, number>>();
    let candidatesFound = 0;
    let rescueCount = 0;

    for (const [path, rec] of this.files) {
      const outcome: VerdictOutcome = this.verdicts.get(path) ?? "unverified";
      const band = bandOf(rec.score);
      const bin = binOf(rec.score);

      const bins = histogram.get(outcome) ?? new Map<string, number>();
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
      histogram.set(outcome, bins);

      if (rec.score >= this.threshold) {
        candidatesFound += 1;
        if (rec.viaSafetyNet) rescueCount += 1;
      }

      for (const label of new Set(rec.hits)) {
        const byBand = perSignal.get(label) ?? new Map<ScoreBand, SignalCell>();
        const cell = byBand.get(band) ?? zeroCell();
        cell.fired += 1;
        if (outcome === "confirmed_real") cell.confirmed_real += 1;
        else if (outcome === "refuted") cell.refuted += 1;
        byBand.set(band, cell);
        perSignal.set(label, byBand);
      }
    }

    const tally: AggregateTally = {
      runContext: this.runContext,
      threshold: this.threshold,
      filesScanned: this.files.size,
      candidatesFound,
      rescueCount,
      perSignal,
      histogram,
    };

    // Destroy the ephemeral join state: per-file records must not outlive the
    // aggregation they existed to enable.
    this.files.clear();
    this.verdicts.clear();
    return tally;
  }
}

/**
 * Register a completed review's verdicts on a session, via the trust-gated
 * {@link effectiveStatus} authority (an evidence-less verified_real counts as
 * unverified here exactly as it does everywhere else). verified_real →
 * confirmed_real; false_positive → refuted; unverified / judgment_call →
 * nothing. NOTE: these are the pipeline's OWN verdicts — the charter's
 * self-validation caveat applies; benchmark rows use ground-truth verdicts
 * instead (see benchmark/scoring/capture-aggregates.ts).
 */
export function registerReviewVerdicts(
  session: CaptureSession,
  findings: readonly Finding[],
  verifications: readonly VerificationResult[],
): void {
  for (const finding of findings) {
    const status = effectiveStatus(finding, verifications);
    const verdict =
      status === "verified_real" ? "confirmed_real" : status === "false_positive" ? "refuted" : null;
    if (verdict === null) continue;
    for (const location of finding.locations ?? []) {
      session.recordVerdict(location.path, verdict);
    }
  }
}

/** Merge tallies from one sweep (suppress-after-sum). Contexts and thresholds must match. */
export function mergeTallies(tallies: readonly AggregateTally[]): AggregateTally {
  if (tallies.length === 0) throw new Error("mergeTallies: nothing to merge");
  const [first, ...rest] = tallies as [AggregateTally, ...AggregateTally[]];
  const merged: AggregateTally = {
    runContext: first.runContext,
    threshold: first.threshold,
    filesScanned: first.filesScanned,
    candidatesFound: first.candidatesFound,
    rescueCount: first.rescueCount,
    perSignal: new Map([...first.perSignal].map(([l, b]) => [l, new Map([...b].map(([k, c]) => [k, { ...c }]))])),
    histogram: new Map([...first.histogram].map(([o, b]) => [o, new Map(b)])),
  };
  for (const t of rest) {
    if (t.runContext !== merged.runContext || t.threshold !== merged.threshold) {
      throw new Error("mergeTallies: refusing to merge across contexts or thresholds");
    }
    merged.filesScanned += t.filesScanned;
    merged.candidatesFound += t.candidatesFound;
    merged.rescueCount += t.rescueCount;
    for (const [label, byBand] of t.perSignal) {
      const target = merged.perSignal.get(label) ?? new Map<ScoreBand, SignalCell>();
      for (const [band, cell] of byBand) {
        const acc = target.get(band) ?? zeroCell();
        acc.fired += cell.fired;
        acc.confirmed_real += cell.confirmed_real;
        acc.refuted += cell.refuted;
        target.set(band, acc);
      }
      merged.perSignal.set(label, target);
    }
    for (const [outcome, bins] of t.histogram) {
      const target = merged.histogram.get(outcome) ?? new Map<string, number>();
      for (const [bin, n] of bins) target.set(bin, (target.get(bin) ?? 0) + n);
      merged.histogram.set(outcome, target);
    }
  }
  return merged;
}

/** The emitted row — the ONLY shape that ever reaches disk. All values are
 *  numbers except three pattern/enum-checked metadata strings; all map keys
 *  come from build-time-closed vocabularies. */
export interface AggregateRow {
  date: string;
  engine_commit: string;
  run_context: CaptureContext;
  threshold: number;
  suppression_k: number;
  files_scanned: number;
  candidates_found: number;
  rescue_count: number;
  /** label or "other_signals" → band or "all" → cell. */
  per_signal: Record<string, Record<string, SignalCell>>;
  /** outcome → fine bin, coarse band, or "all" → count (zeros omitted). */
  score_histogram: Record<string, Record<string, number>>;
}

/** n is emittable at a named grain iff it asserts nothing rare: 0 or ≥ k. */
const publishable = (n: number, k: number): boolean => n === 0 || n >= k;
const cellPublishable = (c: SignalCell, k: number): boolean =>
  publishable(c.fired, k) && publishable(c.confirmed_real, k) && publishable(c.refuted, k);

/**
 * Apply cell suppression and emit the row. The ladders (design F2+F3):
 *  - per-signal: band split → signal total ("all") → anonymous
 *    "other_signals" pool. A signal below k loses its NAME.
 *  - histogram: fine bins → coarse bands → outcome total ("all"). The outcome
 *    total is the terminal grain (a run-level cardinality, J2 class).
 * The row is validated against the closed schema before being returned.
 */
export function emitAggregateRow(
  tally: AggregateTally,
  meta: { date: string; engineCommit: string },
): AggregateRow {
  const k = SUPPRESSION_K[tally.runContext];

  const perSignal: Record<string, Record<string, SignalCell>> = {};
  const pool = zeroCell();
  let pooledAnything = false;
  for (const label of [...tally.perSignal.keys()].sort()) {
    const byBand = tally.perSignal.get(label)!;
    const cells = BANDS.map((b) => [b, byBand.get(b) ?? zeroCell()] as const).filter(
      ([, c]) => c.fired > 0,
    );
    const total = cells.reduce((acc, [, c]) => {
      acc.fired += c.fired;
      acc.confirmed_real += c.confirmed_real;
      acc.refuted += c.refuted;
      return acc;
    }, zeroCell());
    if (total.fired === 0) continue;
    if (cells.every(([, c]) => cellPublishable(c, k))) {
      perSignal[label] = Object.fromEntries(cells.map(([b, c]) => [b, c]));
    } else if (cellPublishable(total, k)) {
      perSignal[label] = { all: total };
    } else {
      pool.fired += total.fired;
      pool.confirmed_real += total.confirmed_real;
      pool.refuted += total.refuted;
      pooledAnything = true;
    }
  }
  if (pooledAnything) perSignal["other_signals"] = { all: pool };

  const histogram: Record<string, Record<string, number>> = {};
  for (const outcome of OUTCOMES) {
    const bins = tally.histogram.get(outcome);
    if (!bins || bins.size === 0) continue;
    const fine = BINS.map((b) => [b, bins.get(b) ?? 0] as const).filter(([, n]) => n > 0);
    const total = fine.reduce((n, [, v]) => n + v, 0);
    if (total === 0) continue;
    if (fine.every(([, n]) => publishable(n, k))) {
      histogram[outcome] = Object.fromEntries(fine);
      continue;
    }
    const byBand = new Map<ScoreBand, number>();
    for (const [bin, n] of fine) {
      const score = bin === "≤0" ? 0 : bin === "9+" ? 9 : Number(bin);
      const band = bandOf(score);
      byBand.set(band, (byBand.get(band) ?? 0) + n);
    }
    const bands = [...byBand.entries()].filter(([, n]) => n > 0);
    histogram[outcome] = bands.every(([, n]) => publishable(n, k))
      ? Object.fromEntries(bands)
      : { all: total };
  }

  const row: AggregateRow = {
    date: meta.date,
    engine_commit: meta.engineCommit,
    run_context: tally.runContext,
    threshold: tally.threshold,
    suppression_k: k,
    files_scanned: tally.filesScanned,
    candidates_found: tally.candidatesFound,
    rescue_count: tally.rescueCount,
    per_signal: perSignal,
    score_histogram: histogram,
  };
  validateAggregateRow(row);
  return row;
}

const ROW_KEYS = [
  "date",
  "engine_commit",
  "run_context",
  "threshold",
  "suppression_k",
  "files_scanned",
  "candidates_found",
  "rescue_count",
  "per_signal",
  "score_histogram",
] as const;

const isNonNegInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

function fail(reason: string): never {
  throw new Error(`aggregate row rejected (closed schema): ${reason}`);
}

/**
 * The write-time closed-schema gate. Throws on ANY deviation: unknown keys at
 * any depth, keys outside the closed vocabularies (signal labels from the
 * engine's compiled tables, bands, bins, outcomes), non-numeric values, and
 * — belt and braces — named-grain counts that violate the row's own
 * suppression_k. The only string values a valid row can carry are the three
 * pattern/enum-checked metadata fields; no field can hold a path or free
 * text, which is the structural anti-injection guarantee.
 */
export function validateAggregateRow(row: unknown): asserts row is AggregateRow {
  if (typeof row !== "object" || row === null || Array.isArray(row)) fail("not an object");
  const r = row as Record<string, unknown>;
  const keys = Object.keys(r);
  for (const key of keys) if (!(ROW_KEYS as readonly string[]).includes(key)) fail(`unknown field "${key}"`);
  for (const key of ROW_KEYS) if (!(key in r)) fail(`missing field "${key}"`);

  if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) fail("date must be YYYY-MM-DD");
  if (typeof r.engine_commit !== "string" || !/^[0-9a-f]{7,40}$/.test(r.engine_commit)) {
    fail("engine_commit must be a 7-40 char lowercase hex hash");
  }
  if (r.run_context !== "benchmark" && r.run_context !== "self-audit") {
    fail(`run_context "${String(r.run_context)}" is not a capture-permitted context`);
  }
  if (!isNonNegInt(r.threshold)) fail("threshold must be a non-negative integer");
  if (!isNonNegInt(r.suppression_k) || r.suppression_k < 1) fail("suppression_k must be a positive integer");
  if (!isNonNegInt(r.files_scanned)) fail("files_scanned must be a non-negative integer");
  if (!isNonNegInt(r.candidates_found)) fail("candidates_found must be a non-negative integer");
  if (!isNonNegInt(r.rescue_count)) fail("rescue_count must be a non-negative integer");
  if ((r.candidates_found as number) > (r.files_scanned as number)) fail("candidates_found exceeds files_scanned");
  if ((r.rescue_count as number) > (r.candidates_found as number)) fail("rescue_count exceeds candidates_found");
  const k = r.suppression_k as number;

  if (typeof r.per_signal !== "object" || r.per_signal === null || Array.isArray(r.per_signal)) {
    fail("per_signal must be an object");
  }
  for (const [label, byBand] of Object.entries(r.per_signal as Record<string, unknown>)) {
    const named = label !== "other_signals";
    if (named && !SIGNAL_LABELS.has(label)) fail(`per_signal key "${label}" is not an engine signal label`);
    if (typeof byBand !== "object" || byBand === null || Array.isArray(byBand)) {
      fail(`per_signal["${label}"] must be an object`);
    }
    const bandKeys = Object.keys(byBand as object);
    if (bandKeys.length === 0) fail(`per_signal["${label}"] is empty`);
    const collapsed = bandKeys.includes("all");
    if (collapsed && bandKeys.length !== 1) fail(`per_signal["${label}"] mixes "all" with band keys`);
    if (!collapsed && !bandKeys.every((b) => (BANDS as readonly string[]).includes(b))) {
      fail(`per_signal["${label}"] has a key outside the band vocabulary`);
    }
    if (!named && !collapsed) fail(`other_signals must be collapsed to "all"`);
    for (const [band, cell] of Object.entries(byBand as Record<string, unknown>)) {
      if (typeof cell !== "object" || cell === null || Array.isArray(cell)) {
        fail(`per_signal["${label}"]["${band}"] must be a cell object`);
      }
      const cellKeys = Object.keys(cell as object).sort();
      if (cellKeys.join(",") !== "confirmed_real,fired,refuted") {
        fail(`per_signal["${label}"]["${band}"] must have exactly fired/confirmed_real/refuted`);
      }
      const c = cell as Record<string, unknown>;
      for (const field of ["fired", "confirmed_real", "refuted"]) {
        const v = c[field];
        if (!isNonNegInt(v)) fail(`per_signal["${label}"]["${band}"].${field} must be a non-negative integer`);
        // k-anonymity, enforced at write time too: a NAMED grain never carries
        // a count in [1, k). The anonymous pool is the designed exception.
        if (named && !publishable(v, k)) {
          fail(`per_signal["${label}"]["${band}"].${field}=${v} violates suppression_k=${k}`);
        }
      }
      const cc = c as unknown as SignalCell;
      if (cc.confirmed_real + cc.refuted > cc.fired) {
        fail(`per_signal["${label}"]["${band}"] verdict counts exceed fired`);
      }
    }
  }

  if (typeof r.score_histogram !== "object" || r.score_histogram === null || Array.isArray(r.score_histogram)) {
    fail("score_histogram must be an object");
  }
  for (const [outcome, binsRaw] of Object.entries(r.score_histogram as Record<string, unknown>)) {
    if (!(OUTCOMES as readonly string[]).includes(outcome)) {
      fail(`score_histogram key "${outcome}" is not an outcome`);
    }
    if (typeof binsRaw !== "object" || binsRaw === null || Array.isArray(binsRaw)) {
      fail(`score_histogram["${outcome}"] must be an object`);
    }
    const binKeys = Object.keys(binsRaw as object);
    if (binKeys.length === 0) fail(`score_histogram["${outcome}"] is empty`);
    const allFine = binKeys.every((b) => BINS.includes(b));
    const allBands = binKeys.every((b) => (BANDS as readonly string[]).includes(b));
    const collapsed = binKeys.length === 1 && binKeys[0] === "all";
    if (!allFine && !allBands && !collapsed) {
      fail(`score_histogram["${outcome}"] keys must be all fine bins, all bands, or exactly "all"`);
    }
    for (const [bin, n] of Object.entries(binsRaw as Record<string, unknown>)) {
      if (!isNonNegInt(n) || n === 0) fail(`score_histogram["${outcome}"]["${bin}"] must be a positive integer`);
      if (!collapsed && !publishable(n, k)) {
        fail(`score_histogram["${outcome}"]["${bin}"]=${n} violates suppression_k=${k}`);
      }
    }
  }
}

/**
 * Validate and append one row to the sink. The write is a single JSON line;
 * the ledger is append-only by convention and by construction (this is the
 * only writer, and it only appends).
 */
export function appendAggregateRow(ledgerPath: string, row: AggregateRow): void {
  validateAggregateRow(row);
  appendFileSync(ledgerPath, JSON.stringify(row) + "\n");
}
