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
 * Measurement capture — benchmark producer (charter slice 1b). Deterministic,
 * LLM-free, $0, and READ-ONLY over all scoring evidence: entries, ground
 * truths, projections, and the per-entry results ledgers are consumed, never
 * written. The ONLY write this tool performs is a single-row append to the
 * aggregate sink (benchmark/results/signal-aggregates.jsonl).
 *
 * Why capture happens HERE and not during the live benchmark run: benchmark
 * projections come from review-only runs that never invoke the heuristic, and
 * ground-truth verdicts exist only at scoring time. `scoreSource` is a pure
 * function of (path, content, engine version), so the per-file scoring
 * structure is reconstructed for free by re-scanning the fixture in THIS
 * process, where the ground-truth verdicts also live — the verdict/file join
 * happens entirely in memory and per-file records never touch disk
 * (reconstruction replaces retention; design doc, "Why B fully serves A1/A2").
 *
 * Verdict semantics (pipeline-INDEPENDENT, the kind charter A1 graduates on):
 * a fixture file is confirmed_real when it is a location of a finding that hit
 * a must_find item; refuted when it is a location of a finding that matched a
 * must_not_claim item; unverified otherwise. Entries whose representative run
 * cannot be scored (STALE / artifact-missing / no-rows) are EXCLUDED and named
 * on stderr — no verdict evidence means no capture, never a guessed row.
 *
 * One benchmark sweep emits ONE row merged across scored entries (ruling of
 * 2026-07-09: no entry_id, no repo-category dimension in v1).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGGREGATE_LEDGER_RELPATH,
  CaptureSession,
  appendAggregateRow,
  emitAggregateRow,
  mergeTallies,
  scanRepo,
} from "../../src/engine/index.js";
import type { AggregateTally } from "../../src/engine/index.js";
import type { Finding } from "../../src/types/index.js";
import { assertNotBait, buildReport, gitDeps } from "./run-all.js";
import { scoreEntry } from "./score.js";
import type { FindingsProjection, GroundTruth } from "./score.js";

/** Capture one scored entry: re-scan its fixture, join ground-truth verdicts. */
function captureEntry(
  entriesDir: string,
  runsDir: string,
  id: string,
  selected: { date: string; mode: string },
): AggregateTally {
  const entryDir = assertNotBait(join(entriesDir, id));

  const session = CaptureSession.begin("benchmark");
  if (session === null) throw new Error("unreachable: benchmark is capture-permitted");
  scanRepo(join(entryDir, "fixture"), { runContext: "benchmark", capture: session });

  const projection = JSON.parse(
    readFileSync(
      assertNotBait(join(runsDir, id, `${selected.date}-${selected.mode}.projection.json`)),
      "utf8",
    ),
  ) as FindingsProjection;
  const groundTruth = JSON.parse(
    readFileSync(assertNotBait(join(entryDir, "ground_truth.json")), "utf8"),
  ) as GroundTruth;

  const score = scoreEntry(id, projection, groundTruth);
  const findingById = new Map<string, Finding>(projection.findings.map((f) => [f.id, f]));
  for (const hit of score.hits) {
    for (const findingId of hit.findingIds) {
      for (const location of findingById.get(findingId)?.locations ?? []) {
        session.recordVerdict(location.path, "confirmed_real");
      }
    }
  }
  for (const fp of score.falsePositives) {
    for (const location of findingById.get(fp.findingId)?.locations ?? []) {
      session.recordVerdict(location.path, "refuted");
    }
  }

  return session.tally();
}

function main(argv: string[]): number {
  const repoRoot = argv[0] ?? process.cwd();
  const deps = gitDeps(repoRoot);

  // Reuse run-all's representative-run selection verbatim (read-only, pure
  // over deps + disk) rather than re-deriving it and drifting.
  const report = buildReport(deps);
  const scored = report.rows.filter(
    (r): r is typeof r & { selected: NonNullable<(typeof r)["selected"]> } =>
      r.status === "scored" && r.selected !== undefined,
  );
  const excluded = report.rows.filter((r) => r.status !== "scored");
  if (excluded.length > 0) {
    console.error(
      `excluded from capture (no scoreable verdict evidence): ${excluded
        .map((r) => `${r.id}[${r.status}]`)
        .join(", ")}`,
    );
  }
  if (scored.length === 0) {
    console.error("no scored entries — nothing to capture");
    return 1;
  }

  const tallies = scored.map((r) => captureEntry(deps.entriesDir, deps.runsDir, r.id, r.selected));
  const merged = mergeTallies(tallies);

  const engineCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const row = emitAggregateRow(merged, {
    date: new Date().toISOString().slice(0, 10),
    engineCommit,
  });
  appendAggregateRow(join(repoRoot, AGGREGATE_LEDGER_RELPATH), row);

  console.log(
    `aggregate row appended to ${AGGREGATE_LEDGER_RELPATH} — ` +
      `${scored.length} entries merged, context=benchmark, k=${row.suppression_k}`,
  );
  console.log(JSON.stringify(row, null, 2));
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
