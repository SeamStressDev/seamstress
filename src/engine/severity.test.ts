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
 * Severity calibration — pins the inflation defect (Iteration C).
 *
 * Severity (`blastRadius`) is assigned on impact-magnitude-IF-real with no
 * signal for whether the bad outcome is currently reachable. So a true-but-
 * LATENT architectural concern ("structurally permits…", "no … constraint")
 * with large hypothetical impact rates `critical` identically to an immediately-
 * triggerable exploit. Four real cases shipped this way — a service-role client
 * with no structural import guard, a mutable exported config object, a schema that
 * structurally permits a privileged row, and a fixed-key webhook upsert — and had
 * to be hand-rejected at curation.
 *
 * Pinned through the existing `rankAndIdentify` (the post-synthesis pipeline
 * seam that finalizes findings) so failure is BEHAVIORAL, not a wiring error.
 *
 * Deterministic: synthetic drafts in, calibrated findings out — no model call.
 */

import { describe, expect, it } from "vitest";
import { rankAndIdentify } from "./pipeline.js";
import type { FindingDraft } from "./parse.js";

// LATENT — the real latent-schema-constraint shape. Large hypothetical impact
// (paid access with no live subscription), but NO demonstrated code path that
// creates the bad row.
const LATENT_DRAFT: FindingDraft = {
  description:
    "The schema structurally permits a row holding status='active' and planTier='enterprise' with stripeSubscriptionId=NULL and currentPeriodEnd=NULL simultaneously, because each field is independently nullable/defaulted with no cross-column check constraint.",
  reasoning:
    "Each column is independently nullable/defaulted; nothing in the schema prevents the combination. No code path is shown that actually constructs such a row — it is a latent/architectural concern, not a demonstrated exploit.",
  blastRadius: "critical",
};

// REACHABLE — the real deferred-quota TOCTOU shape. A concrete path that fires in
// ordinary use (two concurrent uploads, or a deferred confirm) produces the harm.
const REACHABLE_DRAFT: FindingDraft = {
  description:
    "Storage quota is a read-only check at upload-initiate, while the usage increment happens later at confirm-time with no quota gate, reservation, or lock — so two concurrent uploads both pass the check, or a deferred confirm runs after the account fills, and the user exceeds their plan limit.",
  reasoning:
    "checkQuota only reads current usage; incrementUsage in confirmUpload re-checks nothing. Two ordinary concurrent uploads both pass — a concrete, currently-reachable bad outcome.",
  blastRadius: "high",
};

describe("severity calibration — reachability discount", () => {
  it("caps a LATENT/architectural finding below critical (the inflation defect)", () => {
    const [finding] = rankAndIdentify([LATENT_DRAFT], "seam-1");
    // A latent concern with no reachable path must not ship as critical.
    expect(finding?.blastRadius).not.toBe("critical");
  });

  it("leaves a concretely-REACHABLE finding at its real severity (over-correction guard)", () => {
    const [finding] = rankAndIdentify([REACHABLE_DRAFT], "seam-1");
    // Genuinely-reachable severe findings must NOT be flattened.
    expect(finding?.blastRadius).toBe("high");
  });
});
