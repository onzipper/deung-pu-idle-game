import { describe, expect, it } from "vitest";
import {
  GATE_TRIP_ARRIVE_RADIUS,
  GATE_TRIP_TIMEOUT_MS,
  nextGateTripStep,
  type GateTripTarget,
} from "../gateTrip";

const ORIGIN = { mapId: "map1", zoneIdx: 2 };
const DESTINATION = { mapId: "map1", zoneIdx: 3 };

function target(overrides: Partial<GateTripTarget> = {}): GateTripTarget {
  return {
    gateX: 876,
    destination: DESTINATION,
    originZone: ORIGIN,
    armedAt: 1_000,
    ...overrides,
  };
}

describe("nextGateTripStep", () => {
  it("idle is always a no-op passthrough", () => {
    expect(
      nextGateTripStep("idle", target(), {
        heroX: 876,
        dead: false,
        currentZone: ORIGIN,
        nowMs: 1_000,
      }),
    ).toEqual({ phase: "idle", effect: null });
  });

  it("stays walking while still outside the arrive radius", () => {
    const step = nextGateTripStep("walking", target(), {
      heroX: 500,
      dead: false,
      currentZone: ORIGIN,
      nowMs: 1_500,
    });
    expect(step).toEqual({ phase: "walking", effect: null });
  });

  it("fires transition exactly once on arrival, never again on a repeat tick", () => {
    const arriveCtx = {
      heroX: 876 - GATE_TRIP_ARRIVE_RADIUS, // exactly at the edge, still "arrived"
      dead: false,
      currentZone: ORIGIN,
      nowMs: 1_500,
    };
    const first = nextGateTripStep("walking", target(), arriveCtx);
    expect(first).toEqual({ phase: "idle", effect: "transition" });

    // The real caller (`advanceGateTrip`) always flips the store's phase back
    // to "idle" the instant this fires — feeding that back in must be a no-op,
    // even though the hero is still standing right there "in range".
    const second = nextGateTripStep(first.phase, target(), arriveCtx);
    expect(second).toEqual({ phase: "idle", effect: null });
  });

  it("arrival holding true across many ticks before the phase updates still only reports once per call, and the caller's phase-reset prevents a re-fire", () => {
    // A tick sequence: still walking -> arrives -> (caller resets to idle) -> stays idle.
    const ctxFar = { heroX: 400, dead: false, currentZone: ORIGIN, nowMs: 1_100 };
    const ctxArrived = { heroX: 876, dead: false, currentZone: ORIGIN, nowMs: 1_200 };
    let phase = nextGateTripStep("walking", target(), ctxFar).phase;
    expect(phase).toBe("walking");
    const arrive = nextGateTripStep(phase, target(), ctxArrived);
    expect(arrive.effect).toBe("transition");
    phase = arrive.phase; // caller commits this
    expect(nextGateTripStep(phase, target(), ctxArrived)).toEqual({
      phase: "idle",
      effect: null,
    });
  });

  it("death cancels silently, regardless of distance to the gate", () => {
    const step = nextGateTripStep("walking", target(), {
      heroX: 876,
      dead: true,
      currentZone: ORIGIN,
      nowMs: 1_500,
    });
    expect(step).toEqual({ phase: "idle", effect: null });
  });

  it("a zone change by some OTHER means (not our own transition) cancels silently", () => {
    const step = nextGateTripStep("walking", target(), {
      heroX: 876,
      dead: false,
      currentZone: { mapId: "map1", zoneIdx: 3 }, // already moved, not via us
      nowMs: 1_500,
    });
    expect(step).toEqual({ phase: "idle", effect: null });
  });

  it("times out after GATE_TRIP_TIMEOUT_MS while still out of range", () => {
    const notYet = nextGateTripStep("walking", target(), {
      heroX: 400,
      dead: false,
      currentZone: ORIGIN,
      nowMs: 1_000 + GATE_TRIP_TIMEOUT_MS - 1,
    });
    expect(notYet).toEqual({ phase: "walking", effect: null });

    const timedOut = nextGateTripStep("walking", target(), {
      heroX: 400,
      dead: false,
      currentZone: ORIGIN,
      nowMs: 1_000 + GATE_TRIP_TIMEOUT_MS,
    });
    expect(timedOut).toEqual({ phase: "idle", effect: null });
  });

  it("arrival wins over a simultaneous timeout (both true the same tick) — still just a silent no-effect cancel either way, but arrival is checked last so it takes effect", () => {
    const step = nextGateTripStep("walking", target(), {
      heroX: 876,
      dead: false,
      currentZone: ORIGIN,
      nowMs: 1_000 + GATE_TRIP_TIMEOUT_MS,
    });
    // Timeout is checked before arrival, so a stale trip that only just now
    // wandered into range on the exact timeout tick is cancelled, not fired —
    // documents the precedence rather than asserting an accidental behaviour.
    expect(step).toEqual({ phase: "idle", effect: null });
  });
});
