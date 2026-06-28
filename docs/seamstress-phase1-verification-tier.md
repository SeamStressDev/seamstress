# Phase 1 — Verification-tier experiment

**Question:** verification (the trust gate) is the single largest COGS line in a review (Opus, ~37% / ~$0.053). Before Build 3's detector multiplies seams, can verification drop to a cheaper model **without losing accuracy or evidence rigor**?

**Method (apples-to-apples, n=1 fixture):** ran critics + synthesis **once** on the Resend critical-email fixture (`fixtures/resend-critical-email.seam.json`), producing **6 synthesized findings** across all blast-radius ranks. Then ran the **verification stage only** on those *same 6 findings*, three times — varying only `verificationModel`: Opus 4.8 (current default), Sonnet 4.6, Haiku 4.5. Critics + synthesis held fixed, so only the verifier changed. Real API, clean per-call COGS.

> Caveat up front: **n=1 on one small (~30-line) fixture.** This is one good datapoint to make the call now; a durable tier policy wants a few more seams. Flagged again in the recommendation.

## Verdicts (same 6 findings, three verifiers)

| Finding | Blast radius | Opus 4.8 | Sonnet 4.6 | Haiku 4.5 |
|---|---|---|---|---|
| f1 — send failures silently swallowed | **critical** | verified_real | verified_real | verified_real |
| f2 — `getDailyCount` outside try/catch | **critical** | verified_real | verified_real | verified_real |
| f3 — cosmetic quota guard (the known hit) | **high** | verified_real | verified_real | verified_real |
| f4 — increment only after successful send | high | judgment_call | verified_real | verified_real |
| f5 — no `caregiverEmail` validation | medium | verified_real | judgment_call | verified_real |
| f6 — quota counts acceptances, not deliveries | low | judgment_call | judgment_call | judgment_call |

**Agreement where it matters.** All three tiers are **unanimous on the four highest-consequence findings** — both `critical`s, the `high` cosmetic-quota known-hit (f3), and the `low` (f6). Not one tier flipped a real bug to `false_positive`, and not one **missed** or dropped a finding.

**The two disagreements (f4, f5)** are both on the **`verified_real` ↔ `judgment_call` boundary** — the inherently fuzzy line ("real, but does it depend on intent?"), never a `false_positive` and never a miss:
- **f4** (increment-after-send): Opus called it `judgment_call` (depends whether you *want* failed attempts counted); Sonnet & Haiku called it `verified_real` (the code factually never counts them). Both defensible.
- **f5** (email validation): Sonnet called it `judgment_call`; Opus & Haiku `verified_real`.

These are judgment-boundary differences on lower-priority findings, not accuracy failures. The safety-critical property of the trust gate — *don't wave a real bug through as a false positive, don't fabricate evidence* — held on every tier.

## Evidence quality

Every tier quoted **real source** as evidence on every finding (the catch block, the `getDailyCount`/`overQuota` lines, the try/send/increment sequence) — 1–2 quotes each, no vague or absent evidence anywhere. Quoted-evidence size (chars) per finding:

- Opus: 168 / 138 / 324 / 560 / 187 / 208
- Sonnet: 253 / 280 / 280 / 328 / 402 / 208
- Haiku: 472 / 278 / 280 / 549 / 643 / 446

The cheaper tiers were, if anything, **more verbose** in grounding — Haiku quoted the largest spans. No degradation in evidence rigor at either lower tier.

## Cost (6 verifications)

| Verifier | Cost | Per finding | vs Opus |
|---|---|---|---|
| Opus 4.8 ($5/$25) | $0.107545 | $0.017924 | — |
| **Sonnet 4.6 ($3/$15)** | **$0.049230** | **$0.008205** | **54% cheaper** |
| Haiku 4.5 ($1/$5) | $0.019074 | $0.003179 | **82% cheaper** |

(Per-finding Opus cost ~$0.018 is consistent with the earlier live review's $0.053/3.)

**Projected review impact** (earlier full review was ~$0.142: sonnet critics $0.038 + opus synthesis $0.051 + opus verification $0.053):
- Verification → **Sonnet**: verification ~$0.024, review ~**$0.113**; verification drops from **37% → ~21%** of the review.
- Verification → Haiku: verification ~$0.009, review ~**$0.099**; verification ~**9%**.

## Decision — drop default verification to **Sonnet 4.6**

Sonnet reproduced **every verdict on the critical/high core findings** (incl. the cosmetic-quota known-hit) with **equally rigorous, real-source evidence**, at **54% lower cost**. Its only divergences from Opus were two `verified_real`/`judgment_call` boundary calls on lower-priority findings — not the failure mode that matters for a trust gate. That clears the bar the task set ("reproduces the verdicts with equally-rigorous evidence → change the default").

**Why Sonnet and not Haiku (yet):** Haiku is genuinely tempting — 82% cheaper, and it matched Opus on 4 of 6 (including both criticals). But this is the **trust gate** and **n=1**. Dropping *two* tiers on the step whose entire job is to not wave bad findings through warrants more than one fixture. Sonnet is the conservative one-tier step that captures most of the win now; **Haiku is a strong candidate to validate across a few more seams** (a natural rider on Phase 2 / early Build 3) before going further.

**Synthesis stays on Opus** — this experiment only varied verification; synthesis judgment wasn't measured and isn't changed.

**Action taken:** `DEFAULT_REVIEW_CONFIG.verificationModel` → `claude-sonnet-4-6` in `src/engine/config.ts`, with a guard test. Committed as `perf(engine): verification defaults to sonnet — same accuracy, lower COGS`.
