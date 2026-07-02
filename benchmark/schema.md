# Entry & scoring contract

## Directory layout

    benchmark/entries/<id>/
      entry.json
      fixture/            # the code under review (self-contained)
      ground_truth.json

## entry.json

| field       | type   | notes                                                        |
|-------------|--------|--------------------------------------------------------------|
| `id`        | string | matches the directory name, e.g. `001-cosmetic-key-isolation`|
| `title`     | string | short human label                                            |
| `seam_kind` | enum   | **the engine's real `SeamKind` values, verbatim:** `auth`, `money_path`, `pii`, `data_deletion`, `safety_delivery`, `other` |
| `difficulty`| 1–3    | 1 = flaw visible in a single file; 2 = flaw only visible across files/components; 3 = flaw requires runtime/account/quota context not stated in the code |
| `source`    | string | commit ref, postmortem URL, or `"own-code-derived (clean-room)"` |
| `status`    | enum   | `draft` \| `verified`                                        |

**Status rule:** `verified` may only be set after a real SeamStress run against
the fixture has confirmed the ground truth is discoverable. **New entries always
start as `draft`.**

Note on `seam_kind`: the values are the engine's internal `SeamKind`
(`src/types/seam.ts`). There is deliberately **no** tenant/multi-tenant kind
today; tenant entries are not yet expressible and are out of scope for this rung
(tracked in `docs/STATE.md` open anomalies).

## ground_truth.json

Two arrays, `must_find[]` and `must_not_claim[]`. Each item:

    {
      "id": "shared-quota-cosmetic-isolation",
      "description": "human explanation of the issue",
      "match": { ...criteria... }
    }

- A **must_find** item scores a *hit* if at least one finding matches its
  criteria; otherwise a *miss*.
- A **must_not_claim** item produces a *false positive* for every finding that
  matches it. These encode the design-intent / cosmetic-fix traps a correct
  review must avoid.

### match criteria

| field             | type       | meaning                                                                 |
|-------------------|------------|-------------------------------------------------------------------------|
| `seam_kind`       | enum?      | finding's seam kind (resolved via `seamId` → seam) must equal this      |
| `blast_radius_min`| enum?      | finding's `blastRadius` must be at least this severe (`critical>high>medium>low`) |
| `file`            | regex?     | at least one of the finding's location paths must match (case-insensitive) |
| `all_of`          | string[][]?| **substance gate.** An array of alternative-groups; each group passes if *any* of its regexes matches the finding text (`description` + `reasoning` + `consequence`), and **all** groups must pass |

`all_of` is how "generous to phrasing, strict to substance" is expressed: one
group lists acceptable phrasings of a concept (`["quota","rate.?limit","account limit"]`),
and requiring a *second* group (e.g. a "shared/same-account" concept) forces the
real mechanism to be present, not just a vague symptom.

**Every item's `match` must constrain something** — at least one of `seam_kind`,
`blast_radius_min`, `file`, or a non-empty `all_of`. An item with no criteria
would match every finding (vacuous hits, or blanket false positives); the scorer
rejects such ground truth with an error rather than scoring it.

## Findings projection (scorer input)

The scorer does **not** yet read tool output directly — SeamStress has no
machine-readable findings artifact today (it renders Markdown/HTML only). The
scorer consumes a JSON **projection** in this shape, which the benchmark owns as
a contract:

    {
      "seams":         [ { "id": "seam-1", "kind": "safety_delivery" } ],
      "findings":      [ Finding, ... ],           // engine's real Finding shape
      "verifications": [ VerificationResult, ... ] // engine's real VerificationResult shape
    }

`findings` and `verifications` use the engine's internal types verbatim
(`src/types/finding.ts`, `verification.ts`); the scorer imports those types and
`effectiveStatus` directly, so it scores the true contract. **Wiring the `map`
runner to emit this projection is a future engine task** (see `docs/STATE.md`);
until then, projections are hand-authored (as in the scorer's tests).

Seam kind lives on the **seam**, not the finding — so the projection carries
`seams[]`, and the scorer resolves each finding's kind via its `seamId`.

## Scorer output & exit codes

Per-entry result: `hits` (each with the matched finding ids and their
`effectiveStatus` — recorded, **not** gated on at this rung), `misses`,
`falsePositives`, a boolean `passed`, and a one-line `summary`.

`passed` is true only when every `must_find` is hit **and** there are zero false
positives. CLI exit codes: **0** = passed, **2** = scored but not passed (a miss
or a false positive), **1** = usage/IO/ground-truth error. An empty findings
projection therefore exits `2` with all must_find items listed as misses — never
a silent pass.
