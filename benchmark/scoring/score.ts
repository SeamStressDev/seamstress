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
 * Seam-Bug Benchmark — scorer (single entry).
 *
 * Scores ONE benchmark entry against a SeamStress findings *projection* (see
 * schema.md): { seams: [{id, kind}], findings: Finding[], verifications: [] }.
 * `findings`/`verifications` use the engine's real internal types, imported here
 * so the benchmark scores the true contract rather than a copy that can drift.
 *
 * This rung: one entry at a time (no cross-entry aggregation). Each hit is
 * annotated with its finding's effectiveStatus but NOT gated on it — record the
 * verification status, don't judge it (verification-gating is a later rung).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { effectiveStatus } from "../../src/types/index.js";
import type {
  Finding,
  VerificationResult,
  SeamKind,
  VerificationStatus,
  BlastRadiusRank,
} from "../../src/types/index.js";

/** The minimal machine-readable projection the scorer consumes (see schema.md). */
export interface FindingsProjection {
  seams: { id: string; kind: SeamKind }[];
  findings: Finding[];
  verifications: VerificationResult[];
}

/** One match criterion — generous to phrasing, strict to substance. */
export interface MatchCriteria {
  /** Finding's seam kind (resolved via seamId) must equal this, if set. */
  seam_kind?: SeamKind;
  /** Finding's blastRadius must be at least this severe, if set. */
  blast_radius_min?: BlastRadiusRank;
  /** A finding location path must match this regex (case-insensitive), if set. */
  file?: string;
  /**
   * Substance gate: alternative-groups. Each group passes if ANY of its regexes
   * matches the finding text (description + reasoning + consequence); ALL groups
   * must pass. Lets many phrasings of one concept count while still requiring a
   * second concept (e.g. shared-account) to co-occur.
   */
  all_of?: string[][];
}

export interface GroundTruthItem {
  id: string;
  description: string;
  match: MatchCriteria;
}

export interface GroundTruth {
  must_find: GroundTruthItem[];
  must_not_claim: GroundTruthItem[];
}

const BLAST_ORDER: Record<BlastRadiusRank, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** True when a criterion constrains nothing — it would match every finding. */
function criteriaIsEmpty(m: MatchCriteria): boolean {
  return (
    m.seam_kind === undefined &&
    m.blast_radius_min === undefined &&
    m.file === undefined &&
    (m.all_of === undefined || m.all_of.every((g) => g.length === 0))
  );
}

function compileOrThrow(pattern: string, itemId: string): void {
  try {
    new RegExp(pattern, "i");
  } catch (e) {
    throw new Error(
      `ground-truth item "${itemId}" has an invalid regex ${JSON.stringify(pattern)}: ${(e as Error).message}`,
    );
  }
}

/** Reject hand-authoring accidents before they produce vacuous hits/FPs. */
function validateItem(item: GroundTruthItem): void {
  if (criteriaIsEmpty(item.match)) {
    throw new Error(
      `ground-truth item "${item.id}" has no match criteria — set at least one of ` +
        `seam_kind, blast_radius_min, file, or a non-empty all_of`,
    );
  }
  if (item.match.file !== undefined) compileOrThrow(item.match.file, item.id);
  for (const group of item.match.all_of ?? []) {
    if (group.length === 0) {
      throw new Error(
        `ground-truth item "${item.id}" has an empty all_of group — a group with no ` +
          `alternatives can never match; remove it or add patterns`,
      );
    }
    for (const rx of group) compileOrThrow(rx, item.id);
  }
}

function findingText(f: Finding): string {
  return [f.description, f.reasoning, f.consequence ?? ""].join("\n");
}

function groupsMatch(text: string, groups: string[][]): boolean {
  return groups.every((alts) => alts.some((rx) => new RegExp(rx, "i").test(text)));
}

/** Does one finding satisfy one criterion? */
function findingMatches(
  finding: Finding,
  criteria: MatchCriteria,
  kindById: Map<string, SeamKind>,
): boolean {
  if (criteria.seam_kind !== undefined && kindById.get(finding.seamId) !== criteria.seam_kind) {
    return false;
  }
  if (
    criteria.blast_radius_min !== undefined &&
    BLAST_ORDER[finding.blastRadius] < BLAST_ORDER[criteria.blast_radius_min]
  ) {
    return false;
  }
  if (criteria.file !== undefined) {
    const rx = new RegExp(criteria.file, "i");
    const paths = finding.locations?.map((l) => l.path) ?? [];
    if (!paths.some((p) => rx.test(p))) return false;
  }
  if (criteria.all_of !== undefined && criteria.all_of.length > 0) {
    if (!groupsMatch(findingText(finding), criteria.all_of)) return false;
  }
  return true;
}

