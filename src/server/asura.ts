/**
 * Endgame "ดินแดนอสูร" — server-authoritative sigil ledger + legendary craft mint
 * (docs/endgame-design.md v1.2/v1.3).
 *
 * TWO server jobs, mirroring the existing item-ledger / daily-claim trust split:
 *
 *  1. DAILY z10 ตราอสูร SIGIL (`claimAsuraSigil`) — the asura z10 boss yields ONE sigil
 *     per Asia/Bangkok (UTC+7) day. The ENGINE holds the sigil COUNT (client-authoritative
 *     v1 — the `claimAsuraSigil` intent adds it); the SERVER's ONLY job is the honesty
 *     anchor: an `AsuraSigilClaim` @@unique(characterId, day) ledger row that makes a
 *     second claim on the same server-day impossible (P2002 → already_claimed). `day` is
 *     the SERVER wall-clock's Bangkok day-epoch (same axis as DailyClaim.serverDay; a
 *     client that winds its clock forward gets no new sigil).
 *
 *  2. LEGENDARY CRAFT (`craftLegendaryWeapon`) — the "ตำราตำนาน" mint. The ENGINE
 *     validates + consumes the counts it owns (แก่นอสูร/ตรา/ศิลา/gold/materials via the
 *     `craftLegendary` intent — client-authoritative v1, anti-cheat re-derive DEFERRED);
 *     the SERVER owns the ITEM half it cannot trust the client for: it CONSUMES an
 *     equipped-or-held t10 weapon of the character's class (soft-delete + `consumed`
 *     ItemEvent) and MINTS the bind-on-craft `LEGENDARY_FOR_CLASS[cls]` instance (origin
 *     "craft", `minted` event) in ONE tx. The unique claimKey `${characterId}:legendary:${cls}`
 *     makes it IDEMPOTENT + one-legendary-per-class-per-character. Legendaries are never
 *     NPC-sellable (excluded in items.ts `sellItems`) and never server-refined (rejected in
 *     `refineItem` — awakening is engine-side stat math). Bind-on-craft; no trade flag (v1).
 *
 * Trust boundary: the caller (route) resolves `characterId` from the identity + active-
 * character cookies (never the body); this module re-reads ownership/liveness in-tx.
 */

import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  LEGENDARY_FOR_CLASS,
  LEGENDARY_MAX_AWAKEN,
  awakenCost,
  clampRefineForTemplate,
  lookupTemplate,
} from "@/engine/config/items";
import type { HeroClass } from "@/engine";
import { prisma } from "@/lib/db";
import { serverDayFor } from "@/server/dailyQuests";
import {
  INSTANCE_SELECT,
  toItemDTO,
  invalidateAnnouncementsCache,
  type ItemInstanceDTO,
} from "@/server/items";

// ── Daily z10 ตราอสูร sigil claim ─────────────────────────────────────────────

export type SigilClaimResult =
  | { ok: true; day: number }
  | { ok: false; reason: "already_claimed" };

/**
 * Bank the DAILY z10 sigil for the active character (server-authoritative calendar). The
 * server recomputes `day` from its OWN wall-clock (Asia/Bangkok, `serverDayFor` — the
 * daily-quest calendar axis) and INSERTs an `AsuraSigilClaim`; a second claim on the same
 * day collides on the @@unique(characterId, day) index → P2002 → `already_claimed`. No
 * reward is granted here: the ENGINE `claimAsuraSigil` intent adds the sigil count once
 * the client sees 200 (the refine/daily pattern — mutate only after the server confirms).
 */
export async function claimAsuraSigil(
  characterId: string,
  now: Date = new Date(),
): Promise<SigilClaimResult> {
  const day = serverDayFor(now);
  try {
    await prisma.asuraSigilClaim.create({ data: { characterId, day }, select: { id: true } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, reason: "already_claimed" };
    }
    throw err;
  }
  return { ok: true, day };
}

// ── Legendary craft (the "ตำราตำนาน" mint) ────────────────────────────────────

/** Craft body: the t10 weapon instance the player sacrifices into the forge. */
export const craftSchema = z.object({ instanceId: z.string().min(1).max(64) }).strict();
export type CraftInput = z.infer<typeof craftSchema>;

/** Idempotency + one-per-class key → the UNIQUE `ItemInstance.claimKey`. Namespaced apart
 *  from gear (`${characterId}:${rollId}`) / stone (`${characterId}:stone:${rollId}`) claims. */
