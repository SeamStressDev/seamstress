/**
 * Pins the branching of the shared `.env` loader. Every collaborator is
 * injected (fs existence check, the underlying loader, the warn sink), so no
 * real `.env` file or Node downgrade is needed — the tests are deterministic.
 */

import { describe, expect, it, vi } from "vitest";
import { loadEnvFile } from "./env.js";

describe("loadEnvFile", () => {
  it("does nothing when no .env file exists (the only silent skip)", () => {
    const loadEnv = vi.fn();
    const warn = vi.fn();

    loadEnvFile({ envFileExists: () => false, loadEnv, warn });

    expect(loadEnv).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns loudly when .env exists but process.loadEnvFile is unavailable (Node too old)", () => {
    const warn = vi.fn();

    loadEnvFile({ envFileExists: () => true, loadEnv: undefined, warn });

    expect(warn).toHaveBeenCalledOnce();
    const message = warn.mock.calls[0]?.[0] as string;
    expect(message).toMatch(/Node >=22/);
    expect(message).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("loads without warning when .env exists and the loader works", () => {
    const loadEnv = vi.fn();
    const warn = vi.fn();

    loadEnvFile({ envFileExists: () => true, loadEnv, warn });

    expect(loadEnv).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent when the loader throws ENOENT (file vanished after the check)", () => {
    const enoent = Object.assign(new Error("no such file or directory"), {
      code: "ENOENT",
    });
    const warn = vi.fn();

    loadEnvFile({
      envFileExists: () => true,
      loadEnv: () => {
        throw enoent;
      },
      warn,
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it("surfaces non-ENOENT loader failures loudly", () => {
    const warn = vi.fn();

    loadEnvFile({
      envFileExists: () => true,
      loadEnv: () => {
        throw new Error("malformed line 3");
      },
      warn,
    });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("malformed line 3");
  });
});
