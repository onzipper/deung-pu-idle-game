/**
 * Save schema versioning.
 *
 * Idle-game saves live for years; migrating them is painful if not designed in
 * from day one. Every time `SaveData` changes shape, bump `SAVE_VERSION` and add
 * a branch to `migrate()` that upgrades the previous shape. Never mutate an old
 * save in place without going through here.
 */

import type { SaveData } from "@/engine/state";

// v1 -> v2 (M5): added per-hero `heroes: {level,xp}[]` (Character XP + Level).
export const SAVE_VERSION = 2;

/** A save of unknown/older version, before migration. */
export type UnknownSave = Partial<SaveData> & { version?: number };

/**
 * Upgrade a possibly-old save to the current `SAVE_VERSION`.
 * Migration steps go oldest-first, keyed off `save.version`.
 */
export function migrate(save: UnknownSave): SaveData {
  const unlocked = save.unlocked ?? ["swordsman"];

  // v1 -> v2: no per-hero progression existed, so every unlocked hero defaults to
  // level 1 / xp 0 (index-aligned with `unlocked`). Idempotent for v2+ saves that
  // already carry `heroes`.
  const heroes =
    save.heroes ?? unlocked.map(() => ({ level: 1, xp: 0 }));

  return {
    version: SAVE_VERSION,
    stage: save.stage ?? 1,
    gold: save.gold ?? 0,
    unlocked,
    upgrades: save.upgrades ?? { atk: 0, speed: 0, hp: 0 },
    heroes,
    lastSeen: save.lastSeen ?? 0,
  };
}
