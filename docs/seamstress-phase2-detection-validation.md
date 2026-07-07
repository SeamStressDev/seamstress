# Phase 2: Detection-approach validation (hybrid: heuristic pre-filter → LLM judgment)

**Question:** seam *detection* (finding which code IS a seam) is unproven — every run so far hand-located the seam. Before building a detector, does the **hybrid** approach (cheap heuristic narrows WHERE to look → LLM confirms/classifies each candidate) find the real seams **without flooding false positives**? Same FP discipline that gated the review before Build 2.

**Method (known ground truth, n=1 repo):** a public Next.js/Stripe SaaS starter, 184 source files (`.ts`/`.tsx`, excl. `node_modules`/`.d.ts`), with hand-identified ground-truth seams. Hand-run, chunked, real source asserted in every prompt (placeholder lesson):
1. **Heuristic pre-filter** (free, no LLM): score each file on path/name + import + content-keyword signals; candidates = score ≥ 3.
2. **LLM judgment** (Sonnet 4.6, one call per candidate, `purpose: seam_detection`): is this a seam, and what kind? System prompt explicitly says *most files are NOT seams; flag only files that perform/guard a high-risk operation; flagging everything is useless.*

> Caveat up front: **n=1 repo.** One disciplined pass tells us whether the approach is sound; a durable detector wants a couple more repos (esp. non-Stripe stacks).

## Stage 1: heuristic pre-filter, 184 → 28 candidates (15%)

The heuristic cut the search space by 85% and **kept every known seam**. The top of the ranked list is exactly the ground truth (webhook 14, generate-user-stripe 11, open-customer-portal 10, update-user-role 9). Excluded near-misses (score 1–2) were validation schemas, config, and UI buttons — no real server-side seam scored below threshold.

**Heuristic recall: complete** for this repo. The caveat: this works *because* these seams carry strong surface signals (`stripe` imports, `"use server"`, `webhook` paths). A seam hiding in a generically-named file with no such signal could slip the pre-filter — the inherent risk of a cheap heuristic (see Refinement).

## Stage 2: LLM judgment, 28 candidates → 19 seams, 9 rejected

### Recall: found every known seam (the costly failure did not happen)

| Ground-truth seam | Found? | Kind assigned |
|---|---|---|
| `app/api/webhooks/stripe/route.ts` (Stripe webhook) | ✅ | money_path |
| `actions/generate-user-stripe.ts` (checkout) | ✅ | money_path |
| `actions/open-customer-portal.ts` (IDOR portal) | ✅ | money_path |
| `actions/update-user-role.ts` (privilege change) | ✅ | auth |
| `app/api/user/route.ts` (account deletion) | ✅ | data_deletion |
| `auth.ts` / `auth.config.ts` / `middleware.ts` (auth boundary) | ✅ | auth |
| `lib/subscription.ts` (billing status) | ✅ | money_path |

**Recall = 100% on known seams.** No money-path or auth seam was missed — the expensive failure mode did not occur.

### Precision: did NOT flood, but has a soft spot on UI surfaces

The 9 rejections were all correct non-seams — the Stripe client init (`lib/stripe.ts`), `config/dashboard.ts`, `navbar`/`mobile-nav`, a profile form, the presentational billing page, and three loading/spinner files. So it did **not** flag "every component that imports auth" — the discipline largely held.

Of the **19 flagged**, by directory: `actions/` 4, `app/api/` 3, `lib/`+root 5 — **all clearly correct server-side seams**. The questionable calls cluster in two places:

- **`components/` UI (3):** `delete-account-modal.tsx`, `user-role-form.tsx`, `user-auth-form.tsx`. The LLM's own reasoning is honest — *"this component directly triggers/invokes"* the risky operation. But the operation (the mutation, the auth) lives in the action/route it calls; the component is the UI surface. These are the false-positive class.
- **Presentational layouts (1–2):** `app/(auth)/layout.tsx` (login-page shell) is a likely FP; `app/(protected)/layout.tsx` and `admin/layout.tsx` are defensible (they enforce the route guard).

**Precision ≈ 63–79%** (strict vs. lenient on route-guard layouts). Not a flood — but not razor-sharp: the judge flags the UI *surface* of a risky operation, not only its server-side *implementation*. Notably inconsistent (rejected `user-name-form.tsx`, accepted `user-role-form.tsx`).

### Classification accuracy: strong on real seams

money_path for all Stripe/billing/webhook/portal/subscription; auth for role/middleware/auth; data_deletion for the user DELETE route. No `pii`/`safety_delivery` hallucinated (correct — none exist here). Minor: `update-user-name` → `auth` is over-classified (it's a low-stakes profile mutation that happens to be auth-guarded); `open-customer-portal` → `money_path` is defensible though its real bug is an auth/IDOR issue.

## Cost: detection finally measured

The heuristic judged only **15% of files** (28 of 184), making detection **~6.5× cheaper** than LLM-reading every file. That's the point of the pre-filter: it keeps a whole-repo first pass cheap enough to be practical, and this was the previously-unmetered cost line, now measured.

## Decision: GO, with one refinement

**The hybrid approach is sound enough to build.** It hit every known seam (recall 100%), did not flood (rejected the obvious noise), classified real seams accurately, and detection is cheap enough to run as a whole-repo first pass. This clears the same bar the review cleared before Build 2.

**The one refinement to fold into Build 3** (precision, not recall): the FP class is concentrated in `components/` UI and a presentational layout — and *every real seam was in `actions/`, `app/api/`, `lib/`, or root auth/middleware*. Two cheap fixes, ideally both:
1. **Scope candidates to server-side code** — down-weight or exclude `components/**` and presentational `layout.tsx`/`page.tsx`. Removes nearly all FPs at ~zero recall cost here.
2. **Sharpen the judge prompt** to distinguish *"implements/guards the risky operation"* from *"renders UI that triggers it"* — only the former is a seam.

**Resilience note:** one candidate (`middleware.ts`) came back with `confidence` omitted and a strict parse aborted the whole pass mid-run — the exact long-run fragility the retry work targeted. Fixed in the harness by making `confidence` optional and isolating per-candidate parse failures so one bad response can't tank a repo scan. Build 3's detector must do the same: per-file isolation, never an all-or-nothing pass.

**Heuristic-recall caveat for Build 3:** the pre-filter's completeness here rode on strong surface signals. A signal-light seam (e.g. money math in a generically-named util) could be missed. Consider a content-based safety net (or periodic full-scan spot-checks) so the cheap filter doesn't become a silent recall ceiling.

**n=1 repo** — Stripe/Next.js stack. The approach is validated *here*; confirm on a second, non-Stripe repo early in Build 3 before trusting the heuristic signals broadly.
