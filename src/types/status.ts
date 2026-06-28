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
 * If more than one result somehow references the same finding (it shouldn't —
 * verification produces one result per finding), the first match wins; callers
 * should not rely on that ordering.
 */
export function effectiveStatus(
  finding: Finding,
  verifications: readonly VerificationResult[],
): VerificationStatus {
  const result = verifications.find((v) => v.findingId === finding.id);
  return result ? result.status : "unverified";
}
