# Signal-aggregate sink: what this stream is and how far to trust it

`signal-aggregates.jsonl` (gitignored — local until an explicit commit ruling) is the
measurement charter's slice-1b capture stream: one append-only JSON line per
capture-permitted run, recording how the detection heuristic's signals behaved. It
serves exactly two charter decisions and nothing else:

- **A1 — should a signal exist, and keep its weight?** Consumed as per-signal
  precision, stratified by score band and verified-real outcome.
- **A2 — should a tuning constant keep its value?** Consumed as score distributions,
  band shares, and rescue rate.

(Session briefs sometimes call these "D1/D2"; no such charter rows exist — the rows are
A1/A2.)

Capture only: nothing in the engine reads this file back. It cannot influence
detection, scoring, or the trust gate.

## Shape: stratified aggregates under a closed schema

Each row holds counts bucketed by **signal × score band (`sub`/`mid`/`strong`) ×
verified-real outcome (`confirmed_real`/`refuted`/`unverified`)**, plus a per-outcome
score histogram over all scanned files and three run-level scalars
(`files_scanned`, `candidates_found`, `rescue_count`). Two structural guarantees:

- **No per-file data, ever.** Per-file records exist only in process memory during a
  run, solely so verdicts can join back to files; they are aggregated and destroyed
  before anything persists (pinned by test: no scanned path or path fragment survives
  into a serialized row). Any per-file question is answerable instead by re-running the
  pure scorer at the row's `engine_commit`.
- **Closed schema (structural anti-injection).** Every key comes from a
  build-time-closed vocabulary (the engine's compiled signal labels, bands, bins,
  outcomes) and every value is a number, except three pattern/enum-checked metadata
  strings (`date`, `engine_commit`, `run_context`). There is no free-text field and no
  field whose type can carry text sourced from scanned content, so the ledger is safe
  for any consumer — human, script, or model — by construction, not by usage policy.
  The write-time validator rejects any deviation.

## Suppression, and the current trust status

Every count at a named grain must be 0 or ≥ k (`suppression_k`, carried on each row;
currently the uniform conservative **k = 5**). Anything smaller merges upward — a
signal below k loses its *name* into the anonymous `other_signals` pool; histogram
bins collapse to bands, then to outcome totals. This single mechanism closes both
rare-signal fingerprinting and cross-run differencing.

**Trust status: CANDIDATE — and explicitly *accumulating, not yet queryable*.** At
current corpus size (5 entries, ~13 fixture files) the conservative threshold
suppresses most cells: rows pool nearly everything into `other_signals` and collapsed
totals. **This is correct and intended.** The sink exists to accumulate with the right
stratified shape from birth; it becomes decision-useful only when corpus volume
justifies lowering k — which is a recorded decision annotated in the slice-1b design
document, never a silent edit. Do not compute A1/A2 answers from this file today; the
cells you would need are deliberately not there yet.

## Blind spots carried from the charter

- **Recall-per-signal is not observable here.** The heuristic is a pre-filter
  flashlight: a signal can look precise in this ledger and still be silently missing
  the seams it was meant to catch, because files the pre-filter rejected never earn
  verdicts. Only deliberate below-threshold audit sampling (unfunded) could observe
  recall-per-signal.
- **Precision graduates only against pipeline-independent verdicts.** Benchmark rows
  carry ground-truth verdicts (`must_find` hits → `confirmed_real`, `must_not_claim`
  matches → `refuted`) and are the decision-grade evidence. Self-audit rows do not;
  per the design document, verbatim: "The `confirmed_real` tallies inherit A1's
  self-validation blind spot. Self-audit verdicts come from the pipeline's own
  verification gate, which is not independent confirmation; graduation requires
  pipeline-independent verdicts. Not a leak — an epistemics caveat the ledger's README
  must carry verbatim."
- **Rare-signal precision on self-audit is unobservable by design.** Name-pooling means
  a signal firing fewer than k times per run never accumulates named evidence from
  self-audit rows. The remedy for "we need to evaluate rare signal X" is a targeted
  benchmark fixture that exercises it ≥ k times in one public entry — never a k
  reduction.

## Producing rows

- Benchmark sweep (deterministic, LLM-free, $0):
  `npx tsx benchmark/scoring/capture-aggregates.ts` — one merged row across all
  currently scoreable entries; unscoreable entries are excluded and named on stderr.
- Self-audit run: `npm run map -- <repo> --context self-audit` — one row at run end,
  appended by the CLI. Any other `--context` (or none) captures nothing: the 1a
  allowlist gates capture at the scan site.

Append-only: rows are never edited or deleted. A row's `suppression_k` and
`engine_commit` say how to read it; a future k change never invalidates old rows.
