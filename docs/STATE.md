# Project state

## Current state

The seam-bug benchmark now has a machine-readable path end to end and one real
scored run on record. The `map` runner emits the scorer's projection via
`--json` (`projectSeamMap`, `src/engine/projection.ts`); the scorer is
type-checked under `npm run typecheck` (separate `benchmark/tsconfig.json`) and
rejects degenerate `all_of` groups. Full suite is 158 passing (16 files).

**First real scored run (entry 001, `$0.00`, 0 tokens):** the pre-registered
prediction — `candidatesFound: 0`, break-point (a) — was confirmed exactly. The
detector's pre-filter surfaced no candidate from the three flat, keyword-free
fixture files, so the emitted projection was empty and the scorer correctly
reported `FAIL` with both `must_find` items listed as misses (never a silent
pass). Entry 001 stays **draft** — the miss is a detector-recall datum, not a
fixture or ground-truth defect, and the freeze held (nothing nudged to pass).

Note: the **populated-projection path** (real findings flowing through `--json`
into the scorer) is proven by the synthetic contract test only; the first
real-repo run that actually produces findings will close it.

## Next three tasks

1. **Design the validity / detector-results status split and apply it to entry
   001.** Resolve the status-rule circularity (see open anomalies): separate an
   entry's VALIDITY (bug real, ground truth correct — human/incident-evidenced)
   from recorded DETECTOR RESULTS per run/engine-version. Schema change — design
   deliberately, not inline.
2. **Stage-isolated scoring mode.** Run the review pipeline directly on entry
   001's seam, bypassing detection, to decompose detection-recall vs
   judgment-recall (~$0.30, gated on approval).
3. **Curate 3–5 postmortem-derived entries** (Claude + Nate task, not Claude
   Code) — real public incidents mapped to fixtures + ground truth.

## Open anomalies

- **No tenant seam kind.** The product thesis names money/auth/tenant seams, but
  the `SeamKind` enum has no tenant kind (`auth`, `money_path`, `pii`,
  `data_deletion`, `safety_delivery`, `other`). Decide before launch: add a kind,
  or document that tenant seams map to `pii`/`other`. (Tenant benchmark entries
  are not expressible until then.)
- **~~`benchmark/` is outside `npm run typecheck` scope.~~** RESOLVED — a
  separate `benchmark/tsconfig.json` scoped to `scoring/` is now wired into the
  `typecheck` script. (Residual gap: `scoring/**/*.test.ts` is excluded, so the
  scorer's own test file is exercised by vitest but not by `tsc`.)
- **Pre-filter floor on keyword-free fixtures.** Keyword-free, flat-path
  fixtures score 0 on the detector's heuristic and never reach judgment.
  Difficulty-3 entries (context-dependent bugs with no signal vocabulary)
  systematically die at detection — the same species as the Django ~40% recall
  lesson from Build 3. Implication: **detection recall bounds total recall for
  exactly the bug class the tool most wants to catch.** Entry 001's first run is
  the concrete instance.
- **Status-rule circularity.** The rule "`verified` = a real run confirms
  discoverability" means the benchmark can never certify a known-miss entry — it
  could only ever contain what the tool already finds, defeating the point of a
  known-answer benchmark. Needs a taxonomy split: entry **VALIDITY** (the bug is
  real and the ground truth correct — human/incident-evidenced; entry 001
  qualifies today) vs. recorded **DETECTOR RESULTS** per run / engine-version. A
  schema change to design next session, not inline.
