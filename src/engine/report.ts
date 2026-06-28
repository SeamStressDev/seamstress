/**
 * Render a {@link SeamMap} into the builder-facing risk report — the artifact a
 * real founder reads. The rules that make it the *product*, not a JSON dump:
 *
 * - Plain language, consequence-first. The buyer speaks fear, not methodology:
 *   "anyone logged in can change their own role to admin", never "an IDOR in the
 *   portal action" or "the synthesis surfaced…". Internal jargon is softened.
 * - Verified issues are the headline, each backed by the exact quoted code — the
 *   trust signal that separates SeamStress from a scanner that guesses. Judgment
 *   calls are noted separately as "worth a look"; nothing unverified is presented
 *   as fact.
 * - The coverage caveat is shown honestly when the stack is unfamiliar.
 *
 * COGS is deliberately NOT rendered here — it is an operator concern the runner
 * prints separately, so the report you hand a stranger stays clean.
 */

import { effectiveStatus } from "../types/index.js";
import type { BlastRadiusRank, Finding, SeamKind, VerificationResult } from "../types/index.js";
import type { SeamMap } from "./map.js";

const BLAST_ORDER: Record<BlastRadiusRank, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const BLAST_LABEL: Record<BlastRadiusRank, string> = {
  critical: "🔴 Critical",
  high: "🟠 High",
  medium: "🟡 Medium",
  low: "⚪ Low",
};

/** Plain, buyer-facing label for each seam kind. */
const KIND_LABEL: Record<SeamKind, string> = {
  money_path: "Money & billing",
  auth: "Login & access control",
  pii: "Personal data",
  data_deletion: "Data deletion",
  safety_delivery: "Critical delivery",
  other: "High-risk logic",
};

/** What it means for the builder if a finding of this kind is real. */
const KIND_CONSEQUENCE: Record<SeamKind, string> = {
  money_path: "money can move the wrong way — incorrect charges, lost revenue, or someone reaching billing they shouldn't.",
  auth: "the wrong person can get in, or gain powers they shouldn't have.",
  pii: "personal data can be exposed to people who shouldn't see it.",
  data_deletion: "data can be destroyed — possibly someone else's, possibly with no undo.",
  safety_delivery: "a message that has to arrive can silently fail to.",
  other: "a high-risk operation can behave incorrectly.",
};

/** Soften internal/security jargon into plain phrasing for the builder. */
function softenJargon(text: string): string {
  return text
    .replace(/\bIDOR\b/g, "broken access control (one user reaching another's data)")
    .replace(/\bprivilege escalation\b/gi, "a user gaining powers they shouldn't have")
    .replace(/\bCSRF\b/g, "cross-site request forgery (an action triggered without the user's intent)");
}

function kindOf(map: SeamMap, seamId: string): SeamKind {
  return map.seams.find((s) => s.id === seamId)?.kind ?? "other";
}

/** Render the quoted-code evidence for a finding, if any. */
function evidenceBlock(verification: VerificationResult | undefined): string {
  const quote = verification?.evidence?.[0]?.quotedCode?.trim();
  if (!quote) return "";
  const loc = verification?.evidence?.[0]?.location;
  const where = loc ? ` (${loc.path}${loc.startLine ? `:${loc.startLine}` : ""})` : "";
  return `  - **Proof from your code${where}:**\n\n    \`\`\`\n    ${quote.replace(/\n/g, "\n    ")}\n    \`\`\`\n`;
}

function renderFinding(map: SeamMap, finding: Finding, verifications: VerificationResult[]): string {
  const kind = kindOf(map, finding.seamId);
  const v = verifications.find((x) => x.findingId === finding.id);
  const where = finding.locations?.[0]
    ? `${finding.locations[0].path}${finding.locations[0].startLine ? `:${finding.locations[0].startLine}` : ""}`
    : map.seams.find((s) => s.id === finding.seamId)?.sources[0]?.path ?? "—";

  return (
    `### ${BLAST_LABEL[finding.blastRadius]} — ${softenJargon(finding.description)}\n\n` +
    `  - **Where:** \`${where}\`\n` +
    `  - **Area:** ${KIND_LABEL[kind]}\n` +
    `  - **If this is wrong:** ${KIND_CONSEQUENCE[kind]}\n` +
    evidenceBlock(v) +
    "\n"
  );
}

