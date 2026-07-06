# Examples

A few runs of SeamStress on code we can show completely — our own source and a
small synthetic demo app. This is a methodology demonstration, not a promise
about what any given run finds.

Everything below is real output from real runs. Nothing was edited to look
better; each artifact is labeled with what it ran on, at which commit, and when.

---

## Case study 1: SeamStress auditing its own verification gate

The riskiest code in SeamStress is the part that decides whether a finding may
be shown as `verified_real`. The whole tool rests on one promise: anything
presented as verified was checked against your actual code, with the lines
quoted. If that gate has an edge case, the tool can show a confident claim it
never earned, and it renders as success, silently. So before the repo went
public we pointed the engine at that gate: we assembled the trust-gate code as a
seam and ran the real pipeline against it (blind critics, synthesis, per-finding
verification). It found two Critical defects in its own foundation.

**One: a verdict could be marked verified with no proof behind it.** The status
authority (`effectiveStatus`) trusted a `verified_real` verdict on a finding-ID
match alone and never looked at the evidence, and the schema allowed an empty
evidence list or an empty quote. A finding with no quoted code could land in the
headline under copy promising the exact lines as proof. Fixed in
[`5fdd680`](https://github.com/SeamStressDev/seamstress/commit/5fdd680): the
authority now certifies a verdict only when at least one non-empty quote backs
it. Pinned by tests in `src/types/types.test.ts` ("refuses verified_real when
the evidence array is empty", "refuses verified_real when the only evidence has
an empty/whitespace quote", "still certifies a verdict backed by real quoted
code").

**Two: proof could attach to the wrong finding.** Finding IDs were namespaced by
a slug of the file path, and two different paths could slug to the same value, so
one seam's verified status and quoted evidence could bind to another seam's
finding. Reaching it needs a slug-colliding pair of paths, but the outcome is
fabricated proof on a finding that was never verified. Fixed in
[`bb9c838`](https://github.com/SeamStressDev/seamstress/commit/bb9c838): IDs are
now keyed on the seam's position, which is unique by construction. Pinned by
`src/engine/detector.test.ts` ("keeps verifications bound to the right finding
when two seams share a slugged id").

Both fixes are reversion-proven: revert the fix and the test fails. One related
gap was found and knowingly left: an orphaned verification (its finding ID
matching nothing) degrades that finding to `unverified`. That is under-reporting,
the fail-safe direction, not a confident lie, so it was noted rather than fixed.
The full engineering record, including the verifier's quoted evidence for each
finding, is in
[`docs/seamstress-trust-gate-trio.md`](../docs/seamstress-trust-gate-trio.md).

---

## Case study 2: SeamStress auditing its own report generator

Before the repo went public, we ran the review trio (blind critics → synthesis →
verification) against another risky surface: the HTML report
generator (`src/engine/report.ts`), where untrusted text — model-emitted finding
descriptions, verbatim code quoted from a stranger's repo, file paths — is
interpolated into an HTML document a user opens in a browser. It's our own code,
so every line is public and the assembled seam is reproducible from the
committed source.

### Before (historical run, 2026-07-01, pre-fix commit `7ccdb33`)

The trio surfaced one **verified_real** finding:

> **[2] (low, confidence=high) VERIFIED_REAL**
> Headline kind tag hardcodes the literal 'money-path ·' prefix, so every
> headline is mislabeled as money-path regardless of the actual seam kind.
>
> verdict: verified_real — "… a finding whose actual kind is 'auth' would render
> as 'money-path · Login & access control' — the kind prefix is always wrong for
> any non-money-path seam. The escaping of KIND_LABEL[kind] is correct, so this
> is purely an output-integrity/mislabeling defect, not an injection issue."
>
> evidence (src/engine/report.ts:399):
> `` lines.push(`<span class="tag">money-path · ${escapeHtml(KIND_LABEL[kind])}</span>`); ``

A real bug, in the exact artifact SeamStress hands people as proof of rigor,
firing on every HTML report with a headline finding. It had survived because the
only test fixture used a money-path seam — where the wrong prefix looked
plausible.

### What it did *not* inflate

The same run produced three findings the pipeline explicitly declined to
escalate — each ranked **judgment_call**, not verified:

1. **blastRadius interpolated unescaped into `class` attributes** — factually
   present, but the value is zod-enum validated upstream to exactly
   `critical|high|medium|low`: "sound today with zero reachable exploit path …
   a judgment call because the risk is latent and conditional on schema
   weakening."
2. **Numeric counts interpolated without escaping** — "not a practical injection
   vector without a type-system violation that the code gives no evidence of
   permitting."
3. **The composed verdict string skips escapeHtml** — built only from numbers
   and hardcoded literals: "no current injection vector … a design/style
   judgment rather than a concrete vulnerability."

The synthesis: *"The renderer routes every genuinely untrusted string
(descriptions, reasoning, consequence, quoted code, paths, repo, coverage)
through escapeHtml, so there is no reachable XSS today."*

Declining to cry wolf is half the methodology. A tool that inflated any of these
three into a "critical XSS" would have been wrong.

### After (fix + re-run, 2026-07-02, commit `346db9e`)

The finding drove a one-line fix
([`346db9e`](https://github.com/SeamStressDev/seamstress/commit/346db9e)),
pinned by a test that renders an auth-kind headline and asserts `money-path`
does not appear:

```diff
-    lines.push(`<span class="tag">money-path · ${escapeHtml(KIND_LABEL[kind])}</span>`);
+    lines.push(`<span class="tag">${escapeHtml(KIND_LABEL[kind])}</span>`);
```

Re-running the same trio against the fixed code: the mislabel finding is gone
(the evidence line now quotes the corrected code), the numeric-interpolation
concern was killed outright as **false_positive** ("numbers are structurally
incapable of containing HTML-significant characters"), and the synthesis reads:
*"5-entity escaping is adequate for the text-node, attribute, `<pre>`, and
`<title>` contexts used here — there is no reachable XSS on the current code
path."*

### A note on provenance

These two self-audits are historical runs, and their raw run outputs were not
preserved as files. The verifiable record is the code: the fixing commits linked
above and the behavior-pinning tests named, which anyone can inspect and run.
Runs since then persist their outputs; the benchmark (below) keeps every run's
projection and log under `benchmark/results/runs/`.

---

## Case study 3: what a finding looks like

[`example-report.html`](./example-report.html) is a real rendered SeamStress
report: a run against a small, deliberately vulnerable **synthetic demo app**
(four files — a login handler, a payment webhook, a role-update endpoint, and a
DB stub), current code
`346db9e`, 2026-07-02, `--max 4`.

SeamStress found 2 seams and verified 3 issues, each with the offending lines
quoted:

- 🔴 **Critical — Session token is forgeable** — base64(userId:timestamp) with
  no secret or randomness (the headline, with quoted proof).
- 🔴 **Critical — Passwords stored and compared in plaintext** — no hashing.
- ⚪ **Low — Timing difference between user-not-found and wrong-password paths
  leaks account existence.**

These are business-logic seams — the kind a pattern-matching linter has no rule
for. The fixture is small and synthetic by design (we can show it fully); it is
not a claim about detection rates on large real codebases.

---

## The anti-noise check: run against itself

Mapped against its **own repository** (46 files scanned, current code
`346db9e`, 2026-07-02), SeamStress reports **0 seams and 0 findings**. That is
the correct answer: this repo is a CLI tool with no money, auth, or multi-tenant
surface — the detector examined the candidate files and rejected them all. The
tool reports nothing when there's nothing, rather than inventing findings to
look busy.

---

## A recorded miss

The tool has documented failures, and they are on the public record rather than
edited out. The benchmark's [results ledger](../benchmark/README.md#results-ledger)
is append-only and includes misses.

Two concrete cases. Entry 001 (cosmetic key isolation): on a full-pipeline run
the detector's keyword pre-filter scored the fixture at zero and never sent it to
review, so it was scored a miss (0/2, and $0.00 because no model was ever called).
Handed the seam directly in review-only mode, the tool finds it, so this is a
detection-recall miss at the pre-filter stage, not a reasoning failure, and it is
the concrete instance of a limit we track. Entry 005 (identity absent from a
cache key): an early run scored `partial` (1 of 2), hitting the consequence but
missing the mechanism. The cause was our scoring vocabulary, not the finding; the
tool had described the bug correctly. We widened the match criteria for phrasing
coverage, verified the widening did not make the matcher fire on a correct
control, and a fresh independent run then scored it clean. The whole arc, miss
included, is in that entry's ledger.

---

## Caveats

These are demonstrations on code we can show fully. SeamStress reasons about
the code in front of it, not intent documented elsewhere; it's young and
validated on a small number of repos. Treat findings as "worth checking," not
gospel.

---

Shipping something with money/auth/tenant seams? I do fixed-scope pre-launch
seam reviews — hello@seamstress.dev.