export function legendaryClaimKey(characterId: string, cls: HeroClass): string {
  return `${characterId}:legendary:${cls}`;
}

/** RefineAnnouncement kind for the first-craft-per-class server announce. */
export const LEGENDARY_CRAFT_KIND = "legendaryCraft";

export type CraftResult =
  | { ok: true; status: "minted" | "existing"; item: ItemInstanceDTO }
  | { ok: false; reason: "no_weapon" | "not_t10" | "wrong_class" };

/** Internal control-flow error so a tx callback can abort with a typed reason. */
class CraftOpError extends Error {
  constructor(public readonly reason: "no_weapon" | "not_t10" | "wrong_class") {
    super(reason);
  }
}

/**
 * Fire the SINGLETON-PER-CLASS "first to forge this class's legendary" announcement,
 * reusing the M7.9 `RefineAnnouncement` feed (levelCap pattern). `singletonKey`
 * "legendary:<cls>" is @unique so a concurrent second craft of the same class collides on
 * P2002 → swallowed. Standalone (NOT in the craft tx) + fully best-effort so a feed error
 * never touches the mint. `templateId` carries the crafted legendary (the client derives
 * the class for its copy); `refineLevel` is null.
 */
async function emitLegendaryCraftAnnouncement(
  characterId: string,
  charName: string,
  cls: HeroClass,
  templateId: string,
  now: Date,
): Promise<void> {
  try {
    await prisma.refineAnnouncement.create({
      data: {
        kind: LEGENDARY_CRAFT_KIND,
        characterId,
        charName,
        templateId,
        singletonKey: `legendary:${cls}`, // @unique → first-per-class exactly-once
        createdAt: now,
      },
    });
    invalidateAnnouncementsCache();
  } catch {
    // P2002 (this class already announced) or any feed error → best-effort ignore.
  }
}

/**
 * Mint the bind-on-craft legendary for `characterId`, consuming the supplied t10 class
 * weapon. SERVER-AUTHORITATIVE item half of the tome recipe (the engine consumed the
 * currency counts client-side). Steps:
 *   1. resolve the character's base class + name (the recipe is for YOUR class);
 *   2. FAST-PATH idempotency: if the legendary already exists (claimKey), return it and
 *      consume NOTHING (one per class per character);
 *   3. ONE tx: re-read the material weapon (owned, live) → validate slot=weapon / tier=10 /
 *      classReq=cls (wrong class → 403); MINT the legendary FIRST (its unique claimKey is
 *      the idempotency guard — a racing second craft collides on P2002 and the WHOLE tx
 *      rolls back, so the t10 weapon is never double-consumed); CONSUME the weapon
 *      (guarded soft-delete + unequip in the same tx — invariant 5) + `consumed`/`minted`
 *      ItemEvents;
 *   4. best-effort first-craft-per-class server announce.
 * A P2002 escaping the tx (lost the claimKey race) returns the now-existing legendary
 * (idempotent). Reasons: no_weapon (missing/not owned) 404 · not_t10 (wrong tier/slot) 409
 * · wrong_class (foreign-class weapon) 403.
 */
