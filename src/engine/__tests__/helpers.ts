/**
 * Shared test helpers for the Phase C regression suite. NOT a test file itself
 * (no `.test.ts` suffix), so Vitest's `include` glob skips it.
 */

import { step } from "@/engine";
import type { Enemy, GameState, SaveData } from "@/engine";

/** A save with all 3 hero classes unlocked, no upgrades, at the given stage. */
export const threeHeroSave = (stage = 3): SaveData => ({
  version: 1,
  stage,
  gold: 0,
  unlocked: ["swordsman", "archer", "mage"],
  upgrades: { atk: 0, speed: 0, hp: 0 },
  lastSeen: 0,
});

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
