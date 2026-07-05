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
// v2 -> v3 (M5): added per-hero `tier` (class advancement / evolution).
export const SAVE_VERSION = 3;

/**
 * A per-hero progress entry from an unknown/older save: `tier` may be absent (v2)
 * or an arbitrary number before it is normalised to 1 | 2.
 */
type UnknownHeroProgress = { level: number; xp: number; tier?: number };

/** A save of unknown/older version, before migration. */
export type UnknownSave = Omit<Partial<SaveData>, "heroes"> & {
  version?: number;
  heroes?: UnknownHeroProgress[];
};

/**
 * Upgrade a possibly-old save to the current `SAVE_VERSION`.
 * Migration steps go oldest-first, keyed off `save.version`.
 */
export function migrate(save: UnknownSave): SaveData {
  const unlocked = save.unlocked ?? ["swordsman"];

  // v1 -> v2: no per-hero progression existed, so every unlocked hero defaults to
  // level 1 / xp 0 (index-aligned with `unlocked`).
  // v2 -> v3: `tier` (class evolution) added; a v2 entry has no `tier`, so default
  // it to 1 (base class). Normalising per-entry (not just when `heroes` is absent)
  // keeps this idempotent for v3 saves and up-converts a v2 `heroes` array.
  const raw: UnknownHeroProgress[] =
    save.heroes ?? unlocked.map(() => ({ level: 1, xp: 0 }));
  const heroes: SaveData["heroes"] = raw.map((h) => ({
    level: h.level,
    xp: h.xp,
    tier: h.tier === 2 ? 2 : 1,
  }));

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
