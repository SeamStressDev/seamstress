# Build 3 — detector live validation (does it generalize off the Stripe stack?)

The detector was validated live on two repos with known ground truth: the Next.js/Stripe starter (Phase 2 regression) and a **non-Stripe** stack (a Django REST example app) — the carry-forward test of whether the heuristic finds real seams when the signals aren't familiar Stripe/Next idioms.

## Repo 1 — a public Next.js/Stripe starter — regression

The server-scope refinement worked exactly as intended:

| | Phase 2 | Build 3 |
|---|---|---|
| Heuristic candidates | 28 | **16** |
| Candidates in `components/` (the FP class) | several | **0** |
| Recall on known seams | 100% | **100%** |
| Flagged seams | 19 (≈4–5 UI FPs) | **13 (all server-side, defensible)** |
| Detection cost | baseline | **lower** (fewer candidates) |

Recall held at 100% (webhook, checkout, customer-portal, role change, account deletion, auth boundary), precision sharply up (the UI false positives are gone), cost down. The judge also pinpointed the *actual* known vulnerabilities — the `open-customer-portal` IDOR ("one user accessing another's portal via arbitrary userStripeId") and the `update-user-role` privilege escalation ("any authenticated user can change their own role to admin"). Substantive, not superficial.

## Repo 2 — a Django REST example app — the generalize test

**This is the important finding.** On first run the hybrid detector **did NOT generalize** — and the miss was entirely at the heuristic stage:

| | Before fix | After fix |
|---|---|---|
| Heuristic candidates | 5 | 16 |
| `authentication/backends.py` (JWT verify) | **MISSED** | found ✅ |
| `authentication/views.py` (login/register) | **MISSED** | found ✅ |
| `articles/views.py` (ownership-gated deletion) | **MISSED** | found ✅ |
| Confirmed seams | 2 | **5** |
| Recall on core auth/data seams | ~40% | **~100%** |

### Why it missed (diagnosis)

The heuristic's signals were JS/Stripe-tuned, so on a Django stack they were blind:
1. **Server bonus** required `auth` as a *complete* path segment, so Django's `authentication/` directory got none — and Django's canonical server files (`views.py`, `models.py`, `backends.py`) weren't recognized as server-side.
2. **Auth content signals** were JS libraries (`next-auth`, `jsonwebtoken`, `passport`, `devise`) — they missed Python's `import jwt`, `authenticate()`, `set_password`, and DRF's `permission_classes` / `IsAuthenticated` / `request.user`.
3. **Safety-net access-branch** assumed an imperative `if <permission>` check; DRF's *declarative* `permission_classes = [...]` never matched, so the ownership-gated deletion view wasn't rescued.

The LLM judgment generalized fine — it confirmed the Python seams correctly and rejected the config/urls/serializer noise. **The pre-filter was the weak link**, and a pattern-matcher tuned on one stack silently dropping real seams on another is exactly the failure mode the safety net is meant to guard (a cost-bounding filter must not discard the non-obvious seams the tool exists to catch).

### The fix (committed)

`heuristic.ts`, three targeted changes that make the pre-filter stack-aware without flooding:
1. **Backend-language files** (`.py`/`.rb`/`.go`/`.php`/`.java`/`.cs`/`.rs`/`.ex`) earn the server bonus directly — the "UI surface that only triggers a server op" FP class is a JS/TSX phenomenon, so a backend-language file is inherently server-side.
2. **Cross-stack auth idioms** added to the content signal: `import jwt`, `jwt.decode/encode`, `authenticate(`, `set_password`/`check_password`, `permission_classes`, `IsAuthenticated`, `@login_required`, `before_action`, `request.user`/`current_user`.
3. **Declarative permission patterns** added to the safety-net access-branch shape (`permission_classes=`, `before_action`, `@login_required`, `check_object_permissions`, `IsAuthenticated`), plus `migrations/` skipped as generated noise.

After the fix: Django recall ~100% (all core auth + the deletion-IDOR seam nominated and confirmed), the judge caught the real comment-deletion authorization bug, and **Stripe was unchanged** (identical 16-candidate set — no regression). Detection on Django stayed cheap (16 Sonnet calls).

## Verdict

- **Stripe regression:** clean — better precision, same recall, lower cost.
- **Generalization:** the approach is sound, but it **depends entirely on the heuristic's signal coverage**. Out of the box it was JS-tuned and missed real seams on Django; once the signals were made stack-aware, recall recovered to ~100%. The honest lesson for the end-to-end build: **the heuristic's signal set is the recall ceiling, and it must be maintained per-stack.** The content safety net helps but is not a substitute — its risk-shapes also needed broadening for declarative frameworks.

- **n=2 repos** (Stripe/Next, Django/DRF). Each new stack is a potential recall gap until its idioms are covered; a third stack (Rails/Go/Express) should be spot-checked early in the end-to-end build, and a `confidence`/coverage signal on the heuristic would make a missed-seam ceiling visible rather than silent.
