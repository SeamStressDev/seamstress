/**
 * Pins the graceful-failure contract of the shared CLI plumbing: expected,
 * user-caused errors surface as one clean line (no stack), unexpected errors
 * keep their full detail. Deterministic — output sink injected, no runs.
 */

import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { CliError, reportFatal, requireRepoDir } from "./cli.js";
import { MissingApiKeyError } from "./llm/client.js";

describe("reportFatal — expected errors print one clean line", () => {
  it("missing API key: message only, no stack frames", () => {
    const log = vi.fn();

    reportFatal("Seam-map run failed", new MissingApiKeyError(), log);

    expect(log).toHaveBeenCalledOnce();
    const line = log.mock.calls[0]?.[0] as string;
    expect(line).toContain("Seam-map run failed: ANTHROPIC_API_KEY is not set");
    expect(line).not.toMatch(/\bat /);
    expect(line).not.toContain("\n");
  });

  it("CliError (e.g. bad repo path): message only, no stack frames", () => {
    const log = vi.fn();

    reportFatal("Seam-map run failed", new CliError("Repo path not found: /nope"), log);

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toBe("Seam-map run failed: Repo path not found: /nope");
  });

  it("unexpected errors keep full detail (the error object itself)", () => {
    const log = vi.fn();
    const boom = new Error("boom");

    reportFatal("Seam-map run failed", boom, log);

    expect(log).toHaveBeenCalledWith("Seam-map run failed:");
    expect(log).toHaveBeenCalledWith(boom);
  });
});

describe("requireRepoDir — clean up-front path validation", () => {
  it("throws a clean CliError naming the path when it does not exist", () => {
    expect(() => requireRepoDir("/definitely/not/a/real/path")).toThrowError(CliError);
    expect(() => requireRepoDir("/definitely/not/a/real/path")).toThrow(
      "Repo path not found: /definitely/not/a/real/path",
    );
  });

  it("throws 'not a directory' when the path is a file", () => {
    const thisFile = fileURLToPath(import.meta.url);
    expect(() => requireRepoDir(thisFile)).toThrow("Repo path is not a directory");
  });

  it("accepts a real directory", () => {
    expect(() => requireRepoDir(".")).not.toThrow();
  });
});
