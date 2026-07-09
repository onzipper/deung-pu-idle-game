/**
 * Owner UX round (2026-07-09) "เดินไปที่ประตูก่อน แล้วค่อยวาป" — store-level wiring
 * tests for `startGateTrip`/`cancelGateTrip`/`advanceGateTrip` and every OTHER
 * store action that must cancel an in-flight gate trip as a side effect
 * (mirrors `smithTrip`'s own cancel wiring, which has no dedicated store-level
 * test file — this one exists because the brief calls out "each cancel
 * reason" as something to pin). The pure arrival/timeout/death/zone-change
 * decision itself is covered headlessly in `ui/world/__tests__/gateTrip.test.ts`;
 * this file only exercises the STORE glue around it.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { useGameStore, type HeroSummary } from "@/ui/store/gameStore";
import { GATE_TRIP_TIMEOUT_MS } from "@/ui/world/gateTrip";

const WORLD_FARM = {
  mapId: "map1",
  zoneIdx: 2,
  kind: "farm" as const,
  stage: 2,
  traveling: false,
  left: null,
  right: null,
};

const WORLD_TOWN = {
  mapId: "map1",
  zoneIdx: 0,
  kind: "town" as const,
  stage: 0,
  traveling: false,
  left: null,
  right: null,
};

/** A minimal, type-valid `HeroSummary` fixture — only `x`/`dead` vary per test. */
function heroAt(x: number, dead = false): HeroSummary[] {
  return [
    {
      cls: "swordsman",
      hp: 100,
      maxHp: 100,
      x,
      skillCd: 0,
      atkBuffMult: 1,
      atkBuffTimer: 0,
      mana: 10,
      maxMana: 10,
      skills: [],
      autoSlots: [null, null, null],
      unlockedSlots: 1,
      dead,
      level: 1,
      xpProgress: 0,
      atLevelCap: false,
      tier: 1,
      canEvolve: false,
      quest: null,
      statPoints: 0,
      stats: { str: 10, dex: 10, int: 10, vit: 10 },
      primaryStat: "str",
      combatPower: 0,
      equipped: { weapon: null, armor: null },
      hasCommand: false,
    },
  ];
}

