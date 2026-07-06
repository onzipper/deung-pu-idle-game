/**
 * Shared test helpers for the Phase C regression suite. NOT a test file itself
 * (no `.test.ts` suffix), so Vitest's `include` glob skips it.
 */

import {
  CONFIG,
  SAVE_VERSION,
  SIGNATURE_SKILL,
  heroMaxMana,
  initGameState,
  makeBoss,
  makeHero,
  migrate,
  step,
  worldNav,
} from "@/engine";
import type { Enemy, FrameInput, GameState, HeroClass, SaveData } from "@/engine";

/**
 * A fresh single-character save of class `cls` at the given stage (M6 v8 shape).
 * Built through `migrate()` so the world fields (location/unlockedZones/
 * lastFarmZone) are placed at the FARM zone matching `stage` — the same path a
 * real trimmed/older save takes on load.
 */
export const soloSave = (cls: HeroClass = "swordsman", stage = 3): SaveData =>
  migrate({
    version: SAVE_VERSION,
    stage,
    gold: 0,
    hero: {
      cls,
      level: 1,
      xp: 0,
      tier: 1,
      statPoints: 0,
      stats: { ...CONFIG.stats.base[cls] },
      mana: heroMaxMana(cls, CONFIG.stats.base[cls].int),
      autoSlots: [SIGNATURE_SKILL[cls], null, null],
      quest: null,
    },
    lastSeen: 0,
  });

/**
 * Test shortcut into a boss fight at the CURRENT stage, WITHOUT the world walk
 * (mirrors the old `challengeBoss` + the internal `startBossFight`). The world
 * navigation INTO a boss room is covered separately in world.test.ts; this lets
 * the boss-MECHANIC tests (enrage/slam/telegraph) stay stage-scoped and terse.
 */
export function forceBoss(s: GameState): void {
  s.bossReady = true;
  s.phase = "boss";
  s.boss = makeBoss(s.nextId++, s.stage);
  s.enemies = [];
  s.projectiles = s.projectiles.filter((p) => p.team === "hero");
  for (const h of s.heroes) {
    h.dead = false;
    h.hp = h.maxHp;
  }
}

/**
 * Idle-player world autopilot (mirrors the balance sim): walk forward once a farm
 * zone's quota is met and the next zone is unlocked, enter the boss room, and walk
 * to the next map on a boss-room victory. Death respawn + auto-return are engine
 * behaviour (set `s.autoReturn = true`).
 */
export function worldAutopilot(s: GameState): FrameInput {
  const input: FrameInput = {};
  if (s.traveling) return input;
  const nav = worldNav(s);
  const right = nav.right;
  const walkRight = (): void => {
    if (right?.unlocked) input.walkToZone = { mapId: right.zone.mapId, zoneIdx: right.zone.zoneIdx };
  };
  if (s.phase === "victory") {
    walkRight(); // boss room beaten -> into the next map
    return input;
  }
  if (nav.current.kind === "town") {
    walkRight(); // stranded in town (auto-return off) -> walk back out
    return input;
  }
  if (nav.current.kind === "boss") return input; // fighting
  if (s.bossReady) walkRight(); // farm quota met -> into the next farm zone / boss room
  return input;
}

/**
 * Seat a synthetic swordsman/archer/mage PARTY into an otherwise-solo state.
 *
 * Gameplay spawns one hero (M5 pivot), but the multi-actor combat engine is
 * RETAINED for the M8 party. Tests that must exercise per-hero targeting /
 * formation / skill independence use this to stand up a 3-hero party, which also
 * guards that the party engine still works.
 */
export function makeParty(seed = 7, stage = 3): GameState {
  const s = initGameState(seed, soloSave("swordsman", stage));
  s.heroes = [makeHero(1, "swordsman"), makeHero(2, "archer"), makeHero(3, "mage")];
  s.nextId = 4;
  return s;
}

/** Step until `pred` holds (or `cap` steps elapse); returns whether it was reached. */
export function runUntil(
  s: GameState,
  pred: (s: GameState) => boolean,
  cap: number,
): boolean {
  for (let i = 0; i < cap; i++) {
    if (pred(s)) return true;
    step(s, {});
  }
  return pred(s);
}

export const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

/**
 * A stationary, inert enemy stub for skill-targeting tests: speed 0 (never
 * drifts) and a huge attack cooldown (never lands a hit), so the only thing
 * that changes its hp is whatever the test deliberately casts at it.
 */
export function makeStubEnemy(id: number, x: number, hp = 1000): Enemy {
  return {
    id,
    kind: "normal",
    x,
    y: 200,
    hp,
    maxHp: hp,
    atk: 0,
    speed: 0,
    size: 1,
    behavior: "melee",
    range: 0,
    cd: 999,
    engageOffset: 0,
    homeX: x,
    aggressive: false,
    aggroRadius: 0,
    engaged: true, // injected test mobs act like the old always-engaged enemies
  };
}
