# The ONE Trio: auditing the trust gate

**Target (highest blast radius):** the verification trust gate — `effectiveStatus`
(`src/types/status.ts`), the evidence schema (`src/types/verification.ts`), the
`mergeReviews` finding-ID namespacing (`src/engine/pipeline.ts`), and the render
binding (`src/engine/report.ts`).

**Why this is THE target:** SeamStress's entire claim — the thing that separates
it from every scanner — is *"every finding we show as `verified_real` (with
proof) is verified against your actual code."* That claim is enforced by this
code. If it has an edge case — a finding rendering as verified with no real
evidence, or evidence binding to the WRONG finding — the map shows a user a
**confident lie in the exact dimension that is the whole differentiator**, and it
renders as success (silent). That's the one bug that destroys trust on first
contact.

**Method:** dogfooded the engine on itself — assembled the trust-gate code as a
seam and ran the real pipeline (`npm run review`): 3 blind decorrelated critics →
synthesis → per-finding verification, every verdict quoting the actual code.
**8 model calls** — 3 critic + 1 synthesis + 4 verification.

## Central question: answered

> **Can a finding EVER render to a user as `verified_real` (with proof) when
> verification did not establish it — OR can evidence attach to the WRONG
> finding?**

**YES — on both counts, before this audit.** The trio found and *self-verified
against the real code* two critical confident-lie paths. The trust gate did **not**
hold; it had real defects. Both are now fixed with reversion-proven regression
tests.

## Verified findings

### 🔴 Critical: `verified_real` with no evidence renders as proven (fixed: `5fdd680`)

`effectiveStatus` is documented as the SOLE authority but returned `result.status`
purely on a `findingId` match — **it never inspected the evidence.** The schema
reinforced this: `VerificationResultSchema.evidence` has no `.min(1)`, and
`VerificationEvidenceSchema.quotedCode` has no `.min(1)`. So both
`{status:"verified_real", evidence:[]}` and `{…, evidence:[{quotedCode:""}]}`
validate. In `report.ts`, `byStatus("verified_real")` then puts such a finding in
the headline under copy that promises *"the exact lines quoted as proof"* —
`evidenceBlock` only suppresses the *display* of the (missing) proof; it does not
remove the finding from the verified set.

Verifier's quoted evidence (real code):
```ts
// status.ts — consults status only, never evidence
const result = verifications.find((v) => v.findingId === finding.id);
return result ? result.status : "unverified";
// verification.ts — evidence: z.array(...)  // no .min(1); quotedCode: z.string()  // no .min(1)
// report.ts — evidenceBlock: if (!quote) return "";  // finding still renders as verified
```
**Blast radius: critical.** Reachable on *any* malformed verification (the model
omitting evidence), the headline trust claim, rendered as success.

**Fix:** the authority now honors a verdict only if it is backed by ≥1 non-empty
quoted-code evidence; otherwise the finding derives `unverified`. Checking at
`effectiveStatus` (not only the schema) also catches the whitespace-`quotedCode`
variant a naive `.min(1)` would miss.

### 🔴 Critical: slug collision misattaches evidence to the wrong finding (fixed: `bb9c838`)

`mergeReviews` namespaced finding IDs with `<seam.id>:` only. But `seamIdFor`
lowercases and collapses every non-alphanumeric run to `-`, so two distinct paths
(`a/Check.ts` and `a-check.ts`, or `user_check` and `user-check`) slugify to the
**same** `seam.id`. The shared prefix aliases their `finding-1`s, and the
first-match `.find()` in both `effectiveStatus` and `report.ts` binds **one
seam's `verified_real` status + quoted evidence to the OTHER seam's finding** —
fabricated proof on a finding that was never verified.

Verifier's quoted evidence (real code):
```ts
// assembly.ts — slug collapses distinct paths to one id
const slug = path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
// pipeline.ts — both seams get the same prefix
const prefix = `${seam.id}:`;
// status.ts / report.ts — first match wins
verifications.find((v) => v.findingId === finding.id);
```
**Blast radius: critical** (wrong proof on wrong finding), though it requires a
slug-colliding path pair to trigger.

**Fix:** the namespace is now keyed on the seam's POSITION (`s<i>:<seam.id>:`).
The index is unique by construction, so no slug collision can produce a duplicate
finding ID; each finding stays bound to its own verdict and evidence.

### Lesser variants (same root cause, covered by the two fixes)
- **No uniqueness enforcement / `.find()` first-match** (high): the general
  mechanism behind the collision — duplicate IDs silently let insertion order
  govern status/evidence. The position-keyed prefix removes the only way
  duplicates arise (intra-seam IDs are already unique by `rankAndIdentify`).
- **Orphaned verification dropped** (medium): a verification whose `findingId`
  doesn't match any finding silently degrades that finding to `unverified`
  (under-reporting, not a confident lie) — noted, lower priority, not fixed here.

## Verdict

The trust gate **did not hold** under its own adversarial methodology — it had two
critical confident-lie paths, exactly the class of bug worth catching before any
user sees the map. Both are now closed at the authority and the merge layer,
each pinned by a reversion-proven regression test (the bug becomes a guard).
Re-running the trio against the fixed code, the verified-without-evidence and
misattachment paths are gone. The remaining items are under-reporting (fail-safe)
and require either a malformed model response that the parse-retry already
re-asks, or a low-probability path collision now made harmless.

The dogfood worked: the verification methodology, pointed at the verification
foundation, found the highest-priority bugs in the codebase. Earned confidence —
not assumed.
