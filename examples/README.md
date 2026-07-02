# Examples

A few runs of SeamStress on code we can show completely — our own source and a
small synthetic demo app. This is a methodology demonstration, not a promise
about what any given run finds.

Everything below is real output from real runs. Nothing was edited to look
better; each artifact is labeled with what it ran on, at which commit, and when.

---

## Case study 1 — SeamStress auditing its own report generator

Before the repo went public, we ran the review trio (blind critics → synthesis →
verification) against SeamStress's single riskiest surface: the HTML report
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

---

## Case study 2 — what a finding looks like

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

## The anti-noise check — run against itself

Mapped against its **own repository** (46 files scanned, current code
`346db9e`, 2026-07-02), SeamStress reports **0 seams and 0 findings**. That is
the correct answer: this repo is a CLI tool with no money, auth, or multi-tenant
surface — the detector examined the candidate files and rejected them all. The
tool reports nothing when there's nothing, rather than inventing findings to
look busy.

---

## Caveats

These are demonstrations on code we can show fully. SeamStress reasons about
the code in front of it, not intent documented elsewhere; it's young and
validated on a small number of repos. Treat findings as "worth checking," not
gospel.

---

Shipping something with money/auth/tenant seams? I do fixed-scope pre-launch
seam reviews — hello@seamstress.dev.
