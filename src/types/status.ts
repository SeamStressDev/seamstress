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
 * Deriving a finding's verification status from evidence.
 *
 * Decision 1 (Build 2): {@link VerificationResult} is the SOLE authority for
 * verification status. A {@link Finding} has no status field — it cannot, by
 * construction, claim to be "verified" without a result backing it. The
 * effective status is computed here by looking up whether a result exists for
 * the finding. No result → `unverified`.
 *
 * This makes the illegal state ("verified with no evidence") unrepresentable:
 * there is no field to set, only a {@link VerificationResult} to produce.
 */

import type { Finding, VerificationStatus } from "./finding.js";
import type { VerificationResult } from "./verification.js";

/**
 * The effective verification status of a finding, derived from the verification
 * results produced for it. Returns the matching result's `status`, or
 * `unverified` when no result exists for the finding.
 *
 * TRUST-GATE INVARIANT (added after the trust-gate trio): a verdict is only
 * honored if it is backed by REAL quoted code. The product claim is "every
 * finding we show as verified is verified against your actual code" — so a
 * result that carries no usable evidence (empty `evidence` array, or only
 * empty/whitespace `quotedCode`) cannot certify a finding as anything but
 * `unverified`. The schema permits evidence-less results; the authority refuses
 * to trust them. This blocks the confident-lie path where a `verified_real`
 * with no proof would render in the headline under "the exact lines quoted as
 * proof" with nothing attached. Checking at the authority (not only the schema)
 * also catches the whitespace-`quotedCode` variant a naive `.min(1)` would miss.
 *
 * If more than one result somehow references the same finding (it shouldn't —
 * verification produces one result per finding), the first match wins; callers
 * should not rely on that ordering.
 */
export function effectiveStatus(
  finding: Finding,
  verifications: readonly VerificationResult[],
): VerificationStatus {
  const result = verifications.find((v) => v.findingId === finding.id);
  if (!result) return "unverified";
  const hasRealEvidence = result.evidence.some((e) => e.quotedCode.trim().length > 0);
  return hasRealEvidence ? result.status : "unverified";
}
