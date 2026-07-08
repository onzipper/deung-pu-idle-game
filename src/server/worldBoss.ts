/**
 * World boss "เสี่ยจ๋อง" — hourly-window reward claim (server-authoritative).
 *
 * An hourly world boss spawns; a player who kills it claims ONCE per (character,
 * hourly window). The claim grants, in ONE tx:
 *   - gold 5,000 (client-authoritative save blob — returned as `goldCredit`, the same
 *     trust tier + application path as the sell endpoint's `totalGold` / refine's
 *     `goldDelta`; there is NO cryptographic gold signer in this MVP, gold lives in the
 *     save until the M5 re-derivation lands, see src/server/items.ts sell/refine),
 *   - enhancement stones +350 on the AUTHORITATIVE `Character.materials` column (same
 *     pattern as refine/salvage/stone-claim), and
 *   - ONE "แกร่ง" fortifier ItemInstance (50:50 crypto roll weapon vs armor, origin
 *     "worldboss", minted with its `minted` ItemEvent — the anti-dupe recipe).
 *
 * Trust boundary: identity comes from the cookie; the body's `characterId` is only
 * honoured after an owner+liveness check (never trusted alone). The `windowId` is
 * validated against the SERVER wall-clock (a client that forwards its clock or forges
 * a future/stale window is rejected — the anti-cheat crux). Idempotency is the
 * `WorldBossClaim` @@unique([characterId, windowId]) → a duplicate collides on P2002
 * and returns `already_claimed` (the DailyClaim pattern).
 */

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { randomInt } from "node:crypto";
import { WORLD_BOSS, worldBossWindowId } from "@/engine";
import { FORTIFIER_FOR_SLOT } from "@/engine/config/items";
import { prisma } from "@/lib/db";
import { INSTANCE_SELECT, toItemDTO, type ItemInstanceDTO } from "@/server/items";

// ── Schedule ─────────────────────────────────────────────────────────────────
// `WORLD_BOSS` (CONFIG.worldBoss) + `worldBossWindowId` now come from the ENGINE —
// the single schedule source shared with the client's spawn/countdown driver, so a
// kill and its claim always bucket into the SAME windowId. Re-exported for the
// existing test imports.
export { WORLD_BOSS, worldBossWindowId };

/** Extra slack past the boss lifetime for a claim whose kill landed at the window
 *  edge (covers clock skew + claim latency across an hour rollover). */
const CLAIM_GRACE_MS = 5 * 60 * 1000;

/** Per-claim reward (owner-set). Gold is a client-applied credit; materials + the
 *  fortifier are server-authoritative. */
export const WORLD_BOSS_REWARD = { gold: 5000, materials: 350 } as const;

/**
 * SERVER-WIDE shared HP pool knobs (owner-approved: one boss, one pool, every online
 * player chips the SAME hp). `hp` is the engine's balance-tuned pool (imported so the
 * lazily-minted `WorldBossWindow` and the client's local render agree on the same total).
 *
 * `maxDamagePerPost` is the CLIENT-TRUST v1 plausibility cap: damage numbers are not yet
 * server-re-derived (that is the M5 anti-cheat wave), so this only rejects an absurd /
 * overflow forged number. It is deliberately GENEROUS — ~a few minutes of a very strong
 * hero's theoretical DPS, and still a small fraction of the full pool — so an honest
 * batched report is never rejected while a single forged post can't wipe the pool. A real
 * per-hit re-derivation replaces this when M5 lands.
 */
export const WORLD_BOSS_DAMAGE = {
  hp: WORLD_BOSS.hp,
  maxDamagePerPost: 250_000,
} as const;

// ── Damage report (shared pool) ──────────────────────────────────────────────

