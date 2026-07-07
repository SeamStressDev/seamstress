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
 * Render a {@link SeamMap} into the risk report — the artifact the repo's owner
 * actually reads. The rules that make it a readable report, not a JSON dump:
 *
 * - Plain language, consequence-first. Describe impact, not methodology:
 *   "anyone logged in can change their own role to admin", never "an IDOR in the
 *   portal action" or "the synthesis surfaced…". Internal jargon is softened.
 * - Lead with the most consequential findings. An executive summary of ONLY the
 *   critical+high verified findings comes first — the 2-3 highest-impact
 *   issues — so a skimming reader sees them before a wall of lower-severity
 *   notes. The report has to stay curated, not exhaustive.
 * - Verified issues are the headline, each backed by the exact quoted code. The
 *   medium/low tail and judgment calls ("worth a look") are kept below, collapsed
 *   to compact one-liners so they don't drown the headline. Nothing unverified is
 *   presented as fact.
 * - The coverage caveat is shown honestly when the stack is unfamiliar.
 *
 * Cost is deliberately NOT rendered here — the runner prints a separate cost
 * summary to stderr, so the report you hand someone stays clean.
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

/** Plain reader-facing label for each seam kind. */
const KIND_LABEL: Record<SeamKind, string> = {
  money_path: "Money & billing",
  auth: "Login & access control",
  pii: "Personal data",
  data_deletion: "Data deletion",
  safety_delivery: "Critical delivery",
  tenant_isolation: "Cross-tenant data",
  other: "High-risk logic",
};

/** Soften internal/security jargon into plain phrasing for the reader. */
function softenJargon(text: string): string {
  return text
    .replace(/\bIDOR\b/g, "broken access control (one user reaching another's data)")
    .replace(/\bprivilege escalation\b/gi, "a user gaining powers they shouldn't have")
    .replace(/\bCSRF\b/g, "cross-site request forgery (an action triggered without the user's intent)");
}

function kindOf(map: SeamMap, seamId: string): SeamKind {
  return map.seams.find((s) => s.id === seamId)?.kind ?? "other";
}

/**
 * Neutralize control characters in a repo-controlled path before interpolating
 * it into the markdown report. A repository controls its own file paths, and a
 * path may legally contain newlines and other control bytes; without this a
 * crafted filename could inject markdown structure into the report. The HTML
 * report neutralizes separately via {@link escapeHtml}.
 */
function mdSafePath(path: string): string {
  return path.replace(/[\u0000-\u001f]/g, " ");
}

/** Render the quoted-code evidence for a finding, if any. */
function evidenceBlock(verification: VerificationResult | undefined): string {
  const quote = verification?.evidence?.[0]?.quotedCode?.trim();
  if (!quote) return "";
  const loc = verification?.evidence?.[0]?.location;
  const where = loc ? ` (${mdSafePath(loc.path)}${loc.startLine ? `:${loc.startLine}` : ""})` : "";
  return `  - **Proof from your code${where}:**\n\n    \`\`\`\n    ${quote.replace(/\n/g, "\n    ")}\n    \`\`\`\n`;
}

function renderFinding(map: SeamMap, finding: Finding, verifications: VerificationResult[]): string {
  const kind = kindOf(map, finding.seamId);
  const v = verifications.find((x) => x.findingId === finding.id);
  const where = finding.locations?.[0]
    ? `${finding.locations[0].path}${finding.locations[0].startLine ? `:${finding.locations[0].startLine}` : ""}`
    : map.seams.find((s) => s.id === finding.seamId)?.sources[0]?.path ?? "—";

  // The consequence is the finding's OWN, model-emitted line — never derived
  // from the seam `kind` (that produced category-mislabeled consequences). If
  // the finding carries none, the line is omitted rather than back-filled.
  const consequenceLine = finding.consequence
    ? `  - **If this is wrong:** ${softenJargon(finding.consequence)}\n`
    : "";

  return (
    `### ${BLAST_LABEL[finding.blastRadius]} — ${softenJargon(finding.description)}\n\n` +
    `  - **Where:** \`${mdSafePath(where)}\`\n` +
    `  - **Area:** ${KIND_LABEL[kind]}\n` +
    consequenceLine +
    evidenceBlock(v) +
    "\n"
  );
}

