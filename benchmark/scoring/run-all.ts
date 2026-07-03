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
 * Seam-Bug Benchmark — run-all aggregation harness (score-only, deterministic).
 *
 * Consumes ALREADY-PERSISTED projection artifacts and the append-only results
 * ledgers; emits a per-entry table plus an aggregate line. No pipeline runs,
 * no API calls, no network, no clock in the report BODY (the header timestamp
 * sits outside the reproducible body). Same artifacts -> byte-identical body.
 *
 * Two axes, never fused (the rung-3 validity/results split):
 *  - entry `validity` (validated/proposed) is a property of the ENTRY,
 *    human-attested; it appears ONLY as a per-entry column.
 *  - run `outcome` (found / found-unverified / blocked-fp / partial / missed)
 *    is a property of the RUN, derived here by re-scoring the persisted
 *    projection with the real scorer; ONLY outcomes are aggregated.
 *
 * Representative-run selection, deterministic total order:
 *  1. keep ledger rows whose ground_truth_commit resolves to the SAME BLOB
 *     CONTENT as HEAD's ground_truth.json (commit hashes differ freely across
 *     unrelated commits — content equality is what "current ground truth"
 *     means; commit-hash equality would false-STALE every current row);
 *  2. among those, take the LAST in JSONL append order (append-only file, so
 *     last-appended = most recent; dates are not unique and never tiebreak);
 *  3. none -> STALE, reported with BOTH commits (row's ground_truth_commit vs
 *     the last commit touching ground_truth.json) for human judgment. STALE is
 *     a flag, never a fail, and is excluded from the scored aggregate's
 *     numerator AND denominator.
 *
 * Bait fixtures are elicitation instruments, not entries: any path under
 * benchmark/bait/ reaching the scoring path THROWS — a silent skip could mask
 * a future refactor pointing the harness at bait.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { FindingsProjection, GroundTruth } from "./score.js";
import { scoreEntry } from "./score.js";

/** One parsed ledger row (results/<id>.jsonl). */
export interface LedgerRow {
  date: string;
  engine_commit: string;
  ground_truth_commit: string;
  mode: string;
  outcome: string;
  scorer_summary: string;
  cost_usd: number;
}

/** Injectable dependencies so tests run on synthetic fixtures without git. */
export interface RunAllDeps {
  /** Directory containing entry subdirectories (id/entry.json, ground_truth.json). */
  entriesDir: string;
  /** Directory containing <id>.jsonl ledgers. */
  resultsDir: string;
  /** Directory containing <id>/<date>-<mode>.projection.json artifacts. */
  runsDir: string;
  /** Blob id of a file at a commitish, or null if unresolvable. */
  blobAt(commitish: string, repoRelPath: string): string | null;
  /** Short hash of the last commit touching a path, or null if none. */
  lastCommitTouching(repoRelPath: string): string | null;
}

/** Real-git deps rooted at the repository the harness runs from. */
export function gitDeps(repoRoot: string): RunAllDeps {
  const git = (args: string[]): string | null => {
    try {
      return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim() || null;
    } catch {
      return null;
    }
  };
  return {
    entriesDir: join(repoRoot, "benchmark", "entries"),
    resultsDir: join(repoRoot, "benchmark", "results"),
    runsDir: join(repoRoot, "benchmark", "results", "runs"),
    blobAt: (commitish, p) => git(["rev-parse", `${commitish}:${p}`]),
    lastCommitTouching: (p) => git(["log", "-1", "--format=%h", "--", p]),
  };
}

/** THROW if a bait path ever reaches the scoring path (loud, never a skip). */
export function assertNotBait(path: string): string {
  if (resolve(path).split(sep).includes("bait")) {
    throw new Error(`bait fixture handed to the scoring path: ${path}`);
  }
  return path;
}

export type RowStatus = "scored" | "stale" | "artifact-missing" | "no-rows";

