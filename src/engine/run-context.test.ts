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
 * Run-context primitive tests (measurement charter, slice 1a). Pins three
 * promises: the unspecified default is the no-capture side, the capture gate
 * is an ALLOWLIST (false for everything not explicitly permitted, including
 * enum members the gate has never heard of), and the primitive is inert —
 * threading a context changes nothing about what the scan or detector does.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { toTokenUsage } from "../llm/index.js";
import type { CallModelParams, CallModelResult } from "../llm/index.js";
import type { ModelCaller } from "./config.js";
import { detectSeams } from "./detector.js";
import { scanRepo } from "./heuristic.js";
import { isCapturePermitted, resolveRunContext } from "./run-context.js";
import type { RunContext } from "./run-context.js";

const ALL_CONTEXTS: RunContext[] = ["benchmark", "self-audit", "gift-run", "user", "test"];

describe("resolveRunContext — the safe default", () => {
  it("resolves unspecified to 'user' (the no-capture side), unconditionally", () => {
    expect(resolveRunContext(undefined)).toBe("user");
  });

  it("passes every explicit context through unchanged", () => {
    for (const ctx of ALL_CONTEXTS) expect(resolveRunContext(ctx)).toBe(ctx);
  });
});

describe("isCapturePermitted — allowlist, never denylist", () => {
  it("permits exactly the ours-to-capture set: benchmark and self-audit", () => {
    expect(isCapturePermitted("benchmark")).toBe(true);
    expect(isCapturePermitted("self-audit")).toBe(true);
  });

  it("denies gift-run (owner's code), user, test, and unspecified", () => {
    expect(isCapturePermitted("gift-run")).toBe(false);
    expect(isCapturePermitted("user")).toBe(false);
    expect(isCapturePermitted("test")).toBe(false);
    expect(isCapturePermitted(undefined)).toBe(false);
  });

  it("denies a hypothetical context the gate has never heard of (allowlist proof)", () => {
    // A future enum member added WITHOUT touching the gate must not inherit
    // capture permission by omission. A denylist implementation passes the
    // named-value tests above but fails this one.
    const unlisted = "paid-audit" as RunContext;
    expect(isCapturePermitted(unlisted)).toBe(false);
  });
});

// --- Threading through the real entry points ---

const tmpRepos: string[] = [];
afterAll(() => tmpRepos.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Write a throwaway repo with one obvious candidate file. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "seam-ctx-"));
  tmpRepos.push(dir);
  mkdirSync(join(dir, "api"), { recursive: true });
  writeFileSync(
    join(dir, "api", "checkout.ts"),
    'import Stripe from "stripe";\nexport async function charge() { /* payment */ }\n',
  );
  return dir;
}

/** A fake judge that confirms every candidate as a seam. */
function fakeJudge(): ModelCaller {
  return {
    async callModel(params: CallModelParams): Promise<CallModelResult> {
      return {
        text: JSON.stringify({ isSeam: true, kind: "money_path", confidence: "high", reasoning: "r" }),
        stopReason: "end_turn",
        usage: toTokenUsage("claude-sonnet-4-6", params.purpose ?? "seam_detection", {
          inputTokens: 10,
          outputTokens: 5,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        }),
      };
    },
  };
}

describe("run-context threading — detectSeams", () => {
  it("a benchmark-shaped invocation reports benchmark context", async () => {
    const result = await detectSeams(makeRepo(), { client: fakeJudge(), runContext: "benchmark" });
    expect(result.runContext).toBe("benchmark");
  });

  it("an unspecified invocation (every CLI today) reports user context", async () => {
    const result = await detectSeams(makeRepo(), { client: fakeJudge() });
    expect(result.runContext).toBe("user");
  });

  it("a context set only in scan options is honored; the top-level option wins over it", async () => {
    const viaScan = await detectSeams(makeRepo(), {
      client: fakeJudge(),
      scan: { runContext: "self-audit" },
    });
    expect(viaScan.runContext).toBe("self-audit");

    const bothSet = await detectSeams(makeRepo(), {
      client: fakeJudge(),
      runContext: "benchmark",
      scan: { runContext: "user" },
    });
    expect(bothSet.runContext).toBe("benchmark");
  });
});

describe("run-context inertness — the primitive changes no behavior", () => {
  it("scanRepo returns identical candidates under every context and under none", () => {
    const repo = makeRepo();
    const bare = scanRepo(repo, {});
    for (const ctx of ALL_CONTEXTS) {
      expect(scanRepo(repo, { runContext: ctx })).toEqual(bare);
    }
    expect(bare.length).toBeGreaterThan(0); // the comparison is not vacuous
  });
});
