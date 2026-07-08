/**
 * Save schema versioning.
 *
 * Idle-game saves live for years; migrating them is painful if not designed in
 * from day one. Every time `SaveData` changes shape, bump `SAVE_VERSION` and add
 * a branch to `migrate()` that upgrades the previous shape. Never mutate an old
 * save in place without going through here.
 */

import { CONFIG, SIGNATURE_SKILL } from "@/engine/config";
import { emptyEquipped, type EquippedGear } from "@/engine/config/items";
import { clampRefine } from "@/engine/config/refine";
import { splitmix32 } from "@/engine/core/hash";
import { heroMaxMana } from "@/engine/systems/stats";
import { evolutionQuestFor } from "@/engine/systems/quests";
import { autoSlotCapacity } from "@/engine/entities";
import {
  farmLocationForStage,
  isValidLocation,
  mapZoneCount,
  unlockUpTo,
  zoneAt,
} from "@/engine/systems/world";
import { normalizeBotSettings } from "@/engine/systems/bots";
import { completedChapterIds } from "@/engine/systems/mainQuest";
import type { SaveData, CharacterSave } from "@/engine/state";
import type {
  HeroClass,
  HeroStats,
  HeroQuest,
  HeroDailies,
  SkillId,
  ShopItemId,
  ConsumableCounts,
  BotSettings,
  WorldLocation,
} from "@/engine/entities";

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
// v7 -> v8 (M6 "World & Town", ROADMAP task 1): the save gains `location`
//   (mapId + zoneIdx), `unlockedZones` (per-map unlocked count) and `lastFarmZone`.
//   Migration PLACES an existing save at the FARM zone matching its current
//   `stage` (clamped into the frontier), unlocks EVERY zone up to and including
//   it ("all zones up to it"), and points auto-return at that same farm zone. A
//   v8 save's own world fields are validated + preserved (idempotent for the
//   server's migrate-on-every-save). `stage` is re-derived to the placed zone's
//   stage so it can never drift from `location`.
// v8 -> v9 (M6 "เมืองหลัก + NPC shops"): the save gains `consumables` (held
//   {hpPotion, manaPotion, returnScroll} stack COUNTS — non-tradable, fungible;
//   NOT M7 item-instances). A pre-v9 save had none, so migration backfills ZEROS.
//   A v9 save's counts are preserved (clamped to [0, stackCap] — idempotent for
//   the server's migrate-on-every-save). Use-cooldowns + the auto-use toggles are
//   transient / UI-owned, so nothing else persists.
// v9 -> v10 (M7 "ของดรอปและ Gear"): the save gains `equipped` (weapon/armor
//   templateId cache — the DB ItemInstance ledger is authoritative, boot payload
//   wins on load), `lootCounter` (monotonic drop-roll counter → anti-dupe rollId
//   source) and `lootSalt` (per-save constant decorrelating the drop stream). A
//   pre-v10 save had none: `equipped` backfills to an EMPTY loadout (a fresh
//   character owns no gear yet — the DB ledger, not the blob, is the truth), the
//   counter to 0, and the salt is DERIVED deterministically from the save content
//   (migrate has no init seed) so it is stable for that save + spread across
//   characters. A v10 save's own fields are preserved (idempotent for the
//   server's migrate-on-every-save): a present salt is NEVER recomputed, the
//   counter is clamped monotonic, and the loadout is normalised.
// v10 -> v11 (M7.5 "Sell, Bots & Inventory UX"): the save gains `bot` (idle-
//   automation settings — the potion-restock + sell-trip bots + their targets /
//   reserves). A pre-v11 save had none, so migration backfills the config DEFAULTS
//   (both bots OFF, so behaviour is unchanged). A v11 save's own settings are
//   preserved (booleans coerced, targets clamped to the stack cap, gold floor
//   non-negative — idempotent for the server's migrate-on-every-save).
// v11 -> v12 (M6.6 "autoHunt toggle"): the save gains `autoHunt` (whether the
//   hero auto-acquires NEW hunt targets outside the boss phase). A pre-v12 save
//   had none, so migration backfills `true` (behaviour unchanged — auto-hunt was
//   always on before this toggle existed). A v12 save's own flag is preserved
//   (coerced to a boolean — idempotent for the server's migrate-on-every-save).
// v12 -> v13 (M7.7 follow-up "เกจรี" fix): the save gains `zoneKills` — per-farm-
//   zone unlock-quota progress keyed "mapId:zoneIdx", so a town trip (bot restock,
//   warp, death respawn) no longer wipes the zone-unlock gauge. Pre-v13 saves
//   backfill to {} (progress starts fresh once — the old behavior, one last time).
// v13 -> v14 (M7.6 "ตีบวก" / Refine): equipped-gear snapshots gain a per-slot
// `refine` level ({weapon, armor}, +0..+REFINE.maxRefine) and the save gains a
// `materials` counter (a plain per-character resource, like gold, spent + gold to
// refine gear + granted by salvage). Pre-v14 saves backfill refine to +0 on every
// slot (no stat change — an unrefined loadout is byte-identical to pre-M7.6) and
// materials to 0. Refine ROLLS are server-authoritative (the engine never rolls;
// config/refine.ts); this only PERSISTS the server-decided level. A v14 save's own
// values are preserved (refine clamped to [0, max]; materials floored non-negative —
// idempotent for the server's migrate-on-every-save).
// v14 -> v15 (M7.9 "Grand Expansion" — tier 3): the character-advancement `tier`
// domain WIDENS from {1,2} to {1,2,3} (จอมอัศวิน/ราชันพราน/อาร์คเมจ), and with it two
// derived shapes shift: (a) a tier-2 hero can now hold the NEW tier-3 QUEST (kills in
// map3 + a repeat map2-boss kill — id `tier3_<cls>`), where before a tier-2 hero always
// had `quest: null`; (b) a tier-3 hero's `autoSlots` array grows to LENGTH 4 (the 4th
// auto-cast slot), while tiers 1-2 keep the historical length-3 loadout. There is NO
// brand-new top-level field, so migrating a v14 save is a pure DOMAIN widening: a v14
// save has tier <= 2, so its tier/quest/autoSlots normalise byte-identically to before
// (tier-2 quest stays null -> re-offered at L40, autoSlots stays length 3). A genuine
// v15 save's tier-3 quest + 4-slot loadout are preserved (validated against the tier's
// quest def; idempotent for the server's migrate-on-every-save). Skill-4 is DERIVED
// from tier/level (not persisted); the tier-3 mana bonus is re-derived on load.
// v15 -> v16 (M7.95 "Hall of Fame" — engine/SAVE wave): the save gains three
// write-only HOF observers — `goldEarned` (lifetime gold ever earned, the "total
// gold" board), `bossBest` (best/lowest clear time per boss stage {seconds, at}, keyed
// by stage number), and `levelCapAt` (epoch-ms the hero first hit levelCap, the HOF
// tiebreaker). A pre-v16 save backfills goldEarned to 0 (NOT current gold: retroactive
// EARNED totals are genuinely unknowable — spending already happened — so we don't
// fabricate a floor), bossBest to {} (no past fights were timed), and levelCapAt to
// null (the crossing moment is unrecoverable). Durations (`seconds`) are deterministic
// step counting; the `at`/`levelCapAt` epoch-ms are stamped at the save boundary
// (0 = unstamped, exactly like the server-owned `lastSeen`; the engine has no
// wall-clock). A v16 save's own values are preserved (goldEarned floored non-negative,
// bossBest entries validated + kept fastest-per-stage, levelCapAt a non-negative number
// or null — idempotent for the server's migrate-on-every-save).
// ---- M7.9 tier-3 quest REDESIGN (owner "option ข", 2026-07-08) — NO version bump ----
// The tier-3 quest's OBJECTIVES changed (2 → 1: map4-z1 kills only; the map2-boss backtrack
// is gone) but its id (`tier3_<cls>`) and the persisted HeroQuest SHAPE
// ({id,accepted,progress[]}) are UNCHANGED, so this is NOT a save-shape change. An in-flight
// v16 save mid-OLD-tier-3-quest is handled gracefully by the objective-shape guard in
// `normalizeQuest` (+ its twin in state/index.ts `normalizeHeroQuest`): a saved accepted
// tier-3 quest whose progress length ≠ the new def's objective count is RESET to un-accepted
// (null → re-offered at L40), so an old 2-entry progress can never crash or mis-map onto the
// new single objective. No migrate() branch + no SAVE_VERSION bump required.
// v16 -> v17 (M8 Wave A "Quest system" + "วาปหาเพื่อน" warp scroll — bundled so ONE bump
// covers both). Three save-shape changes:
//  (a) `consumables` gains `warpScroll` — a new NPC-shop consumable stack (the party warp
//      scroll). A pre-v17 save backfills it to 0 (no scrolls held); a v17 save's count is
//      preserved (clamped to [0, stackCap] — idempotent).
//  (b) each hero gains `mainClaimed: string[]` — the MAIN-quest chapters whose reward has
//      been claimed. The main line itself is DERIVED from progression (systems/mainQuest),
//      so only the claim log persists. ⚠️ A pre-v17 deep character has completed many
//      chapters already; backfilling `[]` would leave every finished chapter "claimable",
//      wrongly owing a pile of retroactive rewards. FIX (mirrors v16 goldEarned=0 "no
//      backpay"): prefill `mainClaimed` with every chapter the CURRENT progression already
//      implies complete (`completedChapterIds(unlockedZones, bossBest)`), granting NO
//      reward — the player starts claiming from their NEXT chapter only. Idempotent for
//      migrate-on-every-save: a v17 save with a real array is preserved (known ids only).
//  (c) each hero gains `dailies: {serverDay, quests:[{id,progress,claimed}]}` — the daily-
//      quest roster + progress. A pre-v17 save backfills an EMPTY roster (serverDay 0, no
//      quests — safe: nothing done today; the server feeds a fresh roster on boot). A v17
//      save's roster is preserved (unknown catalog ids dropped, counters clamped).
// v17 -> v18 (NINJA — อาชีพพิเศษที่ 4, docs/ninja-design.md): the `hero.cls` DOMAIN WIDENS from
// {swordsman,archer,mage} to add "ninja" (tier chain นินจา → จอมนินจา → ราชันเงา). This is a
// PURE domain widening — NO brand-new save FIELD — exactly like the v14→v15 tier-3 widening,
// so migrating a v17 save is byte-identical: a v17 save has cls ∈ the old 3, so `asClass`
// preserves it and every derived shape (stats base, skills, quests, autoSlots) normalises
// unchanged. A genuine v18 ninja save round-trips its cls (KNOWN_CLASSES now includes it, so
// `asClass` no longer coerces it to swordsman). The ninja's skills/dash/quests are all DERIVED
// from cls+tier+level (not persisted), so there is no migrate() data branch — only the
// KNOWN_CLASSES widening + this stamp. Old saves load unchanged.
// v18 -> v19 (ดินแดนอสูร / ASURA hard-map — endgame v1, docs/endgame-design.md): the save gains
// two ADDITIVE accrual counters for the hard map — `asuraEssence` (a plain แก่นอสูร essence COUNT,
// like gold, banked on elite kills) and `asuraZoneKills` (per-asura-zone ศิลาโซน lifetime kill
// counters keyed "asura:zoneIdx"). Both accrue-only in v1 (the craft menu + secret quest that
// SPEND them are a later patch). A pre-v19 save had neither, so migration backfills essence -> 0
// and the counters -> {} (nobody is owed retroactive materials — mirrors v16 goldEarned=0 / v17
// mainClaimed no-backpay). The asura map's zone-UNLOCK progress rides the EXISTING `unlockedZones`
// (asura is just the 7th map, gated behind the s30 boss via `onBossRoomCleared`), so NO new unlock
// field is needed. The hot-zone index + elite spawn tally are TRANSIENT (never persisted). A v19
// save's own values are preserved (essence floored non-negative; counters normalised — idempotent
// for the server's migrate-on-every-save). Old saves load byte-identically (both default empty).
export const SAVE_VERSION = 19;

