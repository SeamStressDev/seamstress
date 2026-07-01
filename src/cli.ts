/**
 * Shared CLI plumbing for the runners: validate user input up front and report
 * fatal errors cleanly.
 *
 * Expected, user-caused failures (a typo'd repo path, a missing API key) print
 * a single actionable line — no stack trace. Genuinely unexpected errors keep
 * their full detail so a real bug stays debuggable.
 */

import { statSync } from "node:fs";
import { MissingApiKeyError } from "./llm/client.js";

/** An expected, user-caused failure: report the message alone, never a stack. */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

/** Throw a clean {@link CliError} unless `path` exists and is a directory. */
export function requireRepoDir(path: string): void {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    throw new CliError(`Repo path not found: ${path}`);
  }
  if (!stats.isDirectory()) {
    throw new CliError(`Repo path is not a directory: ${path}`);
  }
}

/**
 * Print a fatal error to the sink (default stderr). Expected errors
 * ({@link CliError}, {@link MissingApiKeyError}) print as one clean
 * `prefix: message` line; anything else keeps the full error object so an
 * unexpected crash still surfaces its stack. Exit-code handling stays with
 * the caller.
 */
export function reportFatal(
  prefix: string,
  err: unknown,
  log: (...args: unknown[]) => void = console.error,
): void {
  if (err instanceof CliError || err instanceof MissingApiKeyError) {
    log(`${prefix}: ${err.message}`);
    return;
  }
  log(`${prefix}:`);
  log(err);
}
