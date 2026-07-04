# SeamStress

Seam-scoped code review. It finds the **business-logic and money-path bugs that scanners and linters miss** — the ones that live where money, auth, and multi-tenant data intersect, and that only show up if you actually reason about the code.

A linter matches patterns. SeamStress reads the high-risk boundaries of your codebase — a Stripe webhook, a checkout action, an upload quota, a per-user data query — and asks the questions a careful reviewer would: *does this guard actually hold? can one user reach another's data? does this fail silently? is the quota real or cosmetic?* Then it checks each answer against your real code and only reports what it can prove, quoting the exact lines.

It's early, bring-your-own-key, and validated on a small number of repos. This README tells you exactly what it does and doesn't do.

The class of bugs SeamStress targets — business-logic failures at money, auth, and multi-tenant seams — is documented, with real public incidents, in the [Seam-Bug Catalog](https://github.com/SeamStressDev/seam-bug-catalog).

## Quickstart

**Prerequisites:** Node 22+ and an [Anthropic API key](https://console.anthropic.com/).

```bash
git clone https://github.com/SeamStressDev/seamstress
cd seamstress
npm install

# provide your key — either a .env file:
cp .env.example .env        # then edit .env and set ANTHROPIC_API_KEY
# ...or export it directly:
export ANTHROPIC_API_KEY=sk-ant-...

# run it on any local repo:
npm run map -- /path/to/your/repo
```

That prints a Markdown risk report to stdout. To write it to a file, or get the HTML report instead:

```bash
npm run map -- /path/to/your/repo --out report.md      # Markdown → file
npm run map -- /path/to/your/repo --html report.html   # standalone HTML report
npm run map -- /path/to/your/repo --max 40             # cap how many candidates are reviewed
```

No build step is needed — the run scripts execute the TypeScript directly.

**Cost:** it's your key. SeamStress makes real Anthropic API calls — a few per seam — so a run spends real usage on your account. The `--max` flag caps how much it reviews.

A finding in the report reads roughly like:

> **🔴 Critical — anyone logged in can set their own role to admin**
> Where: `actions/update-user-role.ts:17`
> If this is wrong: the wrong person can gain powers they shouldn't have.
> Proof from your code: `if (session.id === userId) setRole(role)`

See [`examples/`](./examples/) for a sample report and a case study of
SeamStress auditing its own report generator — including the bug it found in
itself and the fix that followed.

## How it works

Two stages, both LLM-driven with programmatic guardrails:

1. **Detection** — a cheap heuristic pre-filter narrows the repo to candidate high-risk files, then an LLM confirms or rejects each one as a real *seam* and classifies it (auth, money-path, PII, data-deletion, critical-delivery).
2. **Review** — each seam is reviewed by several **blind, decorrelated critics** (they don't see each other's findings), a **synthesis** step consolidates and ranks by blast radius, and a **verification** step checks every finding against the actual source.

The load-bearing principle is the verification gate: **a finding is only shown as verified when it's confirmed against your real code with a quoted line as proof.** A claim the tool can't ground in the source is not presented as fact — it's dropped or flagged as a judgment call, never rendered as a confident "verified" with nothing behind it.

## What it does and doesn't do

SeamStress is deliberately narrow. It looks for **business-logic and "seam"
bugs** — the places where money, authorization, and multi-tenant data cross
boundaries and the individual pieces are each correct but the combination is
dangerous. It is built to reason about those seams with judgment rather than
flood you with noise.

**Does:**
- Detect and review the high-risk seams in a repo — auth/authorization, money paths, PII handling, data deletion, critical delivery.
- Verify each surfaced issue against the real code, with the offending lines quoted; rank by severity.
- Emit a plain-language Markdown or self-contained HTML report a developer (or a non-security founder) can act on.

Being honest about the limits is part of the tool:

- **It reasons about code, not intent.** A finding can be *code-accurate* and
  still describe something you decided on purpose. SeamStress cannot see design
  decisions that live outside the code — issue trackers, architecture records,
  a documented tradeoff. Treat findings as **questions the code raises**, not
  verdicts: "the code permits X — is that intended?" The final call is yours.

- **It is not a general security scanner.** SeamStress does not replace SAST
  tools, dependency scanners, or secret detection. It looks at a specific,
  hard-to-automate class of bug that those tools structurally tend to miss —
  and it will miss things they catch. Use it alongside them, not instead of
  them.

- Detection is **best-tuned for JavaScript/TypeScript (Next.js) and Python (Django)**. On other stacks it still runs, but the report says so and treats itself as a floor on the risk, not a complete inventory — the heuristic can miss seams whose signals it doesn't recognize.

- It's **young** and validated on a small number of repos. It finds real bugs, but it is not a substitute for a security audit.

- **It cannot see runtime behavior.** Anything that only manifests during
  execution — timing, live configuration, actual traffic — is outside static
  analysis. A seam that looks fine in source may still fail under load, and vice
  versa.

- **Verification has a ceiling.** SeamStress flags when it cannot confirm a
  finding against the code alone (for example, behavior that depends on an
  external provider's semantics). An unconfirmed finding is not a false alarm —
  it's an honest "worth a human look."

For evidence of how SeamStress performs — including where it fails — see the
[benchmark and its public results ledger](benchmark/README.md), which records
misses alongside hits.

## Responsible Use

SeamStress performs **static analysis** of source code you provide. It reads
code; it does not execute it, connect to any system, or interact with anything
running. It cannot access a system, a network, or any code you do not already
have in hand.

That said, running an analysis is your responsibility:

- **Use SeamStress on code you own or are authorized to review.** You are
  responsible for ensuring you have the right to analyze any code you run it
  against — the same responsibility you'd have opening that code in an editor.
- **SeamStress grants no access.** It analyzes source you already possess. It
  is not a scanner, a probe, or an exploitation tool, and it does nothing to any
  live system.
- **Findings are yours to handle responsibly.** If you analyze code you don't
  own — for example, a public open-source project — treat any real finding as a
  security disclosure, not a publication. See ["Reporting findings in code you
  don't own" in SECURITY.md](SECURITY.md#reporting-findings-in-code-you-dont-own).

SeamStress is a tool for building safer software, offered freely in that spirit.
Using it to help others — or yourself — write more trustworthy code is exactly
the point.

## Pre-launch seam review

If you're shipping an AI-assisted product that touches money, auth, or
multi-tenant data, I offer a fixed-scope pre-launch seam review — the
methodology in this repo, plus the judgment it can't automate. I build with
AI assistance myself; SeamStress exists because I wanted review discipline
that matches that speed.

The deliverable is the questions your code raises at its riskiest boundaries:
what the money, auth, and tenant seams actually permit as written — each
observation verified against your source with the lines quoted, so you decide
what's a defect and what's intended. It's a focused seam review, not a full
security audit, and not a promised bug count.

The engagement is fixed-scope — to start a conversation, email
hello@seamstress.dev.

## License

Copyright (C) 2026 SeamStress contributors.
Licensed under the GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).
