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
