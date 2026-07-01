/**
 * Live detector runner. Scans a repo, runs the hybrid detector (heuristic
 * pre-filter → per-file-isolated LLM judgment), and prints the detected seams
 * (kind, path, why), what was rejected/errored, and detection COGS.
 *
 * Usage (needs a real key in .env):
 *   npm run detect -- /path/to/repo
 *   npm run detect -- /path/to/repo --max 40   # cap candidates judged
 */

import { detectSeams } from "./engine/index.js";
import { loadEnvFile } from "./env.js";
import { LlmClient } from "./llm/index.js";

async function main(): Promise<void> {
  loadEnvFile();

  const repoPath = process.argv[2];
  if (!repoPath) {
    console.error("Usage: npm run detect -- <repo-path> [--max N]");
    process.exitCode = 1;
    return;
  }
  const maxIdx = process.argv.indexOf("--max");
  const maxCandidates = maxIdx !== -1 ? Number(process.argv[maxIdx + 1]) : undefined;

  console.log(`--- SeamStress detector: ${repoPath} ---`);
  const client = new LlmClient();
  const result = await detectSeams(repoPath, {
    client,
    ...(maxCandidates !== undefined ? { maxCandidates } : {}),
  });

  console.log(
    `\nheuristic: ${result.candidatesFound} candidates` +
      (maxCandidates !== undefined ? ` (judging first ${result.candidates.length})` : "") +
      ` | judged: ${result.judged.length} | seams: ${result.seams.length} | ` +
      `rejected: ${result.judged.filter((j) => j.response && !j.response.isSeam).length} | ` +
      `errored: ${result.errors.length}`,
  );

  console.log("\n================ DETECTED SEAMS ================");
  if (result.seams.length === 0) console.log("(none)");
  for (const j of result.judged) {
    if (!j.seam || !j.response) continue;
    const conf = j.response.confidence ? ` ${j.response.confidence}` : "";
    console.log(`\n[${j.response.kind}${conf}] ${j.path}`);
    console.log(`    ${j.response.reasoning}`);
  }

  const rejected = result.judged.filter((j) => j.response && !j.response.isSeam);
  if (rejected.length > 0) {
    console.log("\n================ REJECTED (not a seam) ================");
    for (const j of rejected) console.log(`  ${j.path} — ${j.response?.reasoning ?? ""}`);
  }

  if (result.errors.length > 0) {
    console.log("\n================ ERRORED (isolated, scan continued) ================");
    for (const j of result.errors) console.log(`  ${j.path} — ${j.error}`);
  }

  console.log("\n================ DETECTION COGS ================");
  console.log(
    `  $${result.cost.totalCostUsd.toFixed(6)} ` +
      `(${result.cost.totalInputTokens} in / ${result.cost.totalOutputTokens} out, ` +
      `${result.usages.length} calls)`,
  );
  for (const [model, usd] of Object.entries(result.cost.costUsdByModel)) {
    console.log(`    ${model}: $${usd.toFixed(6)}`);
  }
}

main().catch((err: unknown) => {
  console.error("Detection run failed:");
  console.error(err);
  process.exitCode = 1;
});