/** A per-hero progress entry from an unknown/older save (pre-v4 team shape). */
type UnknownHeroProgress = { level?: number; xp?: number; tier?: number };

/** A per-hero stat block from an unknown/older save (all fields optional). */
type UnknownStats = { str?: number; dex?: number; int?: number; vit?: number };

/** A world location from an unknown/older save (fields optional). */
type UnknownLocation = { mapId?: unknown; zoneIdx?: unknown };

/**
 * v16 bossBest (M7.95): keep only entries keyed by a positive integer stage whose
 * value is a `{seconds, at}` record with a finite, non-negative `seconds`. `at` is
 * kept if a valid non-negative epoch-ms, else 0 (unstamped — the boundary stamps it).
 */
function normalizeBossBest(
  raw: Record<string, unknown> | undefined,
): Record<number, { seconds: number; at: number }> {
  const out: Record<number, { seconds: number; at: number }> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    const stage = Number(k);
    if (!Number.isInteger(stage) || stage <= 0) continue;
    if (!v || typeof v !== "object") continue;
    const seconds = (v as { seconds?: unknown }).seconds;
    const at = (v as { at?: unknown }).at;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) continue;
    out[stage] = {
      seconds,
      at: typeof at === "number" && Number.isFinite(at) && at >= 0 ? at : 0,
    };
  }
  return out;
}

