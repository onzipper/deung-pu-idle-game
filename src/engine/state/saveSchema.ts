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
        tier: z.number().int().min(1).max(2),
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
      })
      .strict(),
    // Server-owned. Present in the client shape (as 0) but IGNORED — persistSave
    // re-stamps it from the server clock. Optional so a client may omit it.
    lastSeen: z.number().optional(),
  })
  .strict();

export type ValidSaveInput = z.infer<typeof saveDataSchema>;
