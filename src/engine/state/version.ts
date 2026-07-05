/**
 * Save schema versioning.
 *
 * Idle-game saves live for years; migrating them is painful if not designed in
 * from day one. Every time `SaveData` changes shape, bump `SAVE_VERSION` and add
 * a branch to `migrate()` that upgrades the previous shape. Never mutate an old
 * save in place without going through here.
 */

import { CONFIG, SIGNATURE_SKILL } from "@/engine/config";
import { heroMaxMana } from "@/engine/systems/stats";
import { classChangeQuestFor } from "@/engine/systems/quests";
import type { SaveData, CharacterSave } from "@/engine/state";
import type { HeroClass, HeroStats, HeroQuest, SkillId } from "@/engine/entities";

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
// v5 -> v6 (M5 "mana + skill framework v2"): the hero gains `mana` (current, INT-
//   derived pool) + `autoSlots` (the auto-cast loadout). Learned skills are DERIVED
//   from level/tier and NOT persisted. Older saves default mana to a FULL pool and
//   the auto-slot loadout to the class default (signature in slot 0).
// v6 -> v7 (M5 "เปลี่ยนคลาสผ่านเควส" / class-change quest, ROADMAP task 5): the
//   hero gains `quest` (the active class-change quest {id, accepted, progress[]},
//   or null). Pre-v7 saves had no quests, so migration sets it to null for EVERY
//   hero: a tier-2 hero has already class-changed (no quest), and a tier-1 hero at
//   level >= the gate is simply RE-OFFERED the quest on load (progress starts
//   empty when accepted). No gold is owed — the old evolve gold cost is gone
//   (quest EFFORT replaced it; evolution stays a one-way flag).
export const SAVE_VERSION = 7;

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
  // v4/v5/v6/v7 single-character shape (v5 adds statPoints + stats; v6 adds mana +
  // autoSlots; v7 adds quest):
  hero?: Partial<CharacterSave> & {
    statPoints?: number;
    stats?: UnknownStats;
    mana?: number;
    autoSlots?: (SkillId | null)[];
    quest?: HeroQuest | null;
  };
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

/** A finite non-negative mana amount clamped into `[0, maxMana]`, else full pool. */
function clampMana(v: number | undefined, maxMana: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return maxMana;
  return Math.min(v, maxMana);
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
 * Normalise a possibly-old/foreign class-change quest to the v7 shape. Pre-v7
 * saves have no quest (-> null, re-offered). A v7 save's ACCEPTED quest is
 * preserved (validated against the current class def + clamped progress) so the
 * server's migrate-on-every-save never wipes in-progress quest state; a tier-2
 * hero or an un-accepted/foreign entry normalises to null.
 */
function normalizeQuest(
  cls: HeroClass,
  tier: 1 | 2,
  saved: HeroQuest | null | undefined,
): HeroQuest | null {
  if (tier === 2 || !saved || saved.accepted !== true) return null;
  const def = classChangeQuestFor(cls);
  if (saved.id !== def.id) return null;
  const progress = def.objectives.map((_, i) => {
    const v = Array.isArray(saved.progress) ? saved.progress[i] : undefined;
    return asStat(v, 0);
  });
  return { id: def.id, accepted: true, progress };
}

/** Default auto-slot loadout for a migrated save: signature in slot 0, rest empty. */
function defaultAutoSlotsFor(cls: HeroClass): (SkillId | null)[] {
  const slots: (SkillId | null)[] = new Array(CONFIG.autoSlots.max).fill(null);
  slots[0] = SIGNATURE_SKILL[cls];
  return slots;
}

/**
 * Normalise a possibly-partial auto-slot array to the current length (v6). A
 * missing/malformed array falls back to the class default; unknown entries are
 * cleared to null. The full pool is used as the mana default (a generous top-up).
 */
function normalizeAutoSlots(
  cls: HeroClass,
  saved: (SkillId | null)[] | undefined,
): (SkillId | null)[] {
  const fallback = defaultAutoSlotsFor(cls);
  if (!Array.isArray(saved)) return fallback;
  const out: (SkillId | null)[] = new Array(CONFIG.autoSlots.max).fill(null);
  for (let i = 0; i < out.length; i++) {
    const id = saved[i];
    out[i] = typeof id === "string" ? id : id === null ? null : fallback[i];
  }
  return out;
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
    const stats = normalizeStats(cls, save.hero.stats);
    const maxMana = heroMaxMana(cls, stats.int);
    hero = {
      cls,
      level,
      xp: save.hero.xp ?? 0,
      tier: save.hero.tier === 2 ? 2 : 1,
      // v5 keeps the saved points; a v4 save (no statPoints) gets the retro grant.
      statPoints: asStat(save.hero.statPoints, level * PPL),
      stats,
      // v6 keeps the saved mana (clamped into the pool); a v5 save defaults to full.
      mana: clampMana(save.hero.mana, maxMana),
      autoSlots: normalizeAutoSlots(cls, save.hero.autoSlots),
      // v7 keeps a saved accepted quest; a pre-v7 save (no quest) -> null (re-offer).
      quest: normalizeQuest(cls, save.hero.tier === 2 ? 2 : 1, save.hero.quest),
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
    const stats = normalizeStats(cls, undefined);
    hero = {
      cls,
      level,
      xp: p?.xp ?? 0,
      tier: p?.tier === 2 ? 2 : 1,
      statPoints: level * PPL,
      stats,
      mana: heroMaxMana(cls, stats.int),
      autoSlots: defaultAutoSlotsFor(cls),
      // Pre-v4 team saves predate quests entirely -> null (re-offered if eligible).
      quest: null,
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
