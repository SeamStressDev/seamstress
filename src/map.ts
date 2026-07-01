/**
 * The free seam-map runner — the validation instrument.
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
 */

import { writeFileSync } from "node:fs";
import { mapSeams, renderSeamMap, renderSeamMapHtml, renderCostSummary } from "./engine/index.js";
import { loadEnvFile } from "./env.js";
import { LlmClient } from "./llm/index.js";

function flagValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  loadEnvFile();

  const repoPath = process.argv[2];
  if (!repoPath || repoPath.startsWith("--")) {
    console.error("Usage: npm run map -- <repo-path> [--out report.md] [--html report.html] [--max N]");
    process.exitCode = 1;
    return;
  }
  const out = flagValue("--out");
  const htmlOut = flagValue("--html");
  const maxRaw = flagValue("--max");
  const maxCandidates = maxRaw !== undefined ? Number(maxRaw) : undefined;

  console.error(`Mapping ${repoPath} …`);
  const client = new LlmClient();
  const map = await mapSeams(repoPath, {
    client,
    ...(maxCandidates !== undefined ? { maxCandidates } : {}),
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

  // Cost summary goes to stderr, never into the report file.
  console.error("\n" + renderCostSummary(map));
}

main().catch((err: unknown) => {
  console.error("Seam-map run failed:");
  console.error(err);
  process.exitCode = 1;
});
