# Project state

## Current state

Rung 3 complete: the benchmark now separates entry validity from detector
results, and has a real decomposition result on record. `entry.json` carries
`validity: proposed|validated` + `validity_evidence` (entry 001 is `validated`
with own-code clean-room attestation); detector outcomes live in an append-only
public ledger, `benchmark/results/<entry-id>.jsonl`. Both runner emitters ship
(`map --json` → `projectSeamMap`, `review --json` → `projectReview`). Full suite
is 162 passing (16 files); typecheck covers the scorer.

**Ledger has two rows for entry 001, and together they decompose the recall:**
- `full` / **missed** (2026-07-02, engine `9ea4d8a`, $0): the pre-filter never
  surfaced the seam — break-point (a).
- `review-only` / **found** (2026-07-03, engine `40efa46`, $0.15): handed the
  seam directly, the review pipeline hit both `must_find` items with zero false
  positives.

So **entry 001's gap is 100% detection-recall, 0% judgment-recall** — judgment
catches it once the seam arrives; detection never delivers it. The pre-registered
65/35 prediction (that judgment would find it) resolved **CORRECT**. One nuance
worth keeping: the shared-quota finding landed `judgment_call`, not
`verified_real` — the pipeline honestly bounded the provider-behavior assumption
(code documents shared-*account*, not shared-*limit*) — which validates the
scorer's record-don't-gate design (the hit counts; the residual uncertainty is
recorded, not laundered into a false certainty).

## Next three tasks

1. **Curate 3–5 postmortem-derived entries** (Claude + Nate task, not Claude
   Code) — real public incidents mapped to fixtures + ground truth. These are
   the entries the detector was **not** tuned against (see teach-to-the-test
   anomaly), so they carry the honest recall signal.
2. **Tenant `SeamKind` decision** — add a kind or document that tenant seams map
   to `pii`/`other`; tenant entries aren't expressible until resolved.
3. **Design the structural / second-channel detection signal** — surface subtle,
   keyword-free money/auth/safety seams the pre-filter currently scores 0. Note:
   this work is explicitly **informed by entry 001**, which reclassifies 001 from
   a recall test to a regression case (per the teach-to-the-test anomaly).

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
- **~~Status-rule circularity.~~** RESOLVED — `status` was replaced by
  `validity` (proposed/validated, entry-level, evidence-backed) plus the
  append-only results ledger (detector outcomes per run/engine-version). The
  benchmark can now hold entries the tool currently misses.
- **Teach-to-the-test risk.** Any detection improvement motivated by entry 001
  converts it from a recall test into a regression test — once the detector is
  tuned to surface 001, 001 finding it proves nothing about recall. Honest recall
  claims require entries the detector was **not** tuned against. Track which
  entries informed which detector changes (entry 001 is already spent on the
  next-task-3 detection work).
