/**
 * Reachability-claim gate (programmatic verification check).
 *
 * A verification verdict that asserts EXTERNAL reachability of a symbol — "any
 * importing module can overwrite X", "external code can call X", "an attacker
 * can reach X" — has a precondition the model routinely fails to check: X must
 * actually be reachable from outside its module, i.e. EXPORTED. In the Cluckcoach
 * #2 case the verifier quoted the very line that disproves the claim
 * (`const RANK` — no export) and still shipped it as a confident Critical.
 *
 * This is a PROGRAMMATIC check, not a stronger prompt — the model already failed
 * at exactly this judgment, so we check the source. Narrow on purpose: it closes
 * the export-visibility instance only. The broad disease ("does the quote
 * actually ENTAIL the claim" — exported-but-never-called, reachable-only-behind-
 * a-guard, mutable-but-frozen-at-init) is a named follow-up, deliberately NOT
 * handled here.
 *
 * Pure: no I/O, no model calls, deterministic string/regex analysis only.
 */

import type { Finding, VerificationResult } from "../types/index.js";

/** Phrases that mark a claim as asserting EXTERNAL reach of a symbol. */
const REACHABILITY_PATTERNS: RegExp[] = [
  /\b(?:any|another|other|every)\s+(?:other\s+|importing\s+)?modules?\b/i,
  /\bimporting module\b/i,
  /\bexternal(?:ly)?\b/i,
  /\bfrom outside\b/i,
  /\boutside (?:the|its) module\b/i,
  /\ban?\s+attacker\b/i,
  /\bany code\b/i,
  /\banywhere in the (?:app|code|codebase|application)\b/i,
  /\b(?:callable|reachable|importable|overwritable|mutable) from\b/i,
];

/** Is this claim asserting external reach of something? */
function isReachabilityClaim(text: string): boolean {
  return REACHABILITY_PATTERNS.some((re) => re.test(text));
}

/** Declarations: capture the symbol name and whether `export ` directly precedes it. */
const DECL_RE =
  /(?:^|\n)[ \t]*(export[ \t]+)?(?:default[ \t]+)?(?:async[ \t]+)?(?:const|let|var|function|class)[ \t]+([A-Za-z_$][\w$]*)/g;

/** `export { A, B as C }` lists — the LOCAL name (before `as`) is what gets exported. */
const EXPORT_LIST_RE = /export[ \t]*\{([^}]*)\}/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The set of symbols declared in the source, and the subset that is exported. */
function analyzeSymbols(source: string): { declared: Set<string>; exported: Set<string> } {
  const declared = new Set<string>();
  const exported = new Set<string>();

  for (const m of source.matchAll(DECL_RE)) {
    const name = m[2];
    if (!name) continue;
    declared.add(name);
    if (m[1]) exported.add(name); // inline `export const X` / `export function X`
  }
  for (const m of source.matchAll(EXPORT_LIST_RE)) {
    const inner = m[1] ?? "";
    for (const part of inner.split(",")) {
      const local = part.trim().split(/\s+as\s+/i)[0]?.trim();
      if (local && /^[A-Za-z_$][\w$]*$/.test(local)) exported.add(local);
    }
  }
  return { declared, exported };
}

/** Declared symbols that the claim names by word — grounded in the source, not prose alone. */
function symbolsNamedInClaim(claim: string, declared: Set<string>): string[] {
  return [...declared].filter((s) => new RegExp(`\\b${escapeRegExp(s)}\\b`).test(claim));
}

/**
 * Down-scope a `verified_real` verdict whose external-reachability claim is
 * unconfirmed — the named symbol is declared but NOT exported, so it cannot be
 * "reached/overwritten from another module". Returns the result unchanged when:
 * the verdict isn't `verified_real`, the claim isn't reachability-shaped, no
 * declared symbol is cleanly named, or every named symbol is genuinely exported.
 *
 * We DOWN-SCOPE to `judgment_call` rather than reject to `false_positive`: the
 * symbol is real and mutable within its module — only its EXTERNAL reachability
 * is unconfirmed — so "contestable, worth a look" is honest, while calling the
 * whole finding untrue would over-correct.
 */
export function gateReachabilityClaim(
  finding: Pick<Finding, "description" | "reasoning">,
  result: VerificationResult,
  source: string,
): VerificationResult {
  if (result.status !== "verified_real") return result;

  const claim = `${finding.description}\n${finding.reasoning}`;
  if (!isReachabilityClaim(claim)) return result;

  const { declared, exported } = analyzeSymbols(source);
  const named = symbolsNamedInClaim(claim, declared);
  if (named.length === 0) return result; // no symbol cleanly extracted — out of scope

  const unexported = named.filter((s) => !exported.has(s));
  if (unexported.length === 0) return result; // every named symbol is genuinely exported

  return {
    ...result,
    status: "judgment_call",
    note:
      `${result.note} ` +
      `[SeamStress reachability gate: this finding's external-reachability claim ` +
      `could not be confirmed — ${unexported.join(", ")} ` +
      `${unexported.length === 1 ? "is" : "are"} declared but not exported from the ` +
      `module, so the "reachable/overwritable from outside" assertion is unverified. ` +
      `Down-scoped from verified_real to judgment_call.]`,
  };
}