/** v16 levelCapAt (M7.95): a non-negative epoch-ms (0 = reached-unstamped), else null. */
function normalizeLevelCapAt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

/** v13 zoneKills: keep only "map:idx" keys with non-negative integer counts. */
function normalizeZoneKills(raw: Record<string, unknown> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && k.includes(":")) {
      out[k] = v;
    }
  }
  return out;
}

/** A save of unknown/older version, before migration. */
export interface UnknownSave {
  version?: number;
  stage?: number;
  gold?: number;
  lastSeen?: number;
  // v8 world fields (M6). All optional so a pre-v8 save is backfilled from `stage`.
  location?: UnknownLocation;
  unlockedZones?: Record<string, unknown>;
  lastFarmZone?: UnknownLocation;
  // v9 NPC-consumable stacks (M6); v17 adds `warpScroll`. Optional so a pre-v9/v17 save
  // backfills to zeros.
  consumables?: {
    hpPotion?: unknown;
    manaPotion?: unknown;
    returnScroll?: unknown;
    warpScroll?: unknown;
  };
  // v11 idle-bot settings (M7.5). Optional so a pre-v11 save backfills to defaults
  // (both bots OFF). Partial so a trimmed block is filled by `normalizeBotSettings`.
  bot?: Partial<BotSettings>;
  // v12 autoHunt toggle (M6.6). Optional/unknown so a pre-v12 (or malformed) save
  // backfills to `true`.
  autoHunt?: unknown;
  // v13 per-zone unlock-progress kills (M7.7 follow-up). Optional; malformed
  // entries are dropped (non-negative integers only).
  zoneKills?: Record<string, unknown>;
  // v10 gear (M7). Optional so a pre-v10 save backfills (equipped empty, counter 0,
  // salt derived). `equipped` fields are unknown so a malformed cache normalises.
  // v14 (M7.6): `equipped.refine` per-slot levels (optional; pre-v14 -> +0).
  equipped?: { weapon?: unknown; armor?: unknown; refine?: { weapon?: unknown; armor?: unknown } };
  lootCounter?: unknown;
  lootSalt?: unknown;
  // v14 material counter (M7.6). Optional; pre-v14 backfills to 0.
  materials?: unknown;
  // v19 ดินแดนอสูร accrual (endgame v1). Optional; pre-v19 backfills essence -> 0,
  // asuraZoneKills -> {}. Malformed entries drop.
  asuraEssence?: unknown;
  asuraZoneKills?: Record<string, unknown>;
  // v16 Hall of Fame observers (M7.95). All optional; a pre-v16 save backfills
  // goldEarned -> 0, bossBest -> {}, levelCapAt -> null. Malformed entries drop.
  goldEarned?: unknown;
  bossBest?: Record<string, unknown> | undefined;
  levelCapAt?: unknown;
  // v4/v5/v6/v7 single-character shape (v5 adds statPoints + stats; v6 adds mana +
  // autoSlots; v7 adds quest):
  hero?: Partial<CharacterSave> & {
    statPoints?: number;
    stats?: UnknownStats;
    mana?: number;
    autoSlots?: (SkillId | null)[];
    quest?: HeroQuest | null;
    // v17 (M8 Wave A): main-quest claim log + daily block. Optional/unknown so a pre-v17
    // save backfills (mainClaimed -> completed-no-backpay, dailies -> empty).
    mainClaimed?: unknown;
    dailies?: unknown;
  };
  // pre-v4 team shape:
  unlocked?: string[];
  heroes?: UnknownHeroProgress[];
  upgrades?: { atk?: number; speed?: number; hp?: number };
}

