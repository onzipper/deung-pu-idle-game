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
  makeHero,
  step,
} from "@/engine";
import type { Enemy, GameState, HeroClass, SaveData } from "@/engine";

/** A fresh single-character save of class `cls` at the given stage (M5 v6 shape). */
export const soloSave = (cls: HeroClass = "swordsman", stage = 3): SaveData => ({
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
  },
  lastSeen: 0,
});

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
  };
}
