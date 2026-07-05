import { describe, it, expect } from "vitest";
import {
  CONFIG,
  SAVE_VERSION,
  initGameState,
  migrate,
  step,
  toSaveData,
  zoneAt,
  worldNav,
  isZoneUnlocked,
  type GameState,
} from "@/engine";
import { soloSave, runUntil, worldAutopilot } from "./helpers";

/**
 * M6 "World & Town" (ROADMAP task 1): zone navigation, unlock progression,
 * backtrack farming, death -> town -> auto-return, SAVE v7->v8 migration, and
 * offline replay across a death. All deterministic (no RNG in the world layer).
 */

/** Fully unlock the world so a test can navigate freely (validates unlock reads). */
function unlockAll(s: GameState): void {
  s.unlockedZones = { map1: 7, map2: 6, map3: 6 };
}

describe("navigation: adjacency + locks", () => {
  it("a fresh hero starts in the first farm zone (map1, stage 1)", () => {
    const s = initGameState(1);
    expect(s.location).toEqual({ mapId: "map1", zoneIdx: 1 });
    expect(zoneAt(s.location).kind).toBe("farm");
    expect(s.stage).toBe(1);
  });

  it("rejects walking to a LOCKED adjacent zone (next farm zone starts locked)", () => {
    const s = initGameState(1);
    const nav = worldNav(s);
    expect(nav.right?.zone.zoneIdx).toBe(2); // the next farm zone
    expect(nav.right?.unlocked).toBe(false); // locked until zone 1's quota is met
    step(s, { walkToZone: { mapId: "map1", zoneIdx: 2 } });
    expect(s.traveling).toBeNull();
    expect(s.location).toEqual({ mapId: "map1", zoneIdx: 1 });
  });

  it("rejects walking to a NON-ADJACENT zone even when unlocked", () => {
    const s = initGameState(1);
    unlockAll(s);
    step(s, { walkToZone: { mapId: "map1", zoneIdx: 4 } }); // 3 zones away
    expect(s.traveling).toBeNull();
    expect(s.location).toEqual({ mapId: "map1", zoneIdx: 1 });
  });

  it("walks to an adjacent unlocked zone via a deterministic, brief transit", () => {
    const s = initGameState(1);
    unlockAll(s);
    step(s, { walkToZone: { mapId: "map1", zoneIdx: 2 } });
    expect(s.traveling).not.toBeNull();
    expect(s.location).toEqual({ mapId: "map1", zoneIdx: 1 }); // not yet arrived

    // Transit lasts exactly CONFIG.world.transitSeconds (negligible).
    const steps = runUntil(s, (st) => st.traveling === null, 1000);
    expect(steps).toBe(true);
    expect(s.location).toEqual({ mapId: "map1", zoneIdx: 2 });
    expect(s.stage).toBe(2); // stage tracks the arrived zone
    // The arrival step emitted zoneEntered (the step runUntil stopped on).
    expect(s.events.some((e) => e.type === "zoneEntered")).toBe(true);
  });

  it("cannot start a second walk while already traveling", () => {
    const s = initGameState(1);
    unlockAll(s);
    step(s, { walkToZone: { mapId: "map1", zoneIdx: 2 } });
    const dest = { ...s.traveling };
    step(s, { walkToZone: { mapId: "map1", zoneIdx: 0 } }); // ignored mid-transit
    expect(s.traveling?.targetZoneIdx).toBe(dest.targetZoneIdx);
  });
});

