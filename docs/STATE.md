# Project state

## Current state

Rung 6 complete: the trap matcher was redesigned. The systemically-flawed
vocabulary-co-occurrence `all_of` traps are replaced by **`asserted_claim`** —
bound-span (a predicate asserted OF a subject within N chars) + negation guard
on the plain form + a scope-bound form (the negation IS the claim, requiring a
global-scope marker, guard not applied) + word-boundary term matching. **All ten
`must_not_claim` traps across the five entries are migrated.** A **24-string
frozen corpus** (`benchmark/scoring/fixtures/trap-corpus.json` — Nate-approved,
vocabulary-audited; the three real rung-5 FP findings verbatim on the
must-not-fire side, must-fire side in finding-prose) is committed as the
permanent regression suite, driving the 10 trap specs in `trap-specs.json`.

Suite 193 green; typecheck clean; empty-projection sweep unchanged (FAIL
2/2/1/1/2 — no `must_find` scoring touched; `all_of`/`groupsMatch` logic
untouched). The migration passed the frozen oracle, then a **pre-existing rung-1
test** caught one coverage gap (literal terms lost the old regex reach on
"separate critical API key"), which was fixed and folded into the corpus (23→24).

**No validity flips — 002–005 stay `proposed`.** The traps are redesigned but no
entry has been re-run against real output under them; 002/003's earlier `found`
were scored by the old flawed traps and must be re-confirmed.

## Next three tasks

1. **Bait-fixture session — now TWO deliverables:** (a) validate trap RECALL
   (does a trap fire on a real wrong claim? — currently unmeasured, §residuals),
   and (b) collect the first real wrong-claim specimens to test the pre-registered
   precursor hypotheses (below).
2. **Resume validation runs on 002–005** under the migrated traps — re-run 004,
   first-run 005, and make the per-entry `validated`/`proposed` decisions.
3. **Full-pipeline runs on 002–005 + run-all aggregation harness** — extend the
   recall ledger with `full`-mode rows and add a runner scoring every entry
   (keeping `full` vs `review-only` separate).

## Pre-registered hypotheses

Precursor candidates for wrong-claim findings, registered **before any real
specimen exists**, to be tested when the bait-fixture session produces one:

1. **Specificity decay** — wrong claims anchor less (fewer concrete
   function/file/behavior citations, prescriptions without a causal mechanism).
2. **Cross-finding contradiction** — a wrong claim disproportionately conflicts
   with a correct finding in the same run.
3. **Verification-status correlation** — wrong claims disproportionately land
   `unverified`/`judgment_call` rather than `verified_real`.

**NOTE:** verification status is an annotation and a hypothesis, **never the trap
oracle** — grading the tool with the tool's own verifier is circular and stays
forbidden.

## Open anomalies

- **~~Trap mechanism systemically flawed.~~** RESOLVED (rung 6) — vocabulary
  co-occurrence replaced by `asserted_claim` (bound-span + negation guard on the
  plain form + scope-bound form + word boundaries). All ten traps migrated; the
  24-string frozen corpus (3 real FP findings verbatim) is the permanent
  regression suite. The investigation measured the old shape firing on **9/10**
  correct rejections; the new one fires on **0/10** while still firing on every
  genuine wrong-claim in the corpus.

  **Residual risks (explicit — this is a PRECISION fix, not a complete one):**
  - **(a) Scope-form false negative.** A global wrong claim phrased *without* a
    scope marker passes. Demonstrated live twice: "neither path has idempotency"
    (fires=false in 003's proof), and the "shared cache is the same" phrasing risk
    noted in 005's. The scope form trades this FN for the scoped-statement FP it
    exists to prevent.
  - **(b) Negator list is best-effort.** Non-lexical negation ("hardly adequate",
    "far from sufficient", irony) can slip past the guard.
  - **(c) Per-trap N overrides are corpus-derived, not principled.** Each `within`
    is the value that separated *this* trap's frozen strings (004-neighboring
    needed N=40 for a 52-char wrong-subject sentence). **N-value drift across
    future entries is the early-warning signal that character-distance binding is
    reaching its limit.**
  - **(d) Zero-true-positive gap STILL OPEN.** Trap *recall* is unvalidated
    against real output; the must-fire corpus is hand-written. The one exception
    is the rung-1 `score.test.ts` case that caught the coverage gap — the only
    true-positive coverage not authored this morning.
  - **(e) Literal-term brittleness.** Multi-word subject/predicate terms don't
    span interposed words ("separate critical API key" defeated "separate key").
    One instance found by an independent test and fixed; other traps' vocabularies
    plausibly carry the same gap, undetectable until real must-fire cases exist —
    which the bait-fixture session now also serves.

  Calibration from rung 5 (registered prediction vs. actual, primary must_find):
  | entry | prediction | actual |
  |---|---|---|
  | 002 | ~45% PARTIAL / ~45% FULL | FULL (correct) |
  | 003 | ~85% FOUND | first-pass MISS (prediction wrong; matcher too strict) |
  | 004 | ~85% FOUND | FOUND (correct) |
- **~~No tenant seam kind.~~** RESOLVED — the anomaly read: *"the `SeamKind` enum
  has no tenant kind … Decide before launch: add a kind, or document that tenant
  seams map to `pii`/`other`."* Decided: added `tenant_isolation` (label
  "Cross-tenant data"); entry 005 exercises it end to end.
- **002–005 validity still unconfirmed.** The matcher redesign (rung 6) is done,
  but no entry has been re-run against real output under the migrated traps.
  002/003's earlier `found` were scored by the old flawed traps; they must be
  re-confirmed. Validity decisions resume in the next validation session (re-run
  004, first-run 005).
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
