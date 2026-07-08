/**
 * Incoming-save payload schema (zod) — the SHAPE contract for a POSTed save.
 *
 * This lives in `engine/` (zod is pure TS — allowed under the engine-purity rule)
 * and is COLOCATED with the `SaveData` / `CharacterSave` shape in `./index.ts` and
 * the `SAVE_VERSION` / `migrate()` in `./version.ts`. Rationale: every time the
 * save shape changes, this schema must change in lockstep — keeping them in the
 * same layer means a future `SAVE_VERSION` bump is a single, self-contained engine
 * edit and never forces a change to the server (`src/server/save.ts` only IMPORTS
 * this). See the matching handoff note in `src/server/save.ts`.
 *
 * This is a boundary contract, not a rules authority: it validates the SHAPE and
 * sane numeric ranges only. `parseSaveData` (server) runs `migrate()` on top, and
 * the M5 anti-cheat pass re-derives max-plausible progress server-side.
 */

import { z } from "zod";
import { CONFIG, SLOT_ORDER } from "@/engine/config";
import { SAVE_VERSION } from "@/engine/state/version";
import type { HeroClass } from "@/engine/entities";

// SLOT_ORDER is the authoritative list of known hero classes.
const KNOWN_CLASSES = [...SLOT_ORDER] as [HeroClass, ...HeroClass[]];

/** A single base-stat axis: a non-negative integer within the config cap. */
const statAxis = z.number().int().min(0).max(CONFIG.stats.cap);

/** A base-stat block: four non-negative integer axes (M5 "Base stats", SAVE v5). */
export const statBlockSchema = z
  .object({ str: statAxis, dex: statAxis, int: statAxis, vit: statAxis })
  .strict();

/** A world location (M6 "World & Town", SAVE v8): map id + zone index. Validity of
 * the address (map exists, zone in range) is re-checked by `migrate` on load, so a
 * loose shape here never needlessly 400s a stale-but-harmless location. */
export const worldLocationSchema = z
  .object({ mapId: z.string(), zoneIdx: z.number().int().min(0) })
  .strict();

/** Held NPC-consumable stack counts (M6 "เมืองหลัก", SAVE v9). Loose non-negative
 * ints — `migrate` clamps each to `CONFIG.shop.stackCap`, so an over-cap saved
 * count never needlessly 400s (same resilience as the world fields below). */
export const consumablesSchema = z
  .object({
    hpPotion: z.number().int().min(0),
    manaPotion: z.number().int().min(0),
    returnScroll: z.number().int().min(0),
    // "วาปหาเพื่อน" warp scroll (M8, SAVE v17). Optional so a pre-v17 (or trimmed)
    // payload passes; `migrate` backfills 0 and clamps to the stack cap.
    warpScroll: z.number().int().min(0).optional(),
  })
  .strict();

/** Idle-bot settings (M7.5, SAVE v11). Loose non-negative numbers — `migrate`
 * (`normalizeBotSettings`) coerces booleans + clamps targets to the stack cap, so a
 * stale/over-cap block never needlessly 400s (same resilience as the fields below). */
export const botSettingsSchema = z
  .object({
    enabled: z.boolean(),
    sellTripEnabled: z.boolean(),
    hpPotionTarget: z.number().int().min(0),
    mpPotionTarget: z.number().int().min(0),
    scrollReserve: z.number().int().min(0),
    goldReserve: z.number().min(0).finite(),
  })
  .strict();

/**
 * The accepted incoming-save contract (M5 v5 single character). Anything that
 * fails this is a 400 — a well-behaved client (see `toSaveData`) always produces
 * a conforming shape.
 */
