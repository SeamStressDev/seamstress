/**
 * Stage 3 of the detector — assemble a confirmed candidate into a {@link Seam}.
 *
 * Conclusion-blinding lives here. The validation runs found that leaking the
 * author's own verdict into the review ("// this is cosmetic", "// no-op")
 * rigged the test — the reviewer just echoed the comment. Seam assembly is the
 * choke point where the reviewer's input is built, so it is where that lesson is
 * enforced: {@link blindConclusions} neutralizes verdict-stating comments while
 * leaving the code itself intact. This is best-effort, not a guarantee — it
 * targets answer-leaking comments, not all commentary.
 */

import type { Candidate } from "./heuristic.js";
import type { Seam, SeamKind } from "../types/index.js";

/** Max characters of source embedded as a seam's inputText — bounds review cost. */
export const MAX_INPUT_TEXT_CHARS = 16_000;

/** Marker left in place of a redacted conclusion-stating comment. */
const REDACTION = "[comment redacted for blind review]";

/**
 * Verdict / answer-leaking phrases in comments that would hand the reviewer its
 * conclusion. Deliberately narrow — these state a security/correctness judgment,
 * which is exactly what the reviewer is supposed to reach independently.
 */
const CONCLUSION_PATTERNS = [
  /cosmetic/i,
  /no-?op\b/i,
  /does(n'?t| not) (actually|anything|nothing)/i,
  /(safe to ignore|this is (safe|fine)|not a (real|true) )/i,
  /\b(insecure|vulnerab|exploit|backdoor|security hole|injection)/i,
  /\b(intentional(ly)?|on purpose)\b/i,
  /\b(known (bug|issue|vuln)|FIXME|XXX|HACK)\b/i,
];

/** Does this comment text leak a conclusion? */
function leaksConclusion(commentText: string): boolean {
  return CONCLUSION_PATTERNS.some((re) => re.test(commentText));
}

/**
 * Neutralize verdict-stating comments in source while preserving every line of
 * code. Handles `//`, `#`, and `/* ... *\/` comments (single-line spans). Pure
 * and exported so the blinding rule is independently testable.
 */
export function blindConclusions(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      // Line comments: // (JS/TS) and # (Python/Ruby), when not inside a string.
      const lineComment = line.match(/(\/\/|#)(.*)$/);
      if (lineComment && leaksConclusion(lineComment[2] ?? "")) {
        return line.slice(0, lineComment.index) + lineComment[1] + " " + REDACTION;
      }
      // Single-line block comments: /* ... */
      const block = line.match(/\/\*(.*?)\*\//);
      if (block && leaksConclusion(block[1] ?? "")) {
        return line.replace(/\/\*(.*?)\*\//, `/* ${REDACTION} */`);
      }
      return line;
    })
    .join("\n");
}

/** Turn a repo-relative path into a stable, schema-valid seam id. */
function seamIdFor(path: string): string {
  const slug = path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `seam-${slug || "unknown"}`;
}

/**
 * Build a {@link Seam} from a confirmed candidate. The seam's `inputText` is the
 * candidate's real source, conclusion-blinded and capped to
 * {@link MAX_INPUT_TEXT_CHARS}. Sources point at the whole candidate file.
 */
export function assembleSeam(candidate: Candidate, source: string, kind: SeamKind): Seam {
  const blinded = blindConclusions(source);
  const truncated = blinded.length > MAX_INPUT_TEXT_CHARS;
  const inputText = truncated
    ? blinded.slice(0, MAX_INPUT_TEXT_CHARS) + "\n// [truncated for review]"
    : blinded;

  return {
    id: seamIdFor(candidate.path),
    kind,
    label: candidate.path,
    sources: [{ path: candidate.path, startLine: 1, endLine: Math.max(candidate.lines, 1) }],
    inputText,
  };
}