const KNOWN_CLASSES: readonly HeroClass[] = ["swordsman", "archer", "mage", "ninja"];

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
  tier: 1 | 2 | 3,
  saved: HeroQuest | null | undefined,
): HeroQuest | null {
  const def = evolutionQuestFor(cls, tier); // null at tier 3 (fully evolved, no quest)
  if (!def || !saved || saved.accepted !== true) return null;
  if (saved.id !== def.id) return null;
  // Objective-SHAPE guard (M7.9 tier-3 REDESIGN, owner "option ข" 2026-07-08): the id
  // `tier3_<cls>` is UNCHANGED but the OBJECTIVE shape changed (old = 2 objectives: map3
  // kills + a map2-boss rekill; new = 1 objective: map4-z1 kills). A pre-redesign save
  // mid-tier-3-quest therefore has a progress array whose length no longer matches the
  // def. Rather than silently mis-map the old map3-kill count onto the new map4 objective,
  // RESET the stale instance to un-accepted (null → the quest is simply re-offered at
  // L40). No SAVE_VERSION bump is needed — the HeroQuest SHAPE ({id,accepted,progress[]})
  // is unchanged; this is a data-content guard that any objective-shape change rides on.
  if (!Array.isArray(saved.progress) || saved.progress.length !== def.objectives.length) {
    return null;
  }
  const progress = def.objectives.map((_, i) => asStat(saved.progress[i], 0));
  return { id: def.id, accepted: true, progress };
}