export async function craftLegendaryWeapon(
  characterId: string,
  instanceId: string,
  now: Date = new Date(),
): Promise<CraftResult> {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { baseClass: true, name: true },
  });
  // Caller resolved ownership; a missing row here is defensive.
  if (!character) return { ok: false, reason: "no_weapon" };
  const cls = character.baseClass as HeroClass;
  const legendaryTemplateId = LEGENDARY_FOR_CLASS[cls];
  if (!legendaryTemplateId) return { ok: false, reason: "wrong_class" }; // unknown class (defensive)
  const claimKey = legendaryClaimKey(characterId, cls);

  // Fast-path idempotency: already forged → return it, consume nothing.
  const already = await prisma.itemInstance.findUnique({
    where: { claimKey },
    select: INSTANCE_SELECT,
  });
  if (already) {
    const dto = toItemDTO(already);
    if (dto) return { ok: true, status: "existing", item: dto };
  }

  try {
    const item = await prisma.$transaction(async (tx) => {
      // Re-read the material weapon in-tx (owned + live).
      const weapon = await tx.itemInstance.findFirst({
        where: { id: instanceId, ownerId: characterId, deletedAt: null },
        select: { id: true, templateId: true },
      });
      if (!weapon) throw new CraftOpError("no_weapon");
      const wt = lookupTemplate(weapon.templateId);
      // Must be a t10 GEAR weapon (not a legendary/fortifier) of the character's class.
      if (!wt || wt.slot !== "weapon" || wt.tier !== 10 || wt.kind === "legendary") {
        throw new CraftOpError("not_t10");
      }
      if (wt.classReq !== cls) throw new CraftOpError("wrong_class");

      // Mint the legendary FIRST — the unique claimKey is the idempotency guard; a
      // concurrent second craft collides on P2002 here and the whole tx rolls back
      // (nothing consumed). origin "craft" keeps it off the drop-rate plausibility ceiling.
      const minted = await tx.itemInstance.create({
        data: {
          ownerId: characterId,
          templateId: legendaryTemplateId,
          origin: "craft",
          sourceDetail: `craft:${instanceId}`,
          claimKey,
        },
        select: INSTANCE_SELECT,
      });

      // Consume the t10 weapon (soft-delete + unequip in the SAME tx — invariant 5). The
      // guarded updateMany (deletedAt:null) is the no-double-consume lock.
      const consumed = await tx.itemInstance.updateMany({
        where: { id: weapon.id, ownerId: characterId, deletedAt: null },
        data: { deletedAt: now, equippedSlot: null },
      });
      if (consumed.count === 0) throw new CraftOpError("no_weapon");
      await tx.itemEvent.create({
        data: {
          itemId: weapon.id,
          type: "consumed",
          fromCharacterId: characterId,
          meta: JSON.stringify({
            consumedBy: "legendaryCraft",
            legendaryId: minted.id,
            templateId: weapon.templateId,
          }),
        },
      });
      await tx.itemEvent.create({
        data: {
          itemId: minted.id,
          type: "minted",
          toCharacterId: characterId,
          meta: JSON.stringify({ origin: "craft", cls, from: weapon.templateId }),
        },
      });

      const dto = toItemDTO(minted);
      if (!dto) throw new CraftOpError("no_weapon"); // retired template — defensive (frozen ids)
      return dto;
    });

    await emitLegendaryCraftAnnouncement(characterId, character.name, cls, legendaryTemplateId, now);
    return { ok: true, status: "minted", item };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Lost the claimKey race — the tx rolled back (nothing consumed). Return the
      // now-existing legendary (idempotent, one per class per character).
      const existing = await prisma.itemInstance.findUnique({
        where: { claimKey },
        select: INSTANCE_SELECT,
      });
      const dto = existing ? toItemDTO(existing) : null;
      if (dto) return { ok: true, status: "existing", item: dto };
    }
    if (err instanceof CraftOpError) return { ok: false, reason: err.reason };
    throw err;
  }
}

// ── Legendary awakening ("ปลุกพลัง" — the +0..+5 progression path) ─────────────
//
// A crafted legendary sits at +0 FOREVER without this: the server refine endpoint rejects
// kind "legendary" (awakening is NOT a rolling +10/break path). Awakening is the legendary's
// OWN progression — a GUARANTEED +1 (owner design: 100% success, NEVER breaks) that rides the
// same `refineLevel` field ordinary refine uses, capped at `LEGENDARY_MAX_AWAKEN` (+5) by
// `clampRefineForTemplate`. It is a pure SINK: escalating gold + เศษศิลา stones (`awakenCost`).
//
// Trust split mirrors `refineItem` (there is no roll to protect, so it is strictly simpler):
//   • STONES are server-authoritative — debited atomically from `Character.materials` (the same
//     column the refine/salvage/stone-claim endpoints own; the save blob never writes it back).
//   • GOLD is client-authoritative (save blob, MVP gap) — the route passes the PERSISTED balance
//     for a BALANCE CHECK only; it is returned as `goldDelta` for the client's gold intent, never
//     debited server-side (identical to `refineItem`).
// The +1 is applied via a compare-and-set on the CURRENT level (a concurrent/retried request that
// already moved the level matches 0 rows → tx aborts, stones restored → no double-charge). An
// `awakened` ItemEvent is the ledger record.

/** Awaken body: the legendary instance to power up (+1). */
export const awakenSchema = z.object({ instanceId: z.string().min(1).max(64) }).strict();
export type AwakenInput = z.infer<typeof awakenSchema>;

export type AwakenResult =
  | {
      ok: true;
      /** New awaken +level after this guaranteed step (1..LEGENDARY_MAX_AWAKEN). */
      refineLevel: number;
      /** New authoritative `Character.materials` (stone) balance after debiting. */
      materials: number;
      /** Deltas for the client to apply via engine intents (materialsDelta + gold). */
      materialsDelta: number;
      goldDelta: number;
      cost: { gold: number; stones: number };
    }
  | {
      ok: false;
      reason: "not_found" | "not_legendary" | "max" | "insufficient_gold" | "insufficient_materials";
    };

