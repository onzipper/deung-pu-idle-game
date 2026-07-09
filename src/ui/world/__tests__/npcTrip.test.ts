import { describe, expect, it } from "vitest";
import { nextNpcTripStep } from "../npcTrip";

describe("nextNpcTripStep", () => {
  it("idle is always a no-op passthrough", () => {
    expect(
      nextNpcTripStep("idle", { inTown: true, inRange: true, dead: false }),
    ).toEqual({ phase: "idle", effect: null });
    expect(
      nextNpcTripStep("idle", { inTown: false, inRange: false, dead: true }),
    ).toEqual({ phase: "idle", effect: null });
  });

  it("death cancels silently from any active phase", () => {
    expect(
      nextNpcTripStep("traveling", { inTown: false, inRange: false, dead: true }),
    ).toEqual({ phase: "idle", effect: null });
    expect(
      nextNpcTripStep("walking", { inTown: true, inRange: false, dead: true }),
    ).toEqual({ phase: "idle", effect: null });
  });

  it("stays traveling while still outside town", () => {
    expect(
      nextNpcTripStep("traveling", { inTown: false, inRange: false, dead: false }),
    ).toEqual({ phase: "traveling", effect: null });
  });

  it("transitions traveling -> walking exactly once on town arrival, out of range", () => {
    const first = nextNpcTripStep("traveling", {
      inTown: true,
      inRange: false,
      dead: false,
    });
    expect(first).toEqual({ phase: "walking", effect: "walkToNpc" });

    // A repeat tick while still walking must NOT re-queue the moveTo intent.
    const second = nextNpcTripStep(first.phase, {
      inTown: true,
      inRange: false,
      dead: false,
    });
    expect(second).toEqual({ phase: "walking", effect: null });
  });

  it("opens the panel the instant in-range, from either traveling or walking", () => {
    expect(
      nextNpcTripStep("traveling", { inTown: true, inRange: true, dead: false }),
    ).toEqual({ phase: "idle", effect: "openPanel" });
    expect(
      nextNpcTripStep("walking", { inTown: true, inRange: true, dead: false }),
    ).toEqual({ phase: "idle", effect: "openPanel" });
  });

  it("walking reverts to traveling if the hero somehow leaves town", () => {
    expect(
      nextNpcTripStep("walking", { inTown: false, inRange: false, dead: false }),
    ).toEqual({ phase: "traveling", effect: null });
  });

  // The pure machine itself is npc-agnostic (which npc is targeted lives in
  // `gameStore.ts`'s `npcTripTarget`, not here) — these cases just confirm
  // the SAME transitions hold regardless of which npc the caller is walking
  // toward (pahpu/elder, not just the original lungdueng-only smithTrip).
  it("behaves identically for a pahpu-shaped trip (mutual-exclusion/target selection lives in the store, not here)", () => {
    expect(
      nextNpcTripStep("traveling", { inTown: true, inRange: false, dead: false }),
    ).toEqual({ phase: "walking", effect: "walkToNpc" });
    expect(
      nextNpcTripStep("walking", { inTown: true, inRange: true, dead: false }),
    ).toEqual({ phase: "idle", effect: "openPanel" });
  });

  it("behaves identically for a questboard-shaped trip", () => {
    expect(
      nextNpcTripStep("traveling", { inTown: false, inRange: false, dead: false }),
    ).toEqual({ phase: "traveling", effect: null });
    expect(
      nextNpcTripStep("traveling", { inTown: true, inRange: true, dead: false }),
    ).toEqual({ phase: "idle", effect: "openPanel" });
  });
});