/** Default auto-slot loadout for a migrated save: signature in slot 0, rest empty. The
 * LENGTH is tier-scoped (`autoSlotCapacity`) — 3 for tiers 1-2, 4 for tier 3 (M7.9). */
function defaultAutoSlotsFor(cls: HeroClass, tier: 1 | 2 | 3): (SkillId | null)[] {
  const slots: (SkillId | null)[] = new Array(autoSlotCapacity(tier)).fill(null);
  slots[0] = SIGNATURE_SKILL[cls];
  return slots;
}

/** Coerce a possibly-malformed saved tier to the {1,2,3} domain (M7.9). */
function asTier(v: number | undefined): 1 | 2 | 3 {
  return v === 3 ? 3 : v === 2 ? 2 : 1;
}

/**
 * Normalise a possibly-partial auto-slot array to the current length (v6). A
 * missing/malformed array falls back to the class default; unknown entries are
 * cleared to null. The full pool is used as the mana default (a generous top-up).
 */
function normalizeAutoSlots(
  cls: HeroClass,
  tier: 1 | 2 | 3,
  saved: (SkillId | null)[] | undefined,
): (SkillId | null)[] {
  const fallback = defaultAutoSlotsFor(cls, tier);
  if (!Array.isArray(saved)) return fallback;
  const out: (SkillId | null)[] = new Array(autoSlotCapacity(tier)).fill(null);
  for (let i = 0; i < out.length; i++) {
    const id = saved[i];
    out[i] = typeof id === "string" ? id : id === null ? null : fallback[i];
  }
  return out;
}