/** Most lower-severity / judgment one-liners shown before collapsing to "+N more". */
const TAIL_CAP = 8;

/** A compact one-line consequence for a finding (severity badge + plain text). */
function oneLiner(map: SeamMap, finding: Finding): string {
  return `- **${BLAST_LABEL[finding.blastRadius]}** (${KIND_LABEL[kindOf(map, finding.seamId)]}) — ${softenJargon(finding.description)}`;
}

/** Render a compact, capped list of one-liners with a "+N more" tail. */
function compactList(map: SeamMap, findings: Finding[], moreLabel: string): string[] {
  const shown = findings.slice(0, TAIL_CAP).map((f) => oneLiner(map, f));
  const extra = findings.length - TAIL_CAP;
  if (extra > 0) shown.push(`- _… and ${extra} more ${moreLabel}._`);
  return shown;
}

/** Render the full risk map as markdown. */
export function renderSeamMap(map: SeamMap): string {
  const { review } = map;
  const verifications = review.verifications;

  const byStatus = (status: string): Finding[] =>
    review.findings
      .filter((f) => effectiveStatus(f, verifications) === status)
      .sort((a, b) => BLAST_ORDER[a.blastRadius] - BLAST_ORDER[b.blastRadius]);

  const verified = byStatus("verified_real");
  const judgment = byStatus("judgment_call");

  // The punch vs. the tail: criticals + highs lead; medium/low get collapsed.
  const isTopTier = (f: Finding): boolean => f.blastRadius === "critical" || f.blastRadius === "high";
  const headline = verified.filter(isTopTier);
  const lowerVerified = verified.filter((f) => !isTopTier(f));

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

  // ── Executive summary: the handful that actually matter, first. ──
  lines.push("## ⚡ What matters most");
  lines.push("");
  if (headline.length === 0) {
    lines.push(
      "**No critical or high-severity issues found.** " +
        "There's a lower-severity tail below worth a skim.",
    );
    lines.push("");
  } else {
    lines.push(
      `**${headline.length} issue${headline.length === 1 ? "" : "s"} of high severity or above** — ` +
        "each verified against your real code (full detail + the quoted proof below):",
    );
    lines.push("");
    headline.forEach((f, i) => {
      lines.push(`${i + 1}. ${BLAST_LABEL[f.blastRadius]} — ${softenJargon(f.description)}`);
    });
    lines.push("");
  }

  // ── Full detail for the issues that matter. ──
  if (headline.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## 🚨 The issues that matter — verified in your real code");
    lines.push("");
    lines.push("Each is confirmed against your code, with the exact lines quoted as proof.");
    lines.push("");
    for (const f of headline) lines.push(renderFinding(map, f, verifications));
  }

  // ── The tail: real, honest, but demoted so it doesn't drown the headline. ──
  if (lowerVerified.length > 0) {
    lines.push("## 🔧 Lower-severity verified notes");
    lines.push("");
    lines.push("Real and confirmed, but lower blast radius — worth fixing, not emergencies.");
    lines.push("");
    lines.push(...compactList(map, lowerVerified, "lower-severity verified notes"));
    lines.push("");
  }

  if (judgment.length > 0) {
    lines.push("## 🔎 Worth a look — judgment calls");
    lines.push("");
    lines.push("Real, but they depend on intent or context only you own.");
    lines.push("");
    lines.push(...compactList(map, judgment, "judgment calls"));
    lines.push("");
  }

  lines.push("## 🗺️ What we looked at");
  lines.push("");
  lines.push("The high-risk boundaries we found and reviewed:");
  lines.push("");
  for (const seam of map.seams) {
    const n = verified.filter((f) => f.seamId === seam.id).length;
    const status = n > 0 ? `**${n} verified issue${n === 1 ? "" : "s"}**` : "no verified issues";
    lines.push(`- ${KIND_LABEL[seam.kind]} — \`${mdSafePath(seam.sources[0]?.path ?? seam.label)}\` — ${status}`);
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

/** Escape the 5 HTML-significant characters. Applied to ALL finding-derived
 *  text — descriptions, reasoning, consequence, quoted code, paths, labels are
 *  untrusted stranger input and must never reach the HTML raw. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain reader-facing severity words (the chip/badge text). */
const SEVERITY_WORD: Record<BlastRadiusRank, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** The file:line label for a finding — prefers its own location, falls back to the seam. */
function findingWhere(map: SeamMap, finding: Finding): string {
  const loc = finding.locations?.[0];
  if (loc) return `${loc.path}${loc.startLine ? `:${loc.startLine}` : ""}`;
  return map.seams.find((s) => s.id === finding.seamId)?.sources[0]?.path ?? "—";
}

/**
 * Render the risk map as a self-contained static HTML report —
 * sibling of {@link renderSeamMap}, same `SeamMap`, HTML instead of markdown.
 * Reuses the exact same derived views (effectiveStatus verified-only filter,
 * kindOf, severity counts) so the two reports agree on what is verified.
 *
 * v1 scope: ONE headline (the single top-ranked verified finding); all other
 * verified findings collapse to a compact list; the "why a scanner misses it"
 * callout is derived from the finding's `reasoning`; reachability is not shown;
 * every finding-derived string passes through {@link escapeHtml}.
 */
export function renderSeamMapHtml(map: SeamMap): string {
  const { review } = map;
  const verifications = review.verifications;

  const verified = review.findings
    .filter((f) => effectiveStatus(f, verifications) === "verified_real")
    .sort((a, b) => BLAST_ORDER[a.blastRadius] - BLAST_ORDER[b.blastRadius]);

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of verified) counts[f.blastRadius] += 1;

  // ONE headline: the single top-ranked verified finding. Everything else —
  // including any other crit/high — goes to the collapsed list.
  const headline = verified[0];
  const rest = verified.slice(1);

  const repo = escapeHtml(review.target.repo);

  const verdict =
    verified.length === 0
      ? "No verified issues surfaced. The high-risk seams reviewed held up against the actual code — a floor on risk, not a guarantee."
      : `SeamStress reviewed ${map.seams.length} high-risk seam${map.seams.length === 1 ? "" : "s"} and verified ` +
        `${verified.length} issue${verified.length === 1 ? "" : "s"} against your real code` +
        (counts.critical + counts.high > 0
          ? `, including ${counts.critical + counts.high} high-severity or above. The most consequential is below, with the exact lines quoted as proof.`
          : ". The details are below, each with the exact lines quoted as proof.");

  const styles = `
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #0d1117; color: #e6edf3;
      font: 15px/1.6 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; }
    .wrap { max-width: 820px; margin: 0 auto; padding: 40px 24px 64px; }
    .chrome { display: flex; align-items: baseline; justify-content: space-between;
      border-bottom: 1px solid #21262d; padding-bottom: 14px; }
    .mark { font-weight: 700; letter-spacing: .5px; color: #e6edf3; }
    .mark .dot { color: #58a6ff; }
    .repo { color: #7d8590; font-size: 13px; }
    .metrics { display: flex; flex-wrap: wrap; gap: 22px; margin: 22px 0 8px; }
    .metric .n { font-size: 26px; font-weight: 700; color: #e6edf3; }
    .metric .l { font-size: 12px; color: #7d8590; text-transform: uppercase; letter-spacing: .6px; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 20px; }
    .chip { font-size: 12px; padding: 3px 10px; border-radius: 999px; border: 1px solid #30363d; color: #adbac7; }
    .chip.critical { border-color: #f8514933; background: #f851491a; color: #ff7b72; }
    .chip.high { border-color: #db6d2833; background: #db6d281a; color: #ffa657; }
    .chip.medium { border-color: #d2992233; background: #d299221a; color: #e3b341; }
    .chip.low { color: #7d8590; }
    .chip.errored { border-color: #30363d; color: #7d8590; }
    .verdict { color: #adbac7; margin: 0 0 30px; }
    .card { border: 1px solid #30363d; border-radius: 8px; padding: 20px 22px; background: #161b22; }
    .card .top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
    .badge { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px;
      padding: 3px 9px; border-radius: 4px; }
    .badge.critical { background: #f85149; color: #0d1117; }
    .badge.high { background: #ffa657; color: #0d1117; }
    .badge.medium { background: #e3b341; color: #0d1117; }
    .badge.low { background: #484f58; color: #e6edf3; }
    .tag { font-size: 12px; color: #7d8590; }
    .verified { font-size: 12px; color: #3fb950; margin-left: auto; }
    .card h2 { font-size: 17px; line-height: 1.4; margin: 0 0 14px; color: #e6edf3; font-weight: 600; }
    .trace { margin: 0 0 16px; }
    .trace .path { font-size: 12px; color: #7d8590; margin-bottom: 6px; }
    pre { margin: 0; padding: 14px 16px; background: #0d1117; border: 1px solid #21262d; border-radius: 6px;
      overflow-x: auto; font-size: 13px; color: #e6edf3; }
    .label { font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: #7d8590; margin: 16px 0 4px; }
    .consequence { color: #e6edf3; margin: 0 0 4px; }
    .why { border-left: 2px solid #30363d; padding-left: 14px; color: #adbac7; margin-top: 4px; }
    .collapsed { margin-top: 28px; }
    .collapsed h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: #7d8590; margin: 0 0 10px; }
    .row { display: flex; gap: 10px; align-items: baseline; padding: 8px 0; border-top: 1px solid #21262d; }
    .row .sev { font-size: 11px; font-weight: 700; text-transform: uppercase; min-width: 62px; }
    .row .sev.critical { color: #ff7b72; } .row .sev.high { color: #ffa657; }
    .row .sev.medium { color: #e3b341; } .row .sev.low { color: #7d8590; }
    .row .d { flex: 1; color: #adbac7; }
    .row .f { color: #6e7681; font-size: 12px; }
    .caveat { border: 1px solid #d2992233; background: #d299220f; border-radius: 6px;
      padding: 12px 14px; color: #e3b341; font-size: 13px; margin: 0 0 24px; }
    footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #21262d;
      color: #6e7681; font-size: 12px; text-align: center; }
    footer a { color: #7d8590; text-decoration: none; }
  `.trim();

  const lines: string[] = [];
  lines.push("<!doctype html>");
  lines.push('<html lang="en"><head><meta charset="utf-8">');
  lines.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  lines.push(`<title>Seam Risk Map — ${repo}</title>`);
  lines.push(`<style>${styles}</style>`);
  lines.push("</head><body><div class=\"wrap\">");

  // ── Chrome ──
  lines.push('<div class="chrome">');
  lines.push('<span class="mark">SEAM<span class="dot">·</span>STRESS</span>');
  lines.push(`<span class="repo">${repo}</span>`);
  lines.push("</div>");

  // ── Metrics bar ──
  lines.push('<div class="metrics">');
  lines.push(`<div class="metric"><div class="n">${map.filesScanned}</div><div class="l">files scanned</div></div>`);
  lines.push(`<div class="metric"><div class="n">${map.seams.length}</div><div class="l">seams</div></div>`);
  lines.push(`<div class="metric"><div class="n" data-verified-total="${verified.length}">${verified.length}</div><div class="l">verified issues</div></div>`);
  lines.push(`<div class="metric"><div class="n">${headline ? 1 : 0}</div><div class="l">headline</div></div>`);
  lines.push("</div>");

  // ── Severity chips ──
  lines.push('<div class="chips">');
  lines.push(`<span class="chip critical" data-count-critical="${counts.critical}">${counts.critical} critical</span>`);
  lines.push(`<span class="chip high" data-count-high="${counts.high}">${counts.high} high</span>`);
  lines.push(`<span class="chip medium" data-count-medium="${counts.medium}">${counts.medium} medium</span>`);
  lines.push(`<span class="chip low" data-count-low="${counts.low}">${counts.low} low</span>`);
  if (map.erroredSeams.length > 0) {
    lines.push(`<span class="chip errored">${map.erroredSeams.length} could not review</span>`);
  }
  lines.push("</div>");

  if (map.coverage.caveat) {
    lines.push(`<p class="caveat">⚠ Coverage (${escapeHtml(map.coverage.stack)}): ${escapeHtml(map.coverage.caveat)}</p>`);
  }

  // ── Prose verdict ──
  lines.push(`<p class="verdict">${verdict}</p>`);

  // ── Headline finding (one, full detail) ──
  if (headline) {
    const kind = kindOf(map, headline.seamId);
    const v = verifications.find((x) => x.findingId === headline.id);
    const quote = v?.evidence?.[0]?.quotedCode?.trim();
    const evLoc = v?.evidence?.[0]?.location;
    const traceWhere = evLoc
      ? `${evLoc.path}${evLoc.startLine ? `:${evLoc.startLine}` : ""}`
      : findingWhere(map, headline);

    lines.push('<div class="card" data-headline-card>');
    lines.push('<div class="top">');
    lines.push(`<span class="badge ${headline.blastRadius}">${SEVERITY_WORD[headline.blastRadius]}</span>`);
    lines.push(`<span class="tag">${escapeHtml(KIND_LABEL[kind])}</span>`);
    lines.push('<span class="verified">✓ verified against source</span>');
    lines.push("</div>");
    lines.push(`<h2>${escapeHtml(headline.description)}</h2>`);
    if (quote) {
      lines.push('<div class="trace">');
      lines.push(`<div class="path">${escapeHtml(traceWhere)}</div>`);
      lines.push(`<pre>${escapeHtml(quote)}</pre>`);
      lines.push("</div>");
    }
    if (headline.consequence) {
      lines.push('<div class="label">If this is wrong</div>');
      lines.push(`<p class="consequence">${escapeHtml(headline.consequence)}</p>`);
    }
    lines.push('<div class="label">Why a scanner misses it</div>');
    lines.push(`<p class="why">${escapeHtml(headline.reasoning)}</p>`);
    lines.push("</div>");
  }

  // ── Collapsed list (the rest) ──
  lines.push('<div class="collapsed" data-collapsed-list>');
  if (rest.length > 0) {
    lines.push(`<h3>${rest.length} more verified issue${rest.length === 1 ? "" : "s"}</h3>`);
    for (const f of rest) {
      lines.push('<div class="row">');
      lines.push(`<span class="sev ${f.blastRadius}">${SEVERITY_WORD[f.blastRadius]}</span>`);
      lines.push(`<span class="d">${escapeHtml(f.description)}</span>`);
      lines.push(`<span class="f">${escapeHtml(findingWhere(map, f))}</span>`);
      lines.push("</div>");
    }
  }
  lines.push("</div>");

  // ── Footer ──
  lines.push('<footer>Audited with SeamStress · <a href="https://seamstress.dev">seamstress.dev</a></footer>');
  lines.push("</div></body></html>");

  return lines.join("\n");
}

/** Cost summary — printed to stderr by the runner, never written into the report file. */
export function renderCostSummary(map: SeamMap): string {
  const c = map.totalCost;
  const models = Object.entries(c.costUsdByModel)
    .map(([m, usd]) => `${m} $${usd.toFixed(4)}`)
    .join(", ");
  return (
    `Run cost (billed to your Anthropic key): $${c.totalCostUsd.toFixed(4)} — ` +
    `detection $${map.detectionCost.totalCostUsd.toFixed(4)} + review $${map.reviewCost.totalCostUsd.toFixed(4)}\n` +
    `  ${c.totalInputTokens} input / ${c.totalOutputTokens} output tokens\n` +
    `  by model: ${models}`
  );
}
