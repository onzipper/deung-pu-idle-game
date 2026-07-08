import { describe, it, expect } from "vitest";
import {
  initGameState,
  step,
  makeHero,
  zoneAt,
  WORLD_BOSS,
  worldBossWindowId,
  worldBossPhaseAt,
  worldBossZoneFor,
  worldBossFarmZones,
  worldBossLocationFor,
} from "@/engine";
import type { GameState, GameEvent, WorldLocation } from "@/engine";
import { FIXED_DT } from "@/engine/core/loop";
import { LockstepClient, stateHash } from "@/engine/lockstep";
import { soloSave } from "./helpers";

/**
 * WORLD BOSS "เสี่ยจ๋อง" (hourly world boss — engine wave). Covers the pure schedule
 * helpers (window/phase/zone), the `spawnWorldBoss` intent (zone/window gating,
 * idempotency, countdown + zone-leave despawn, defeated-blocks-respawn), the byte-
 * identical guards (dormant + no RNG/loot perturbation), the kill flow (no xp/gold/
 * killGoal), and a 2-client lockstep cross-delivery.
 */

const { periodMs, preAnnounceMs, lifetimeMs } = WORLD_BOSS;

/** Seat the hero in the window's chosen world-boss farm zone (battle phase). */
function seatInBossZone(s: GameState, windowId: number): WorldLocation {
  const loc = worldBossLocationFor(windowId);
  if (!loc) throw new Error("no world-boss farm zone");
  s.location = { mapId: loc.mapId, zoneIdx: loc.zoneIdx };
  s.stage = zoneAt(loc).stage;
  s.phase = "battle";
  return loc;
}

/** Freeze the normal mob field so a test isolates the world boss. */
function isolate(s: GameState): void {
  s.spawnPaused = true;
  s.spawnBurst = false;
  s.enemies = [];
}

const eventTypes = (s: GameState, t: GameEvent["type"]): number =>
  s.events.filter((e) => e.type === t).length;

// ---------------------------------------------------------------------------
// Pure schedule helpers.
// ---------------------------------------------------------------------------

describe("worldBoss schedule helpers", () => {
  it("worldBossWindowId floors nowMs into hour windows", () => {
    expect(worldBossWindowId(0)).toBe(0);
    expect(worldBossWindowId(periodMs - 1)).toBe(0);
    expect(worldBossWindowId(periodMs)).toBe(1);
    expect(worldBossWindowId(periodMs * 3 + 5)).toBe(3);
  });

  it("worldBossPhaseAt resolves active/pre/idle at exact ms edges", () => {
    // Start of the hour — active, full lifetime remaining, no spawn wait.
    expect(worldBossPhaseAt(0)).toEqual({
      phase: "active",
      windowId: 0,
      msToSpawn: 0,
      msRemaining: lifetimeMs,
    });
    // Last active ms.
    expect(worldBossPhaseAt(lifetimeMs - 1)).toMatchObject({ phase: "active", windowId: 0, msRemaining: 1 });
    // Exactly at lifetime — active window just ended -> idle (far from next hour).
    expect(worldBossPhaseAt(lifetimeMs)).toMatchObject({ phase: "idle", windowId: 1, msRemaining: 0 });
    // First pre-announce ms (period - preAnnounce) — points at the UPCOMING window.
    expect(worldBossPhaseAt(periodMs - preAnnounceMs)).toEqual({
      phase: "pre",
      windowId: 1,
      msToSpawn: preAnnounceMs,
      msRemaining: lifetimeMs,
    });
    // One ms earlier is still idle (just outside the pre window).
    expect(worldBossPhaseAt(periodMs - preAnnounceMs - 1)).toMatchObject({ phase: "idle", windowId: 1 });
    // Last ms before the hour — pre, 1 ms to spawn.
    expect(worldBossPhaseAt(periodMs - 1)).toMatchObject({ phase: "pre", windowId: 1, msToSpawn: 1 });
    // The next hour rolls over into the next active window.
    expect(worldBossPhaseAt(periodMs)).toMatchObject({ phase: "active", windowId: 1 });
  });

  it("worldBossZoneFor spreads across zones and collapses to 0 for one zone", () => {
    expect(worldBossZoneFor(0, 1)).toBe(0);
    expect(worldBossZoneFor(12345, 1)).toBe(0);
    const count = worldBossFarmZones().length;
    expect(count).toBeGreaterThan(1);
    const seen = new Set<number>();
    for (let w = 0; w < 200; w++) {
      const z = worldBossZoneFor(w, count);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThan(count);
      seen.add(z);
    }
    // FNV over the windowId digits must reach at least a few distinct zones.
    expect(seen.size).toBeGreaterThan(1);
  });

  it("worldBossLocationFor resolves the chosen zone to a real map1 farm zone", () => {
    const loc = worldBossLocationFor(0)!;
    expect(loc.mapId).toBe(WORLD_BOSS.mapId);
    expect(zoneAt(loc).kind).toBe("farm");
  });
});

