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

**~~No validity flips — 002–005 stay `proposed`.~~** SUPERSEDED by the
validation session (see §Validation session below): 002/003/004 flipped to
`validated` on clean scorer PASSes under the migrated traps; 005 stays
`proposed` on a `partial` (must_find vocabulary gap, tool found the bug).

## Field-scope investigation (post-rung-6)

A follow-up task assumed the `asserted_claim` matcher scored only a finding's
`description` — a suspected recall hole, since a recommendation-shaped wrong
claim ("randomize the IDs") naturally lives in `reasoning`. **The premise did
not hold.** `findingText` (`score.ts`) already joins
`description + reasoning + consequence` with `"\n"`, and both `groupsMatch`
(must_find) and `assertedClaimMatches` (traps) run on it. There is no
`recommendation` field on `Finding`, and none is emitted anywhere in `src/` or
`benchmark/`. **No `score.ts` change was made** — nothing to widen; reasoning
was already in scope.

**Re-fire analysis — safe, measured against RECONSTRUCTIONS.** The three real
rung-5 FP findings were checked for trap vocabulary that, with `reasoning`/
`consequence` in scope, would re-fire a trap: all three come back SAFE with
margin. **Caveat, stated plainly:** this was measured against the
investigation's *reconstructed* multi-field texts, not pristine originals — the
rung-5 `/tmp` loss means the corpus's three FP strings are reconstructions. Safe
with margin, so the result stands; the record must not read as the clean
version. (Third time the lost-findings wound has cost confidence — the
persisted-path rule exists for exactly this.)

**Corpus grown 24 → 28.** The 24 originals were description-shaped and did not
exercise multi-field assembly. Four Nate-approved cross-field strings are frozen
in: three must-fire (004-randomizing, 002-fix-is-documentation, 005-caching)
whose wrong claim lives in `reasoning` — each misses under a *simulated*
description-only scope and hits under full text, proving multi-field scoring is
load-bearing — plus one must-not-fire **separator-crossing negation guard** (004:
randomization vocab in `description`, negated "not the fix" in `reasoning`, silent
*because of* the negator reaching across `"\n"`; strip the negator and it fires).

**Correction to the record.** All prior trap results — the precision redesign,
"9/10 fired on correct rejections", and the three FPs — were **already scored
against full finding text** (`description+reasoning+consequence`), not
description-only. They **stand**; they are not superseded. The "description-scoped
/ superseded by full-text scoping" framing rested on the incorrect premise above.

**Bait session UNBLOCKED.** Because the matcher reads `reasoning`, a
recommendation-shaped wrong claim in a finding's reasoning is catchable — the
recall test is valid, not confounded by a field-scope hole.

## Bait-fixture session (hard bait, pre-committed 3-run cap — COMPLETE)

`benchmark/bait/idor-randomization/` — support-ticket attachment viewer,
sequential IDs loud (seed 4471–4473, counter comment, upload echoes new id,
stats route exposes running count), missing ownership check quiet (structural,
uncommented, no contrasting checked route). Nate-audited against the assembled
inputText: confession-clean. Excluded from the benchmark proper and all entry
statistics (`benchmark/bait/README.md` + main README section). All three runs
persisted verbatim to `benchmark/bait/idor-randomization/runs/run-N.{projection.json,log}`
with byte-identical projection↔log cross-checks before each run counted.

**Headline: the tool resisted deliberate hard baiting toward the randomization
wrong-fix across 3 independent runs on a fixture engineered to tempt it.** Zero
specimens. 13 findings total (4/4/5), every run centered on the missing
per-resource authorization check (Nate-ruled TOOL-CORRECT three-for-three).
Randomization was mentioned exactly once in three runs (run 3, finding-4) and
was explicitly subordinated: "not an access-control failure — it is an
amplifier … Even if authorization were added, opaque random IDs would be
preferable … architectural hardening concern." Runs 1–2 never raised
randomization at all — their trap silences are trivially-correct
(vocabulary-absent), not subordination events.

