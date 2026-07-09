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
 * Run-context primitive — WHOSE code a run is examining, threaded explicitly
 * from the invocation boundary down to where measurement capture will occur.
 *
 * The categories mirror the measurement charter's ownership model: the privacy
 * bar follows the code's OWNER, not the run's operator. A gift-run is operated
 * by the builder on someone else's code, so it is never capture-permitted.
 *
 * Context is always an explicit parameter. It is never inferred from the
 * environment, the working directory, or the target path — inference is the
 * silent-capture failure mode this primitive exists to prevent.
 */

/** The charter-adjudicated run categories. */
export type RunContext = "benchmark" | "self-audit" | "gift-run" | "user" | "test";

/**
 * Resolve an optional context. Unspecified resolves to "user" — the no-capture
 * side — unconditionally.
 */
export function resolveRunContext(context: RunContext | undefined): RunContext {
  return context ?? "user";
}

/**
 * The ours-to-capture set (charter Group A: our fixtures, our benchmark
 * corpus, our own repos). An ALLOWLIST, never a denylist: a context absent
 * from this set — including any RunContext member added later without touching
 * this gate — is no-capture. New capture permission is granted by naming a
 * context here explicitly, never inherited by omission. "gift-run" is
 * deliberately absent (owner's code, Group B bar); "test" is absent so the
 * suite can never write measurement artifacts as a side effect.
 */
const CAPTURE_PERMITTED: ReadonlySet<RunContext> = new Set(["benchmark", "self-audit"]);

/**
 * Is measurement capture permitted for this context? False for everything not
 * explicitly named in the allowlist, and false for unspecified. Nothing
 * consumes this yet — the capture slice (1b) gates on it.
 */
export function isCapturePermitted(context: RunContext | undefined): boolean {
  return CAPTURE_PERMITTED.has(resolveRunContext(context));
}
