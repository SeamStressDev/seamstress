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
 * Proves the scorer against entry 001 with four hand-authored projections.
 * These are synthetic (not produced by running SeamStress — no API calls); each
 * one isolates a scoring path. The load-bearing case is #4: an empty result must
 * report as a miss/FAIL, never a silent pass.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scoreEntry } from "./score.js";
import type { FindingsProjection, GroundTruth } from "./score.js";

const at = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

const ENTRY = "001-cosmetic-key-isolation";
const groundTruth = JSON.parse(
  readFileSync(at(`../entries/${ENTRY}/ground_truth.json`), "utf8"),
) as GroundTruth;

const load = (name: string): FindingsProjection =>
  JSON.parse(readFileSync(at(`./fixtures/${name}`), "utf8")) as FindingsProjection;

describe("scoreEntry — entry 001 cosmetic key isolation", () => {
  it("both must_find present → 2/2 hits, 0 false positives, passes", () => {
    const r = scoreEntry(ENTRY, load("both-must-find.json"), groundTruth);
    expect(r.hits.length).toBe(2);
    expect(r.misses).toEqual([]);
    expect(r.falsePositives).toEqual([]);
    expect(r.passed).toBe(true);
    // effectiveStatus is annotated, not gated: f2 has real evidence, f1 none.
    const silent = r.hits.find((h) => h.itemId === "silent-critical-delivery-failure");
    expect(silent?.statuses).toContain("verified_real");
    const quota = r.hits.find((h) => h.itemId === "shared-quota-cosmetic-isolation");
    expect(quota?.statuses).toContain("unverified");
  });

  it("only the quota finding → exactly 1/2 hits, 1 miss, 0 false positives, fails", () => {
    const r = scoreEntry(ENTRY, load("only-quota.json"), groundTruth);
    expect(r.hits.map((h) => h.itemId)).toEqual(["shared-quota-cosmetic-isolation"]);
    expect(r.misses).toEqual(["silent-critical-delivery-failure"]);
    expect(r.falsePositives).toEqual([]);
    expect(r.passed).toBe(false);
  });

  it("plausible-but-wrong finding (flags the key split) → 0 hits, ≥1 false positive, fails", () => {
    const r = scoreEntry(ENTRY, load("wrong-only.json"), groundTruth);
    expect(r.hits).toEqual([]);
    expect(r.falsePositives.length).toBeGreaterThanOrEqual(1);
    expect(r.falsePositives.some((fp) => fp.itemId === "key-split-is-a-defect")).toBe(true);
    expect(r.passed).toBe(false);
  });

  it("empty findings → 0 hits, all must_find missed, reported as FAIL (never a silent pass)", () => {
    const r = scoreEntry(ENTRY, load("empty.json"), groundTruth);
    expect(r.hits).toEqual([]);
    expect(r.falsePositives).toEqual([]);
    expect(r.misses).toEqual([
      "shared-quota-cosmetic-isolation",
      "silent-critical-delivery-failure",
    ]);
    expect(r.passed).toBe(false);
    expect(r.summary).toContain("FAIL");
  });
});

describe("scoreEntry — ground-truth validation", () => {
  it("rejects an all_of containing an empty group, naming the offending item", () => {
    const bad: GroundTruth = {
      must_find: [
        { id: "degenerate", description: "d", match: { all_of: [["quota"], []] } },
      ],
      must_not_claim: [],
    };
    expect(() => scoreEntry(ENTRY, load("empty.json"), bad)).toThrow(/degenerate.*empty all_of group/);
  });

  it("accepts entry 001's real ground truth (over-rejection can't masquerade as success)", () => {
    // The real ground truth must still validate and score without throwing.
    const r = scoreEntry(ENTRY, load("both-must-find.json"), groundTruth);
    expect(r.passed).toBe(true);
  });
});

describe("scoreEntry — review-only projection shape (dry-scoring, $0, no API)", () => {
  // Shaped exactly as the review runner's projectReview() emits: a single seam
  // (id = the seam.json id, kind safety_delivery) plus findings/verifications.
  // Proves the review-only projection is scorer-compatible BEFORE any spend —
  // an incompatibility would otherwise surface only after the API money is gone.
  const reviewOnlyProjection: FindingsProjection = {
    seams: [{ id: "001-cosmetic-key-isolation", kind: "safety_delivery" }],
    findings: [
      {
        id: "001-cosmetic-key-isolation:f1",
        seamId: "001-cosmetic-key-isolation",
        description: "The dedicated critical-alert key shares the same provider account (acct_7fb2) as the bulk key.",
        blastRadius: "high",
        reasoning: "Both keys sit under one account and share its per-account send quota; the isolation between bulk and critical is cosmetic.",
      },
      {
        id: "001-cosmetic-key-isolation:f2",
        seamId: "001-cosmetic-key-isolation",
        description: "The critical alert can silently fail to deliver under bulk load.",
        blastRadius: "critical",
        reasoning: "The 429 is swallowed and sendCriticalAlert only logs, so a critical security alert is lost.",
      },
    ],
    verifications: [
      {
        findingId: "001-cosmetic-key-isolation:f2",
        status: "verified_real",
        evidence: [{ quotedCode: "if (!result.sent) { console.warn(...) }", location: { path: "notifications.ts", startLine: 20 } }],
        note: "Confirmed against the seam.",
      },
    ],
  };

  it("scores a review-only-shaped projection against entry 001's real ground truth to a known outcome", () => {
    const r = scoreEntry(ENTRY, reviewOnlyProjection, groundTruth);
    // Known outcome: both must_find hit, no false positives → PASS (the shape a
    // successful review-only run would produce). This is a shape-compat proof,
    // NOT a prediction about the real run.
    expect(r.hits.map((h) => h.itemId).sort()).toEqual([
      "shared-quota-cosmetic-isolation",
      "silent-critical-delivery-failure",
    ]);
    expect(r.misses).toEqual([]);
    expect(r.falsePositives).toEqual([]);
    expect(r.passed).toBe(true);
  });
});
