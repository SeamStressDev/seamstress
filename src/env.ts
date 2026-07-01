/**
 * Shared `.env` loader for the CLI runners.
 *
 * Uses `process.loadEnvFile()` (added in Node 21.7 / backported to 20.12;
 * SeamStress requires Node >=22) instead of a dotenv dependency. The ONE
 * silent path is "no `.env` file at all" — the key may already be in the
 * ambient environment. Every other failure is surfaced loudly, because the
 * worst version of this failure is a user who correctly created `.env` and
 * still gets told the key is missing.
 */

import { existsSync } from "node:fs";

/** Injection points so the branching is unit-testable without a real `.env`. */
export interface LoadEnvFileOptions {
  /** Whether a `.env` file exists in the current directory. */
  envFileExists?: () => boolean;
  /**
   * The underlying loader. Passing `undefined` explicitly models a Node
   * runtime without `process.loadEnvFile`.
   */
  loadEnv?: (() => void) | undefined;
  /** Sink for loud-failure messages (default: `console.error`). */
  warn?: (message: string) => void;
}

/** Load `.env` if present; warn loudly if it exists but cannot be loaded. */
export function loadEnvFile(options: LoadEnvFileOptions = {}): void {
  const envFileExists = options.envFileExists ?? (() => existsSync(".env"));
  const warn =
    options.warn ?? ((message: string) => console.error(message));
  const loadEnv =
    "loadEnv" in options
      ? options.loadEnv
      : typeof process.loadEnvFile === "function"
        ? () => process.loadEnvFile()
        : undefined;

  // No .env — fine, the key may already be in the environment.
  if (!envFileExists()) return;

  if (typeof loadEnv !== "function") {
    warn(
      "Found a .env file, but this Node version cannot load it " +
        "(process.loadEnvFile is unavailable). SeamStress requires Node >=22 — " +
        "upgrade Node, or set ANTHROPIC_API_KEY directly in your environment.",
    );
    return;
  }

  try {
    loadEnv();
  } catch (error) {
    // The file vanished between the existence check and the load — same as
    // "no .env", so stay silent. Anything else must not be swallowed.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    const detail = error instanceof Error ? error.message : String(error);
    warn(
      `Found a .env file but failed to load it: ${detail}. Fix the file, ` +
        "or set ANTHROPIC_API_KEY directly in your environment.",
    );
  }
}
