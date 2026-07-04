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

import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  CONFIG,
  SAVE_VERSION,
  SLOT_ORDER,
  SPEED_UPGRADE_CAP,
  migrate,
  type HeroClass,
  type SaveData,
  type UnknownSave,
} from "@/engine";
import { prisma } from "@/lib/db";
import { computeOfflineTime, type OfflineResult } from "@/server/offline";

// SLOT_ORDER is the authoritative list of known hero classes.
const KNOWN_CLASSES = [...SLOT_ORDER] as [HeroClass, ...HeroClass[]];

/**
 * The accepted incoming-save contract. Anything that fails this is a 400 — a
 * well-behaved client (see `toSaveData`) always produces a conforming shape.
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
    unlocked: z
      .array(z.enum(KNOWN_CLASSES))
      .min(1)
      .max(CONFIG.maxHeroes)
      // Unique — `heroSlots` is derived from `unlocked.length`, so duplicates
      // would forge extra slots.
      .refine((xs) => new Set(xs).size === xs.length, {
        message: "unlocked must not contain duplicates",
      }),
    upgrades: z
      .object({
        atk: z.number().int().min(0),
        // Only the speed line is capped in the engine; enforce it here too.
        speed: z.number().int().min(0).max(SPEED_UPGRADE_CAP),
        hp: z.number().int().min(0),
      })
      .strict(),
    // Server-owned. Present in the client shape (as 0) but IGNORED — persistSave
    // re-stamps it from the server clock. Optional so a client may omit it.
    lastSeen: z.number().optional(),
  })
  .strict();

export type ValidSaveInput = z.infer<typeof saveDataSchema>;

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
 * Load a user's save. The stored JSON is ALWAYS migrated before returning, and
 * offline time is computed from the server-stamped `lastSeen` vs `now` (server
 * wall-clock — never a client-supplied timestamp).
 */
export async function loadSave(
  userId: string,
  now: number = Date.now(),
): Promise<LoadResult> {
  const row = await prisma.saveState.findUnique({ where: { userId } });
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
 * Validate and upsert a user's save (one slot per user for MVP).
 * The server stamps `lastSeen` — the client timestamp is discarded.
 */
export async function persistSave(
  userId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<PersistResult> {
  const parsed = parseSaveData(input);
  if (!parsed.ok) return parsed;

  // ── M5 anti-cheat re-validation slots in HERE ──────────────────────────────
  // Before accepting, re-derive the max achievable gold/stage/upgrades from the
  // previous row + elapsed wall-time at a bounded earn rate, and clamp/reject
  // impossible jumps. Today we only enforce structural sanity above.

  const data: SaveData = { ...parsed.data, lastSeen: now.getTime() };
  const jsonData = data as unknown as Prisma.InputJsonObject;

  await prisma.saveState.upsert({
    where: { userId },
    create: { userId, version: data.version, data: jsonData, lastSeen: now },
    update: { version: data.version, data: jsonData, lastSeen: now },
  });

  return { ok: true, lastSeen: now.toISOString() };
}