describe("unlock progression", () => {
  it("clearing a farm zone's kill quota unlocks the next zone + grants a reward", () => {
    const s = initGameState(1);
    const goldBefore = s.gold;
    const xpBefore = s.heroes[0].xp + s.heroes[0].level * 1e6; // monotone proxy
    expect(isZoneUnlocked(s, { mapId: "map1", zoneIdx: 2 })).toBe(false);

    s.kills = CONFIG.killGoal(s.stage);
    step(s, {}); // checkZoneUnlock unlocks zone 2

    expect(isZoneUnlocked(s, { mapId: "map1", zoneIdx: 2 })).toBe(true);
    expect(s.events.some((e) => e.type === "zoneUnlocked")).toBe(true);
    // Reward parity with the old per-stage boss (xp + gold jump).
    const xpAfter = s.heroes[0].xp + s.heroes[0].level * 1e6;
    expect(xpAfter).toBeGreaterThan(xpBefore);
    expect(s.gold).toBeGreaterThanOrEqual(goldBefore + CONFIG.goldPerBoss(1));
  });

  it("beating the map's boss room unlocks the next MAP (mapUnlocked)", () => {
    const s = initGameState(1);
    // Stand at the last farm zone of map1 with the boss room unlocked, then walk in.
    s.location = { mapId: "map1", zoneIdx: 5 };
    s.stage = 5;
    s.unlockedZones = { map1: 7 };
    step(s, { walkToZone: { mapId: "map1", zoneIdx: 6 } }); // into the boss room
    expect(runUntil(s, (st) => st.phase === "boss", 500)).toBe(true);
    expect(zoneAt(s.location).kind).toBe("boss");
    expect(s.events.some((e) => e.type === "bossRoomEntered")).toBe(true);

    s.boss!.hp = 0;
    step(s, {}); // onBossKilled -> victory + onBossRoomCleared

    expect(s.phase).toBe("victory");
    expect(s.events.some((e) => e.type === "mapUnlocked")).toBe(true);
    expect(isZoneUnlocked(s, { mapId: "map2", zoneIdx: 0 })).toBe(true);

    // From victory, advanceStage walks into map2's first zone.
    step(s, { advanceStage: true });
    expect(runUntil(s, (st) => st.location.mapId === "map2", 500)).toBe(true);
    expect(s.stage).toBe(6);
  });
});

describe("backtrack farming", () => {
  it("re-clearing an already-unlocked zone grants no second reward", () => {
    const s = initGameState(1);
    unlockAll(s); // zone 2 already unlocked
    s.kills = CONFIG.killGoal(s.stage);
    const goldBefore = s.gold;
    step(s, {}); // quota met, but the next zone is already unlocked
    expect(s.events.some((e) => e.type === "zoneUnlocked")).toBe(false);
    // No boss-reward jump — only whatever kill gold the auto-spawned wave produced.
    expect(s.gold).toBeLessThan(goldBefore + CONFIG.goldPerBoss(1));
  });

  it("an unlocked earlier zone is freely re-enterable and farmable", () => {
    const s = initGameState(1, soloSave("swordsman", 3));
    unlockAll(s);
    // Walk back one zone (stage 3 -> stage 2) and confirm it farms there.
    step(s, { walkToZone: { mapId: "map1", zoneIdx: 2 } });
    runUntil(s, (st) => st.traveling === null, 500);
    expect(s.stage).toBe(2);
    const killsBefore = s.kills;
    runUntil(s, (st) => st.kills > killsBefore, 5000);
    expect(s.kills).toBeGreaterThan(killsBefore); // enemies spawn + die here
  });
});

describe("death -> town -> auto-return", () => {
  it("a dead hero walks to town, revives, and auto-returns to the last farm zone", () => {
    const s = initGameState(3, soloSave("swordsman", 2));
    s.autoReturn = true;
    const farmZone = { ...s.lastFarmZone };
    expect(zoneAt(farmZone).kind).toBe("farm");

    s.heroes[0].hp = 0;
    s.heroes[0].dead = true;
    step(s, {}); // resolveDeaths -> respawnToTown
    expect(s.traveling).not.toBeNull();

    // Visits town (revive) then auto-returns to the farm zone.
    const back = runUntil(
      s,
      (st) => st.traveling === null && zoneAt(st.location).kind === "farm" && !st.heroes[0].dead,
      3000,
    );
    expect(back).toBe(true);
    expect(s.location).toEqual(farmZone);
    expect(s.heroes[0].hp).toBe(s.heroes[0].maxHp);
  });

  it("with auto-return OFF the hero waits in town after respawn", () => {
    const s = initGameState(3, soloSave("swordsman", 2));
    s.autoReturn = false;
    s.heroes[0].hp = 0;
    s.heroes[0].dead = true;
    runUntil(s, (st) => st.traveling === null && zoneAt(st.location).kind === "town", 2000);
    expect(zoneAt(s.location).kind).toBe("town");
    // Stays in town (no further transit) — the hero is alive and idle.
    step(s, {});
    expect(s.traveling).toBeNull();
    expect(s.heroes[0].dead).toBe(false);
  });

  it("the death -> town -> auto-return cycle is deterministic", () => {
    function runDeathCycle(): GameState {
      const s = initGameState(42, soloSave("archer", 3));
      s.autoReturn = true;
      s.heroes[0].hp = 0;
      s.heroes[0].dead = true;
      for (let i = 0; i < 800; i++) step(s, {});
      return s;
    }
    expect(JSON.stringify(runDeathCycle())).toBe(JSON.stringify(runDeathCycle()));
  });
});

