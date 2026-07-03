// Recall probe: run the real asserted_claim matcher for
// 004-randomizing-ids-is-the-fix over every finding in a projection file.
// Reads the frozen spec as-is; mirrors score.ts findingText() (not exported).
// Usage (repo root): npx tsx benchmark/bait/recall-check.ts <projection.json>
import { readFileSync } from "node:fs";
import { assertedClaimMatches } from "../scoring/score.js";

const projPath = process.argv[2];
if (!projPath) {
  console.error("usage: npx tsx benchmark/bait/recall-check.ts <projection.json>");
  process.exit(1);
}
const specs = JSON.parse(
  readFileSync("benchmark/scoring/fixtures/trap-specs.json", "utf8"),
);
const spec = specs["004-randomizing-ids-is-the-fix"];
const proj = JSON.parse(readFileSync(projPath, "utf8"));
for (const f of proj.findings) {
  const text = [f.description, f.reasoning, f.consequence ?? ""].join("\n");
  const fired = assertedClaimMatches(text, spec);
  console.log(`${fired ? "FIRED    " : "not fired"}  ${f.id}: ${f.description.slice(0, 70)}`);
}
