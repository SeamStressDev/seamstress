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
 * HTML report generator — pins the LOGIC that fails silently: HTML-escaping of
 * untrusted stranger text, the one-headline split, the severity tally, and
 * verified-only headline selection. Deterministic: synthetic SeamMap, no model.
 */

import { describe, expect, it } from "vitest";
import { renderSeamMapHtml } from "./report.js";
import type { SeamMap } from "./map.js";
import type {
  BlastRadiusRank,
  Cost,
  Finding,
  Seam,
  VerificationResult,
} from "../types/index.js";

const ZERO_COST: Cost = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCacheCreationInputTokens: 0,
  totalCacheReadInputTokens: 0,
  totalCostUsd: 0,
  costUsdByModel: {},
  costUsdByPurpose: { seam_detection: 0, critic: 0, synthesis: 0, verification: 0, other: 0 },
};

/** A dangerous string that must never reach the output unescaped. */
const XSS = '<script>alert(1)</script>';

const seam: Seam = {
  id: "seam-1",
  kind: "money_path",
  label: "app/api/webhooks/stripe/route.ts",
  sources: [{ path: "app/api/webhooks/stripe/route.ts", startLine: 1, endLine: 40 }],
  inputText: "x",
};

/** spec: [description, blastRadius, verified, quotedCode] */
type Spec = { desc: string; blast: BlastRadiusRank; verified: boolean; quote?: string; reasoning?: string; consequence?: string };

function mapFrom(specs: Spec[]): SeamMap {
  const findings: Finding[] = specs.map((s, i) => ({
    id: `seam-1:finding-${i + 1}`,
    seamId: "seam-1",
    description: s.desc,
    reasoning: s.reasoning ?? "the guard is a read-only check with no lock",
    blastRadius: s.blast,
    ...(s.consequence !== undefined ? { consequence: s.consequence } : {}),
    locations: [{ path: "app/api/webhooks/stripe/route.ts", startLine: 27 }],
  }));
  const verifications: VerificationResult[] = specs.map((s, i) => ({
    findingId: `seam-1:finding-${i + 1}`,
    // A finding is "verified" only if it has real quoted evidence (effectiveStatus gate).
    status: s.verified ? "verified_real" : "judgment_call",
    evidence: s.verified
      ? [{ quotedCode: s.quote ?? `code-${i}`, location: { path: "app/api/webhooks/stripe/route.ts", startLine: 27 } }]
      : [],
    note: "n",
  }));
  return {
    repoPath: "/x",
    filesScanned: 42,
    candidatesFound: 7,
    seams: [seam],
    review: {
      target: { repo: "acme/widgets", commit: "deadbee" },
      seams: [seam],
      findings,
      verifications,
      usages: [],
      cost: ZERO_COST,
      synthesis: "s",
    },
    erroredSeams: [],
    detectionCost: ZERO_COST,
    reviewCost: ZERO_COST,
    totalCost: ZERO_COST,
    coverage: { stack: "JavaScript/TypeScript", wellTuned: true, caveat: null },
  };
}

// Fixture: two verified crit/high, one lower verified, one non-verified, and XSS payloads.
const FIXTURE = mapFrom([
  { desc: `Webhook always returns 200 even on failure ${XSS}`, blast: "critical", verified: true, quote: `res.send(200) // ${XSS}` },
  { desc: "Duplicate checkout creates a second subscription", blast: "high", verified: true },
  { desc: "Error masking hides the real failure cause", blast: "medium", verified: true },
  { desc: "Cascade delete may be intended", blast: "critical", verified: false }, // judgment_call → must NOT be headline
]);

describe("renderSeamMapHtml — logic pins", () => {
  const html = renderSeamMapHtml(FIXTURE);

  it("HTML-escapes untrusted finding text (no raw <script> reaches the output)", () => {
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders exactly ONE full-detail headline card", () => {
    const cards = html.match(/data-headline-card/g) ?? [];
    expect(cards).toHaveLength(1);
  });

  it("puts the second crit/high finding in the collapsed list, not a second card", () => {
    // The high finding is verified crit/high but is NOT the top-ranked one, so it
    // must appear only in the collapsed section, never as a headline card.
    const headlineSection = html.slice(
      html.indexOf("data-headline-card"),
      html.indexOf("data-collapsed-list"),
    );
    expect(headlineSection).not.toContain("Duplicate checkout creates a second subscription");
    expect(html).toContain("Duplicate checkout creates a second subscription");
  });

  it("severity tally reflects the verified findings (2 crit? no — 1 crit, 1 high, 1 med verified)", () => {
    // Verified: critical(1) + high(1) + medium(1) = 3 verified issues. The
    // non-verified 'critical' judgment_call is NOT counted.
    expect(html).toMatch(/data-count-critical="1"/);
    expect(html).toMatch(/data-count-high="1"/);
    expect(html).toMatch(/data-count-medium="1"/);
    expect(html).toMatch(/data-verified-total="3"/);
  });

  it("does NOT select a non-verified finding as the headline", () => {
    const headlineSection = html.slice(
      html.indexOf("data-headline-card"),
      html.indexOf("data-collapsed-list") === -1 ? undefined : html.indexOf("data-collapsed-list"),
    );
    expect(headlineSection).not.toContain("Cascade delete may be intended");
  });
});
