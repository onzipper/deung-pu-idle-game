/**
 * Cross-device UI/automation config (owner request 2026-07-07) — the trust
 * boundary around the per-character `Character.uiConfig` JSON column.
 *
 * WHAT THIS IS: the browser-localStorage-owned bot/automation PREFERENCES
 * (autoCast, autoAllocate, auto-return/advance, auto-potion toggles+thresholds,
 * the per-rarity auto-sell rules incl. the M7.9 epic toggle, auto-equip). They
 * used to live only in localStorage → reset when a player switched phone↔PC.
 * Persisting them per character makes the config FOLLOW THE CHARACTER.
 *
 * WHAT THIS IS NOT: it is NOT the engine save (`SaveData`/`SAVE_VERSION`) and NOT
 * authoritative game state. It carries NONE of the engine-persisted fields —
 * bot targets / gold reserve (SAVE v11) and autoHunt (SAVE v12) already live in
 * the save blob, which stays their SINGLE SOURCE OF TRUTH. Duplicating them here
 * would create two writers for one value; deliberately excluded.
 *
 * Trust model: like every other incoming payload, the client is untrusted. The
 * schema is STRICT (unknown keys rejected) and every field is bounded. Because
 * these are cosmetic preferences (never gold/progress), a MALFORMED uiConfig must
 * never fail the player's actual save — the caller drops an invalid one and
 * leaves the stored value untouched (see `persistSave`). Every field is optional
 * so a client on an older/newer build never has its whole config rejected for a
 * single missing/added field.
 */

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/** Per-rarity auto-dispose action — mirrors the client `AutoSellAction` union
 * (`src/ui/store/gameStore.ts`). */
const autoSellAction = z.enum(["off", "sell", "salvage"]);

/** A potion auto-use threshold is a fraction of the max pool. The client clamps
 * to [0.05, 0.95]; accept the full [0, 1] so a legit default/edge value is never
 * spuriously rejected, while still bounding a hostile huge/negative number. */
const threshold = z.number().min(0).max(1);

/**
 * STRICT, all-optional schema. Lists EXACTLY the known preference fields with
 * bounds; any unknown key is rejected. Optional-everywhere = forward/backward
 * compatible (a missing field is simply not applied; the client keeps its own
 * value for it).
 */
export const uiConfigSchema = z
  .object({
    autoCast: z.boolean(),
    autoAllocate: z.boolean(),
    autoReturn: z.boolean(),
    autoAdvance: z.boolean(),
    autoHpPotion: z.boolean(),
    autoManaPotion: z.boolean(),
    autoHpThreshold: threshold,
    autoManaThreshold: threshold,
    autoSellCommon: autoSellAction,
    autoSellRare: autoSellAction,
    autoSellEpic: autoSellAction,
    autoSellKeepBetterStat: z.boolean(),
    autoEquip: z.boolean(),
    // HOF seasonal rewards: the ONE chosen display title id (`${board}.${rank}`, e.g.
    // "level.1") the player shows on nameplates/HOF/party. Structurally validated here
    // (a short string or null to clear); the AUTHORITATIVE "you actually hold this
    // title" check lives in `setDisplayTitle` (src/server/hofSeason.ts), and every
    // OTHER-player read derives titles from HofAward, never from this cosmetic field.
    displayTitle: z.string().min(1).max(16).nullable(),
  })
  .partial()
  .strict();

export type UiConfig = z.infer<typeof uiConfigSchema>;

export type ParseUiConfigResult =
  | { ok: true; data: UiConfig }
  | { ok: false; error: string };

/**
 * Validate + narrow an untrusted uiConfig payload. Pure (no I/O) so it's unit-
 * testable without the DB, same shape as `parseSaveData`.
 */
export function parseUiConfig(input: unknown): ParseUiConfigResult {
  const result = uiConfigSchema.safeParse(input);
  if (!result.success) {
    const error = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error };
  }
  return { ok: true, data: result.data };
}

/**
 * Read a character's stored uiConfig (the per-character preference blob), or null
 * if the character has never persisted one (pre-existing rows / fresh character →
 * the client keeps its own localStorage/defaults). Narrowed through the schema on
 * read too, so a row hand-edited to an unknown shape degrades to null rather than
 * leaking junk to the client.
 */
export async function loadUiConfig(characterId: string): Promise<UiConfig | null> {
  const row = await prisma.character.findUnique({
    where: { id: characterId },
    select: { uiConfig: true },
  });
  if (!row || row.uiConfig == null) return null;
  const parsed = parseUiConfig(row.uiConfig);
  return parsed.ok ? parsed.data : null;
}

/**
 * Coerce a validated uiConfig into the Prisma JSON write value. Kept here so the
 * `persistSave` transaction stays free of Prisma-JSON casting noise.
 */
export function uiConfigWriteValue(cfg: UiConfig): Prisma.InputJsonValue {
  return cfg as unknown as Prisma.InputJsonValue;
}
