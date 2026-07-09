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
 * The seam-map runner.
 *
 * Point it at a repo: it detects the seams, reviews them, and prints a readable
 * risk map you can act on. Optionally writes the report to a .md file (clean —
 * no cost lines). The run-cost summary goes to stderr, never into the report
 * file.
 *
 * Usage (needs a real key in .env):
 *   npm run map -- /path/to/repo
 *   npm run map -- /path/to/repo --out report.md
 *   npm run map -- /path/to/repo --max 30      # cap candidates judged
 *   npm run map -- /path/to/repo --context self-audit   # whose code this is
 *
 * --context is the run-context primitive (slice 1a): always explicit, never
 * inferred, and unspecified means "user" — the no-capture side. For the two
 * capture-permitted contexts (benchmark, self-audit) the run ALSO appends one
 * stratified aggregate row to the measurement sink (slice 1b) at the end.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { reportFatal, requireRepoDir } from "./cli.js";
import {
  AGGREGATE_LEDGER_RELPATH,
  CaptureSession,
  RUN_CONTEXTS,
  appendAggregateRow,
  emitAggregateRow,
  mapSeams,
  projectSeamMap,
  registerReviewVerdicts,
  renderCostSummary,
  renderSeamMap,
  renderSeamMapHtml,
} from "./engine/index.js";
import type { RunContext } from "./engine/index.js";
import { loadEnvFile } from "./env.js";
import { LlmClient } from "./llm/index.js";

/** The engine repo root (this file lives one level below it), where the
 *  measurement ledger lives — NOT the scanned repo. */
const ENGINE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function flagValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  loadEnvFile();

  const repoPath = process.argv[2];
  if (!repoPath || repoPath.startsWith("--")) {
    console.error("Usage: npm run map -- <repo-path> [--out report.md] [--html report.html] [--json projection.json] [--max N] [--context benchmark|self-audit|gift-run|user|test]");
    process.exitCode = 1;
    return;
  }
  requireRepoDir(repoPath);
  const out = flagValue("--out");
  const htmlOut = flagValue("--html");
  const jsonOut = flagValue("--json");
  const maxRaw = flagValue("--max");
  const maxCandidates = maxRaw !== undefined ? Number(maxRaw) : undefined;

  // Closed-set parse: a context is chosen from the enum or the run refuses.
  const contextRaw = flagValue("--context");
  if (contextRaw !== undefined && !(RUN_CONTEXTS as readonly string[]).includes(contextRaw)) {
    console.error(`Unknown --context "${contextRaw}". One of: ${RUN_CONTEXTS.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const runContext = contextRaw as RunContext | undefined;
  // Null for every non-capture context, including unspecified (the 1a gate).
  const capture = CaptureSession.begin(runContext);

  console.error(`Mapping ${repoPath} …`);
  const client = new LlmClient();
  const map = await mapSeams(repoPath, {
    client,
    ...(maxCandidates !== undefined ? { maxCandidates } : {}),
    ...(runContext !== undefined ? { runContext } : {}),
    ...(capture !== null ? { capture } : {}),
  });

  const report = renderSeamMap(map);
  console.log(report);

  if (out) {
    writeFileSync(out, report + "\n");
    console.error(`\nReport written to ${out}`);
  }

  if (htmlOut) {
    writeFileSync(htmlOut, renderSeamMapHtml(map) + "\n");
    console.error(`HTML report written to ${htmlOut}`);
  }

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(projectSeamMap(map), null, 2) + "\n");
    console.error(`Findings projection written to ${jsonOut}`);
  }

  // Slice 1b flush: verdicts join the scan's in-memory records, the per-file
  // state is aggregated and destroyed, and ONE suppressed row is appended.
  // These are the pipeline's own verdicts (self-validation caveat applies —
  // see the ledger README); ground-truth benchmark capture lives in
  // benchmark/scoring/capture-aggregates.ts instead.
  if (capture !== null) {
    registerReviewVerdicts(capture, map.review.findings, map.review.verifications);
    const engineCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: ENGINE_ROOT,
      encoding: "utf8",
    }).trim();
    const row = emitAggregateRow(capture.tally(), {
      date: new Date().toISOString().slice(0, 10),
      engineCommit,
    });
    const ledgerPath = join(ENGINE_ROOT, AGGREGATE_LEDGER_RELPATH);
    appendAggregateRow(ledgerPath, row);
    console.error(`Measurement aggregate appended to ${ledgerPath} (context: ${map.runContext})`);
  }

  // Cost summary goes to stderr, never into the report file.
  console.error("\n" + renderCostSummary(map));
}

main().catch((err: unknown) => {
  reportFatal("Seam-map run failed", err);
  process.exitCode = 1;
});
