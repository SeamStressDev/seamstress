# Project state

## Current state

Rung 4 complete: the benchmark now has **five entries** spanning four seam
kinds, and the engine's `SeamKind` enum gained `tenant_isolation` to express the
tenant class. Entries: `001` cosmetic-key-isolation (`safety_delivery`,
**validated**); `002` conjunctive-suppression-unsafe-default (`money_path`);
`003` idempotency-coverage-asymmetry (`money_path`); `004`
missing-ownership-check-idor (`auth`); `005` identity-absent-cache-key
(`tenant_isolation`) — 002–005 all **proposed**, postmortem-derived from the
public seam-bug catalog. The `tenant_isolation` kind carries a "Cross-tenant
data" renderer label; `benchmark/schema.md`'s kind list was updated in the same
commit. Full suite 164 passing (16 files); typecheck clean.

Each new entry was authored verbatim from the rung-4 companion spec, validated
before commit (validateItem passes, empty projection scores FAIL with the exact
must_find miss count, byte-provenance of `seam.json` diff-clean against the
frozen fixtures), and committed one at a time. Entry 001's ledger still holds the
recall decomposition from rung 3 (full/missed + review-only/found → gap is 100%
detection-recall); 002–005 have no ledger rows yet — their review-only runs are
the next session.

## Next three tasks

1. **Gated review-only runs on 002–005** — run each seam through the review
   pipeline, score against ground truth, tighten the three bite-risk traps
   against the real findings, and flip each entry to `validated` as it clears.
2. **Full-pipeline runs on the same four** — extending the recall ledger with
   `full`-mode rows to decompose detection vs judgment recall per entry.
3. **Run-all aggregation harness** — now that multiple entries exist, a runner
   that scores every entry and reports a summary (keeping `full` vs
   `review-only` separate per the ledger rule).

## Open anomalies

- **~~No tenant seam kind.~~** RESOLVED — the anomaly read: *"the `SeamKind` enum
  has no tenant kind … Decide before launch: add a kind, or document that tenant
  seams map to `pii`/`other`."* Decided: added `tenant_isolation` (label
  "Cross-tenant data"); entry 005 exercises it end to end.
- **002–005 ground truth untested against real findings.** These entries scored
  only against empty/synthetic projections so far. Three bite-risk `must_not_claim`
  traps are deliberately loose pending the gated review-only runs: 002
  `fix-is-documentation-or-training`, 004 `randomizing-ids-is-the-fix`, 005
  `caching-authenticated-is-inherently-wrong`. They get tightened against real
  findings, not before.
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
