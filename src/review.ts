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
 * Live review runner. Loads ONE assembled seam from a JSON fixture, runs the
 * full real pipeline (blind critics → synthesis → verification) against the
 * Anthropic API, and prints the ranked findings, each verification verdict with
 * its quoted evidence, and the COGS broken down by purpose — the first time
 * verification cost is measured as a fraction of a real review.
 *
 * Usage (needs a real key in .env):
 *   npm run review                                    # default Resend fixture
 *   npm run review -- fixtures/resend-critical-email.seam.json
 */

import { readFileSync } from "node:fs";
import { reportFatal } from "./cli.js";
import { reviewSeam } from "./engine/index.js";
import { loadEnvFile } from "./env.js";
import { LlmClient } from "./llm/index.js";
import { effectiveStatus, SeamSchema } from "./types/index.js";
import type { ReviewResult } from "./types/index.js";

const DEFAULT_FIXTURE = "fixtures/resend-critical-email.seam.json";

function printResult(result: ReviewResult): void {
  const { findings, verifications, cost } = result;

  console.log("\n================ RANKED FINDINGS ================");
  if (findings.length === 0) {
    console.log("(no findings — the seam was judged sound)");
  }
  findings.forEach((f, i) => {
    const status = effectiveStatus(f, verifications);
    const conf = f.confidence ? `, confidence=${f.confidence}` : "";
    console.log(`\n[${i + 1}] (${f.blastRadius}${conf}) ${status.toUpperCase()}`);
    console.log(`    ${f.description}`);
    console.log(`    reasoning: ${f.reasoning}`);

    const v = verifications.find((x) => x.findingId === f.id);
    if (v) {
      console.log(`    verdict: ${v.status} — ${v.note}`);
      v.evidence.forEach((e) => {
        const loc = e.location.startLine ? `:${e.location.startLine}` : "";
        console.log(`      evidence (${e.location.path}${loc}): ${e.quotedCode}`);
      });
    }
  });

  console.log("\n================ SYNTHESIS ================");
  console.log(result.synthesis);

  console.log("\n================ COST BY PIPELINE STAGE ================");
  for (const [purpose, usd] of Object.entries(cost.costUsdByPurpose)) {
    if (usd > 0) console.log(`  ${purpose.padEnd(14)} $${usd.toFixed(6)}`);
  }
  console.log("  ----------------------------");
  console.log("  by model:");
  for (const [model, usd] of Object.entries(cost.costUsdByModel)) {
    console.log(`    ${model.padEnd(26)} $${usd.toFixed(6)}`);
  }
  console.log(
    `  TOTAL          $${cost.totalCostUsd.toFixed(6)} ` +
      `(${cost.totalInputTokens} in / ${cost.totalOutputTokens} out tokens, ` +
      `${result.usages.length} calls)`,
  );
}

async function main(): Promise<void> {
  loadEnvFile();

  const fixturePath = process.argv[2] ?? DEFAULT_FIXTURE;
  const raw: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));
  const seam = SeamSchema.parse(raw);

  console.log(`--- SeamStress review: ${seam.label} ---`);
  console.log(`seam: ${seam.id} (kind: ${seam.kind}) from ${fixturePath}`);

  const client = new LlmClient();
  const result = await reviewSeam(seam, {
    client,
    target: { repo: "SeamStressDev/seamstress", commit: "working-tree" },
  });

  printResult(result);
}

main().catch((err: unknown) => {
  reportFatal("Review run failed", err);
  process.exitCode = 1;
});
