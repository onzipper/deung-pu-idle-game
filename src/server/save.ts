/**
 * Server-authoritative save / load.
 *
 * Trust boundary: every payload that crosses into the DB or back out is treated
 * as hostile. Incoming saves are validated with zod (shape + sane numeric
 * ranges) before they touch the row; outgoing (stored) saves ALWAYS pass through
 * `migrate()` so a stale or hand-edited blob is normalised to the current
 * `SAVE_VERSION` before the client sees it.
 *
 * `lastSeen` is server-owned in both directions: the client's timestamp is
 * ignored and re-stamped from the server wall-clock on persist, which is what
 * keeps offline-idle earnings from being farmed by a forward-set client clock.
 *
 * M5 anti-cheat slots in at the marked point in `persistSave`: today we only
 * reject structurally impossible saves; the milestone-5 goal is to re-derive the
 * maximum achievable gold/stage/upgrades server-side (from elapsed time and a
 * bounded earn rate) and clamp/reject anything beyond it.
 */

import { Prisma } from "@prisma/client";
import {
  migrate,
  saveDataSchema,
  type SaveData,
  type UnknownSave,
} from "@/engine";
import { prisma } from "@/lib/db";
import { computeOfflineTime, type OfflineResult } from "@/server/offline";
import { powerFromSave } from "@/server/characters";
import { upsertLeaderboardEntry } from "@/server/leaderboard";
import { parseUiConfig, uiConfigWriteValue } from "@/server/uiConfig";

// HANDOFF: the incoming-save payload zod (`saveDataSchema`) now lives in the
// engine (`src/engine/state/saveSchema.ts`, colocated with the SAVE_VERSION shape)
// and is re-exported from `@/engine`. A future SAVE_VERSION bump is therefore a
// self-contained engine edit and does NOT touch this file. This module owns the
// trust boundary AROUND that schema (migrate, persistence, offline, anti-cheat).

export type ParseResult =
  | { ok: true; data: SaveData }
  | { ok: false; error: string };

/**
 * Validate + normalise an untrusted payload into a canonical `SaveData`.
 * Pure (no I/O) so it is unit-testable without the DB.
 */
export function parseSaveData(input: unknown): ParseResult {
  const result = saveDataSchema.safeParse(input);
  if (!result.success) {
    const error = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error };
  }
  // Route through migrate() so the persisted shape is always canonical.
  return { ok: true, data: migrate(result.data as UnknownSave) };
}

export interface LoadResult {
  /** The migrated save, or null if the user has never saved. */
  save: SaveData | null;
  /** Capped offline-idle credit computed from the server wall-clock. */
  offline: OfflineResult;
}

/**
 * Load an ACTIVE CHARACTER's save (M5: per-character, keyed by the unique
 * `characterId` — the caller resolves it from the identity cookie + active-
 * character selection). The stored JSON is ALWAYS migrated before returning, and
 * offline time is computed from the server-stamped `lastSeen` vs `now` (server
 * wall-clock — never a client-supplied timestamp).
 */
export async function loadSave(
  characterId: string,
  now: number = Date.now(),
): Promise<LoadResult> {
  const row = await prisma.saveState.findUnique({ where: { characterId } });
  if (!row) {
    return { save: null, offline: { creditedSeconds: 0, capped: false } };
  }

  const save = migrate(row.data as UnknownSave);
  // The DateTime column is the authoritative last-seen (the JSON copy is not
  // trusted); mirror it into the returned save for consistency.
  const lastSeenMs = row.lastSeen.getTime();
  save.lastSeen = lastSeenMs;

  const offline = computeOfflineTime(lastSeenMs, now);
  return { save, offline };
}

export type PersistResult =
  | { ok: true; lastSeen: string }
  | { ok: false; error: string };