// ---------------------------------------------------------------------------
// Spawn intent.
// ---------------------------------------------------------------------------

describe("worldBoss spawn intent", () => {
  it("spawns only in the chosen zone + window", () => {
    const wid = 3;
    // Right zone -> spawns.
    const s = initGameState(1, soloSave("mage", 1));
    seatInBossZone(s, wid);
    isolate(s);
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds: 900 } });
    expect(s.worldBoss?.active).toBe(true);
    expect(s.worldBoss?.entity).not.toBeNull();
    expect(s.worldBoss?.windowId).toBe(wid);
    expect(eventTypes(s, "worldBossSpawned")).toBe(1);

    // Wrong zone (a different farm zone) -> no spawn.
    const s2 = initGameState(1, soloSave("mage", 1));
    const loc = worldBossLocationFor(wid)!;
    const otherIdx = loc.zoneIdx === 1 ? 2 : 1;
    s2.location = { mapId: "map1", zoneIdx: otherIdx };
    s2.stage = zoneAt(s2.location).stage;
    s2.phase = "battle";
    isolate(s2);
    step(s2, { spawnWorldBoss: { windowId: wid, remainingSeconds: 900 } });
    expect(s2.worldBoss).toBeNull();
  });

  it("is idempotent per windowId (re-injection + same-step cohort lanes)", () => {
    const wid = 7;
    const s = initGameState(2, soloSave("swordsman", 1));
    s.heroes = [makeHero(1, "swordsman"), makeHero(2, "archer")];
    s.nextId = 3;
    seatInBossZone(s, wid);
    isolate(s);
    // Two lanes inject the SAME window this step -> exactly one spawn (first wins).
    step(s, [
      { spawnWorldBoss: { windowId: wid, remainingSeconds: 900 } },
      { spawnWorldBoss: { windowId: wid, remainingSeconds: 500 } },
    ]);
    expect(eventTypes(s, "worldBossSpawned")).toBe(1);
    const id = s.worldBoss?.entity?.id;
    // Re-inject next step -> no second spawn.
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds: 900 } });
    expect(eventTypes(s, "worldBossSpawned")).toBe(0);
    expect(s.worldBoss?.entity?.id).toBe(id);
  });

  it("despawns when the lifetime countdown expires", () => {
    const wid = 4;
    const s = initGameState(3, soloSave("archer", 1));
    seatInBossZone(s, wid);
    isolate(s);
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds: 0.05 } }); // ~3 steps
    expect(s.worldBoss?.active).toBe(true);
    let despawned = false;
    for (let i = 0; i < 10 && !despawned; i++) {
      step(s, {});
      if (eventTypes(s, "worldBossDespawned")) despawned = true;
    }
    expect(despawned).toBe(true);
    expect(s.worldBoss?.active).toBe(false);
    expect(s.worldBoss?.entity).toBeNull();
    expect(s.worldBoss?.defeated).toBe(false);
  });

  it("despawns when the hero leaves the boss's zone", () => {
    const wid = 9;
    const s = initGameState(4, soloSave("swordsman", 1));
    const loc = seatInBossZone(s, wid);
    isolate(s);
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds: 900 } });
    expect(s.worldBoss?.active).toBe(true);
    // Move to a different farm zone; the next battle step despawns the transient boss.
    s.location = { mapId: "map1", zoneIdx: loc.zoneIdx === 1 ? 2 : 1 };
    step(s, {});
    expect(eventTypes(s, "worldBossDespawned")).toBe(1);
    expect(s.worldBoss?.active).toBe(false);
  });

  it("a defeated boss blocks respawn in the same window", () => {
    const wid = 11;
    const s = initGameState(5, soloSave("mage", 1));
    seatInBossZone(s, wid);
    isolate(s);
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds: 900 } });
    // Kill it.
    s.worldBoss!.entity!.hp = 0;
    step(s, {});
    expect(eventTypes(s, "worldBossDefeated")).toBe(1);
    expect(s.worldBoss?.defeated).toBe(true);
    expect(s.worldBoss?.active).toBe(false);
    // Re-injecting the same window does nothing.
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds: 900 } });
    expect(eventTypes(s, "worldBossSpawned")).toBe(0);
    expect(s.worldBoss?.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Owner LIVE bug fixes (2026-07-08): presence sweep + flee/re-enter window.
// ---------------------------------------------------------------------------

describe("worldBoss presence sweep (bug 1: never rendered in town)", () => {
  it("death in the boss zone -> auto-return retires the boss by the first town step", () => {
    const wid = 5;
    const s = initGameState(77, soloSave("swordsman", 1));
    seatInBossZone(s, wid);
    isolate(s);
    s.autoReturn = false; // "รอที่เมือง" — the owner's repro: the hero DWELLS in town
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds: 900 } });
    expect(s.worldBoss?.active).toBe(true);

    // Kill the hero (the boss's killing blow) then drive the REAL death -> respawnToTown
    // -> transit -> town-arrival machinery purely through step() (nothing hand-forced
    // beyond the death itself — no manual phase/location poke of the town branch).
    for (const h of s.heroes) {
      h.hp = 0;
      h.dead = true;
    }
    let guard = 0;
    while (zoneAt(s.location).kind !== "town" && guard++ < 5000) {
      // The boss stays alive the whole walk home (its lifetime is a wall clock —
      // tickWorldBossLifetime only counts the transit down, never despawns on zone-leave).
      expect(s.worldBoss?.active).toBe(true);
      step(s, {});
    }
    expect(zoneAt(s.location).kind).toBe("town"); // arrived (that step was the travel branch)

    // The FIRST genuine TOWN step must retire it — the town branch never takes a battle
    // step, so the presence sweep has to run there or the renderer draws the boss in town.
    step(s, {});
    expect(s.worldBoss?.active).toBe(false);
    expect(s.worldBoss?.entity).toBeNull();
    expect(s.worldBoss?.defeated).toBe(false);
    expect(eventTypes(s, "worldBossDespawned")).toBe(1);
  });
});

