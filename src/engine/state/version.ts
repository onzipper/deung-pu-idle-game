/**
 * Save schema versioning.
 *
 * Idle-game saves live for years; migrating them is painful if not designed in
 * from day one. Every time `SaveData` changes shape, bump `SAVE_VERSION` and add
 * a branch to `migrate()` that upgrades the previous shape. Never mutate an old
 * save in place without going through here.
 */

import { CONFIG } from "@/engine/config";
import type { SaveData, CharacterSave } from "@/engine/state";
import type { HeroClass, HeroStats } from "@/engine/entities";

// v1 -> v2 (M5): added per-hero `heroes: {level,xp}[]` (Character XP + Level).
// v2 -> v3 (M5): added per-hero `tier` (class advancement / evolution).
// v3 -> v4 (M5 Character Pivot): team -> SINGLE character. `unlocked[]` + the
//   per-slot `heroes[]` + the three `upgrades` lines are all dropped in favour of
//   one `hero: {cls, level, xp, tier}`. LOSSY BY DESIGN (dev-phase saves): we
//   adopt the HIGHEST-LEVEL unlocked hero as the character, discard the other two,
//   and drop all upgrade levels (their power moved to level/tier; gold is kept).
// v4 -> v5 (M5 "Base stats"): the hero gains `statPoints` + `stats {str,dex,int,
//   vit}`. Older saves are granted RETROACTIVE points = `level * pointsPerLevel`
//   (unallocated — no one loses progression), with `stats` seeded to the class
//   base block. (Organic play grants `(level-1) * pointsPerLevel`; the migrate is
//   a deliberately generous one-time retro grant.)
export const SAVE_VERSION = 5;

/** A per-hero progress entry from an unknown/older save (pre-v4 team shape). */
type UnknownHeroProgress = { level?: number; xp?: number; tier?: number };

/** A per-hero stat block from an unknown/older save (all fields optional). */
type UnknownStats = { str?: number; dex?: number; int?: number; vit?: number };

/** A save of unknown/older version, before migration. */
export interface UnknownSave {
  version?: number;
  stage?: number;
  gold?: number;
  lastSeen?: number;
  // v4/v5 single-character shape (v5 adds statPoints + stats):
  hero?: Partial<CharacterSave> & { statPoints?: number; stats?: UnknownStats };
  // pre-v4 team shape:
  unlocked?: string[];
  heroes?: UnknownHeroProgress[];
  upgrades?: { atk?: number; speed?: number; hp?: number };
}

const KNOWN_CLASSES: readonly HeroClass[] = ["swordsman", "archer", "mage"];

function asClass(cls: string | undefined): HeroClass {
  return KNOWN_CLASSES.includes(cls as HeroClass) ? (cls as HeroClass) : "swordsman";
}

/** A non-negative integer, or `fallback` for anything malformed. */
function asStat(v: number | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

/**
 * Normalise a possibly-partial stat block to the v5 shape, defaulting each axis to
 * the class base (so a missing field never zeroes a hero's identity).
 */
function normalizeStats(cls: HeroClass, stats: UnknownStats | undefined): HeroStats {
  const base = CONFIG.stats.base[cls];
  return {
    str: asStat(stats?.str, base.str),
    dex: asStat(stats?.dex, base.dex),
    int: asStat(stats?.int, base.int),
    vit: asStat(stats?.vit, base.vit),
  };
}

/**
 * Upgrade a possibly-old save to the current `SAVE_VERSION`.
 *
 * v5 payloads already carry the single-character + base-stats shape (idempotent).
 * A v4 save (single character, no stats) is granted retroactive base stats. A
 * pre-v4 TEAM save first collapses to the highest-level unlocked hero (ties resolve
 * to the earliest unlocked slot; the rest + all upgrade levels are dropped) and is
 * then granted base stats too. Gold and stage carry over.
 *
 * Base-stats grant (v4/older -> v5): unspent `statPoints = level * pointsPerLevel`
 * (a generous one-time retro grant — organic play grants `(level-1) *
 * pointsPerLevel`), with `stats` seeded to the class base block.
 */
export function migrate(save: UnknownSave): SaveData {
  const PPL = CONFIG.stats.pointsPerLevel;
  let hero: CharacterSave;

  if (save.hero) {
    // v4/v5 single-character shape.
    const cls = asClass(save.hero.cls);
    const level = save.hero.level ?? 1;
    hero = {
      cls,
      level,
      xp: save.hero.xp ?? 0,
      tier: save.hero.tier === 2 ? 2 : 1,
      // v5 keeps the saved points; a v4 save (no statPoints) gets the retro grant.
      statPoints: asStat(save.hero.statPoints, level * PPL),
      stats: normalizeStats(cls, save.hero.stats),
    };
  } else {
    // Pre-v4 team save: adopt the highest-level unlocked hero, then grant stats.
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
    const cls = asClass(unlocked[bestIdx]);
    const level = p?.level ?? 1;
    hero = {
      cls,
      level,
      xp: p?.xp ?? 0,
      tier: p?.tier === 2 ? 2 : 1,
      statPoints: level * PPL,
      stats: normalizeStats(cls, undefined),
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
