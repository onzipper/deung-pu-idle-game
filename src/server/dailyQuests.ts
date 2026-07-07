/**
 * DAILY quests — server-authoritative calendar + claim audit (M8 Quest Wave B).
 *
 * The engine (src/engine/systems/dailyQuests.ts) counts progress and OWNS the reward
 * (client-authoritative economy, same trust tier as gold); the SERVER'S job is the two
 * things the client cannot be trusted with:
 *
 *   1. THE CALENDAR — `serverDay` is computed from the server wall-clock on a FIXED
 *      Asia/Bangkok (UTC+7) day boundary (accepted design flag), never a client clock.
 *      A player who winds their device clock forward gets no new roster.
 *   2. THE ROSTER — the day's 3 quest ids are picked DETERMINISTICALLY from the engine
 *      catalog, seeded by `(serverDay, userId)` with a small STATELESS hash (splitmix32
 *      finalizer — the same idiom as core/rng, no RNG state). Same day + same user =>
 *      the same 3 forever (auditable, un-rerollable); different users differ.
 *
 * The claim gate itself (anti-double-claim) is the `DailyClaim` unique constraint, driven
 * by `recordDailyClaim` below. No reward is computed here — engine-side economy covers it.
 *
 * Server-only (touches the DB via `@/lib/db`); the pure calendar/roster helpers are exported
 * for unit tests and for the save endpoints to piggyback (zero extra client requests).
 */

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { CONFIG } from "@/engine/config";
import { prisma } from "@/lib/db";

/** Claim request body: a single daily-quest id (bounded; roster membership checked later). */
export const dailyClaimSchema = z.object({
  questId: z.string().min(1).max(32),
});
export type DailyClaimInput = z.infer<typeof dailyClaimSchema>;

/** Fixed daily-reset timezone offset: Asia/Bangkok = UTC+7 (design §2, owner-accepted). */
export const DAILY_TZ_OFFSET_SECONDS = 7 * 3600;
const SECONDS_PER_DAY = 86400;

/**
 * The integer day-epoch for a given instant, on the Asia/Bangkok (UTC+7) boundary.
 * `floor((unixSeconds + 7h) / 86400)` — a stable, opaque day counter (NOT a wall date):
 * it rolls over at 00:00 Bangkok time. The engine treats it as an opaque `serverDay`.
 */
export function serverDayFor(now: Date): number {
  return Math.floor((now.getTime() / 1000 + DAILY_TZ_OFFSET_SECONDS) / SECONDS_PER_DAY);
}

/** splitmix32 finalizer (stateless mix of a 32-bit word) — mirrors core/rng's idiom. */
function mix32(a: number): number {
  let t = (a + 0x9e3779b9) | 0;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
  return (t ^ (t >>> 15)) >>> 0;
}

/** FNV-1a 32-bit string hash (folds the userId into a seed word). */
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The full daily catalog ids, SORTED for a deterministic base order (config → keys). */
function catalogIds(): string[] {
  return Object.keys(CONFIG.dailyQuests.catalog).sort();
}

/** How many quests a daily roster holds (echoes the engine `rosterSize` / 3 auto slots). */
export function rosterSize(): number {
  return CONFIG.dailyQuests.rosterSize;
}

/**
 * The deterministic daily roster for `(serverDay, userId)`: `rosterSize` DISTINCT catalog
 * ids, chosen by a seeded partial Fisher–Yates shuffle over the sorted catalog. Pure +
 * stateless — same inputs always yield the same ids (audit / anti-reroll), and the seed
 * mixes the user in so two players on the same day get different rosters. If the catalog
 * ever holds fewer than `rosterSize` entries, it returns all of them.
 */
export function rosterFor(serverDay: number, userId: string): string[] {
  const ids = catalogIds();
  const size = Math.min(rosterSize(), ids.length);
  // Seed: mix the user hash with the day so neither dominates (day alone would give every
  // user the same roster; user alone would never rotate).
  let state = mix32(hashString(userId) ^ mix32(serverDay | 0));
  const next = (): number => {
    state = (state + 0x9e3779b9) | 0;
    return mix32(state);
  };
  // Partial Fisher–Yates: only the first `size` slots need to be resolved.
  const pool = ids.slice();
  for (let i = 0; i < size; i++) {
    const j = i + (next() % (pool.length - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, size);
}

/** The save/boot piggyback payload: today's roster for this user (zero extra requests). */
export interface DailyRosterPayload {
  serverDay: number;
  questIds: string[];
}

/** Compute the daily roster payload for `userId` at instant `now` (server-authoritative). */
export function dailyRosterPayload(userId: string, now: Date): DailyRosterPayload {
  const serverDay = serverDayFor(now);
  return { serverDay, questIds: rosterFor(serverDay, userId) };
}

/** Whether `questId` is a real daily catalog id (rejects unknown/forged ids at the boundary). */
export function isDailyQuestId(questId: string): boolean {
  return Object.prototype.hasOwnProperty.call(CONFIG.dailyQuests.catalog, questId);
}

export type RecordClaimResult =
  | { ok: true; serverDay: number }
  | { ok: false; code: "not_in_roster" | "already_claimed" };

/**
 * Record a daily-quest claim (the `/api/quest/daily/claim` gate). The caller supplies the
 * resolved `characterId` + `userId` + the requested `questId`; the SERVER recomputes both
 * `serverDay` and the roster (the client's day/roster is never trusted). Rejects a quest
 * that is not in TODAY's roster (`not_in_roster`), then INSERTs a `DailyClaim` — a second
 * claim of the same quest on the same day collides on the unique index → `already_claimed`
 * (P2002). No reward is granted here: the engine's `claimDaily` credits it once this returns
 * ok (the refine-endpoint pattern — the client fires the engine intent only after 200).
 */
export async function recordDailyClaim(
  characterId: string,
  userId: string,
  questId: string,
  now: Date = new Date(),
): Promise<RecordClaimResult> {
  const serverDay = serverDayFor(now);
  const roster = rosterFor(serverDay, userId);
  if (!roster.includes(questId)) return { ok: false, code: "not_in_roster" };
  try {
    await prisma.dailyClaim.create({
      data: { characterId, questId, serverDay },
      select: { id: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, code: "already_claimed" };
    }
    throw err;
  }
  return { ok: true, serverDay };
}
