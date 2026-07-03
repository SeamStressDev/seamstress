# Project state

## Current state

Rung 5 halted deliberately mid-session after a systemic finding (see headline
anomaly). Review-only runs were executed against 002–004; entry 001's ledger
recall decomposition stands. **All of 002–005 remain `proposed`** — no validity
flips this session, because validation was proceeding by hand-patching traps per
entry, and three consecutive false positives revealed the trap *mechanism* is
flawed, not the individual traps. Patching further would be tuning ground truth
until the tool passes.

Ledger now carries the runs (5 review-only rows, misses and partials included),
with a new `ground_truth_commit` field making pre-fix/post-fix scoring traceable:
- 002: partial (2/2 hit, 1 FP) → found (0 FP) after tightening one trap (`8ba9c57`).
- 003: missed (matcher too strict AND trap too loose) → found after fixing both
  (`a5aa69e`, `ee9e33a`).
- 004: partial (1/1 hit, 1 FP) — left as a recorded partial once the trap flaw
  was known systemic.

The bug the tool found was correct in every case; the failures were in the
ground-truth matching mechanism.

## Next three tasks

1. **Read-only investigation of the trap-matching failures.** Corpus: the three
   real FP findings verbatim (002 finding-3, 003 finding-1, 004 finding-1) + all
   ten trap definitions + the scored runs. Deliver: (a) characterization of the
   failure classes — note they are NOT one class: 002/004 are
   negation/wrong-subject failures, 003 is a SCOPE failure (an affirmative,
   correctly-scoped statement misread as global), so any single-mechanism fix
   must be checked against all three; (b) paper-evaluation of candidate
   mechanisms (incl. the `asserted_claim` subject/predicate-binding sketch and
   alternatives) against the full corpus BEFORE any scorer code; (c) prior-art
   check in the engine's existing matching internals; (d) note that ZERO
   true-positive trap firings have ever been observed — all true-positive
   behavior is hand-written controls only — so the investigation must also
   address how real wrong-claim findings can be obtained or simulated. Design
   and implementation FOLLOW this investigation.
2. **Resume validation after the redesign** — re-run 004, run 005 for the first
   time, and make the per-entry `validated`/`proposed` decisions on the
   redesigned mechanism.
3. **Full-pipeline runs on 002–005 + run-all aggregation harness** — extend the
   recall ledger with `full`-mode rows and add a runner scoring every entry
   (keeping `full` vs `review-only` separate).

## Open anomalies

- **Trap mechanism systemically flawed (HEADLINE).** Vocabulary co-occurrence
  (`all_of` groups) cannot bind predicate to subject or detect negation; three
  consecutive case-(b) false positives (002 finding-3, 003 finding-1, 004
  finding-1) where the tool made the *correct* point and the trap fired on word
  co-occurrence. **No trap has ever fired correctly on real output — zero true
  positives observed across all runs; trap true-positive behavior is validated
  only by hand-written control strings.** Next task: read-only investigation (see
  next tasks); `asserted_claim` is a candidate mechanism, not a decision.

  Calibration (registered prediction vs. actual, primary must_find item):
  | entry | prediction | actual |
  |---|---|---|
  | 002 | ~45% PARTIAL / ~45% FULL | FULL (correct) |
  | 003 | ~85% FOUND | first-pass MISS (prediction wrong; matcher too strict) |
  | 004 | ~85% FOUND | FOUND (correct) |
- **~~No tenant seam kind.~~** RESOLVED — the anomaly read: *"the `SeamKind` enum
  has no tenant kind … Decide before launch: add a kind, or document that tenant
  seams map to `pii`/`other`."* Decided: added `tenant_isolation` (label
  "Cross-tenant data"); entry 005 exercises it end to end.
- **002–005 validity still unconfirmed.** 002 and 003 reached a clean `found`
  only via hand-patched traps now deemed unreliable; 004 is a recorded partial;
  005 has not run. Validity decisions are **blocked on the matcher redesign**.
  Correction to the rung-4 note: the "bite-risk" looseness was not confined to
  the three flagged traps — it is the whole mechanism; every trap regex needs the
  same scrutiny under the redesign.
- **Detector kind list omits `tenant_isolation`.** The detection prompt's kind
  list is unchanged, so full-pipeline runs cannot classify tenant seams until the
  detection-signal work lands; review-only runs are unaffected (`seam.json`
  carries the kind explicitly).
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