export const worldBossDamageSchema = z
  .object({
    windowId: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    damage: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export type WorldBossDamageInput = z.infer<typeof worldBossDamageSchema>;

export type WorldBossDamageResult =
  | { ok: true; hp: number; defeated: boolean }
  | { ok: false; reason: "stale_window" | "implausible" };

/**
 * Report a batch of `damage` a character dealt to the shared world-boss pool for
 * `windowId`. The SERVER validates: (1) `windowId` is the CURRENT hour against its OWN
 * wall-clock (a forwarded/forged window → `stale_window` / 410); (2) `damage` is within
 * the client-trust plausibility cap (→ `implausible`). Then, race-safe:
 *   - LAZILY mint the `WorldBossWindow` pool at full hp (a concurrent first-report
 *     collides on the @id → P2002, swallowed — exactly one pool per window);
 *   - ATOMICALLY decrement `hpRemaining` floored at 0 (`GREATEST(hp - dmg, 0)` raw UPDATE,
 *     so concurrent chips never go negative / never lose a decrement);
 *   - stamp `defeatedAt` EXACTLY ONCE the first time the pool reads 0;
 *   - UPSERT the caller's `WorldBossDamage` participation row (+= capped damage).
 * Returns the post-decrement `hp` and `defeated` (pool at 0) for the client's
 * `syncWorldBoss` engine intent.
 */
export async function reportWorldBossDamage(
  characterId: string,
  windowId: number,
  damage: number,
  opts: { now?: Date } = {},
): Promise<WorldBossDamageResult> {
  const now = opts.now ?? new Date();

  // Current-hour gate against the SERVER clock (client timestamp never trusted).
  if (windowId !== worldBossWindowId(now.getTime())) return { ok: false, reason: "stale_window" };

  // Client-trust v1 plausibility cap (see WORLD_BOSS_DAMAGE).
  if (!Number.isInteger(damage) || damage < 1 || damage > WORLD_BOSS_DAMAGE.maxDamagePerPost) {
    return { ok: false, reason: "implausible" };
  }

  // Lazily mint the shared pool (race-safe: a concurrent first-report collides on @id).
  try {
    await prisma.worldBossWindow.create({
      data: { windowId, hpRemaining: WORLD_BOSS_DAMAGE.hp },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err; // P2002 = another report minted it first
  }

  // Atomic floored decrement (Prisma can't express GREATEST — raw UPDATE). Guarded so a
  // post against an already-defeated pool is a harmless no-op decrement of a 0 floor.
  await prisma.$executeRaw`
    UPDATE \`WorldBossWindow\`
    SET \`hpRemaining\` = GREATEST(\`hpRemaining\` - ${damage}, 0)
    WHERE \`windowId\` = ${windowId}`;

  const row = await prisma.worldBossWindow.findUnique({
    where: { windowId },
    select: { hpRemaining: true, defeatedAt: true },
  });
  const hp = row?.hpRemaining ?? 0;
  const defeated = hp === 0;

  // Stamp defeatedAt exactly once (the first writer to see 0 wins the guarded UPDATE).
  if (defeated && row && !row.defeatedAt) {
    await prisma.$executeRaw`
      UPDATE \`WorldBossWindow\`
      SET \`defeatedAt\` = ${now}
      WHERE \`windowId\` = ${windowId} AND \`hpRemaining\` = 0 AND \`defeatedAt\` IS NULL`;
  }

  // Participation proof: += this character's (capped) damage for the window.
  await prisma.worldBossDamage.upsert({
    where: { characterId_windowId: { characterId, windowId } },
    create: { characterId, windowId, total: damage },
    update: { total: { increment: damage } },
  });

  return { ok: true, hp, defeated };
}

/**
 * The shared pool's current hp for `windowId` (zone-entry sync). An untouched window (no
 * damage reported yet) has no row → the FULL pool, not defeated. Read-only, no identity.
 */
export async function getWorldBossPoolState(
  windowId: number,
): Promise<{ windowId: number; hp: number; defeated: boolean }> {
  const row = await prisma.worldBossWindow.findUnique({
    where: { windowId },
    select: { hpRemaining: true, defeatedAt: true },
  });
  if (!row) return { windowId, hp: WORLD_BOSS_DAMAGE.hp, defeated: false };
  return { windowId, hp: row.hpRemaining, defeated: row.hpRemaining === 0 };
}

/**
 * Is a claim for `windowId` valid at server instant `nowMs`? A future window (a boss
 * that has not spawned) is always rejected; the CURRENT window is claimable; a PAST
 * window is claimable only while still within `lifetimeMs + grace` of its spawn
 * (`windowId * periodMs`). With `periodMs >> lifetimeMs + grace` that past-window
 * branch is effectively unreachable — the whole current window already covers every
 * legit kill — but it is the exact "kills near the window edge must claim" allowance
 * the contract calls out, kept so a future config where the boss lives ~a full period
 * still lets an at-edge claim through. Pure → unit-tested without a DB.
 */
export function isClaimableWindow(windowId: number, nowMs: number): boolean {
  const current = worldBossWindowId(nowMs);
  if (windowId > current) return false; // boss not spawned yet
  if (windowId === current) return true; // the current hour's boss
  return nowMs <= windowId * WORLD_BOSS.periodMs + WORLD_BOSS.lifetimeMs + CLAIM_GRACE_MS;
}

// ── Boundary schema ──────────────────────────────────────────────────────────

export const worldBossClaimSchema = z
  .object({
    characterId: z.string().min(1).max(64),
    windowId: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export type WorldBossClaimInput = z.infer<typeof worldBossClaimSchema>;

// ── Crypto 50:50 roll (server-authoritative; injectable for tests) ────────────

/** Uniform [0,1) crypto roll — outside the engine determinism rule (CLAUDE.md),
 *  same idiom as the refine roll. */
function cryptoRoll(): number {
  return randomInt(0, 1_000_000) / 1_000_000;
}

/** 50:50 weapon-vs-armor fortifier pick from a [0,1) roll (pure). */
export function pickFortifier(roll: number): string {
  return roll < 0.5 ? FORTIFIER_FOR_SLOT.weapon : FORTIFIER_FOR_SLOT.armor;
}

// ── Claim ────────────────────────────────────────────────────────────────────

export type WorldBossClaimResult =
  | { ok: true; item: ItemInstanceDTO; goldCredit: number; materialsTotal: number }
  | {
      ok: false;
      reason: "not_owned" | "stale_window" | "not_defeated" | "no_participation" | "already_claimed";
    };

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Claim the world-boss reward for `windowId` as the identity `userId`. Validates
 * owner+liveness of `characterId`, then the window against the server clock, then
 * INSERTs the `WorldBossClaim` idempotency row and grants materials + a minted
 * fortifier in the SAME tx (the P2002-on-unique path returns `already_claimed`).
 * Gold is returned as `goldCredit` for the client to apply via its engine gold intent.
 */
export async function claimWorldBoss(
  userId: string,
  characterId: string,
  windowId: number,
  opts: { now?: Date; roll?: () => number } = {},
): Promise<WorldBossClaimResult> {
  const now = opts.now ?? new Date();
  const roll = opts.roll ?? cryptoRoll;

  // Owner + liveness (never trust the body's characterId alone) — a foreign character
  // or a guest with no such character resolves to null here → not_owned.
  const owned = await prisma.character.findFirst({
    where: { id: characterId, userId, deletedAt: null },
    select: { id: true },
  });
  if (!owned) return { ok: false, reason: "not_owned" };

  // Window validity against the SERVER clock (client timestamp never trusted).
  if (!isClaimableWindow(windowId, now.getTime())) return { ok: false, reason: "stale_window" };

  // SERVER-WIDE shared-pool gate (owner-approved): a reward is claimable ONLY once the
  // window's shared HP pool is DEFEATED (authoritative `defeatedAt`), and ONLY by a
  // PARTICIPANT — a character that reported >=1 damage this window (participation proof
  // v1). Both are checked before the idempotency insert so a non-participant or a
  // pre-defeat claim never mints.
  const pool = await prisma.worldBossWindow.findUnique({
    where: { windowId },
    select: { defeatedAt: true },
  });
  if (!pool || !pool.defeatedAt) return { ok: false, reason: "not_defeated" };

  const participation = await prisma.worldBossDamage.findUnique({
    where: { characterId_windowId: { characterId, windowId } },
    select: { total: true },
  });
  if (!participation || participation.total <= 0) return { ok: false, reason: "no_participation" };

  const templateId = pickFortifier(roll());

  try {
    return await prisma.$transaction(async (tx) => {
      // Idempotency gate: one claim per (character, window). A dup collides on the
      // @@unique index → P2002 (caught below → already_claimed).
      await tx.worldBossClaim.create({
        data: { characterId, windowId },
        select: { id: true },
      });

      // +350 enhancement stones on the authoritative column (refine/salvage pattern).
      const updated = await tx.character.update({
        where: { id: characterId },
        data: { materials: { increment: WORLD_BOSS_REWARD.materials } },
        select: { materials: true },
      });

      // Mint the fortifier instance (origin "worldboss" → never touches the drop-rate
      // ceiling) + its `minted` ItemEvent (anti-dupe invariants 1/7/9). No claimKey:
      // the WorldBossClaim row is the idempotency guard, so the mint never double-runs.
      const created = await tx.itemInstance.create({
        data: {
          ownerId: characterId,
          templateId,
          origin: "worldboss",
          sourceDetail: `worldboss:w${windowId}`,
        },
        select: INSTANCE_SELECT,
      });
      await tx.itemEvent.create({
        data: {
          itemId: created.id,
          type: "minted",
          toCharacterId: characterId,
          meta: JSON.stringify({ origin: "worldboss", windowId, templateId }),
        },
      });

      const dto = toItemDTO(created);
      if (!dto) throw new Error("worldboss fortifier template missing"); // defensive (frozen ids)

      return {
        ok: true as const,
        item: dto,
        goldCredit: WORLD_BOSS_REWARD.gold,
        materialsTotal: updated.materials,
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: "already_claimed" };
    throw err;
  }
}