describe("worldBoss flee + re-entry (bug 2: the window is not burned)", () => {
  const wid = 9;
  const flee = (s: GameState, loc: WorldLocation): void => {
    s.location = { mapId: "map1", zoneIdx: loc.zoneIdx === 1 ? 2 : 1 };
  };

  it("flee to an adjacent zone -> the next battle step retires it (NOT defeated)", () => {
    const s = initGameState(21, soloSave("archer", 1));
    const loc = seatInBossZone(s, wid);
    isolate(s);
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds: 900 } });
    expect(s.worldBoss?.active).toBe(true);
    flee(s, loc);
    step(s, {});
    expect(s.worldBoss?.active).toBe(false);
    expect(s.worldBoss?.defeated).toBe(false);
    expect(eventTypes(s, "worldBossDespawned")).toBe(1);
  });

  it("re-entry + fresh intent -> active again, countdown re-seeded from remainingSeconds", () => {
    const s = initGameState(21, soloSave("archer", 1));
    const loc = seatInBossZone(s, wid);
    isolate(s);
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds: 900 } });
    flee(s, loc);
    step(s, {});
    expect(s.worldBoss?.active).toBe(false);
    // Return + inject a FRESH (smaller, wall-clock-derived) remaining -> respawns.
    s.location = { mapId: loc.mapId, zoneIdx: loc.zoneIdx };
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds: 600 } });
    expect(s.worldBoss?.active).toBe(true);
    expect(eventTypes(s, "worldBossSpawned")).toBe(1);
    // Seeded from 600, less this step's single lifetime tick.
    expect(s.worldBoss!.countdown).toBeCloseTo(600 - FIXED_DT, 5);
  });

  it("re-entry countdown is capped at the configured lifetime", () => {
    const s = initGameState(21, soloSave("archer", 1));
    const loc = seatInBossZone(s, wid);
    isolate(s);
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds: 900 } });
    flee(s, loc);
    step(s, {});
    s.location = { mapId: loc.mapId, zoneIdx: loc.zoneIdx };
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds: 99_999 } });
    expect(s.worldBoss?.active).toBe(true);
    expect(s.worldBoss!.countdown).toBeCloseTo(lifetimeMs / 1000 - FIXED_DT, 5);
  });

  it("a DEFEATED window still blocks re-entry (a kill ends the window)", () => {
    const s = initGameState(21, soloSave("archer", 1));
    seatInBossZone(s, wid);
    isolate(s);
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds: 900 } });
    s.worldBoss!.entity!.hp = 0;
    step(s, {});
    expect(s.worldBoss?.defeated).toBe(true);
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds: 600 } });
    expect(s.worldBoss?.active).toBe(false);
    expect(eventTypes(s, "worldBossSpawned")).toBe(0);
  });

  it("an EXPIRED window (remainingSeconds <= 0) never revives on re-entry", () => {
    const s = initGameState(21, soloSave("archer", 1));
    const loc = seatInBossZone(s, wid);
    isolate(s);
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds: 900 } });
    flee(s, loc);
    step(s, {});
    s.location = { mapId: loc.mapId, zoneIdx: loc.zoneIdx };
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds: 0 } });
    expect(s.worldBoss?.active).toBe(false);
    expect(eventTypes(s, "worldBossSpawned")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Kill flow — no xp/gold/killGoal movement.
// ---------------------------------------------------------------------------

describe("worldBoss kill flow", () => {
  it("emits worldBossDefeated once and grants no xp/gold/kills", () => {
    const wid = 6;
    const s = initGameState(8, soloSave("swordsman", 1));
    seatInBossZone(s, wid);
    isolate(s);
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds: 900 } });
    const gold = s.gold;
    const kills = s.kills;
    const xp = s.heroes[0].xp;
    const level = s.heroes[0].level;
    s.worldBoss!.entity!.hp = 0;
    step(s, {});
    expect(eventTypes(s, "worldBossDefeated")).toBe(1);
    expect(eventTypes(s, "kill")).toBe(0);
    expect(s.gold).toBe(gold);
    expect(s.kills).toBe(kills);
    expect(s.heroes[0].xp).toBe(xp);
    expect(s.heroes[0].level).toBe(level);
  });
});

