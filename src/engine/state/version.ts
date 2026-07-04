/**
 * Save schema versioning.
 *
 * Idle-game saves live for years; migrating them is painful if not designed in
 * from day one. Every time `SaveData` changes shape, bump `SAVE_VERSION` and add
 * a branch to `migrate()` that upgrades the previous shape. Never mutate an old
 * save in place without going through here.
 */

import type { SaveData } from "@/engine/state";

export const SAVE_VERSION = 1;

/** A save of unknown/older version, before migration. */
export type UnknownSave = Partial<SaveData> & { version?: number };

/**
 * Upgrade a possibly-old save to the current `SAVE_VERSION`.
 * Skeleton: v1 is the baseline, so there is nothing to migrate yet. Add
 * `if (save.version < N) { ...; save.version = N }` steps as the schema evolves.
 */
export function migrate(save: UnknownSave): SaveData {
  // Future migrations go here, oldest-first, keyed off `save.version`:
  // if ((save.version ?? SAVE_VERSION) < 2) { /* transform v1 -> v2 */ }

  return {
    version: SAVE_VERSION,
    stage: save.stage ?? 1,
    gold: save.gold ?? 0,
    unlocked: save.unlocked ?? ["swordsman"],
    upgrades: save.upgrades ?? { atk: 0, speed: 0, hp: 0 },
    lastSeen: save.lastSeen ?? 0,
  };
}
