# Bait fixtures

Bait fixtures are elicitation instruments: deliberately tempting inputs used to
collect real wrong-claim specimens. They are NOT benchmark entries — no
`entry.json`, no `must_find`, no `must_not_claim` — and are excluded from the
benchmark proper and from ANY recall/precision statistic computed over entries.
No run-all harness may sweep this directory.

Each fixture directory holds the source files, an assembled `seam.json` (same
shape the review runner consumes for entries), and a `runs/` directory with the
persisted, verbatim output of every elicitation run (`run-N.projection.json`
from `--json`, `run-N.log` from teed stdout). Confirmed wrong-claim specimens
are preserved verbatim under `specimens/`.

`recall-check.ts` feeds each finding of a projection file — full finding text,
`description + reasoning + consequence`, exactly as `score.ts` assembles it —
to the real `asserted_claim` matcher for a trap spec, to test whether the trap
fires on real output. It reads the frozen `trap-specs.json` as-is and changes
no scorer behavior.