describe("gate trip store wiring", () => {
  beforeEach(() => {
    useGameStore.getState().drainPendingInput();
    useGameStore.setState({
      world: WORLD_FARM,
      gateTrip: "idle",
      gateTripTarget: null,
      smithTrip: "idle",
      heroes: heroAt(400),
    });
  });

  it("startGateTrip arms 'walking' with the origin zone + queues the moveTo intent (never walkToZone yet)", () => {
    useGameStore.getState().startGateTrip(876, { mapId: "map1", zoneIdx: 3 });
    const s = useGameStore.getState();
    expect(s.gateTrip).toBe("walking");
    expect(s.gateTripTarget).toMatchObject({
      gateX: 876,
      destination: { mapId: "map1", zoneIdx: 3 },
      originZone: { mapId: "map1", zoneIdx: 2 },
    });
    expect(s.pendingInput.moveTo).toEqual({ x: 876 });
    expect(s.pendingInput.walkToZone).toBeNull();
  });

  it("startGateTrip cancels an in-flight smith trip (mutual exclusion)", () => {
    useGameStore.setState({ smithTrip: "walking" });
    useGameStore.getState().startGateTrip(876, { mapId: "map1", zoneIdx: 3 });
    expect(useGameStore.getState().smithTrip).toBe("idle");
  });

  it("startSmithTrip cancels an in-flight gate trip (mutual exclusion, the other direction)", () => {
    useGameStore.getState().startGateTrip(876, { mapId: "map1", zoneIdx: 3 });
    expect(useGameStore.getState().gateTrip).toBe("walking");
    useGameStore.getState().startSmithTrip(); // world is farm -> takes the "traveling" branch
    expect(useGameStore.getState().gateTrip).toBe("idle");
    expect(useGameStore.getState().gateTripTarget).toBeNull();
  });

  it("cancelGateTrip is a no-op while idle, clears an active trip otherwise", () => {
    useGameStore.getState().cancelGateTrip();
    expect(useGameStore.getState().gateTrip).toBe("idle");
    expect(useGameStore.getState().gateTripTarget).toBeNull();

    useGameStore.getState().startGateTrip(876, { mapId: "map1", zoneIdx: 3 });
    useGameStore.getState().cancelGateTrip();
    expect(useGameStore.getState().gateTrip).toBe("idle");
    expect(useGameStore.getState().gateTripTarget).toBeNull();
  });

  it("queueMoveTo (tap ground elsewhere) cancels an in-flight gate trip", () => {
    useGameStore.getState().startGateTrip(876, { mapId: "map1", zoneIdx: 3 });
    useGameStore.getState().queueMoveTo(200);
    expect(useGameStore.getState().gateTrip).toBe("idle");
    expect(useGameStore.getState().gateTripTarget).toBeNull();
    expect(useGameStore.getState().pendingInput.moveTo).toEqual({ x: 200 });
  });

  it("queueAttackTarget (tap a monster) cancels an in-flight gate trip", () => {
    useGameStore.getState().startGateTrip(876, { mapId: "map1", zoneIdx: 3 });
    useGameStore.getState().queueAttackTarget(7);
    expect(useGameStore.getState().gateTrip).toBe("idle");
    expect(useGameStore.getState().gateTripTarget).toBeNull();
  });

  it("queueFastTravel cancels an in-flight gate trip", () => {
    useGameStore.getState().startGateTrip(876, { mapId: "map1", zoneIdx: 3 });
    useGameStore.getState().queueFastTravel({ mapId: "map1", zoneIdx: 0 });
    expect(useGameStore.getState().gateTrip).toBe("idle");
    expect(useGameStore.getState().gateTripTarget).toBeNull();
  });

  it("queueWarpScroll cancels an in-flight gate trip", () => {
    useGameStore.getState().startGateTrip(876, { mapId: "map1", zoneIdx: 3 });
    useGameStore.getState().queueWarpScroll({ mapId: "map2", zoneIdx: 1 });
    expect(useGameStore.getState().gateTrip).toBe("idle");
    expect(useGameStore.getState().gateTripTarget).toBeNull();
  });

  it("advanceGateTrip is a no-op while idle", () => {
    const before = useGameStore.getState();
    useGameStore.getState().advanceGateTrip();
    expect(useGameStore.getState()).toBe(before);
  });

  it("advanceGateTrip: hero still far away -> stays walking, no walkToZone queued", () => {
    useGameStore.getState().startGateTrip(876, { mapId: "map1", zoneIdx: 3 });
    useGameStore.setState({ heroes: heroAt(400) });
    useGameStore.getState().advanceGateTrip();
    expect(useGameStore.getState().gateTrip).toBe("walking");
    expect(useGameStore.getState().pendingInput.walkToZone).toBeNull();
  });

  it("advanceGateTrip: hero within the arrive radius -> fires walkToZone exactly once and ends the trip", () => {
    useGameStore.getState().startGateTrip(876, { mapId: "map1", zoneIdx: 3 });
    useGameStore.setState({ heroes: heroAt(876) });
    useGameStore.getState().advanceGateTrip();
    expect(useGameStore.getState().gateTrip).toBe("idle");
    expect(useGameStore.getState().gateTripTarget).toBeNull();
    expect(useGameStore.getState().pendingInput.walkToZone).toEqual({ mapId: "map1", zoneIdx: 3 });

    // A repeat tick (same hero position, trip already idle) must not re-fire.
    useGameStore.getState().drainPendingInput();
    useGameStore.getState().advanceGateTrip();
    expect(useGameStore.getState().pendingInput.walkToZone).toBeNull();
  });

  it("advanceGateTrip: hero dies mid-walk -> silently cancels, no walkToZone", () => {
    useGameStore.getState().startGateTrip(876, { mapId: "map1", zoneIdx: 3 });
    useGameStore.setState({ heroes: heroAt(400, true) });
    useGameStore.getState().advanceGateTrip();
    expect(useGameStore.getState().gateTrip).toBe("idle");
    expect(useGameStore.getState().pendingInput.walkToZone).toBeNull();
  });

  it("advanceGateTrip: zone changed by some OTHER means -> silently cancels", () => {
    useGameStore.getState().startGateTrip(876, { mapId: "map1", zoneIdx: 3 });
    useGameStore.setState({ world: { ...WORLD_FARM, zoneIdx: 3 } }); // moved without us
    useGameStore.getState().advanceGateTrip();
    expect(useGameStore.getState().gateTrip).toBe("idle");
    expect(useGameStore.getState().pendingInput.walkToZone).toBeNull();
  });

  it("advanceGateTrip: times out after GATE_TRIP_TIMEOUT_MS still out of range", () => {
    useGameStore.getState().startGateTrip(876, { mapId: "map1", zoneIdx: 3 });
    const target = useGameStore.getState().gateTripTarget!;
    useGameStore.setState({
      gateTripTarget: { ...target, armedAt: Date.now() - GATE_TRIP_TIMEOUT_MS - 1 },
      heroes: heroAt(400),
    });
    useGameStore.getState().advanceGateTrip();
    expect(useGameStore.getState().gateTrip).toBe("idle");
    expect(useGameStore.getState().pendingInput.walkToZone).toBeNull();
  });

  it("works from the town zone too (town manual walk shares the same moveTo/walkToZone intents)", () => {
    useGameStore.setState({ world: WORLD_TOWN, heroes: heroAt(50) });
    useGameStore.getState().startGateTrip(55, { mapId: "map1", zoneIdx: 0 });
    expect(useGameStore.getState().gateTripTarget?.originZone).toEqual({ mapId: "map1", zoneIdx: 0 });
    useGameStore.setState({ heroes: heroAt(55) });
    useGameStore.getState().advanceGateTrip();
    expect(useGameStore.getState().gateTrip).toBe("idle");
    expect(useGameStore.getState().pendingInput.walkToZone).toEqual({ mapId: "map1", zoneIdx: 0 });
  });
});
