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