**Recall status — two claims, kept distinct:**
- **Recall-given-a-wrong-claim: evidenced with a known gap** ($0 deterministic
  probe, hand-written strings derived from real finding vocabulary — NOT tool
  output). The `004-randomizing-ids-is-the-fix` trap fired on 4/5 genuine
  wrong-claim variants across `fix/replace/recommend` × `random/uuid/
  unguessable`. The 5th — the most natural phrasing, "the fix is to replace the
  sequential IDs with random UUIDs **so they cannot be guessed**" — did NOT
  fire: the negation guard's 24-char tail window captures `cannot` from the
  claim's own success clause (a new over-suppression instance of residual risk
  (b), the FN direction — the documented (b) was the FP direction).
- **Recall-in-the-wild: UNELICITED.** The tool would not emit the claim; the
  zero-TP gap on real output remains open, honestly.
- Run 3's finding-4 is the first real-output true negative with subject
  vocabulary present: trap correctly silent on a genuinely subordinated
  mention. Mechanism traced: no predicate term in the finding ("would be
  **preferable**" is not in the predicate list) — correct silence, partly for a
  vocabulary reason; the matcher has no subordination concept. Registered gap:
  a wolf phrased "opaque random IDs would be preferable" as its primary fix
  would miss the trap. Also a live instance of residual risk (e): "opaque
  **random** IDs" defeats the literal term `opaque id` (interposed word);
  harmless here because `random` matched.

**Precursors (H1/H2/H3): untestable — no specimen to contrast.** What emerged
is a correct-finding baseline only, directional, n=13 findings/3 runs: H1
anchors 4–8 (primary finding 6/6/8 across runs; the weakest findings 4); H2
zero cross-finding contradictions in any run; H3 verifier status NOISY across
identical inputs (run 1: 3/4 judgment_call incl. a misfiring reachability-gate
boilerplate note; run 2: 1 judgment_call; run 3: 0) — status looks
nondeterministic, not informative, reinforcing that it must never be an oracle.

**Calibration (registered before run 1, author-bias noted): ~35%/run and
~70%/3-runs that a genuine wrong-claim would be elicited → resolved WRONG, 0/3,
un-rescued.** Baitability of the tool on this error was substantially
overestimated (prediction was Claude-authored; Nate judged specimens).

## Validation session (2026-07-03, engine_commit 514d674 — COMPLETE)

Four gated review-only runs (002/003/004/005, one clean scoring each, no
re-runs), scored against the migrated `asserted_claim` traps AS-IS. Artifacts
persisted and committed under `benchmark/results/runs/<entry>/2026-07-03-*`;
projection↔log verbatim cross-check passed before each run counted. Ledger rows
appended (005's is its first — file created). **4-of-5 entries now `validated`**
(001 prior + 002/003/004 today); **core validation loop CLOSED for money_path
and auth, OPEN for tenant_isolation** (005).

- **002 VALIDATED** — PASS 2/2, both hits `verified_real`, 0 FPs ($0.1279).
  Rung-5 contrast: same entry FAILed with an FP under the old vocabulary traps;
  clean PASS under the migrated ones — the precision redesign confirmed on the
  entry's own real output.
- **003 VALIDATED** — PASS 1/1 `verified_real`, 0 FPs ($0.0995). The live
  finding opened with near-identical phrasing to the rung-5 FP reconstruction
  on the corpus no-fire side ("chargeViaIntent attaches no idempotency key…"),
  and the scope-bound trap correctly held silent — the exact hazard shape the
  redesign was built for, live-tested (caveat: corpus string is a
  reconstruction, rung-5 /tmp loss).
- **004 VALIDATED** — PASS 1/1 `verified_real`, 0 FPs ($0.0639). Both traps
  live-exercised and held: prominent sequential-ID discussion framed
  amplifier-not-fix (randomizing trap silent — consistent with the bait
  session's 3 runs and the probe), explicit praise of getInvoice as "exactly
  the check that is missing here" (neighboring-route trap, the N=40 tightest
  override, silent). Scope note: the bait session exercised only the
  randomizing trap; the neighboring-route trap's real-output evidence is this
  run + the frozen corpus.
- **005 stays `proposed`** — FAIL 1/2, outcome `partial`, 0 FPs ($0.1051),
  first-ever run, tenant_isolation debut. **The tool FOUND the bug** —
  finding-1 (critical/high, `verified_real`): "a key that omits user identity",
  "cacheKey(path, query) never incorporates userId" — but the
  `identity-absent-from-cache-key` must_find missed on regex vocabulary in BOTH
  `all_of` groups: camelCase `cacheKey` defeats `cache .?key` (space required),
  and "omits user identity" / "never incorporates userId" are absent from the
  no/without/missing alternation. A must_find-side instance of the
  literal-vocabulary brittleness family (residual (e)); rung 6 hardened the
  trap matchers, not the must_find `groupsMatch` style. **QUEUED, not patched**
  (session no-edit rule): widen 005's must_find vocabulary, then a fresh gated
  run for the validity decision. The consequence must_find hit cleanly
  (2 findings, both `verified_real`).

An attempted mid-session ruling recorded 005 as "VALIDATED 2/2"; the scorer's
deterministic output on the persisted projection (sha256 d6a68f76…) is FAIL 1/2
and was reproduced for reconciliation before recording — the ledger carries the
scorer's verdict.

## Next three tasks

1. **Widen 005's must_find vocabulary** (`identity-absent-from-cache-key`:
   camelCase `cacheKey`, "omits", "never incorporates") + fresh gated run →
   validity decision; consider a must_find-side vocabulary audit across entries
   (same brittleness family as residual (e)).
2. **Full-pipeline runs on 002–005 + run-all aggregation harness** — extend the
   recall ledger with `full`-mode rows and add a runner scoring every entry
   (keeping `full` vs `review-only` separate; `bait/` stays excluded).
3. **Natural-error-rate study** — neutral (non-tempting) fixture, many runs;
   the bait session measured resistance under a stacked deck, which says
   nothing about natural rates. Queued alongside: annotated-vs-stripped-comment
   recall study, pre-flight skill.

## Pre-registered hypotheses

Precursor candidates for wrong-claim findings, registered **before any real
specimen exists**. The bait-fixture session produced ZERO specimens (3-run cap
exhausted), so all three remain UNTESTED — the session yielded only a
correct-finding baseline (see §Bait-fixture session). They stay registered for
whenever a real specimen first appears (e.g. the queued natural-rate study):

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
  - **(d) Zero-true-positive gap PARTIALLY RESOLVED (bait session).**
    Recall-given-a-wrong-claim is now evidenced: the 004 trap fired on 4/5
    hand-written genuine wrong-claims built from real run-output vocabulary
    (derived-from-output, NOT tool-emitted — the distinction is load-bearing),
    and held correctly silent on the one real subordinated mention (run 3
    finding-4). Two new FN-direction gaps registered from the same probe: a
    trailing "cannot be guessed"-type success clause feeds the negation guard
    (over-suppression), and "preferable" is missing from the predicate list.
    Recall-in-the-wild STAYS OPEN: three hard-bait runs elicited zero wrong
    claims (tool resisted), so no tool-emitted true positive exists yet.
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

  Calibration from the bait session (registered before run 1):
  | prediction | actual |
  |---|---|
  | ~35%/run, ~70%/3-runs a genuine wrong-claim is elicited | 0/3 — WRONG, un-rescued; baitability substantially overestimated |
- **~~No tenant seam kind.~~** RESOLVED — the anomaly read: *"the `SeamKind` enum
  has no tenant kind … Decide before launch: add a kind, or document that tenant
  seams map to `pii`/`other`."* Decided: added `tenant_isolation` (label
  "Cross-tenant data"); entry 005 exercises it end to end.
- **~~002–005 validity still unconfirmed.~~** MOSTLY RESOLVED (validation
  session, 2026-07-03): 002/003/004 `validated` on clean PASSes under the
  migrated traps against their own real output. Residual: 005 stays `proposed`
  on a must_find vocabulary miss (tool found the bug; instrument gap queued —
  see §Validation session).
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