/** Internal control-flow error so a tx callback can abort with a typed reason. */
class AwakenOpError extends Error {
  constructor(
    public readonly reason: "not_found" | "not_legendary" | "max" | "insufficient_gold" | "insufficient_materials",
  ) {
    super(reason);
  }
}

/**
 * Awaken (+1) one owned legendary weapon for `characterId` — GUARANTEED, no roll, no break. One
 * `prisma.$transaction`:
 *   1. re-read the instance in-tx (owned + live); missing → not_found (404);
 *   2. it MUST be a "ตำราตำนาน" legendary (kind "legendary"); anything else → not_legendary (409)
 *      — ordinary gear goes through the refine endpoint, not here;
 *   3. reject if already at `LEGENDARY_MAX_AWAKEN` (+5) → max (409);
 *   4. cost = `awakenCost(current+1)`; gold-balance check against the passed `goldBalance` (save
 *      blob; returned as a delta, never debited) → insufficient_gold (409);
 *   5. atomic stone (materials) check-and-set on `Character.materials` (`>= cost.stones`); count 0
 *      → insufficient_materials (409, nothing charged);
 *   6. compare-and-set +1 on the item (`refineLevel: <the value read>` guard — a concurrent/retried
 *      awaken that already moved the level matches 0 rows → abort, stones restored) → not_found;
 *   7. append an `awakened` ItemEvent (meta {from,to,cost}).
 * Returns the new +level, the authoritative stone balance, and the materials/gold DELTAS the client
 * feeds into its `materialsDelta` + gold intents (the `refineItem` response shape).
 */
export async function awakenLegendary(
  characterId: string,
  instanceId: string,
  goldBalance: number,
): Promise<AwakenResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const item = await tx.itemInstance.findFirst({
        where: { id: instanceId, ownerId: characterId, deletedAt: null },
        select: { id: true, templateId: true, refineLevel: true },
      });
      if (!item) throw new AwakenOpError("not_found");

      const tpl = lookupTemplate(item.templateId);
      if (!tpl || tpl.kind !== "legendary") throw new AwakenOpError("not_legendary");

      // The raw persisted level is the compare-and-set guard; the CLAMPED level drives the target
      // (defensive against an out-of-range column) — both agree in practice for a legendary [0,5].
      const rawLevel = item.refineLevel ?? 0;
      const current = clampRefineForTemplate(item.templateId, rawLevel);
      if (current >= LEGENDARY_MAX_AWAKEN) throw new AwakenOpError("max");
      const target = current + 1;
      const cost = awakenCost(target);
      if (!cost) throw new AwakenOpError("max"); // defensive (out of the +1..+5 table)

      // Gold is client-authoritative (save blob) — balance check only, returned as a delta.
      if (goldBalance < cost.gold) throw new AwakenOpError("insufficient_gold");

      // Atomic stone (materials) check-and-set on the authoritative Character column (locks the
      // row → serialises this character's concurrent awakens). Count 0 = not enough → abort.
      const debit = await tx.character.updateMany({
        where: { id: characterId, materials: { gte: cost.stones } },
        data: { materials: { decrement: cost.stones } },
      });
      if (debit.count === 0) throw new AwakenOpError("insufficient_materials");

      // Guaranteed +1 — compare-and-set on the level READ above (retry/concurrent awaken that
      // already advanced the level matches 0 rows → abort, stones restored → no double-apply).
      const applied = await tx.itemInstance.updateMany({
        where: { id: instanceId, ownerId: characterId, deletedAt: null, refineLevel: rawLevel },
        data: { refineLevel: target },
      });
      if (applied.count === 0) throw new AwakenOpError("not_found");

      await tx.itemEvent.create({
        data: {
          itemId: instanceId,
          type: "awakened",
          fromCharacterId: characterId,
          meta: JSON.stringify({ from: current, to: target, cost }),
        },
      });

      const after = await tx.character.findUnique({
        where: { id: characterId },
        select: { materials: true },
      });

      return {
        ok: true as const,
        refineLevel: target,
        materials: after?.materials ?? 0,
        materialsDelta: -cost.stones,
        goldDelta: -cost.gold,
        cost,
      };
    });
  } catch (err) {
    if (err instanceof AwakenOpError) return { ok: false, reason: err.reason };
    throw err;
  }
}
