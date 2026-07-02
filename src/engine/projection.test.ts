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
 * Contract test for the --json projection emitter: the engine emits, the
 * benchmark scorer consumes. Proves not just that the pipe connects (scoreEntry
 * accepts the emitted projection) but that water flows — with a synthetic ground
 * truth crafted so the emitted finding HITS one criterion and MISSES another.
 */

import { describe, expect, it } from "vitest";
import { projectSeamMap } from "./projection.js";
import type { SeamMap } from "./map.js";
import type { Cost, Finding, Seam, VerificationResult } from "../types/index.js";
import { scoreEntry } from "../../benchmark/scoring/score.js";
import type { GroundTruth } from "../../benchmark/scoring/score.js";

const ZERO_COST: Cost = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCacheCreationInputTokens: 0,
  totalCacheReadInputTokens: 0,
  totalCostUsd: 0,
  costUsdByModel: {},
  costUsdByPurpose: { seam_detection: 0, critic: 0, synthesis: 0, verification: 0, other: 0 },
};

const seam: Seam = {
  id: "seam-1",
  kind: "safety_delivery",
  label: "notifications.ts",
  sources: [{ path: "notifications.ts", startLine: 1, endLine: 24 }],
  inputText: "…the full assembled seam text, which the projection must NOT carry…",
};

const findings: Finding[] = [
  {
    id: "seam-1:f1",
    seamId: "seam-1",
    description: "The critical alert can silently fail to deliver under bulk load.",
    blastRadius: "high",
    reasoning: "The 429 is swallowed and sendCriticalAlert only logs, so a critical security alert is lost.",
  },
];

const verifications: VerificationResult[] = [
  {
    findingId: "seam-1:f1",
    status: "verified_real",
    evidence: [{ quotedCode: "if (!result.sent) { console.warn(...) }", location: { path: "notifications.ts", startLine: 20 } }],
    note: "Confirmed against the fixture.",
  },
];

const map: SeamMap = {
  repoPath: "/fixture",
  filesScanned: 3,
  candidatesFound: 1,
  seams: [seam],
  review: {
    target: { repo: "fixture", commit: "test" },
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

describe("projectSeamMap — the --json emitter", () => {
  const projection = projectSeamMap(map);

  it("projects seams to { id, kind } only, dropping label/sources/inputText", () => {
    expect(projection.seams).toEqual([{ id: "seam-1", kind: "safety_delivery" }]);
    expect(projection.seams[0]).not.toHaveProperty("inputText");
    expect(projection.seams[0]).not.toHaveProperty("sources");
  });

  it("passes findings and verifications through unchanged", () => {
    expect(projection.findings).toEqual(findings);
    expect(projection.verifications).toEqual(verifications);
  });

  it("round-trips through JSON unchanged", () => {
    expect(JSON.parse(JSON.stringify(projection))).toEqual(projection);
  });

  it("is consumed by the benchmark scorer, hitting one criterion and missing another", () => {
    const groundTruth: GroundTruth = {
      must_find: [
        {
          id: "hit-me",
          description: "silent critical-delivery failure on a safety_delivery seam",
          match: {
            seam_kind: "safety_delivery",
            blast_radius_min: "high",
            all_of: [
              ["silent", "swallow", "fail", "lost"],
              ["critical alert", "critical security"],
            ],
          },
        },
        {
          id: "miss-me",
          description: "an unrelated money-path claim not present in the finding",
          match: { all_of: [["refund", "chargeback", "double charge"]] },
        },
      ],
      must_not_claim: [],
    };

    const score = scoreEntry("synthetic", projection, groundTruth);

    expect(score.hits.map((h) => h.itemId)).toEqual(["hit-me"]);
    expect(score.misses).toEqual(["miss-me"]);
    // Verification status flows through the projection too: f1 has real evidence.
    expect(score.hits[0]?.statuses).toContain("verified_real");
    expect(score.falsePositives).toEqual([]);
    expect(score.passed).toBe(false); // one miss → not a pass
  });
});