/**
 * Normalise saved consumable stacks (M6, v9) to the {hp,mana,return} shape: each
 * count clamped to [0, stackCap], anything missing/malformed -> 0. A pre-v9 save
 * (no `consumables`) becomes all zeros.
 */
function normalizeConsumables(
  saved: UnknownSave["consumables"],
): ConsumableCounts {
  const cap = CONFIG.shop.stackCap;
  const one = (v: unknown): number => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return 0;
    return Math.min(Math.floor(v), cap);
  };
  return {
    hpPotion: one(saved?.hpPotion),
    manaPotion: one(saved?.manaPotion),
    returnScroll: one(saved?.returnScroll),
    // "วาปหาเพื่อน" warp scroll (M8, v17): pre-v17 saves have no field -> 0.
    warpScroll: one(saved?.warpScroll),
  } satisfies Record<ShopItemId, number>;
}

/** Coerce a saved main-quest claim log to known chapter ids (M8, v17), deduped. */
function normalizeMainClaimedIds(saved: unknown): string[] {
  if (!Array.isArray(saved)) return [];
  const known = new Set<string>(CONFIG.mainQuest.chapters.map((c) => c.id));
  const out: string[] = [];
  for (const v of saved) {
    if (typeof v === "string" && known.has(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Coerce a saved daily block to {serverDay, quests[]} (M8, v17): known ids, sane counters. */
function normalizeDailiesBlock(saved: unknown): HeroDailies {
  const empty: HeroDailies = { serverDay: 0, quests: [] };
  if (!saved || typeof saved !== "object") return empty;
  const s = saved as { serverDay?: unknown; quests?: unknown };
  const serverDay = asStat(numOrUndef(s.serverDay), 0);
  const known = new Set(Object.keys(CONFIG.dailyQuests.catalog));
  const quests: HeroDailies["quests"] = [];
  if (Array.isArray(s.quests)) {
    for (const q of s.quests) {
      if (!q || typeof q !== "object") continue;
      const qq = q as { id?: unknown; progress?: unknown; claimed?: unknown };
      if (typeof qq.id !== "string" || !known.has(qq.id)) continue;
      if (quests.some((e) => e.id === qq.id)) continue;
      quests.push({ id: qq.id, progress: asStat(numOrUndef(qq.progress), 0), claimed: qq.claimed === true });
    }
  }
  return { serverDay, quests };
}

/**
 * Normalise a saved equipped-gear cache (M7, v10) to the {weapon, armor} shape:
 * each is a templateId string or null. A pre-v10 save (no `equipped`) becomes an
 * EMPTY loadout — a fresh character owns no gear, and the DB item ledger (not this
 * blob) is authoritative, so the boot payload overrides this on load anyway.
 * Templates are NOT validated here (unknown ids resolve to 0-stat at read time and
 * are cleaned up by the server ledger); this only fixes the SHAPE.
 */
function normalizeEquipped(saved: UnknownSave["equipped"]): EquippedGear {
  if (!saved) return emptyEquipped();
  return {
    weapon: typeof saved.weapon === "string" ? saved.weapon : null,
    armor: typeof saved.armor === "string" ? saved.armor : null,
    // Refine levels (M7.6, v14): clamp to [0, max]; a pre-v14 save (no `refine`)
    // becomes +0 on every slot (no stat change — byte-identical to pre-M7.6).
    refine: {
      weapon: clampRefine(asStat(numOrUndef(saved.refine?.weapon), 0)),
      armor: clampRefine(asStat(numOrUndef(saved.refine?.armor), 0)),
    },
  };
}

/** Coerce an unknown to a number, or undefined for anything non-numeric. */
function numOrUndef(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/**
 * Deterministically derive a drop-roll salt for a pre-v10 save (migrate has no
 * init seed). Hashes a few stable-ish save fields so the salt is CONSTANT for a
 * given save (idempotent — migrate re-derives the same value until a real v10 save
 * carries its own salt forward) yet spread across characters. Not security — only
 * decorrelates one character's drop stream from another's.
 */
function deriveSalt(save: UnknownSave): number {
  const cls = asClass(save.hero?.cls);
  const clsHash = cls === "swordsman" ? 1 : cls === "archer" ? 2 : cls === "mage" ? 3 : 4;
  const mix =
    ((save.stage ?? 1) >>> 0) ^
    Math.imul((save.gold ?? 0) >>> 0, 0x9e3779b9) ^
    Math.imul((save.hero?.level ?? 1) >>> 0, 0x85ebca6b) ^
    Math.imul(clsHash, 0xc2b2ae35);
  return splitmix32(mix >>> 0);
}

/** A location is valid only if it addresses a real zone; else null. */
function normalizeLocation(loc: UnknownLocation | undefined): WorldLocation | null {
  if (!loc || typeof loc.mapId !== "string" || typeof loc.zoneIdx !== "number") return null;
  if (!Number.isInteger(loc.zoneIdx) || loc.zoneIdx < 0) return null;
  const candidate: WorldLocation = { mapId: loc.mapId, zoneIdx: loc.zoneIdx };
  return isValidLocation(candidate) ? candidate : null;
}

/**
 * Merge a saved `unlockedZones` (clamped to each map's real zone count) with the
 * baseline that guarantees `location` itself is reachable ("all zones up to it").
 * A pre-v8 save has no saved counts, so it becomes exactly the baseline.
 */
function normalizeUnlocked(
  saved: Record<string, unknown> | undefined,
  base: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...base };
  if (saved) {
    for (const [mapId, v] of Object.entries(saved)) {
      const count = mapZoneCount(mapId);
      if (count === 0) continue; // unknown map id — drop
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        out[mapId] = Math.max(out[mapId] ?? 0, Math.min(Math.floor(v), count));
      }
    }
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
    const tier = asTier(save.hero.tier); // v15: {1,2,3} domain
    const stats = normalizeStats(cls, save.hero.stats);
    const maxMana = heroMaxMana(cls, stats.int, tier);
    hero = {
      cls,
      level,
      xp: save.hero.xp ?? 0,
      tier,
      // v5 keeps the saved points; a v4 save (no statPoints) gets the retro grant.
      statPoints: asStat(save.hero.statPoints, level * PPL),
      stats,
      // v6 keeps the saved mana (clamped into the pool); a v5 save defaults to full.
      mana: clampMana(save.hero.mana, maxMana),
      autoSlots: normalizeAutoSlots(cls, tier, save.hero.autoSlots),
      // v7/v15 keeps a saved accepted evolution quest (validated against the tier's
      // def); a pre-v7 save (no quest) -> null (re-offered on load if eligible).
      quest: normalizeQuest(cls, tier, save.hero.quest),
      // v17 (M8 Wave A): placeholders — reassigned below once unlockedZones/bossBest exist.
      mainClaimed: [],
      dailies: { serverDay: 0, quests: [] },
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
    const tier = asTier(p?.tier);
    const stats = normalizeStats(cls, undefined);
    hero = {
      cls,
      level,
      xp: p?.xp ?? 0,
      tier,
      statPoints: level * PPL,
      stats,
      mana: heroMaxMana(cls, stats.int, tier),
      autoSlots: defaultAutoSlotsFor(cls, tier),
      // Pre-v4 team saves predate quests entirely -> null (re-offered if eligible).
      quest: null,
      // v17 (M8 Wave A): placeholders — reassigned below once unlockedZones/bossBest exist.
      mainClaimed: [],
      dailies: { serverDay: 0, quests: [] },
    };
  }

  // ---- world placement (M6, v8) ----
  // Place the save at the FARM zone matching its `stage` (clamped) unless it
  // already carries a valid v8 location. Unlock everything up to that zone; point
  // auto-return at the placed farm zone. Re-derive `stage` from the placement so
  // it can never drift from `location`.
  const rawStage = save.stage ?? 1;
  const location: WorldLocation =
    normalizeLocation(save.location) ?? farmLocationForStage(rawStage);
  const placedFarm =
    normalizeLocation(save.lastFarmZone) &&
    zoneAt(normalizeLocation(save.lastFarmZone)!).kind === "farm"
      ? normalizeLocation(save.lastFarmZone)!
      : zoneAt(location).kind === "farm"
        ? location
        : farmLocationForStage(rawStage);
  const unlockedZones = normalizeUnlocked(save.unlockedZones, unlockUpTo(location));
  const bossBest = normalizeBossBest(save.bossBest);

  // ---- M8 Wave A quest state (v17) ----
  // mainClaimed: a v17 save keeps its (validated) claim log; a pre-v17 save PREFILLS with
  // every chapter the current progression already implies complete — mark-done, NO backpay
  // (mirrors v16 goldEarned=0), so a returning deep character isn't owed a pile of rewards.
  // Detection: a real array present -> v17 (preserve); absent -> pre-v17 (prefill).
  hero.mainClaimed = Array.isArray(save.hero?.mainClaimed)
    ? normalizeMainClaimedIds(save.hero.mainClaimed)
    : completedChapterIds(unlockedZones, bossBest);
  // dailies: v17 preserves its roster (known ids, sane counters); pre-v17 -> empty (safe).
  hero.dailies = normalizeDailiesBlock(save.hero?.dailies);

  return {
    version: SAVE_VERSION,
    stage: zoneAt(location).stage,
    gold: save.gold ?? 0,
    // Hall of Fame observers (M7.95, v16): preserve a v16 save's values; a pre-v16
    // save backfills goldEarned -> 0 (retroactive EARNED totals are unknowable —
    // don't fabricate from current gold), bossBest -> {}, levelCapAt -> null.
    goldEarned: asStat(numOrUndef(save.goldEarned), 0),
    bossBest,
    levelCapAt: normalizeLevelCapAt(save.levelCapAt),
    hero,
    location,
    unlockedZones,
    lastFarmZone: placedFarm,
    // NPC consumables (M6, v9): preserve a v9 save's clamped counts; a pre-v9 save
    // backfills to zeros.
    consumables: normalizeConsumables(save.consumables),
    // Idle bots (M7.5, v11): preserve a v11 save's clamped settings; a pre-v11 save
    // backfills to the config defaults (both bots OFF).
    bot: normalizeBotSettings(save.bot),
    // autoHunt toggle (M6.6, v12): preserve a v12 save's flag (coerced to a
    // boolean); a pre-v12 save (no flag) backfills to `true` (unchanged behaviour).
    autoHunt: typeof save.autoHunt === "boolean" ? save.autoHunt : true,
    // Per-zone unlock progress (v13): keep sane entries, drop garbage.
    zoneKills: normalizeZoneKills(save.zoneKills),
    // M7 gear (v10): empty loadout for a pre-v10 save (DB ledger is authoritative);
    // a monotonic counter clamped non-negative; a salt PRESERVED if present (never
    // recomputed — idempotent) else derived deterministically from the save content.
    equipped: normalizeEquipped(save.equipped),
    lootCounter: asStat(
      typeof save.lootCounter === "number" ? save.lootCounter : undefined,
      0,
    ),
    lootSalt:
      typeof save.lootSalt === "number" && Number.isFinite(save.lootSalt)
        ? save.lootSalt >>> 0
        : deriveSalt(save),
    // M7.6 ตีบวก material counter (v14): preserve a v14 save's count (floored non-
    // negative); a pre-v14 save (no `materials`) backfills to 0.
    materials: asStat(numOrUndef(save.materials), 0),
    // ดินแดนอสูร accrual (v19): preserve a v19 save's essence bank + per-zone ศิลาโซน counters;
    // a pre-v19 save backfills essence -> 0 and the counters -> {} (no retroactive materials).
    // `normalizeZoneKills` keeps only "map:idx" keys with non-negative integer counts.
    asuraEssence: asStat(numOrUndef(save.asuraEssence), 0),
    asuraZoneKills: normalizeZoneKills(save.asuraZoneKills),
    lastSeen: save.lastSeen ?? 0,
  };
}
