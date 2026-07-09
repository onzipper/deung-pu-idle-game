import { describe, expect, it } from "vitest";
import { createAccumulator, FIXED_DT } from "@/engine";
import type { PendingInput } from "@/ui/store/gameStore";
import { drainSoloFrame } from "../soloFrameDrain";

function emptyPending(): PendingInput {
  return {
    castSkills: [],
    setAutoSlots: [],
    challengeBoss: false,
    advanceStage: false,
    walkToZone: null,
    evolveHero: null,
    acceptQuest: null,
    allocateStat: null,
    buyShopItem: null,
    useConsumable: null,
    useReturnScroll: false,
    equip: null,
    setBotSettings: null,
    fastTravel: null,
    goldCredit: null,
    setAutoHunt: null,
    materialsDelta: null,
    moveTo: null,
    attackTarget: null,
    cancelCommand: false,
    setDailies: null,
    claimDaily: null,
    claimMainReward: null,
    useWarpScroll: null,
    spawnWorldBoss: null,
    syncWorldBoss: null,
    setAsuraHotZone: null,
    claimAsuraSigil: false,
    craftLegendary: false,
  };
}

describe("drainSoloFrame", () => {
  it("(a) a fresh accumulator fed an 8.3ms (120Hz) frame yields 0 steps and never drains", () => {
    const acc = createAccumulator();
    let drainCalls = 0;
    const result = drainSoloFrame(acc, 1 / 120, 1, () => {
      drainCalls++;
      return emptyPending();
    });
    expect(result.steps).toBe(0);
    expect(result.pending).toBeNull();
    expect(drainCalls).toBe(0);
  });

  it("(b) a second 8.3ms frame crosses FIXED_DT: 1 step, drain called once, pending returned", () => {
    const acc = createAccumulator();
    let drainCalls = 0;
    const drain = () => {
      drainCalls++;
      return emptyPending();
    };
    const first = drainSoloFrame(acc, 1 / 120, 1, drain);
    expect(first.steps).toBe(0);
    const second = drainSoloFrame(acc, 1 / 120, 1, drain);
    expect(second.steps).toBe(1);
    expect(drainCalls).toBe(1);
    expect(second.pending).not.toBeNull();
  });

  it("(c) boot simulation: a queued setAutoHunt(false) survives three 120Hz frames and is delivered exactly once, never lost", () => {
    // Fake store: a single-slot mutable queue, mirroring `pendingInput`/`drainPendingInput`.
    let queued: PendingInput | null = { ...emptyPending(), setAutoHunt: false };
    const fakeDrain = (): PendingInput => {
      const p = queued ?? emptyPending();
      queued = null; // store clears its queue on drain, same as the real store
      return p;
    };

    const acc = createAccumulator();
    const delivered: (boolean | null)[] = [];
    // Three consecutive 120Hz frames (~8.3ms each). Frame 1 (fresh accumulator) is
    // guaranteed 0-step; by frame 3 the accumulator has crossed FIXED_DT (1/60s).
    for (let i = 0; i < 3; i++) {
      const { steps, pending } = drainSoloFrame(acc, 1 / 120, 1, fakeDrain);
      if (steps > 0 && pending) {
        delivered.push(pending.setAutoHunt);
      }
    }

    // Delivered exactly once, with the correct value, and the fake store's queue was
    // never drained-and-discarded on a 0-step frame (it would otherwise reset to null
    // before ever being picked up).
    expect(delivered).toEqual([false]);
  });

  it("(d) a 60Hz frame (16.7ms) drains immediately — regression guard for the common case", () => {
    const acc = createAccumulator();
    let drainCalls = 0;
    const result = drainSoloFrame(acc, 1 / 60 + 0.0001, 1, () => {
      drainCalls++;
      return emptyPending();
    });
    expect(result.steps).toBeGreaterThanOrEqual(1);
    expect(drainCalls).toBe(1);
    expect(result.pending).not.toBeNull();
  });

  it("FIXED_DT sanity: exactly one 1/60s frame yields exactly 1 step", () => {
    const acc = createAccumulator();
    const { steps } = drainSoloFrame(acc, FIXED_DT, 1, () => emptyPending());
    expect(steps).toBe(1);
  });
});