export interface Hit {
  itemId: string;
  findingIds: string[];
  /** effectiveStatus of each matched finding — recorded, not gated on. */
  statuses: VerificationStatus[];
}

export interface FalsePositive {
  itemId: string;
  findingId: string;
}

export interface EntryScore {
  entryId: string;
  hits: Hit[];
  misses: string[];
  falsePositives: FalsePositive[];
  passed: boolean;
  summary: string;
}

/** Score one entry's projection against its ground truth. Pure; testable. */
export function scoreEntry(
  entryId: string,
  projection: FindingsProjection,
  groundTruth: GroundTruth,
): EntryScore {
  for (const item of [...groundTruth.must_find, ...groundTruth.must_not_claim]) {
    validateItem(item);
  }
  const kindById = new Map(projection.seams.map((s) => [s.id, s.kind]));

  const hits: Hit[] = [];
  const misses: string[] = [];
  for (const item of groundTruth.must_find) {
    const matched = projection.findings.filter((f) => findingMatches(f, item.match, kindById));
    if (matched.length > 0) {
      hits.push({
        itemId: item.id,
        findingIds: matched.map((f) => f.id),
        statuses: matched.map((f) => effectiveStatus(f, projection.verifications)),
      });
    } else {
      misses.push(item.id);
    }
  }

  const falsePositives: FalsePositive[] = [];
  for (const item of groundTruth.must_not_claim) {
    for (const f of projection.findings) {
      if (findingMatches(f, item.match, kindById)) {
        falsePositives.push({ itemId: item.id, findingId: f.id });
      }
    }
  }

  const passed = hits.length === groundTruth.must_find.length && falsePositives.length === 0;
  // A result with any miss or any false positive is a FAIL, not a pass — an
  // empty findings projection lands here with all must_find items as misses.
  const summary =
    `[${entryId}] ${passed ? "PASS" : "FAIL"} — ` +
    `${hits.length}/${groundTruth.must_find.length} must_find hit, ` +
    `${misses.length} missed, ${falsePositives.length} false positive(s)`;

  return { entryId, hits, misses, falsePositives, passed, summary };
}

// ── CLI: score.ts <findings-projection.json> <entryId> ──────────────────────
// Exit codes: 0 = passed, 2 = scored but not passed (miss/FP), 1 = usage/IO/ground-truth error.
function main(argv: string[]): number {
  const [findingsPath, entryId] = argv;
  if (!findingsPath || !entryId) {
    console.error("Usage: score.ts <findings-projection.json> <entryId>");
    return 1;
  }
  let projection: FindingsProjection;
  let groundTruth: GroundTruth;
  try {
    projection = JSON.parse(readFileSync(findingsPath, "utf8")) as FindingsProjection;
  } catch (e) {
    console.error(`Could not read findings projection at ${findingsPath}: ${(e as Error).message}`);
    return 1;
  }
  try {
    const gtUrl = new URL(`../entries/${entryId}/ground_truth.json`, import.meta.url);
    groundTruth = JSON.parse(readFileSync(gtUrl, "utf8")) as GroundTruth;
  } catch (e) {
    console.error(`Could not read ground truth for entry ${entryId}: ${(e as Error).message}`);
    return 1;
  }

  let score: EntryScore;
  try {
    score = scoreEntry(entryId, projection, groundTruth);
  } catch (e) {
    console.error(`Scoring failed: ${(e as Error).message}`);
    return 1;
  }

  console.log(score.summary);
  for (const h of score.hits) {
    console.log(`  hit:  ${h.itemId} — findings [${h.findingIds.join(", ")}] (status: ${h.statuses.join(", ")})`);
  }
  for (const m of score.misses) {
    console.log(`  MISS: ${m}`);
  }
  for (const fp of score.falsePositives) {
    console.log(`  FALSE POSITIVE: finding ${fp.findingId} matched must_not_claim "${fp.itemId}"`);
  }
  return score.passed ? 0 : 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
