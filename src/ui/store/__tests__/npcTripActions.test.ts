/**
 * R2.5-W3 — store-level wiring tests for the GENERALIZED `startNpcTrip(npcId)`/
 * `cancelNpcTrip`/`advanceNpcTrip` (was smith-only `startSmithTrip` before this
 * wave). Covers: parity with the original smith case (`npc:lungdueng`), the two
 * NEW npc targets (`npc:pahpu`/`npc:elder`), the cancel-on-other-command wiring
 * (`queueMoveTo`/`queueAttackTarget`/`queueFastTravel`/`queueWarpScroll`/
 * `talkToNpc`-equivalent explicit cancel), and mutual exclusion with `gateTrip`
 * (the OTHER direction is pinned in `gateTripActions.test.ts`). The pure
 * phase-transition decision itself is covered headlessly in
 * `ui/world/__tests__/npcTrip.test.ts`; this file only exercises the STORE glue.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { useGameStore, type HeroSummary } from "@/ui/store/gameStore";

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

const NOT_IN_RANGE = {
  "npc:pahpu": false,
  "npc:lungdueng": false,
  "npc:elder": false,
} as const;

describe("npc trip store wiring", () => {
  beforeEach(() => {
    useGameStore.getState().drainPendingInput();
    useGameStore.setState({
      world: WORLD_FARM,
      npcTrip: "idle",
      npcTripTarget: null,
      gateTrip: "idle",
      gateTripTarget: null,
      heroes: heroAt(400),
      npcInRange: { ...NOT_IN_RANGE },
      activeTownPanel: null,
    });
  });

  describe("smith parity (npc:lungdueng — the original M7.6 case)", () => {
    it("outside town: arms 'traveling' + queues fastTravel to the town map", () => {
      useGameStore.getState().startNpcTrip("npc:lungdueng");
      const s = useGameStore.getState();
      expect(s.npcTrip).toBe("traveling");
      expect(s.npcTripTarget).toBe("npc:lungdueng");
      expect(s.pendingInput.fastTravel).toEqual({ mapId: "map1", zoneIdx: 0 });
    });

    it("in town, out of range: arms 'walking' + queues moveTo to lungdueng's anchor (x=560)", () => {
      useGameStore.setState({ world: WORLD_TOWN, heroes: heroAt(50) });
      useGameStore.getState().startNpcTrip("npc:lungdueng");
      const s = useGameStore.getState();
      expect(s.npcTrip).toBe("walking");
      expect(s.npcTripTarget).toBe("npc:lungdueng");
      expect(s.pendingInput.moveTo).toEqual({ x: 560 });
    });

    it("in town, already in range: opens the lungdueng panel immediately, no trip armed", () => {
      useGameStore.setState({
        world: WORLD_TOWN,
        npcInRange: { ...NOT_IN_RANGE, "npc:lungdueng": true },
      });
      useGameStore.getState().startNpcTrip("npc:lungdueng");
      const s = useGameStore.getState();
      expect(s.npcTrip).toBe("idle");
      expect(s.activeTownPanel).toBe("lungdueng");
    });

    it("advanceNpcTrip opens the panel + ends the trip once in range", () => {
      useGameStore.setState({
        world: WORLD_TOWN,
        npcTrip: "walking",
        npcTripTarget: "npc:lungdueng",
        npcInRange: { ...NOT_IN_RANGE, "npc:lungdueng": true },
      });
      useGameStore.getState().advanceNpcTrip();
      const s = useGameStore.getState();
      expect(s.npcTrip).toBe("idle");
      expect(s.npcTripTarget).toBeNull();
      expect(s.activeTownPanel).toBe("lungdueng");
    });
  });

  describe("npc:pahpu (new target)", () => {
    it("in town, out of range: walks to pahpu's anchor (x=230)", () => {
      useGameStore.setState({ world: WORLD_TOWN, heroes: heroAt(700) });
      useGameStore.getState().startNpcTrip("npc:pahpu");
      const s = useGameStore.getState();
      expect(s.npcTrip).toBe("walking");
      expect(s.npcTripTarget).toBe("npc:pahpu");
      expect(s.pendingInput.moveTo).toEqual({ x: 230 });
    });

    it("resolves to the 'pahpu' town panel on arrival", () => {
      useGameStore.setState({
        world: WORLD_TOWN,
        npcTrip: "walking",
        npcTripTarget: "npc:pahpu",
        npcInRange: { ...NOT_IN_RANGE, "npc:pahpu": true },
      });
      useGameStore.getState().advanceNpcTrip();
      expect(useGameStore.getState().activeTownPanel).toBe("pahpu");
    });
  });

  describe("npc:elder / questboard (new target)", () => {
    it("in town, out of range: walks to elder's anchor (x=400)", () => {
      useGameStore.setState({ world: WORLD_TOWN, heroes: heroAt(0) });
      useGameStore.getState().startNpcTrip("npc:elder");
      const s = useGameStore.getState();
      expect(s.npcTrip).toBe("walking");
      expect(s.npcTripTarget).toBe("npc:elder");
      expect(s.pendingInput.moveTo).toEqual({ x: 400 });
    });

    it("resolves to the 'board' town panel on arrival (not literally 'elder')", () => {
      useGameStore.setState({
        world: WORLD_TOWN,
        npcTrip: "walking",
        npcTripTarget: "npc:elder",
        npcInRange: { ...NOT_IN_RANGE, "npc:elder": true },
      });
      useGameStore.getState().advanceNpcTrip();
      expect(useGameStore.getState().activeTownPanel).toBe("board");
    });
  });

  describe("cancel wiring", () => {
    it("cancelNpcTrip is a no-op while idle, clears an active trip otherwise", () => {
      useGameStore.getState().cancelNpcTrip();
      expect(useGameStore.getState().npcTrip).toBe("idle");

      useGameStore.getState().startNpcTrip("npc:pahpu");
      useGameStore.getState().cancelNpcTrip();
      expect(useGameStore.getState().npcTrip).toBe("idle");
      expect(useGameStore.getState().npcTripTarget).toBeNull();
    });

    it("queueMoveTo (tap ground elsewhere) cancels an in-flight npc trip", () => {
      useGameStore.getState().startNpcTrip("npc:pahpu");
      useGameStore.getState().queueMoveTo(200);
      expect(useGameStore.getState().npcTrip).toBe("idle");
      expect(useGameStore.getState().npcTripTarget).toBeNull();
    });

    it("queueAttackTarget (tap a monster) cancels an in-flight npc trip", () => {
      useGameStore.getState().startNpcTrip("npc:pahpu");
      useGameStore.getState().queueAttackTarget(7);
      expect(useGameStore.getState().npcTrip).toBe("idle");
      expect(useGameStore.getState().npcTripTarget).toBeNull();
    });

    it("queueFastTravel cancels an in-flight npc trip", () => {
      useGameStore.setState({ world: WORLD_TOWN, heroes: heroAt(700) });
      useGameStore.getState().startNpcTrip("npc:pahpu"); // walking (in town, out of range)
      useGameStore.getState().queueFastTravel({ mapId: "map2", zoneIdx: 0 });
      expect(useGameStore.getState().npcTrip).toBe("idle");
      expect(useGameStore.getState().npcTripTarget).toBeNull();
    });

    it("queueWarpScroll cancels an in-flight npc trip", () => {
      useGameStore.setState({ world: WORLD_TOWN, heroes: heroAt(700) });
      useGameStore.getState().startNpcTrip("npc:pahpu");
      useGameStore.getState().queueWarpScroll({ mapId: "map2", zoneIdx: 1 });
      expect(useGameStore.getState().npcTrip).toBe("idle");
      expect(useGameStore.getState().npcTripTarget).toBeNull();
    });
  });

  describe("death + mutual exclusion", () => {
    it("advanceNpcTrip: hero dies mid-walk -> silently cancels", () => {
      useGameStore.setState({
        world: WORLD_TOWN,
        npcTrip: "walking",
        npcTripTarget: "npc:pahpu",
        heroes: heroAt(700, true),
      });
      useGameStore.getState().advanceNpcTrip();
      expect(useGameStore.getState().npcTrip).toBe("idle");
      expect(useGameStore.getState().activeTownPanel).toBeNull();
    });

    it("startNpcTrip cancels an in-flight gate trip (mutual exclusion)", () => {
      useGameStore.setState({
        gateTrip: "walking",
        gateTripTarget: {
          gateX: 876,
          destination: { mapId: "map1", zoneIdx: 3 },
          originZone: { mapId: "map1", zoneIdx: 2 },
          armedAt: Date.now(),
        },
      });
      useGameStore.getState().startNpcTrip("npc:elder");
      expect(useGameStore.getState().gateTrip).toBe("idle");
      expect(useGameStore.getState().gateTripTarget).toBeNull();
    });
  });
});