export interface EntryReportRow {
  id: string;
  kind: string;
  /** Entry-level, human-attested. NEVER aggregated — column only. */
  validity: string;
  status: RowStatus;
  /** Set when status === "scored". */
  selected?: { date: string; mode: string; appendIndex: number };
  outcome?: string;
  hitStatuses?: string[];
  /** Re-scored summary differs from the row's recorded scorer_summary. */
  drift?: boolean;
  /** False positives in the re-score (also reflected in outcome=blocked-fp). */
  fpCount?: number;
  /** Set when status === "stale": both sides shown for human judgment. */
  stale?: { rowGtCommits: string[]; currentGtCommit: string };
  /** Set when status === "artifact-missing". */
  missingArtifact?: string;
}

export interface RunAllReport {
  rows: EntryReportRow[];
  /** Reproducible: no clock, no randomness. */
  body: string;
}

/** Derive the run outcome from a fresh scoring. Outcome vocabulary is disjoint
 *  from entry-validity vocabulary by construction (no "validated" token). */
function deriveOutcome(score: ReturnType<typeof scoreEntry>): {
  outcome: string;
  hitStatuses: string[];
} {
  const hitStatuses = score.hits.flatMap((h) => h.statuses);
  if (score.falsePositives.length > 0) return { outcome: "blocked-fp", hitStatuses };
  if (score.misses.length === 0) {
    const allVerified = hitStatuses.every((s) => s === "verified_real");
    return { outcome: allVerified ? "found" : "found-unverified", hitStatuses };
  }
  return { outcome: score.hits.length > 0 ? "partial" : "missed", hitStatuses };
}

function scoreOneEntry(deps: RunAllDeps, id: string): EntryReportRow {
  const entryDir = assertNotBait(join(deps.entriesDir, id));
  const entry = JSON.parse(readFileSync(join(entryDir, "entry.json"), "utf8")) as {
    seam_kind: string;
    validity: string;
  };
  const base: Pick<EntryReportRow, "id" | "kind" | "validity"> = {
    id,
    kind: entry.seam_kind,
    validity: entry.validity,
  };

  const ledgerPath = join(deps.resultsDir, `${id}.jsonl`);
  if (!existsSync(ledgerPath)) return { ...base, status: "no-rows" };
  const rows = readFileSync(ledgerPath, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as LedgerRow);
  if (rows.length === 0) return { ...base, status: "no-rows" };

  // Current ground truth = HEAD's blob CONTENT for this entry's ground_truth.json.
  const gtRelPath = ["benchmark", "entries", id, "ground_truth.json"].join("/");
  const headBlob = deps.blobAt("HEAD", gtRelPath);
  const current = rows
    .map((row, appendIndex) => ({ row, appendIndex }))
    .filter(({ row }) => headBlob !== null && deps.blobAt(row.ground_truth_commit, gtRelPath) === headBlob);

  if (current.length === 0) {
    return {
      ...base,
      status: "stale",
      stale: {
        rowGtCommits: [...new Set(rows.map((r) => r.ground_truth_commit))],
        currentGtCommit: deps.lastCommitTouching(gtRelPath) ?? "(unknown)",
      },
    };
  }

  // Append-only ledger: last-appended among current rows is the representative.
  // (Non-empty guaranteed by the length check above.)
  const { row, appendIndex } = current[current.length - 1]!;
  const artifactPath = assertNotBait(
    join(deps.runsDir, id, `${row.date}-${row.mode}.projection.json`),
  );
  if (!existsSync(artifactPath)) {
    return { ...base, status: "artifact-missing", missingArtifact: artifactPath };
  }

  const projection = JSON.parse(readFileSync(artifactPath, "utf8")) as FindingsProjection;
  const groundTruth = JSON.parse(
    readFileSync(assertNotBait(join(entryDir, "ground_truth.json")), "utf8"),
  ) as GroundTruth;
  const score = scoreEntry(id, projection, groundTruth);
  const { outcome, hitStatuses } = deriveOutcome(score);
  return {
    ...base,
    status: "scored",
    selected: { date: row.date, mode: row.mode, appendIndex },
    outcome,
    hitStatuses,
    drift: score.summary !== row.scorer_summary,
    fpCount: score.falsePositives.length,
  };
}