/**
 * Validate and upsert an ACTIVE CHARACTER's save (M5: one save row per character,
 * keyed by the unique `characterId`). `userId` is the owning account, needed to
 * stamp the row on first create (kept for account-scoped queries + cascade). The
 * server stamps `lastSeen` — the client timestamp is discarded.
 *
 * ALSO refreshes the `Character.level` + `Character.power` denormalised caches
 * from the validated payload (power re-derived via the engine's `combatPower` —
 * see `powerFromSave`) in the SAME transaction as the save write, so a Hall-of-
 * Fame read never sees a save/cache skew.
 */
export async function persistSave(
  characterId: string,
  userId: string,
  input: unknown,
  now: Date = new Date(),
  uiConfig?: unknown,
): Promise<PersistResult> {
  const parsed = parseSaveData(input);
  if (!parsed.ok) return parsed;

  // ── M5 anti-cheat re-validation slots in HERE ──────────────────────────────
  // Before accepting, re-derive the max achievable gold/stage/upgrades from the
  // previous row + elapsed wall-time at a bounded earn rate, and clamp/reject
  // impossible jumps. Today we only enforce structural sanity above.

  const data: SaveData = { ...parsed.data, lastSeen: now.getTime() };
  const jsonData = data as unknown as Prisma.InputJsonObject;
  const power = powerFromSave(data.hero);

  // Cross-device UI/automation config (owner request 2026-07-07). OPTIONAL +
  // BEST-EFFORT: a cosmetic preference blob must NEVER fail the player's real
  // save. Missing (`undefined`) → leave the stored value untouched (an old
  // client that doesn't send it doesn't wipe it). Present-but-invalid → drop it
  // (log) and still persist the save. Only a valid one is written, in the SAME
  // Character.update as the HOF caches below.
  const characterData: Prisma.CharacterUpdateInput = {
    level: data.hero.level,
    power,
  };
  // M8 presence cache: stamp the character's CURRENT zone (mapId:zoneIdx composite,
  // ≤32 chars) alongside the level/power caches so a friends-list poll can show
  // "where is my friend" without parsing this save blob. Derived from the validated
  // payload's `location` (re-derivable, denormalized). Absent location (pre-v8 /
  // trimmed) → leave the prior value untouched.
  if (data.location) {
    characterData.lastZone = `${data.location.mapId}:${data.location.zoneIdx}`.slice(0, 32);
  }
  if (uiConfig !== undefined) {
    const uic = parseUiConfig(uiConfig);
    if (uic.ok) characterData.uiConfig = uiConfigWriteValue(uic.data);
    else console.warn("[persistSave] rejected uiConfig (kept prior):", uic.error);
  }

  await prisma.$transaction([
    prisma.saveState.upsert({
      where: { characterId },
      create: { userId, characterId, version: data.version, data: jsonData, lastSeen: now },
      update: { version: data.version, data: jsonData, lastSeen: now },
    }),
    // Refresh the HOF caches (source of truth stays the save blob above).
    // NOTE (M7.6): `Character.materials` is NOT refreshed here — it is the
    // AUTHORITATIVE refine-material counter, mutated ONLY by the salvage/refine
    // endpoints. The save blob carries a `materials` mirror the boot payload
    // overrides from the DB; writing it back from an untrusted save would let a
    // client grant itself materials.
    prisma.character.update({
      where: { id: characterId },
      data: characterData,
    }),
  ]);

  // M7.95 Hall of Fame: rebuild the character's leaderboard projection from the
  // just-persisted (validated) save. BEST-EFFORT — a leaderboard-cache failure
  // must never fail the player's save (the blob is already committed above); it
  // self-heals on the next autosave. Everything ranked is re-derived server-side
  // (power over stats+gear+refine, server-stamped times) — see @/server/leaderboard.
  try {
    await upsertLeaderboardEntry(characterId, userId, data, now);
  } catch (err) {
    console.error("[persistSave] leaderboard upsert failed (non-fatal):", err);
  }

  return { ok: true, lastSeen: now.toISOString() };
}
