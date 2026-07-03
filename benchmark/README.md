# Seam-Bug Benchmark

A known-answer benchmark for the bug class SeamStress targets: business-logic
failures at money, auth, and multi-tenant/safety seams. Each entry pairs a
small, self-contained code **fixture** with a machine-scorable **ground truth**
— the specific issues a correct review must surface, and the traps it must not
fall into. A scorer checks real SeamStress output against that ground truth.

The point is to measure the thing that's hard to measure: not "did the tool emit
findings," but "did it find the *right* seam issue and avoid the plausible-wrong
ones." An empty or evasive review scores as a **miss**, never a pass.

## What an entry is

Each entry is a directory under `entries/<id>/`:

- `entry.json` — metadata (id, title, seam_kind, difficulty, source, status).
- `fixture/` — the minimal code under review, self-contained (no reference to a
  live repo).
- `ground_truth.json` — the scoring contract: `must_find[]` (issues a correct
  review must surface) and `must_not_claim[]` (assertions a correct review must
  not make — the design-intent and cosmetic-fix traps).

See [`schema.md`](./schema.md) for the exact contract.

## How scoring works

The scorer (`scoring/score.ts`) consumes a **findings projection** — a JSON file
in the shape SeamStress's internal model produces (documented in `schema.md`) —
plus an entry id, and reports per entry: **hits** (must_find items a finding
matched), **misses**, and **false positives** (findings matching a
must_not_claim trap). A one-line summary reads `PASS` only when every must_find
is hit and there are zero false positives; anything else — including an empty
findings file — reads as `FAIL`.

Match criteria are designed **generous to phrasing, strict to substance**: a
required issue accepts many wordings ("quota", "rate limit", "account limit")
but still requires the real mechanism to be named, not a vague "might fail."

## Results ledger

Whether the tool finds an entry is recorded separately from whether the entry is
valid. Each entry's validity lives in its frozen `entry.json`; each *run* against
it appends a line to `results/<entry-id>.jsonl` (date, engine commit, mode,
outcome, scorer summary, cost). The ledger is public and append-only, **misses
included** — the point is to measure recall honestly over time, so `full`
(whole-pipeline) and `review-only` (judgment-only) runs are reported separately,
never blended. See [`schema.md`](./schema.md) for the field contract.

## Publishability

Every fixture must be publishable: **public-postmortem-derived or own-code
clean-room reconstruction only.** No proprietary or third-party code is copied
in. (Entry 001 is a clean-room reconstruction of an own-code pattern.)