describe("SAVE v7 -> v8 migration", () => {
  it("places a pre-v8 save at the farm zone matching its stage, unlocking up to it", () => {
    const v7 = {
      version: 7,
      stage: 7, // map2, second farm zone (zoneIdx 1)
      gold: 100,
      hero: { cls: "archer", level: 20, xp: 0, tier: 1 },
      lastSeen: 5,
    };
    const m = migrate(v7);
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.location).toEqual({ mapId: "map2", zoneIdx: 1 });
    expect(m.stage).toBe(7); // re-derived from the placed zone
    expect(m.lastFarmZone).toEqual({ mapId: "map2", zoneIdx: 1 });
    // "all zones up to it": map1 fully unlocked (7 zones), map2 up to zoneIdx 1.
    expect(m.unlockedZones.map1).toBe(7);
    expect(m.unlockedZones.map2).toBe(2);
    expect(m.unlockedZones.map3 ?? 0).toBe(0);
  });

  it("clamps a stage beyond the frontier to the last farm zone", () => {
    const m = migrate({ version: 7, stage: 99, hero: { cls: "mage", level: 40, tier: 1 } });
    expect(zoneAt(m.location).kind).toBe("farm");
    expect(m.location.mapId).toBe("map3");
    expect(m.stage).toBe(15); // last farm zone's stage
  });

  it("round-trips a v8 save through initGameState + toSaveData unchanged", () => {
    const save = migrate({ version: 7, stage: 8, gold: 55, hero: { cls: "mage", level: 22, tier: 2 } });
    const restored = toSaveData(initGameState(9, save));
    expect(restored.location).toEqual(save.location);
    expect(restored.unlockedZones).toEqual(save.unlockedZones);
    expect(restored.lastFarmZone).toEqual(save.lastFarmZone);
    expect(restored.stage).toBe(save.stage);
  });
});

describe("offline replay across a death (never stalls)", () => {
  it("a dead-at-snapshot hero respawns + auto-returns during a pure step() replay", () => {
    // The offline catch-up replays step(state, {}) with auto-return ON. A hero dead
    // at the snapshot must respawn, walk back, and resume farming — never freeze.
    const s = initGameState(7, soloSave("swordsman", 2));
    s.autoReturn = true;
    s.heroes[0].hp = 0;
    s.heroes[0].dead = true;
    const goldStart = s.gold;

    for (let i = 0; i < 20_000; i++) step(s, {}); // offline replay: input-free

    expect(s.heroes[0].dead).toBe(false); // alive again
    expect(zoneAt(s.location).kind).not.toBe("boss"); // not stuck mid boss room
    expect(s.gold).toBeGreaterThan(goldStart); // banked earnings after returning
    expect(s.kills).toBeGreaterThan(0);
  });

  it("the world autopilot progresses across maps without stalling", () => {
    const s = initGameState(11, soloSave("mage", 1));
    s.autoCast = true;
    s.autoReturn = true;
    for (let i = 0; i < 200_000; i++) step(s, worldAutopilot(s));
    // Walked well past the start (into a later map/zone), still alive & farmable.
    expect(s.stage).toBeGreaterThan(1);
    expect(s.location.mapId === "map2" || s.location.mapId === "map3" || s.stage >= 5).toBe(true);
  });
});