/** Build the full report. Pure over deps + disk; body is byte-reproducible. */
export function buildReport(deps: RunAllDeps): RunAllReport {
  assertNotBait(deps.entriesDir);
  const ids = readdirSync(deps.entriesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(deps.entriesDir, d.name, "entry.json")))
    .map((d) => d.name)
    .sort();

  const rows = ids.map((id) => scoreOneEntry(deps, id));

  const scored = rows.filter((r) => r.status === "scored");
  const stale = rows.filter((r) => r.status === "stale");
  const missing = rows.filter((r) => r.status === "artifact-missing" || r.status === "no-rows");

  const lines: string[] = [];
  lines.push(
    "entry | kind | validity | selected-run | outcome | hit-statuses",
    "--- | --- | --- | --- | --- | ---",
  );
  for (const r of rows) {
    const sel =
      r.status === "scored" && r.selected
        ? `${r.selected.date}#${r.selected.appendIndex} ${r.selected.mode}`
        : r.status.toUpperCase();
    const outcome =
      r.status === "scored"
        ? (r.outcome ?? "") + (r.drift ? " [DRIFT vs ledger row]" : "")
        : r.status === "stale" && r.stale
          ? `STALE — row GT commit(s) [${r.stale.rowGtCommits.join(", ")}] vs current GT commit ${r.stale.currentGtCommit}`
          : r.status === "artifact-missing"
            ? `ARTIFACT MISSING — cannot score (${r.missingArtifact})`
            : "no ledger rows";
    lines.push(
      `${r.id} | ${r.kind} | ${r.validity} | ${sel} | ${outcome} | ${(r.hitStatuses ?? []).join(",") || "—"}`,
    );
  }

  // Aggregate = OUTCOMES ONLY (a property of runs). Entry validity is a column
  // above, never summed here. STALE/missing are excluded from numerator AND
  // denominator of the scored line and get their own lines.
  const counts = new Map<string, number>();
  for (const r of scored) counts.set(r.outcome as string, (counts.get(r.outcome as string) ?? 0) + 1);
  const outcomeSummary =
    [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(", ") || "(none)";
  const modes = [...new Set(scored.map((r) => r.selected?.mode))].sort().join(",") || "(none)";
  const totalFps = scored.reduce((n, r) => n + (r.fpCount ?? 0), 0);
  lines.push("");
  lines.push(
    `aggregate (run OUTCOMES only): scored ${scored.length} of ${rows.length} entries — ${outcomeSummary}; false positives: ${totalFps}; mode(s): ${modes}; GT scope: current ground_truth.json content per entry`,
  );
  if (stale.length > 0) {
    lines.push(
      `STALE (excluded from scored aggregate; needs human look / fresh run): ${stale.map((r) => r.id).join(", ")}`,
    );
  }
  if (missing.length > 0) {
    lines.push(
      `ARTIFACT MISSING / NO ROWS (excluded; provenance gap, not a fail): ${missing.map((r) => r.id).join(", ")}`,
    );
  }

  return { rows, body: lines.join("\n") + "\n" };
}

// ── CLI: run-all.ts [repoRoot] ───────────────────────────────────────────────
function main(argv: string[]): number {
  const repoRoot = argv[0] ?? process.cwd();
  const report = buildReport(gitDeps(repoRoot));
  // Timestamp lives in the HEADER, outside the reproducible body.
  console.log(`SeamStress benchmark — run-all score-only report (generated ${new Date().toISOString()})`);
  console.log("");
  console.log(report.body);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
