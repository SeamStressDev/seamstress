# SeamStress

Seam-scoped code review. It finds the **business-logic and money-path bugs that scanners and linters miss** — the ones that live where money, auth, and multi-tenant data intersect, and that only show up if you actually reason about the code.

A linter matches patterns. SeamStress reads the high-risk boundaries of your codebase — a Stripe webhook, a checkout action, an upload quota, a per-user data query — and asks the questions a careful reviewer would: *does this guard actually hold? can one user reach another's data? does this fail silently? is the quota real or cosmetic?* Then it checks each answer against your real code and only reports what it can prove, quoting the exact lines.

It's early, bring-your-own-key, and validated on a small number of repos. This README tells you exactly what it does and doesn't do.

## Quickstart

**Prerequisites:** Node 20.6+ and an [Anthropic API key](https://console.anthropic.com/).

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

No build step is needed — the run scripts execute the TypeScript directly (`npm install` must include dev dependencies, i.e. don't use `--omit=dev`).

**Cost:** it's your key. SeamStress makes real Anthropic API calls — a few per seam — so a run spends real usage on your account. The `--max` flag caps how much it reviews.

A finding in the report reads roughly like:

> **🔴 Critical — anyone logged in can set their own role to admin**
> Where: `actions/update-user-role.ts:17`
> If this is wrong: the wrong person can gain powers they shouldn't have.
> Proof from your code: `if (session.id === userId) setRole(role)`

## How it works

Two stages, both LLM-driven with programmatic guardrails:

1. **Detection** — a cheap heuristic pre-filter narrows the repo to candidate high-risk files, then an LLM confirms or rejects each one as a real *seam* and classifies it (auth, money-path, PII, data-deletion, critical-delivery).
2. **Review** — each seam is reviewed by several **blind, decorrelated critics** (they don't see each other's findings), a **synthesis** step consolidates and ranks by blast radius, and a **verification** step checks every finding against the actual source.

The load-bearing principle is the verification gate: **a finding is only shown as verified when it's confirmed against your real code with a quoted line as proof.** A claim the tool can't ground in the source is not presented as fact — it's dropped or flagged as a judgment call, never rendered as a confident "verified" with nothing behind it.

## What it does and doesn't do

**Does:**
- Detect and review the high-risk seams in a repo — auth/authorization, money paths, PII handling, data deletion, critical delivery.
- Verify each surfaced issue against the real code, with the offending lines quoted; rank by severity.
- Emit a plain-language Markdown or self-contained HTML report a developer (or a non-security founder) can act on.

**Doesn't (be honest about the edges):**
- It reasons about the **code you point it at**. It can't see intent that lives outside the code — issue trackers, ADRs, a Slack thread explaining why something is the way it is. Treat a finding as "worth checking," not gospel.
- Detection is **best-tuned for JavaScript/TypeScript (Next.js) and Python (Django)**. On other stacks it still runs, but the report says so and treats itself as a floor on the risk, not a complete inventory — the heuristic can miss seams whose signals it doesn't recognize.
- It's **young** and validated on a small number of repos. It finds real bugs, but it is not a substitute for a security audit.

## License

Copyright (C) 2026 SeamStress contributors.
Licensed under the GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).