export const saveDataSchema = z
  .object({
    // Must be the current version. Old clients must migrate client-side first;
    // the server does not silently up-convert a POSTed payload of another shape.
    version: z.literal(SAVE_VERSION),
    stage: z.number().int().min(1),
    // Gold is a non-negative finite amount (engine keeps it integral, but we
    // don't hard-require int() so rounding never spuriously 400s a real save).
    gold: z.number().min(0).finite(),
    // The single active character (M5): chosen class + level/xp/tier + base stats.
    // `tier` is the class-advancement tier (1 = base, 2 = evolved). `statPoints`
    // (unspent) and `stats` (allocated block) are the M5 "Base stats" (SAVE v5);
    // both are OPTIONAL so a payload missing them is backfilled by `migrate()`
    // (retro grant), same resilience as the optional server-owned `lastSeen`.
    hero: z
      .object({
        cls: z.enum(KNOWN_CLASSES),
        level: z.number().int().min(1).max(CONFIG.leveling.levelCap),
        xp: z.number().min(0).finite(),
        // M7.9 "Grand Expansion": tier domain widened {1,2} -> {1,2,3} (tier-3 class).
        tier: z.number().int().min(1).max(3),
        statPoints: z.number().int().min(0).optional(),
        stats: statBlockSchema.optional(),
        // M5 "mana + skill framework v2" (SAVE v6). Both OPTIONAL so a payload
        // missing them is backfilled by `migrate()` (mana → full pool, autoSlots
        // → class default), same resilience as the optional stats block above.
        // Mana is finite/non-negative (re-clamped to the derived pool on load).
        mana: z.number().min(0).finite().optional(),
        // Auto-slot loadout: each slot is a skill id string or null (empty). The
        // array length + skill validity are re-normalised on load; unknown ids
        // are dropped, so a strict enum here would needlessly 400 a stale loadout.
        autoSlots: z.array(z.string().nullable()).optional(),
        // M5 "class-change quest" (SAVE v7). OPTIONAL + nullable so a pre-v7 (or
        // tier-2 / un-accepted) payload is backfilled to null by `migrate()`,
        // same resilience as the fields above. Progress is re-validated against
        // the current class def on load (`normalizeQuest`); a foreign id/shape is
        // dropped there, so a loose object schema here never needlessly 400s.
        quest: z
          .object({
            id: z.string(),
            accepted: z.boolean(),
            progress: z.array(z.number().min(0).finite()),
          })
          .strict()
          .nullable()
          .optional(),
        // M8 Wave A (SAVE v17). Both OPTIONAL so a pre-v17 payload is backfilled by
        // `migrate()` (mainClaimed -> completed-no-backpay, dailies -> empty). Loose
        // shapes — `normalizeMainClaimedIds` / `normalizeDailiesBlock` on load drop
        // unknown ids + clamp counters, so a stale/foreign entry never needlessly 400s.
        mainClaimed: z.array(z.string()).optional(),
        dailies: z
          .object({
            serverDay: z.number().int().min(0),
            quests: z.array(
              z
                .object({
                  id: z.string(),
                  progress: z.number().int().min(0),
                  claimed: z.boolean(),
                })
                .strict(),
            ),
          })
          .strict()
          .optional(),
      })
      .strict(),
    // M6 "World & Town" world position (SAVE v8). All OPTIONAL so a pre-v8 (or
    // trimmed) payload is backfilled by `migrate()` from `stage` — same resilience
    // as the optional fields above. `unlockedZones` is a per-map count record;
    // counts are clamped to each map's real zone count on load.
    location: worldLocationSchema.optional(),
    unlockedZones: z.record(z.string(), z.number().int().min(0)).optional(),
    lastFarmZone: worldLocationSchema.optional(),
    // M6 "เมืองหลัก" NPC-consumable stacks (SAVE v9). OPTIONAL so a pre-v9 (or
    // trimmed) payload is backfilled to zeros by `migrate()` — same resilience as
    // the world fields above.
    consumables: consumablesSchema.optional(),
    // M7.5 idle-bot settings (SAVE v11). OPTIONAL so a pre-v11 (or trimmed) payload
    // is backfilled to the config defaults (both bots OFF) by `migrate()` — same
    // resilience as the fields above. Values are re-clamped on load.
    bot: botSettingsSchema.optional(),
    // autoHunt toggle (M6.6, SAVE v12). Optional so a pre-v12 (or trimmed) payload
    // is backfilled to `true` by `migrate()` -- same resilience as the fields above.
    autoHunt: z.boolean().optional(),
    // Per-zone unlock-quota progress (M7.7 follow-up, SAVE v13). Optional so a
    // pre-v13 payload passes; migrate() normalises entries.
    zoneKills: z.record(z.string(), z.number().int().nonnegative()).optional(),
    // M7 gear (SAVE v10). All OPTIONAL so a pre-v10 (or trimmed) payload is
    // backfilled by `migrate()` (equipped → empty, counter → 0, salt → derived) —
    // same resilience as the fields above. `equipped` is a weapon/armor templateId
    // cache (nullable strings; validity re-checked at equip time, so a stale/foreign
    // id never needlessly 400s). The DB item ledger is authoritative regardless.
    // `refine` (M7.6, SAVE v14) is a per-slot +level cache; OPTIONAL + loose
    // non-negative ints (migrate clamps to [0, REFINE.maxRefine]) so a pre-v14 or
    // over-cap payload never needlessly 400s. Server-authoritative regardless.
    equipped: z
      .object({
        weapon: z.string().nullable(),
        armor: z.string().nullable(),
        refine: z
          .object({ weapon: z.number().int().min(0), armor: z.number().int().min(0) })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    lootCounter: z.number().int().min(0).optional(),
    lootSalt: z.number().int().min(0).optional(),
    // M7.6 ตีบวก material counter (SAVE v14). OPTIONAL so a pre-v14 (or trimmed)
    // payload is backfilled to 0 by `migrate()` — same resilience as the fields above.
    materials: z.number().int().min(0).optional(),
    // ดินแดนอสูร accrual (endgame v1, SAVE v19). Both OPTIONAL so a pre-v19 (or trimmed)
    // payload is backfilled by `migrate()` (essence -> 0, counters -> {}). Loose non-negative
    // ints — `migrate`'s `normalizeZoneKills` drops garbage, so a stale entry never needlessly 400s.
    asuraEssence: z.number().int().min(0).optional(),
    asuraZoneKills: z.record(z.string(), z.number().int().nonnegative()).optional(),
    // "ตำราตำนาน" secret tome + ตราอสูร sigils (endgame v1.3, SAVE v20). All OPTIONAL so a pre-v20
    // (or trimmed) payload is backfilled by `migrate()` (sigils -> 0, pages -> 0, unlocked -> false).
    // Loose non-negative ints / bool — `migrate` floors + coerces, so a stale value never needlessly 400s.
    asuraSigils: z.number().int().min(0).optional(),
    tomePages: z.number().int().min(0).optional(),
    tomeUnlocked: z.boolean().optional(),
    // M7.95 "Hall of Fame" observers (SAVE v16). All OPTIONAL so a pre-v16 (or
    // trimmed) payload is backfilled by `migrate()` (goldEarned -> 0, bossBest -> {},
    // levelCapAt -> null). Loose non-negative numbers — `normalizeBossBest` /
    // `normalizeLevelCapAt` on load validate + clamp, so a stale/foreign shape never
    // needlessly 400s (same resilience as the fields above).
    goldEarned: z.number().min(0).finite().optional(),
    bossBest: z
      .record(
        z.string(),
        z.object({ seconds: z.number().min(0).finite(), at: z.number().min(0).finite() }),
      )
      .optional(),
    levelCapAt: z.number().min(0).finite().nullable().optional(),
    // Server-owned. Present in the client shape (as 0) but IGNORED — persistSave
    // re-stamps it from the server clock. Optional so a client may omit it.
    lastSeen: z.number().optional(),
  })
  .strict();

export type ValidSaveInput = z.infer<typeof saveDataSchema>;
