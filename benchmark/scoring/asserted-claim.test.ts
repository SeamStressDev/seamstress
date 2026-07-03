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
 * Candidate-B trap matcher (`asserted_claim`) proven against the FROZEN oracle
 * corpus (`fixtures/trap-corpus.json`) using the ten trap specs
 * (`fixtures/trap-specs.json`). The corpus's must-not-fire side includes the
 * three REAL false-positive findings from rung 5 verbatim; its must-fire side is
 * genuine wrong-claims in finding-prose. Every trap must separate the two.
 * The mechanism passes the full corpus BEFORE any trap migrates (rung 6 Phase 3).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertedClaimMatches, scoreEntry } from "./score.js";
import type { AssertedClaim, FindingsProjection, GroundTruth } from "./score.js";

const at = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const corpus = JSON.parse(readFileSync(at("./fixtures/trap-corpus.json"), "utf8")) as Record<
  string,
  { no_fire: string[]; fire: string[] }
>;
const specs = JSON.parse(readFileSync(at("./fixtures/trap-specs.json"), "utf8")) as Record<
  string,
  AssertedClaim
>;

describe("asserted_claim — separates the frozen oracle corpus for all ten traps", () => {
  // Underscore-prefixed keys (e.g. _within_rationale) are documentation, not traps.
  for (const trap of Object.keys(specs).filter((k) => !k.startsWith("_"))) {
    describe(trap, () => {
      const spec = specs[trap]!;
      const c = corpus[trap]!;
      it.each(c.no_fire.map((s, i) => [i, s] as const))(
        "does NOT fire on correct-rejection #%i",
        (_i, s) => {
          expect(assertedClaimMatches(s, spec)).toBe(false);
        },
      );
      it.each(c.fire.map((s, i) => [i, s] as const))(
        "DOES fire on genuine wrong-claim #%i",
        (_i, s) => {
          expect(assertedClaimMatches(s, spec)).toBe(true);
        },
      );
    });
  }
});

describe("asserted_claim — the two bugs the corpus caught", () => {
  const ac: AssertedClaim = { subject: ["guard"], predicate: ["adequate"], within: 40 };

  it("word boundary: subject 'guard' does not match inside 'safeguard'", () => {
    // 'safeguard is adequate' must NOT fire (guard is not a word here);
    // 'the guard is adequate' must fire.
    expect(assertedClaimMatches("the safeguard is adequate here", ac)).toBe(false);
    expect(assertedClaimMatches("the guard is adequate here", ac)).toBe(true);
  });

  it("contraction negator requires an apostrophe (so 'document' is not a negator)", () => {
    const spec: AssertedClaim = { subject: ["fix"], predicate: ["replace"], within: 40 };
    // A trailing word ending in 'nt' must not be read as a negation:
    expect(assertedClaimMatches("the fix is to replace the document identifier", spec)).toBe(true);
    // A real contraction near the span still suppresses:
    expect(assertedClaimMatches("the fix doesn't replace anything", spec)).toBe(false);
  });

  it("scope-bound form: negation guard does NOT apply (else the trap can never fire)", () => {
    const scoped: AssertedClaim = {
      subject: ["idempotency"],
      predicate: ["no"],
      scope: ["anywhere"],
      within: 40,
    };
    expect(assertedClaimMatches("there is no idempotency anywhere", scoped)).toBe(true);
    expect(assertedClaimMatches("there is no idempotency on this path", scoped)).toBe(false);
  });
});

describe("asserted_claim — validateItem rejects degenerate specs", () => {
  const proj: FindingsProjection = { seams: [], findings: [], verifications: [] };
  const gtWith = (ac: unknown): GroundTruth => ({
    must_find: [{ id: "mf", description: "d", match: { all_of: [["x"]] } }],
    must_not_claim: [{ id: "bad", description: "d", match: { asserted_claim: ac } as never }],
  });

  it("throws on an asserted_claim missing predicate terms", () => {
    expect(() => scoreEntry("001-cosmetic-key-isolation", proj, gtWith({ subject: ["k"], predicate: [] }))).toThrow(
      /missing subject or predicate/,
    );
  });

  it("throws on an empty asserted_claim term", () => {
    expect(() =>
      scoreEntry("001-cosmetic-key-isolation", proj, gtWith({ subject: ["k"], predicate: [""] })),
    ).toThrow(/empty asserted_claim term/);
  });
});
