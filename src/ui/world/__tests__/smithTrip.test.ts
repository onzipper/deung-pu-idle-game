import { describe, expect, it } from "vitest";
import { nextSmithTripStep } from "../smithTrip";

describe("nextSmithTripStep", () => {
  it("idle is always a no-op passthrough", () => {
    expect(
      nextSmithTripStep("idle", { inTown: true, inRange: true, dead: false }),
    ).toEqual({ phase: "idle", effect: null });
    expect(
      nextSmithTripStep("idle", { inTown: false, inRange: false, dead: true }),
    ).toEqual({ phase: "idle", effect: null });
  });

  it("death cancels silently from any active phase", () => {
    expect(
      nextSmithTripStep("traveling", { inTown: false, inRange: false, dead: true }),
    ).toEqual({ phase: "idle", effect: null });
    expect(
      nextSmithTripStep("walking", { inTown: true, inRange: false, dead: true }),
    ).toEqual({ phase: "idle", effect: null });
  });

  it("stays traveling while still outside town", () => {
    expect(
      nextSmithTripStep("traveling", { inTown: false, inRange: false, dead: false }),
    ).toEqual({ phase: "traveling", effect: null });
  });

  it("transitions traveling -> walking exactly once on town arrival, out of range", () => {
    const first = nextSmithTripStep("traveling", {
      inTown: true,
      inRange: false,
      dead: false,
    });
    expect(first).toEqual({ phase: "walking", effect: "walkToSmith" });

    // A repeat tick while still walking must NOT re-queue the moveTo intent.
    const second = nextSmithTripStep(first.phase, {
      inTown: true,
      inRange: false,
      dead: false,
    });
    expect(second).toEqual({ phase: "walking", effect: null });
  });

  it("opens the panel the instant in-range, from either traveling or walking", () => {
    expect(
      nextSmithTripStep("traveling", { inTown: true, inRange: true, dead: false }),
    ).toEqual({ phase: "idle", effect: "openPanel" });
    expect(
      nextSmithTripStep("walking", { inTown: true, inRange: true, dead: false }),
    ).toEqual({ phase: "idle", effect: "openPanel" });
  });

  it("walking reverts to traveling if the hero somehow leaves town", () => {
    expect(
      nextSmithTripStep("walking", { inTown: false, inRange: false, dead: false }),
    ).toEqual({ phase: "traveling", effect: null });
  });
});
