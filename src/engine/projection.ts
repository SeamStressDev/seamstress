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
 * Machine-readable findings projection — the JSON the seam-bug benchmark's
 * scorer consumes (contract owned by `benchmark/schema.md`).
 *
 * This PROJECTS a completed {@link SeamMap}: seams are reduced to `{ id, kind }`
 * (dropping label/sources/inputText), and findings/verifications are passed
 * through in their real internal shapes (already plain, JSON-safe data). It does
 * not recompute anything or touch the other renderers' output.
 */

import type { Finding, SeamKind, VerificationResult } from "../types/index.js";
import type { SeamMap } from "./map.js";

/** The projection shape (mirrors the benchmark's FindingsProjection contract). */
export interface FindingsProjection {
  seams: { id: string; kind: SeamKind }[];
  findings: Finding[];
  verifications: VerificationResult[];
}

/** Project a completed SeamMap down to the benchmark scorer's input shape. */
export function projectSeamMap(map: SeamMap): FindingsProjection {
  return {
    seams: map.seams.map((s) => ({ id: s.id, kind: s.kind })),
    findings: map.review.findings,
    verifications: map.review.verifications,
  };
}
