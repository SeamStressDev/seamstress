/**
 * Unit tests for the pure `calibrateSeverity` helper — called directly, no
 * model, no pipeline. Latent/architectural findings cap to medium; concretely-
 * reachable findings (even with latent-sounding words) stay put.
 */

import { describe, expect, it } from "vitest";
import { calibrateSeverity } from "./severity.js";
import type { SeverityInput } from "./severity.js";

// LATENT — real nexus #2 shape: "structurally permits", "no … check constraint",
// and the reasoning explicitly says NO code path constructs the row.
const LATENT: SeverityInput = {
  blastRadius: "critical",
  description:
    "The schema structurally permits a row holding status='active' and planTier='enterprise' with stripeSubscriptionId=NULL simultaneously, because each field is independently nullable with no cross-column check constraint.",
  reasoning:
    "Nothing in the schema prevents the combination. No code path is shown that actually constructs such a row — latent/architectural, not a demonstrated exploit.",
};

// REACHABLE — real nexus #12 shape: contains "nothing prevents" (latent-sounding)
// BUT cites a concrete trigger ("two concurrent uploads", "deferred confirm").
const REACHABLE_WITH_LATENT_WORDS: SeverityInput = {
  blastRadius: "high",
  description:
    "Storage quota is a read-only check at initiate; the increment happens at confirm-time with no lock — nothing prevents two concurrent uploads both passing the check, or a deferred confirm after the account fills, so the user exceeds their plan limit.",
  reasoning:
    "checkQuota only reads usage; two ordinary concurrent uploads both pass. A concrete, currently-reachable bad outcome.",
};

describe("calibrateSeverity (pure)", () => {
  it("caps a LATENT critical finding to medium", () => {
    const out = calibrateSeverity(LATENT);
    expect(out.blastRadius).toBe("medium");
    expect(out.capNote).toMatch(/latent\/architectural/i);
  });

  it("OVER-MATCH GUARD: a reachable finding with latent-sounding words is NOT capped", () => {
    // 'nothing prevents' is present, but a concrete trigger ('two concurrent
    // uploads') makes it reachable — the cap must not fire.
    const out = calibrateSeverity(REACHABLE_WITH_LATENT_WORDS);
    expect(out.blastRadius).toBe("high");
    expect(out.capNote).toBeNull();
  });

  it("respects an explicit reachability:'reachable' even with marker words", () => {
    const out = calibrateSeverity({
      ...LATENT,
      reachability: "reachable",
    });
    expect(out.blastRadius).toBe("critical");
    expect(out.capNote).toBeNull();
  });

  it("caps on an explicit reachability:'latent' even without marker words", () => {
    const out = calibrateSeverity({
      blastRadius: "critical",
      description: "A user can be granted enterprise access without paying.",
      reasoning: "The entitlement is derived loosely.",
      reachability: "latent",
    });
    expect(out.blastRadius).toBe("medium");
  });

  it("leaves an already-medium latent finding unchanged (no-op, never raises)", () => {
    const out = calibrateSeverity({ ...LATENT, blastRadius: "medium" });
    expect(out.blastRadius).toBe("medium");
    expect(out.capNote).toBeNull();
  });

  it("leaves a plain reachable critical finding unchanged (no latent markers)", () => {
    const out = calibrateSeverity({
      blastRadius: "critical",
      description: "An attacker can change their own role to admin via the unguarded action.",
      reasoning: "The only check is session.id === userId; an authenticated user passes it for their own row.",
    });
    expect(out.blastRadius).toBe("critical");
    expect(out.capNote).toBeNull();
  });
});