// ---------------------------------------------------------------------------
// Byte-identical guards.
// ---------------------------------------------------------------------------

describe("worldBoss byte-identical guards", () => {
  it("a spawn intent for a DIFFERENT zone leaves the normal path byte-identical", () => {
    const wid = 2;
    const loc = worldBossLocationFor(wid)!;
    const otherIdx = loc.zoneIdx === 1 ? 2 : 1;
    const mk = (): GameState => {
      const s = initGameState(4242, soloSave("archer", 1));
      s.location = { mapId: "map1", zoneIdx: otherIdx }; // NOT the boss's zone
      s.stage = zoneAt(s.location).stage;
      s.phase = "battle";
      s.unlockedZones = { ...s.unlockedZones, map1: 6 };
      return s;
    };
    const withIntent = mk();
    const baseline = mk();
    for (let i = 0; i < 300; i++) {
      // Injecting the (wrong-zone) spawn intent must no-op every step.
      step(withIntent, { spawnWorldBoss: { windowId: wid, remainingSeconds: 900 } });
      step(baseline, {});
      expect(stateHash(withIntent)).toBe(stateHash(baseline));
    }
    expect(withIntent.worldBoss).toBeNull();
    expect(JSON.stringify(withIntent)).toBe(JSON.stringify(baseline));
  });

  it("the world boss draws NO RNG / loot-counter (mob + loot streams unperturbed)", () => {
    const wid = 8;
    const s = initGameState(31, soloSave("swordsman", 1));
    seatInBossZone(s, wid);
    isolate(s); // no mobs, so only the boss could perturb the streams
    // Beefy hero so it survives + keeps fighting the engaged boss for the whole window.
    for (const h of s.heroes) {
      h.maxHp = 1e9;
      h.hp = 1e9;
    }
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds: 900 } });
    s.worldBoss!.entity!.hp = s.worldBoss!.entity!.maxHp - 1; // engage it
    const rng0 = s.rngState;
    const loot0 = s.lootCounter;
    let acted = false;
    for (let i = 0; i < 400; i++) {
      step(s, {});
      if (s.worldBoss?.entity && s.worldBoss.entity.hp < s.worldBoss.entity.maxHp) acted = true;
      expect(s.rngState).toBe(rng0);
      expect(s.lootCounter).toBe(loot0);
    }
    expect(s.worldBoss?.active).toBe(true); // 400k HP survives an early hero
    expect(acted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lockstep — 2-client cross-delivery of the spawn intent stays hash-equal.
// ---------------------------------------------------------------------------

describe("worldBoss lockstep", () => {
  it("a spawn intent on one lane keeps a 2-client cohort hash-equal", () => {
    const build = (): GameState => {
      const s = initGameState(555, soloSave("swordsman", 1));
      s.heroes = [makeHero(1, "swordsman"), makeHero(2, "archer")];
      s.nextId = 3;
      seatInBossZone(s, 0);
      s.unlockedZones = { ...s.unlockedZones, map1: 6 };
      return s;
    };
    const a = new LockstepClient(build(), 2);
    const b = new LockstepClient(build(), 2);
    expect(a.hashNow()).toBe(b.hashNow()); // identical start
    // Slot 0 issues the spawn at turn 0 (executes at turn 2); cross-deliver to the peer.
    const msg = a.issue(0, 0, { spawnWorldBoss: { windowId: 0, remainingSeconds: 900 } });
    b.deliver(msg);
    a.runTo(40);
    b.runTo(40);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.state.worldBoss?.active).toBe(true);
  });
});
