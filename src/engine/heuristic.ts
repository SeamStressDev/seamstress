/*
 * SeamStress — seam-scoped code review engine.
 * Copyright (C) 2026 SeamStress contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Stage 1 of the detector — the cheap heuristic pre-filter (FREE, no LLM).
 *
 * Scans a repo's source files for candidate-seam signals and emits a ranked
 * candidate list, bounding WHERE the LLM looks. It does not decide what IS a
 * seam — that is Stage 2's judgment. Two refinements carried in from Phase 2
 * (docs/seamstress-phase2-detection-validation.md):
 *
 * 1. SERVER-SCOPE — every real seam in the Phase 2 repo lived in server code
 *    (actions/api/lib/middleware/auth); the false positives were UI surfaces in
 *    components/ that merely *trigger* a server operation. So server paths get a
 *    bonus and pure-UI files a penalty, pushing UI-trigger files below threshold.
 *
 * 2. CONTENT SAFETY NET — the heuristic is itself a pattern-matcher, so a
 *    *signal-light* seam (real money/auth/deletion logic with none of the
 *    obvious keywords or imports) would slip a keyword filter. A separate
 *    risk-shape pass (DB writes/deletes, permission branches, money arithmetic,
 *    payment calls) rescues such files even with a zero keyword score. This is
 *    the real tension of a pre-filter: it bounds cost but must not silently
 *    discard the non-obvious seams the tool exists to catch.
 */

import { readFileSync, readdirSync, statSync, lstatSync } from "node:fs";
import { join, relative, basename, extname } from "node:path";
import type { RunContext } from "./run-context.js";

/** Source extensions we scan — broad enough for non-JS stacks (the generalize test). */
const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".php", ".java", ".cs", ".rs", ".ex", ".exs",
]);

/** Directories never worth scanning. */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", "coverage",
  "vendor", "venv", ".venv", "__pycache__", ".turbo", "tmp", "public", "assets",
  "migrations", // generated schema diffs — never a seam, pure noise
]);

/**
 * Backend-language extensions. Files in these languages are inherently
 * server-side — the "UI surface that only triggers a server op" false-positive
 * class is a JS/TSX phenomenon — so they earn the server bonus directly. This is
 * what lets the heuristic generalize off the JS/Stripe stack (Phase 2 / Build 3
 * non-Stripe finding: Django `authentication/` and `views.py` were missed
 * because the server signal was tuned to JS path conventions).
 */
const BACKEND_EXTENSIONS = new Set([
  ".py", ".rb", ".go", ".php", ".java", ".cs", ".rs", ".ex", ".exs",
]);

/** A scored candidate file. */
export interface Candidate {
  /** Repo-relative path. */
  path: string;
  /** Total heuristic score. */
  score: number;
  /** The signals that fired, for transparency/debugging. */
  hits: string[];
  /** Line count, for assembling source ranges later. */
  lines: number;
  /** True when the file only cleared the bar via the content safety net. */
  viaSafetyNet: boolean;
}

type Signal = [pattern: RegExp, weight: number, label: string];

/** Keyword/name signals matched against the repo-relative path. */
const PATH_SIGNALS: Signal[] = [
  [/webhook/i, 3, "path:webhook"],
  [/payment|checkout|charge|invoice/i, 3, "path:payment"],
  [/stripe|paypal|braintree/i, 2, "path:payment-sdk"],
  [/billing|subscription/i, 2, "path:billing"],
  [/portal/i, 1, "path:portal"],
  [/\bauth|login|session|oauth|jwt/i, 2, "path:auth"],
  [/middleware/i, 2, "path:middleware"],
  [/admin/i, 2, "path:admin"],
  [/delete|destroy|remove/i, 1, "path:delete"],
  [/password|token|secret|credential/i, 1, "path:secret"],
  [/role|permission|policy|guard/i, 2, "path:role"],
];

