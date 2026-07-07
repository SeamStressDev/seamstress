/*
 * F1-engine security regression from the trio audit: the markdown report must
 * not let a repo-controlled path inject markdown structure. The HTML report
 * already neutralizes via escapeHtml (verification-gate self-audit); this pins
 * the markdown side. Fails against the pre-fix renderer.
 */
import { describe, expect, it } from "vitest";
import { renderSeamMap } from "./report.js";
import type { SeamMap } from "./map.js";

function mapWithSeamPath(path: string): SeamMap {
  return {
    repoPath: "victim",
    filesScanned: 1,
    candidatesFound: 1,
    seams: [{ id: "s1", kind: "money_path", label: "l", sources: [{ path, startLine: 1 }] }],
    erroredSeams: [],
    coverage: { stack: "ts", caveat: "" },
    review: { target: { repo: "victim", commit: "x", generatedAt: "d" }, findings: [], verifications: [] },
  } as unknown as SeamMap;
}

describe("F1-engine: a hostile path cannot inject markdown structure into the report", () => {
  it("neutralizes a newline-bearing path so no forged heading appears", () => {
    const evil = "src/pay\n## FORGED HEADING\n- injected: trust me.ts";
    const md = renderSeamMap(mapWithSeamPath(evil));
    expect(md.includes("\n## FORGED HEADING")).toBe(false);
  });
});