/** Render the full builder-facing risk map as markdown. */
export function renderSeamMap(map: SeamMap): string {
  const { review } = map;
  const verifications = review.verifications;

  const byStatus = (status: string): Finding[] =>
    review.findings
      .filter((f) => effectiveStatus(f, verifications) === status)
      .sort((a, b) => BLAST_ORDER[a.blastRadius] - BLAST_ORDER[b.blastRadius]);

  const verified = byStatus("verified_real");
  const judgment = byStatus("judgment_call");

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of verified) counts[f.blastRadius] += 1;

  const lines: string[] = [];
  lines.push(`# 🔍 Seam Risk Map — ${map.review.target.repo}`);
  lines.push("");
  lines.push(
    "> SeamStress finds the high-risk **seams** in your codebase — the places where " +
      "a bug costs you money, accounts, or data — and verifies each issue against your " +
      "actual code.",
  );
  lines.push("");
  lines.push(
    `**Scanned:** ${map.filesScanned} files · ` +
      `**High-risk areas examined:** ${map.candidatesFound} · ` +
      `**Seams found:** ${map.seams.length}`,
  );
  lines.push(
    `**Verified issues:** ${verified.length}  ` +
      `(🔴 ${counts.critical} critical · 🟠 ${counts.high} high · 🟡 ${counts.medium} medium · ⚪ ${counts.low} low)`,
  );
  lines.push("");

  if (map.coverage.caveat) {
    lines.push(
      `> ⚠️ **Coverage note (${map.coverage.stack}):** ${map.coverage.caveat}`,
    );
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## 🚨 Verified issues — found in your real code");
  lines.push("");
  if (verified.length === 0) {
    lines.push(
      "No verified issues. The seams below were reviewed and the checks held up " +
        "against your code. (This is a floor on risk, not a guarantee — see coverage.)",
    );
    lines.push("");
  } else {
    lines.push("Each of these is confirmed against your code, with the exact lines quoted as proof.");
    lines.push("");
    for (const f of verified) lines.push(renderFinding(map, f, verifications));
  }

  if (judgment.length > 0) {
    lines.push("## 🔎 Worth a look — judgment calls");
    lines.push("");
    lines.push("Real, but they depend on intent or context only you own.");
    lines.push("");
    for (const f of judgment) {
      const kind = kindOf(map, f.seamId);
      lines.push(
        `- **${BLAST_LABEL[f.blastRadius]}** (${KIND_LABEL[kind]}) — ${softenJargon(f.description)}`,
      );
    }
    lines.push("");
  }

  lines.push("## 🗺️ What we looked at");
  lines.push("");
  lines.push("The high-risk boundaries we found and reviewed:");
  lines.push("");
  for (const seam of map.seams) {
    const n = verified.filter((f) => f.seamId === seam.id).length;
    const status = n > 0 ? `**${n} verified issue${n === 1 ? "" : "s"}**` : "no verified issues";
    lines.push(`- ${KIND_LABEL[seam.kind]} — \`${seam.sources[0]?.path ?? seam.label}\` — ${status}`);
  }
  lines.push("");

  if (map.erroredSeams.length > 0) {
    lines.push("## ⚠️ Could not fully review");
    lines.push("");
    lines.push(
      `${map.erroredSeams.length} seam(s) hit an error during review and were skipped (the rest of the map is complete):`,
    );
    for (const e of map.erroredSeams) lines.push(`- \`${e.label}\``);
    lines.push("");
  }

  return lines.join("\n");
}

/** Operator-only COGS footnote (printed by the runner, never in the builder file). */
export function renderOperatorFootnote(map: SeamMap): string {
  const c = map.totalCost;
  const models = Object.entries(c.costUsdByModel)
    .map(([m, usd]) => `${m} $${usd.toFixed(4)}`)
    .join(", ");
  return (
    `operator footnote (not builder-facing):\n` +
    `  mapping cost $${c.totalCostUsd.toFixed(4)} = detection $${map.detectionCost.totalCostUsd.toFixed(4)} + ` +
    `review $${map.reviewCost.totalCostUsd.toFixed(4)}\n` +
    `  ${c.totalInputTokens} in / ${c.totalOutputTokens} out tokens\n` +
    `  models: ${models}`
  );
}