/** Import/keyword signals matched against file content. */
const CONTENT_SIGNALS: Signal[] = [
  [/from ["']stripe["']|new Stripe\(|import stripe|require\(["']stripe["']\)/i, 3, "import:payment"],
  [/stripe\.(checkout|billingPortal|subscriptions|paymentIntents|charges|refunds)/i, 3, "api:payment"],
  // Auth idioms across stacks — JS libs AND Python/Ruby/DRF/Go conventions, so
  // the content signal isn't blind to non-JS auth (the non-Stripe finding).
  [/next-auth|getServerSession|passport|devise|omniauth|from ["']@?\/?auth["']|authlib|jsonwebtoken|import jwt|jwt\.(decode|encode)|authenticate\(|set_password|check_password|permission_classes|IsAuthenticated|@login_required|before_action|current_user|request\.user/i, 2, "import:auth"],
  [/"use server"|'use server'/, 1, "server-action"],
  // "authoriz" not preceded by "un" (so "unauthorized" in error handling does not
  // fire), and RLS on word boundaries only (so the letters inside "URLs" do not).
  [/(?<!un)authoriz|refund|chargeback|\bRLS\b|row.level.security/i, 2, "kw:authorize/refund"],
  [/password|bcrypt|argon2|hashpw|set_password/i, 1, "kw:credential"],
  // TRUNCATE only in statement shape (TRUNCATE TABLE / TRUNCATE ONLY), so the
  // bare word (e.g. a CSS utility class) does not fire.
  [/DELETE FROM|DROP TABLE|TRUNCATE\s+(TABLE|ONLY)\b/i, 2, "kw:sql-destruct"],
];

/**
 * Risk-SHAPE signals for the content safety net — structural patterns that
 * indicate a high-risk operation even with no obvious keyword. Each firing is
 * one "risk shape"; a non-UI file matching >= 2 is rescued as a candidate.
 */
const RISK_SHAPES: Signal[] = [
  [/\b(DELETE FROM|\.delete\(|\.deleteMany\(|\.destroy\b|\.remove\(|\.drop\()/i, 1, "shape:db-delete"],
  [/\b(INSERT INTO|UPDATE \w+ SET|\.create\(|\.update\(|\.save\(|\.insert\()/i, 1, "shape:db-write"],
  [/\bif\b[^\n]{0,80}\b(role|permission|owner|is_?admin|is_?staff|can_|allowed|authorize|access|current_?user)\b|permission_classes\s*=|before_action|@login_required|check_object_permissions|IsAuthenticated/i, 1, "shape:access-branch"],
  [/\b(balance|amount|price|total|cost|credits?|quota|wallet)\b[^\n]{0,40}[-+*/]=?/i, 1, "shape:money-math"],
  [/\b(charge|capture|payout|transfer|debit|credit)\b[^\n]{0,40}\(/i, 1, "shape:value-move"],
];

/** Server-side path markers — every real seam in Phase 2 lived under one. */
const SERVER_PATH = /(^|\/)(actions?|api|routes?|controllers?|services?|handlers?|lib|server|middleware|auth|webhooks?|jobs?|tasks?|workers?|models?|db|database|repositories|resolvers|graphql|usecases?|domain)(\/|\.|$)/i;

/**
 * Pure-UI markers — front-end surfaces that, per Phase 2, only TRIGGER server
 * operations and were the main false-positive source. Restricted so it does not
 * catch server files that happen to contain "view" (e.g. Django `views.py`).
 */
const UI_PATH = /(^|\/)(components?|ui|widgets?)\//i;
const UI_FILE = /(^|\/)(page|layout|loading|error|not-found|template|index)\.(t|j)sx$/i;
const UI_EXT = new Set([".html", ".erb", ".vue", ".svelte", ".hbs", ".ejs", ".haml"]);

/**
 * Non-runtime paths: tests, type-only files, seeds, stories, and email
 * templates. They carry domain vocabulary without deciding runtime outcomes,
 * so they take the same score penalty as UI surfaces in keyword/path scoring.
 * The penalty applies to keyword/path scoring only: the risk-shape safety net
 * evaluates these files unpenalized, so a genuinely risk-shaped test file
 * remains rescuable (see scoreSource).
 */
const NON_RUNTIME_PATH = /(^|\/)(tests?|__tests__|e2e|specs?|stories|storybook|seeds?|templates)\//i;
const NON_RUNTIME_FILE = /\.(test|spec|stories)\.[a-z]+$|\.types\.[a-z]+$/i;

/** Is this file test, type-only, seed, story, or template material? */
function isNonRuntimeFile(path: string): boolean {
  return NON_RUNTIME_PATH.test(path) || NON_RUNTIME_FILE.test(path);
}

/** Default score a file must reach to become a candidate. */
export const DEFAULT_CANDIDATE_THRESHOLD = 3;
/** Default cap on files scored, as a runaway guard on huge repos. */
export const DEFAULT_MAX_FILES = 5000;
/** Risk-shapes a non-UI file must hit to be rescued by the safety net alone. */
export const SAFETY_NET_MIN_SHAPES = 2;

/** Is this file a pure-UI surface (penalized, never server-bonused)? */
function isUiFile(path: string): boolean {
  return UI_PATH.test(path) || UI_FILE.test(path) || UI_EXT.has(extname(path));
}

/**
 * Score one file's source. PURE and exported so scoring is unit-testable without
 * touching the filesystem. Returns the score, the signals that fired, and
 * whether the file qualifies only through the content safety net.
 */
export function scoreSource(path: string, content: string): Candidate {
  const hits: string[] = [];
  let score = 0;

  for (const [re, w, label] of PATH_SIGNALS) if (re.test(path)) { score += w; hits.push(label); }
  for (const [re, w, label] of CONTENT_SIGNALS) if (re.test(content)) { score += w; hits.push(label); }

  const ui = isUiFile(path);
  const nonRuntime = !ui && isNonRuntimeFile(path);
  if (ui) {
    score -= 3; // REFINEMENT: push UI-trigger surfaces below threshold.
    hits.push("penalty:ui");
  } else if (nonRuntime) {
    score -= 3; // tests/types/seeds/stories/templates score like UI in the keyword pass
    hits.push("penalty:non-runtime");
  } else if (SERVER_PATH.test(path) || BACKEND_EXTENSIONS.has(extname(path))) {
    // REFINEMENT: server code is where real seams live — by JS path convention
    // OR by being written in a backend language (generalizes off the JS stack).
    score += 2;
    hits.push("bonus:server");
  }

  // Content safety net: count risk shapes; rescue signal-light non-UI files.
  let shapes = 0;
  for (const [re, , label] of RISK_SHAPES) {
    if (re.test(content)) { shapes += 1; hits.push(label); }
  }
  const rescued = !ui && shapes >= SAFETY_NET_MIN_SHAPES;
  if (rescued) {
    score += shapes; // lift to candidacy on structural risk alone
    // The safety net evaluates non-runtime files unpenalized: a rescued
    // test/seed/template gets the keyword-pass penalty returned, so rescue
    // behaves the same with or without the non-runtime classification.
    if (nonRuntime) score += 3;
  }

  return {
    path,
    score,
    hits,
    lines: content.split("\n").length,
    viaSafetyNet: rescued && score - shapes < DEFAULT_CANDIDATE_THRESHOLD,
  };
}

/** Options for {@link scanRepo}. */
export interface ScanOptions {
  /** Candidate threshold (default {@link DEFAULT_CANDIDATE_THRESHOLD}). */
  threshold?: number;
  /** Cap on files scanned, as a runaway guard on huge repos. */
  maxFiles?: number;
  /**
   * Whose code this run is examining (see {@link RunContext}); unspecified
   * resolves to "user" — the no-capture side. Inert today: the measurement
   * capture slice reads it at the scoring loop, gated on the allowlist.
   */
  runContext?: RunContext;
}

/** Recursively list scannable source files under a directory. */
function listSourceFiles(root: string, dir: string, acc: string[], cap: number): void {
  if (acc.length >= cap) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // unreadable directory (EACCES, ENAMETOOLONG, ...) — skip, never abort
  }
  for (const entry of entries) {
    if (acc.length >= cap) return;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // broken symlink etc. — skip, never abort the scan
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
      // Do not follow directory symlinks: they can resolve outside the scan
      // root (reading files the caller never pointed at) or form cycles.
      // statSync above follows the link; lstatSync sees the link itself.
      let lst;
      try {
        lst = lstatSync(full);
      } catch {
        continue;
      }
      if (lst.isSymbolicLink()) continue;
      listSourceFiles(root, full, acc, cap);
    } else if (SOURCE_EXTENSIONS.has(extname(entry)) && !entry.endsWith(".d.ts")) {
      acc.push(full);
    }
  }
}

/**
 * Scan a repo directory and return the candidate seam files, ranked by score
 * (highest first). The free, LLM-free first stage of detection.
 */
export function scanRepo(repoPath: string, options: ScanOptions = {}): Candidate[] {
  const threshold = options.threshold ?? DEFAULT_CANDIDATE_THRESHOLD;
  const cap = options.maxFiles ?? DEFAULT_MAX_FILES;

  const files: string[] = [];
  listSourceFiles(repoPath, repoPath, files, cap);

  const scored: Candidate[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue; // unreadable — skip, never abort
    }
    const candidate = scoreSource(relative(repoPath, file), content);
    if (candidate.score >= threshold) scored.push(candidate);
  }

  return scored.sort((a, b) => b.score - a.score);
}

/** Re-exported for the assembler, which reads the candidate's real source. */
export function readCandidateSource(repoPath: string, candidate: Candidate): string {
  return readFileSync(join(repoPath, candidate.path), "utf8");
}

/**
 * Count scannable source files and tally them by extension. Drives the map
 * headline and the coverage signal (which language/stack dominates). `scanned`
 * is how many files scanRepo would actually score under `maxFiles`; `total` is
 * how many exist. They differ only past the cap, and the headline reports
 * `scanned` so it never claims to have scored files the cap skipped.
 */
export function sourceFileStats(
  repoPath: string,
  maxFiles: number = DEFAULT_MAX_FILES,
): { total: number; byExt: Record<string, number>; scanned: number } {
  const files: string[] = [];
  listSourceFiles(repoPath, repoPath, files, 100_000);
  const byExt: Record<string, number> = {};
  for (const f of files) {
    const ext = extname(f);
    byExt[ext] = (byExt[ext] ?? 0) + 1;
  }
  return { total: files.length, byExt, scanned: Math.min(files.length, maxFiles) };
}

/** Human-friendly label for a candidate, used as a seam label fallback. */
export function candidateLabel(candidate: Candidate): string {
  return basename(candidate.path);
}
