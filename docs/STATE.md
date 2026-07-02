# Project state

## Current state

The seam-bug benchmark's first rung is scaffolded. There is an entry contract
(`benchmark/schema.md`), an overview (`benchmark/README.md`), and a single-entry
scorer (`benchmark/scoring/score.ts`) wired to the engine's **real** finding
types via the types barrel — it scores a JSON *projection* of a run
(`{ seams:[{id,kind}], findings[], verifications[] }`), resolving each finding's
seam kind through its `seamId`. One seed entry exists — `001-cosmetic-key-isolation`
(a clean-room cosmetic-key-isolation fixture), status **draft**. The scorer is
proven by four synthetic cases (both-found / partial / wrong / empty); full suite
is 152 passing (15 files). SeamStress has **no machine-readable findings artifact**
today (it renders Markdown/HTML only), so projections are hand-authored for now.

## Next three tasks

1. **Score entry 001 against a real run and verify it.** Run SeamStress against
   `benchmark/entries/001-cosmetic-key-isolation/fixture/`, produce a findings
   projection, score it, and flip `status` to `verified` only if the ground truth
   is discoverable. *Prerequisite / enabling engine work:* teach the `map` runner
   to emit the projection JSON (a `--json` output), or hand-transcribe one run's
   findings into the projection shape for a one-off score. (Engine change — out of
   scope for the scaffold session that produced this doc.)
2. **Curate 3–5 postmortem-derived entries** (Claude + Nate task, not Claude
   Code) — real public incidents mapped to fixtures + ground truth.
3. **Decide the benchmark's public home** — in-repo vs. a separate repo — before
   launch.

## Open anomalies

- **No tenant seam kind.** The product thesis names money/auth/tenant seams, but
  the `SeamKind` enum has no tenant kind (`auth`, `money_path`, `pii`,
  `data_deletion`, `safety_delivery`, `other`). Decide before launch: add a kind,
  or document that tenant seams map to `pii`/`other`. (Tenant benchmark entries
  are not expressible until then.)
- **`benchmark/` is outside `npm run typecheck` scope.** `tsconfig` `include` is
  `src/**`, so the scorer is exercised by vitest and tsx but not by `tsc
  --noEmit`. Consider a `benchmark/` tsconfig (or widening `include`) before the
  benchmark grows.
