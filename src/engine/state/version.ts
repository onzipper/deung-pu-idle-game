/**
 * Save schema versioning.
 *
 * Idle-game saves live for years; migrating them is painful if not designed in
 * from day one. Every time `SaveData` changes shape, bump `SAVE_VERSION` and add
 * a branch to `migrate()` that upgrades the previous shape. Never mutate an old
 * save in place without going through here.
 */

import type { SaveData, CharacterSave } from "@/engine/state";
import type { HeroClass } from "@/engine/entities";

// v1 -> v2 (M5): added per-hero `heroes: {level,xp}[]` (Character XP + Level).
// v2 -> v3 (M5): added per-hero `tier` (class advancement / evolution).
// v3 -> v4 (M5 Character Pivot): team -> SINGLE character. `unlocked[]` + the
//   per-slot `heroes[]` + the three `upgrades` lines are all dropped in favour of
//   one `hero: {cls, level, xp, tier}`. LOSSY BY DESIGN (dev-phase saves): we
//   adopt the HIGHEST-LEVEL unlocked hero as the character, discard the other two,
//   and drop all upgrade levels (their power moved to level/tier; gold is kept).
export const SAVE_VERSION = 4;

/** A per-hero progress entry from an unknown/older save (pre-v4 team shape). */
type UnknownHeroProgress = { level?: number; xp?: number; tier?: number };

/** A save of unknown/older version, before migration. */
export interface UnknownSave {
  version?: number;
  stage?: number;
  gold?: number;
  lastSeen?: number;
  // v4 single-character shape:
  hero?: Partial<CharacterSave>;
  // pre-v4 team shape:
  unlocked?: string[];
  heroes?: UnknownHeroProgress[];
  upgrades?: { atk?: number; speed?: number; hp?: number };
}

const KNOWN_CLASSES: readonly HeroClass[] = ["swordsman", "archer", "mage"];

function asClass(cls: string | undefined): HeroClass {
  return KNOWN_CLASSES.includes(cls as HeroClass) ? (cls as HeroClass) : "swordsman";
}

/**
 * Upgrade a possibly-old save to the current `SAVE_VERSION`.
 *
 * v4+ payloads already carry the single-character shape (idempotent). Anything
 * older is a pre-pivot TEAM save: pick the highest-level unlocked hero as the new
 * single character (ties resolve to the earliest unlocked slot), keep its
 * level/xp/tier, drop the rest and all upgrade levels. Gold and stage carry over.
 */
export function migrate(save: UnknownSave): SaveData {
  let hero: CharacterSave;

  if (save.hero) {
    // Already the v4 single-character shape (or forward-compatible).
    hero = {
      cls: asClass(save.hero.cls),
      level: save.hero.level ?? 1,
      xp: save.hero.xp ?? 0,
      tier: save.hero.tier === 2 ? 2 : 1,
    };
  } else {
    // Pre-v4 team save: adopt the highest-level unlocked hero.
    const unlocked = save.unlocked ?? ["swordsman"];
    const progress = save.heroes ?? [];
    let bestIdx = 0;
    let bestLevel = -1;
    for (let i = 0; i < unlocked.length; i++) {
      const lvl = progress[i]?.level ?? 1;
      if (lvl > bestLevel) {
        bestLevel = lvl;
        bestIdx = i;
      }
    }
    const p = progress[bestIdx];
    hero = {
      cls: asClass(unlocked[bestIdx]),
      level: p?.level ?? 1,
      xp: p?.xp ?? 0,
      tier: p?.tier === 2 ? 2 : 1,
    };
  }

  return {
    version: SAVE_VERSION,
    stage: save.stage ?? 1,
    gold: save.gold ?? 0,
    hero,
    lastSeen: save.lastSeen ?? 0,
  };
}
