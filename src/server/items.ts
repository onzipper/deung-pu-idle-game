/**
 * M7 Gear & Drops — server-authoritative item ledger (claim / equip / inventory).
 *
 * Trust boundary: the client is hostile. Ownership is resolved from the identity
 * cookie + active-character cookie (never a client-supplied characterId), every
 * mutation writes the ItemInstance change + its ItemEvent in ONE prisma.$transaction
 * (docs/persistence-m7.md — the 9 anti-dupe invariants are law here), and the
 * item-instance table is AUTHORITATIVE (not a re-derivable save cache).
 *
 * Anti-dupe invariants covered (numbers → docs/persistence-m7.md):
 *   1 mint = one tx (instance + minted event)  · 2 opaque cuid id (DB @default)
 *   3 soft-delete only (destroyItem)            · 4 claimKey UNIQUE = idempotent mint
 *   5 destroy NULLs equippedSlot in same tx     · 6 ≤1 per slot (DB unique, guarded here)
 *   7 events append-only (inserts only)         · 9 every state change writes an event
 * (8 = M9 trade transfer, not shipped here.)
 *
 * Item STATS/templates live in pure-TS engine config (`@/engine/config/items`),
 * never in the DB — balance tweaks must not migrate rows (rule 4 / persistence spec).
 */

import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  ITEM_TEMPLATES,
  dropTableForStage,
  bossDropTableForStage,
  maxSummedDropChance,
  vendorPriceForTemplate,
  INVENTORY_CAP,
  type GearSlot,
} from "@/engine/config/items";
import {
  REFINE,
  refineCost,
  salvageYield,
  successChanceForLevel,
  failModeForLevel,
  clampRefine,
} from "@/engine/config/refine";
import type { HeroClass } from "@/engine";
import { prisma } from "@/lib/db";
import { randomInt } from "node:crypto";

// ── Tunables (plausibility cap) ──────────────────────────────────────────────
/** Hard cap on items per POST /api/items/claim batch (DoS / abuse bound). */
export const MAX_CLAIM_BATCH = 64;
/** Hard cap on itemIds per POST /api/items/sell batch (DoS / abuse bound). Sized
 *  to the full inventory so a "sell everything" trip is one request. */
export const MAX_SELL_BATCH = 100;
/** Hard cap on itemIds per POST /api/items/salvage batch (mirrors sell — a full
 *  inventory "salvage all dupes" trip is one request). */
export const MAX_SALVAGE_BATCH = 100;
/**
 * GENEROUS kills/sec ceiling for the rate-plausibility guard — real auto-hunting
 * clears well under ~1 mob/sec; 5 leaves huge headroom for legit bursts/AoE while
 * still bounding a script that spams the endpoint. Multiplied by the max summed
 * per-kill drop chance to get "max plausible drops per second of lifetime".
 */
export const KILLS_PER_SEC_CEILING = 5;
/** Flat grace added to the ceiling: absorbs clock skew + gives fresh characters
 *  a starting allowance so the very first legit drops are never rate-rejected. */
export const CLAIM_GRACE = 50;

// ── Claim: idempotency + plausibility (pure, unit-testable) ──────────────────

/**
 * Deterministic idempotency key for a drop claim → DB `ItemInstance.claimKey`
 * (UNIQUE). A retried/duplicated claim collides on the unique index and CANNOT
 * double-mint (invariant 4). `rollId` is the engine's per-save monotonic loot
 * counter (stateless, hashed engine-side); scoping by characterId keeps keys
 * unique across characters that happen to share a counter value.
 */
export function deriveClaimKey(characterId: string, rollId: string): string {
  return `${characterId}:${rollId}`;
}

/**
 * Max plausible lifetime drop-claims for a character given seconds of existence
 * (server wall-clock, mirrors the lastSeen anti-cheat pattern). Pure so the math
 * is unit-tested without a DB.
 */
export function plausibleDropCeiling(elapsedSeconds: number): number {
  const perSecond = KILLS_PER_SEC_CEILING * maxSummedDropChance();
  const safeElapsed = Math.max(0, elapsedSeconds);
  return Math.floor(safeElapsed * perSecond) + CLAIM_GRACE;
}

export type ClaimClassification =
  | { ok: true; origin: "drop" | "boss"; membershipKnown: boolean }
  | { ok: false; reason: "unknown_template" | "not_in_table" };

/**
 * Validate a claimed (templateId, stage) against the engine drop tables. The
 * tables are placeholder-empty until the engine drop task lands (contract note in
 * `@/engine/config/items`), so when BOTH tables for a stage are empty we accept
 * with `membershipKnown:false` (flagged TODO by the caller) rather than reject
 * every legit early-M7 claim. Once a stage has a real table, non-members reject.
 */
export function classifyClaim(templateId: string, stage: number): ClaimClassification {
  if (!(templateId in ITEM_TEMPLATES)) return { ok: false, reason: "unknown_template" };

  const farm = dropTableForStage(stage);
  const boss = bossDropTableForStage(stage);
  const inBoss = boss.some((e) => e.templateId === templateId);
  const inFarm = farm.some((e) => e.templateId === templateId);

  if (farm.length === 0 && boss.length === 0) {
    // Engine tables not fleshed out yet → cannot verify membership. Accept,
    // origin defaults to "drop"; caller logs a TODO so this is auditable.
    return { ok: true, origin: "drop", membershipKnown: false };
  }
  if (!inBoss && !inFarm) return { ok: false, reason: "not_in_table" };
  // Farm membership wins the origin label: every farm-table item also sits in
  // its own band's boss pool (boss = on-curve + next tier), so checking boss
  // first would stamp every ordinary farm drop as origin "boss". Boss-origin
  // is therefore only the boss-pool EXCLUSIVES (the next-tier seed items).
  return { ok: true, origin: inFarm ? "drop" : "boss", membershipKnown: true };
}

// ── Zod boundary schemas ─────────────────────────────────────────────────────

/** A single drop-claim entry. `rollId` is coerced to a bounded string key. */
const claimEntrySchema = z
  .object({
    rollId: z
      .union([z.string().min(1).max(64), z.number().int().nonnegative()])
      .transform((v) => String(v)),
    templateId: z.string().min(1).max(64),
    stage: z.number().int().min(1).max(10_000),
  })
  .strict();

export const claimBatchSchema = z
  .object({
    items: z.array(claimEntrySchema).min(1).max(MAX_CLAIM_BATCH),
  })
  .strict();

export type ClaimEntry = z.infer<typeof claimEntrySchema>;

export const equipSchema = z.object({ itemId: z.string().min(1).max(64) }).strict();
export const unequipSchema = equipSchema;

/** NPC-sell batch. Ids are deduped downstream in `sellItems` (one result/tx per
 *  unique id); a duplicated id can never sell/credit the same instance twice. */
export const sellSchema = z
  .object({
    itemIds: z.array(z.string().min(1).max(64)).min(1).max(MAX_SELL_BATCH),
  })
  .strict();

/** Salvage batch (M7.6). Ids are deduped in `salvageItems` (one soft-destroy +
 *  material credit per unique id); a duplicated id can never mint materials twice. */
export const salvageSchema = z
  .object({
    itemIds: z.array(z.string().min(1).max(64)).min(1).max(MAX_SALVAGE_BATCH),
  })
  .strict();

/** Refine one owned item (M7.6). Single itemId — the server rolls the outcome. */
export const refineSchema = z.object({ itemId: z.string().min(1).max(64) }).strict();

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface ItemInstanceDTO {
  id: string;
  templateId: string;
  /** The template's gear slot (weapon/armor). */
  slot: GearSlot;
  /** Which slot it is CURRENTLY equipped in, or null (unequipped). */
  equippedSlot: GearSlot | null;
  origin: string;
  acquiredAt: string;
  /** M7.6 RO-style refine +level (+0..+REFINE.maxRefine). */
  refineLevel: number;
}

interface InstanceRow {
  id: string;
  templateId: string;
  equippedSlot: string | null;
  origin: string;
  acquiredAt: Date;
  refineLevel: number;
}

function toItemDTO(row: InstanceRow): ItemInstanceDTO | null {
  const template = ITEM_TEMPLATES[row.templateId];
  // A row referencing a retired/unknown template is skipped from the DTO stream
  // rather than crashing the read (defensive — ids are frozen, so shouldn't happen).
  if (!template) return null;
  return {
    id: row.id,
    templateId: row.templateId,
    slot: template.slot,
    equippedSlot: (row.equippedSlot as GearSlot | null) ?? null,
    origin: row.origin,
    acquiredAt: row.acquiredAt.toISOString(),
    refineLevel: clampRefine(row.refineLevel),
  };
}

const INSTANCE_SELECT = {
  id: true,
  templateId: true,
  equippedSlot: true,
  origin: true,
  acquiredAt: true,
  refineLevel: true,
} as const;

// ── Inventory read (invariant-6 unique doubles as the ownerId read index) ─────

/**
 * The active character's non-deleted items. Single indexed query on
 * `[ownerId, equippedSlot]` (ownerId prefix). Equipped rows are those with a
 * non-null `equippedSlot`.
 */
export async function loadInventory(characterId: string): Promise<ItemInstanceDTO[]> {
  const rows = await prisma.itemInstance.findMany({
    where: { ownerId: characterId, deletedAt: null },
    select: INSTANCE_SELECT,
    orderBy: { acquiredAt: "asc" },
  });
  return rows.map(toItemDTO).filter((d): d is ItemInstanceDTO => d !== null);
}

/** The equipped loadout (weapon/armor → templateId) for the boot payload. Carries
 *  the per-slot refine +level (M7.6) so the engine hero rebuilds refined stats. */
export interface EquippedLoadout {
  weapon: string | null;
  armor: string | null;
  /** Per-slot refine +level (mirrors `EquippedGear.refine`; missing slot → +0). */
  refine: { weapon: number; armor: number };
}

export function equippedLoadoutFrom(inventory: ItemInstanceDTO[]): EquippedLoadout {
  const loadout: EquippedLoadout = { weapon: null, armor: null, refine: { weapon: 0, armor: 0 } };
  for (const item of inventory) {
    if (item.equippedSlot === "weapon") {
      loadout.weapon = item.templateId;
      loadout.refine.weapon = item.refineLevel;
    } else if (item.equippedSlot === "armor") {
      loadout.armor = item.templateId;
      loadout.refine.armor = item.refineLevel;
    }
  }
  return loadout;
}

/** The active character's authoritative refine-material balance (boot payload). */
export async function loadMaterials(characterId: string): Promise<number> {
  const row = await prisma.character.findUnique({
    where: { id: characterId },
    select: { materials: true },
  });
  return row?.materials ?? 0;
}

// ── Server-wide high-refine announcement feed (M7.9) ─────────────────────────
//
// NO websockets this phase (owner-approved design) — every online client polls
// this via the existing autosave cycle (`POST /api/save`, plus the boot `GET`).
// A row is written ONLY on a refine SUCCESS that lands the item at
// `ANNOUNCE_MIN_REFINE_LEVEL` (+8) or higher, in the SAME tx as the refine
// mutation (see `refineItem` below) — see the schema doc for why the table is
// deliberately NOT a Character relation (transient feed, not an audit ledger).

/** Refine +level floor that triggers a server-wide announcement row. */
export const ANNOUNCE_MIN_REFINE_LEVEL = 8;
/** Opportunistic prune horizon (piggybacked on the write path — no cron). */
const ANNOUNCEMENT_PRUNE_MS = 60 * 60 * 1000; // 1h
/** Feed window: only "recent" landings are worth announcing to a freshly-
 *  polling client. */
const ANNOUNCEMENT_FEED_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
/** Feed size cap (LIMIT). */
const ANNOUNCEMENT_FEED_LIMIT = 10;
/** Cheap in-process cache TTL: every online player's autosave lands within a
 *  few seconds of each other, so a short shared cache noticeably cuts read
 *  load on the shared host without staling the "within one autosave cycle"
 *  requirement (30s cadence). Single-process cache — fine for this MVP scale
 *  (no cross-instance invalidation needed). */
const ANNOUNCEMENT_CACHE_MS = 10_000;

export interface RefineAnnouncementDTO {
  id: string;
  /** Feed kind — the client picks copy/accent by this ("refine" | "levelCap" | "rankOne"). */
  kind: string;
  characterId: string;
  charName: string;
  /** refine kind only (localized client-side); null for levelCap/rankOne. */
  templateId: string | null;
  /** refine kind: +level landed; levelCap kind: the cap level reached; null for rankOne. */
  refineLevel: number | null;
  /** ISO timestamp. */
  at: string;
}

let announcementsCache: { at: number; data: RefineAnnouncementDTO[] } | null = null;

/**
 * Drop the short in-process feed cache so the very next poll sees a just-written
 * announcement immediately (instead of waiting out the TTL). Called by the refine
 * path in-file, and by `src/server/leaderboard.ts` when it writes a levelCap /
 * rankOne row (it can't touch this module-private cache directly).
 */
export function invalidateAnnouncementsCache(): void {
  announcementsCache = null;
}

/**
 * The last `ANNOUNCEMENT_FEED_WINDOW_MS` worth of high-refine landings,
 * newest first, capped at `ANNOUNCEMENT_FEED_LIMIT` — a single indexed SELECT
 * on `createdAt`. The caller (the save route) ships this verbatim to every
 * polling client; the client is responsible for excluding its OWN
 * characterId (the refiner already gets the local refine-juice celebration)
 * and for session-deduping ids it has already displayed (see
 * `ui/announcements/queue.ts`).
 */
export async function recentAnnouncements(now: Date = new Date()): Promise<RefineAnnouncementDTO[]> {
  if (announcementsCache && now.getTime() - announcementsCache.at < ANNOUNCEMENT_CACHE_MS) {
    return announcementsCache.data;
  }
  const since = new Date(now.getTime() - ANNOUNCEMENT_FEED_WINDOW_MS);
  const rows = await prisma.refineAnnouncement.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: ANNOUNCEMENT_FEED_LIMIT,
  });
  const data: RefineAnnouncementDTO[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    characterId: r.characterId,
    charName: r.charName,
    templateId: r.templateId,
    refineLevel: r.refineLevel,
    at: r.createdAt.toISOString(),
  }));
  announcementsCache = { at: now.getTime(), data };
  return data;
}

// ── Claim (mint) ─────────────────────────────────────────────────────────────

function isUniqueViolation(err: unknown, target?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  if (!target) return true;
  const meta = err.meta as { target?: string[] | string } | undefined;
  const t = meta?.target;
  return Array.isArray(t) ? t.includes(target) : t === target;
}

export type ClaimItemResult =
  | { status: "minted" | "existing"; item: ItemInstanceDTO }
  | {
      status: "rejected";
      reason: "unknown_template" | "not_in_table" | "rate" | "inventory_full";
      rollId: string;
    };

/**
 * Mint one item in a single tx (instance + `minted` event) — invariants 1, 7, 9.
 * A `claimKey` collision means the claim already landed (retry/duplicate): fetch
 * and return the existing instance, NEVER double-mint (invariant 4).
 */
async function mintOne(
  characterId: string,
  entry: ClaimEntry,
  origin: "drop" | "boss",
  claimKey: string,
): Promise<{ status: "minted" | "existing"; row: InstanceRow }> {
  const sourceDetail = origin === "boss" ? `s${entry.stage}:boss` : `s${entry.stage}`;
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.itemInstance.create({
        data: {
          ownerId: characterId,
          templateId: entry.templateId,
          origin,
          sourceDetail,
          claimKey,
        },
        select: INSTANCE_SELECT,
      });
      await tx.itemEvent.create({
        data: {
          itemId: created.id,
          type: "minted",
          toCharacterId: characterId,
          meta: JSON.stringify({ stage: entry.stage, rollId: entry.rollId, origin }),
        },
      });
      return created;
    });
    return { status: "minted", row };
  } catch (err) {
    if (isUniqueViolation(err, "claimKey")) {
      const existing = await prisma.itemInstance.findUnique({
        where: { claimKey },
        select: INSTANCE_SELECT,
      });
      if (existing) return { status: "existing", row: existing };
    }
    throw err;
  }
}

/**
 * Batch drop-claim for the active character. Runs one tx per item, is idempotent
 * per claimKey, and enforces the lifetime rate-plausibility ceiling: a NEW mint
 * consumes budget; an idempotent existing-claim return does NOT (already counted).
 * Excess beyond the ceiling is REJECTED, never minted.
 */
export async function claimBatch(
  characterId: string,
  entries: ClaimEntry[],
  now: number = Date.now(),
): Promise<{ results: ClaimItemResult[]; unverifiedMembership: number }> {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { createdAt: true },
  });
  // Ownership is verified by the caller; a missing row here is defensive.
  const createdAtMs = character?.createdAt.getTime() ?? now;
  const elapsedSeconds = Math.max(0, now - createdAtMs) / 1000;
  const ceiling = plausibleDropCeiling(elapsedSeconds);

  // Existing drop/boss mints already count against the lifetime ceiling.
  const existingMinted = await prisma.itemInstance.count({
    where: { ownerId: characterId, origin: { in: ["drop", "boss"] } },
  });
  let remaining = Math.max(0, ceiling - existingMinted);

  // M7.5 inventory-cap backstop: the engine/client triggers a sell-trip at the
  // cap, but a hostile client could keep claiming — the server refuses to mint
  // past INVENTORY_CAP non-deleted instances. An idempotent retry of an
  // ALREADY-minted claim still returns "existing" (the cap must not break
  // idempotency — it mints nothing, so it never grows the inventory).
  const inventoryCount = await prisma.itemInstance.count({
    where: { ownerId: characterId, deletedAt: null },
  });
  let mintedThisBatch = 0;

  const results: ClaimItemResult[] = [];
  let unverifiedMembership = 0;

  for (const entry of entries) {
    const claimKey = deriveClaimKey(characterId, entry.rollId);
    const cls = classifyClaim(entry.templateId, entry.stage);
    if (!cls.ok) {
      results.push({ status: "rejected", reason: cls.reason, rollId: entry.rollId });
      continue;
    }
    if (!cls.membershipKnown) unverifiedMembership++;

    const atCap = inventoryCount + mintedThisBatch >= INVENTORY_CAP;
    const atRate = remaining <= 0;
    if (atCap || atRate) {
      // Gate hit — still honour an idempotent retry of an already-minted claim
      // (it adds no item, so neither cap nor rate is violated), otherwise reject.
      const existing = await prisma.itemInstance.findUnique({
        where: { claimKey },
        select: INSTANCE_SELECT,
      });
      if (existing) {
        const dto = toItemDTO(existing);
        if (dto) results.push({ status: "existing", item: dto });
        continue;
      }
      // Cap takes precedence over rate: it is the actionable normal-play limit.
      results.push({
        status: "rejected",
        reason: atCap ? "inventory_full" : "rate",
        rollId: entry.rollId,
      });
      continue;
    }

    const minted = await mintOne(characterId, entry, cls.origin, claimKey);
    if (minted.status === "minted") {
      remaining--;
      mintedThisBatch++;
    }
    const dto = toItemDTO(minted.row);
    if (dto) results.push({ status: minted.status, item: dto });
  }

  return { results, unverifiedMembership };
}

// ── Equip / Unequip / Destroy ────────────────────────────────────────────────

export type EquipResult =
  | { ok: true; item: ItemInstanceDTO }
  | { ok: false; reason: "not_found" | "unknown_template" | "class_req" };

/**
 * Equip an owned, non-deleted item. The template's slot decides the target slot.
 * Invariant 6 (≤1 per slot per character): the incumbent occupying that slot is
 * unequipped (NULL + `unequipped` event) FIRST in the SAME tx, then the target is
 * equipped (+ `equipped` event). classReq is checked against the character's base
 * class. A deleted row is never equippable.
 */
export async function equipItem(
  characterId: string,
  itemId: string,
  baseClass: HeroClass,
): Promise<EquipResult> {
  try {
    const dto = await prisma.$transaction(async (tx) => {
      const item = await tx.itemInstance.findFirst({
        where: { id: itemId, ownerId: characterId, deletedAt: null },
        select: { ...INSTANCE_SELECT, equippedSlot: true },
      });
      if (!item) throw new ItemOpError("not_found");

      const template = ITEM_TEMPLATES[item.templateId];
      if (!template) throw new ItemOpError("unknown_template");
      if (template.classReq && template.classReq !== baseClass) {
        throw new ItemOpError("class_req");
      }

      const slot = template.slot;

      // Already equipped in this slot → idempotent no-op.
      if (item.equippedSlot === slot) {
        return toItemDTO(item);
      }

      // Unequip the incumbent (invariant 6) in the same tx BEFORE equipping.
      const incumbent = await tx.itemInstance.findFirst({
        where: { ownerId: characterId, equippedSlot: slot, deletedAt: null },
        select: { id: true },
      });
      if (incumbent && incumbent.id !== itemId) {
        await tx.itemInstance.update({
          where: { id: incumbent.id },
          data: { equippedSlot: null },
        });
        await tx.itemEvent.create({
          data: {
            itemId: incumbent.id,
            type: "unequipped",
            fromCharacterId: characterId,
            meta: JSON.stringify({ slot, reason: "displaced" }),
          },
        });
      }

      const updated = await tx.itemInstance.update({
        where: { id: itemId },
        data: { equippedSlot: slot },
        select: INSTANCE_SELECT,
      });
      await tx.itemEvent.create({
        data: {
          itemId,
          type: "equipped",
          fromCharacterId: characterId,
          meta: JSON.stringify({ slot }),
        },
      });
      return toItemDTO(updated);
    });
    if (!dto) return { ok: false, reason: "unknown_template" };
    return { ok: true, item: dto };
  } catch (err) {
    if (err instanceof ItemOpError) return { ok: false, reason: err.reason };
    throw err;
  }
}

export type UnequipResult =
  | { ok: true; item: ItemInstanceDTO }
  | { ok: false; reason: "not_found" };

/** Unequip an owned item (set slot NULL + `unequipped` event). Idempotent if the
 *  item is already unequipped. */
export async function unequipItem(characterId: string, itemId: string): Promise<UnequipResult> {
  try {
    const dto = await prisma.$transaction(async (tx) => {
      const item = await tx.itemInstance.findFirst({
        where: { id: itemId, ownerId: characterId, deletedAt: null },
        select: { ...INSTANCE_SELECT, equippedSlot: true },
      });
      if (!item) throw new ItemOpError("not_found");
      if (item.equippedSlot === null) return toItemDTO(item); // already unequipped

      const updated = await tx.itemInstance.update({
        where: { id: itemId },
        data: { equippedSlot: null },
        select: INSTANCE_SELECT,
      });
      await tx.itemEvent.create({
        data: {
          itemId,
          type: "unequipped",
          fromCharacterId: characterId,
          meta: JSON.stringify({ slot: item.equippedSlot }),
        },
      });
      return toItemDTO(updated);
    });
    if (!dto) return { ok: false, reason: "not_found" };
    return { ok: true, item: dto };
  } catch (err) {
    if (err instanceof ItemOpError && err.reason === "not_found") return { ok: false, reason: "not_found" };
    throw err;
  }
}

/**
 * Soft-destroy an owned item (invariants 3 + 5): set `deletedAt` AND `equippedSlot`
 * NULL in the SAME tx (a dead row must never occupy a live slot in the unique
 * index) + `destroyed` event. No destroy ENDPOINT ships in M7, but the helper
 * exists so any future consume/destroy path is correct-by-construction. Never
 * hard-deletes — the audit trail survives.
 */
export async function destroyItem(
  characterId: string,
  itemId: string,
  now: Date = new Date(),
): Promise<{ ok: boolean }> {
  const res = await prisma.$transaction(async (tx) => {
    const item = await tx.itemInstance.findFirst({
      where: { id: itemId, ownerId: characterId, deletedAt: null },
      select: { id: true },
    });
    if (!item) return false;
    await tx.itemInstance.update({
      where: { id: itemId },
      data: { deletedAt: now, equippedSlot: null },
    });
    await tx.itemEvent.create({
      data: { itemId, type: "destroyed", fromCharacterId: characterId },
    });
    return true;
  });
  return { ok: res };
}

// ── Sell (NPC vendor) ────────────────────────────────────────────────────────

export type SellItemResult =
  | { itemId: string; status: "sold"; price: number }
  | { itemId: string; status: "already"; price: 0 }
  | { itemId: string; status: "rejected"; reason: "equipped" | "not_found" };

/**
 * Sell owned items to the NPC vendor. Each item is ONE $transaction: verify
 * ownership + non-deleted + UNEQUIPPED, then soft-delete (destroy) it and append a
 * `destroyed` ItemEvent recording the sell-time price. Returns a per-item status +
 * `totalGold` (sum of "sold" prices only).
 *
 * TRUST BOUNDARY / gold: the player's gold balance lives in the ENGINE save blob,
 * not a DB column — the client applies `totalGold` via an engine intent and persists
 * it on the next save. This ItemEvent(destroyed, meta.price) row is the AUTHORITATIVE
 * audit for a future server-side gold re-derivation (M-later anti-cheat): re-derivation
 * reads the recorded historical price from the ledger, it NEVER recomputes the price
 * from today's `vendorPriceForTemplate` (magnitudes drift with balance).
 *
 * KNOWN GAP (v1): "town-only" selling is enforced engine/client-side; the server does
 * not yet check the character's map/position, it only records the sale. Tighten when
 * server-authoritative position lands.
 *
 * NO DOUBLE CREDIT: the soft-delete is a conditional `updateMany` guarded by
 * `deletedAt: null` (+ `equippedSlot: null`) — an atomic check-and-set, NOT a
 * read-then-write. Two concurrent sell calls for the same id race on that write:
 * exactly one matches (count 1 → "sold", credited once); the loser matches nothing
 * (count 0 → "already", price 0), so a retried/duplicated call can never add gold
 * twice. Equipped items REJECT with reason "equipped" — sell NEVER auto-unequips
 * (owner-locked M7.5 design).
 */
export async function sellItems(
  characterId: string,
  itemIds: string[],
  now: Date = new Date(),
): Promise<{ results: SellItemResult[]; totalGold: number }> {
  const uniqueIds = [...new Set(itemIds)];
  if (uniqueIds.length === 0) return { results: [], totalGold: 0 };

  // ONE interactive transaction for the whole (≤MAX_SELL_BATCH) request —
  // 2026-07-06 optimization after a pre-cap 1,890-item sell-off hammered the
  // shared MySQL host with a tx per item (3 statements + a commit each). Now:
  // 1 batched read + ≤N single-row conditional writes + 1 createMany, one
  // commit. The per-item `updateMany` conditional check-and-set is KEPT — it
  // is the no-double-credit lock (invariant: a concurrent duplicate sell of
  // the same instance yields exactly one "sold"); events are appended for
  // exactly the won set in the SAME tx (invariants 1/7/9).
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.itemInstance.findMany({
        where: { id: { in: uniqueIds }, ownerId: characterId },
        select: { id: true, templateId: true, deletedAt: true, equippedSlot: true, refineLevel: true },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));

      const results: SellItemResult[] = [];
      const sold: { itemId: string; price: number; templateId: string; refineLevel: number }[] = [];
      for (const itemId of uniqueIds) {
        const item = byId.get(itemId);
        if (!item) {
          results.push({ itemId, status: "rejected", reason: "not_found" });
          continue;
        }
        if (item.deletedAt !== null) {
          results.push({ itemId, status: "already", price: 0 });
          continue;
        }
        // Equipped → reject; never auto-unequip on sell (owner-locked design).
        if (item.equippedSlot !== null) {
          results.push({ itemId, status: "rejected", reason: "equipped" });
          continue;
        }

        // Price is captured at SELL TIME and recorded in the ledger (below).
        const price = vendorPriceForTemplate(item.templateId);

        // Atomic check-and-set (the deletedAt:null guard is the lock). equippedSlot
        // is already NULL here, and the guard re-asserts it, so invariant 5
        // (deletedAt set ⇒ equippedSlot NULL) holds without a separate write.
        const res = await tx.itemInstance.updateMany({
          where: { id: itemId, ownerId: characterId, deletedAt: null, equippedSlot: null },
          data: { deletedAt: now },
        });
        if (res.count === 0) {
          // Lost the race (concurrently sold/deleted between the read and the
          // write) — do NOT credit. A duplicate sell yields exactly one "sold".
          results.push({ itemId, status: "already", price: 0 });
          continue;
        }
        sold.push({ itemId, price, templateId: item.templateId, refineLevel: item.refineLevel });
        results.push({ itemId, status: "sold", price });
      }

      if (sold.length > 0) {
        await tx.itemEvent.createMany({
          data: sold.map((s) => ({
            itemId: s.itemId,
            type: "destroyed",
            fromCharacterId: characterId,
            meta: JSON.stringify({ sold: true, price: s.price, currency: "gold" }),
          })),
        });
        // NPC buy-back window (owner-approved): record one SoldItem row per sold
        // instance in the SAME tx, with its credited price + a SERVER-STAMPED
        // soldAt, so the merchant can offer it back for BUYBACK_WINDOW_DAYS. Salvage
        // does NOT do this (materials were granted → sold-only). See `buybackItem`.
        await tx.soldItem.createMany({
          data: sold.map((s) => ({
            ownerId: characterId,
            templateId: s.templateId,
            refineLevel: s.refineLevel,
            price: s.price,
            soldAt: now,
          })),
        });
      }

      return { results, totalGold: sold.reduce((acc, s) => acc + s.price, 0) };
    },
    // ≤100 indexed single-row writes on a shared host can outlast the 5s
    // default interactive-tx window — give the batch real headroom.
    { maxWait: 10_000, timeout: 20_000 },
  );
}

// ── Salvage (destroy → refine materials) ─────────────────────────────────────

export type SalvageItemResult =
  | { itemId: string; status: "salvaged"; yield: number }
  | { itemId: string; status: "already"; yield: 0 }
  | { itemId: string; status: "rejected"; reason: "equipped" | "not_found" };

/**
 * Salvage owned items into REFINE MATERIALS (M7.6). Mirrors `sellItems` exactly,
 * only the currency differs: instead of returning gold for the client to apply,
 * salvage MINTS materials into the AUTHORITATIVE `Character.materials` column in
 * the SAME tx as the soft-destroys — so the material counter is server-owned, not
 * client-trusted (anti-cheat foundation for the refine sink).
 *
 * NO DOUBLE-CREDIT (mirrors the sell idempotency pattern — no separate client key
 * needed): each item's soft-delete is a conditional `updateMany` guarded by
 * `deletedAt: null` + `equippedSlot: null` (an atomic check-and-set). Two concurrent
 * salvage calls for the same id race on that write — exactly one matches (count 1 →
 * "salvaged", yield counted), the loser matches nothing (count 0 → "already",
 * yield 0). Only the WON set contributes to the materials increment, so a
 * retried/duplicated request can never mint materials twice. Equipped items REJECT
 * ("equipped") — salvage never auto-unequips (mirrors sell).
 *
 * Yield is captured per item via `salvageYield(tier, rarity)` (engine config) and
 * recorded in each `salvaged` ItemEvent (meta) as the AUTHORITATIVE audit for a
 * future server-side re-derivation (never recomputed from today's config).
 */
export async function salvageItems(
  characterId: string,
  itemIds: string[],
  now: Date = new Date(),
): Promise<{ results: SalvageItemResult[]; totalMaterials: number; materials: number }> {
  const uniqueIds = [...new Set(itemIds)];
  if (uniqueIds.length === 0) {
    return { results: [], totalMaterials: 0, materials: await loadMaterials(characterId) };
  }

  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.itemInstance.findMany({
        where: { id: { in: uniqueIds }, ownerId: characterId },
        select: { id: true, templateId: true, deletedAt: true, equippedSlot: true },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));

      const results: SalvageItemResult[] = [];
      const salvaged: { itemId: string; yield: number; tier: number; rarity: string }[] = [];
      for (const itemId of uniqueIds) {
        const item = byId.get(itemId);
        if (!item) {
          results.push({ itemId, status: "rejected", reason: "not_found" });
          continue;
        }
        if (item.deletedAt !== null) {
          results.push({ itemId, status: "already", yield: 0 });
          continue;
        }
        if (item.equippedSlot !== null) {
          results.push({ itemId, status: "rejected", reason: "equipped" });
          continue;
        }
        const template = ITEM_TEMPLATES[item.templateId];
        if (!template) {
          // Retired/unknown template — cannot value it; treat as un-salvageable.
          results.push({ itemId, status: "rejected", reason: "not_found" });
          continue;
        }

        const gained = salvageYield(template.tier, template.rarity);
        // Atomic check-and-set (deletedAt:null + equippedSlot:null is the lock).
        const res = await tx.itemInstance.updateMany({
          where: { id: itemId, ownerId: characterId, deletedAt: null, equippedSlot: null },
          data: { deletedAt: now },
        });
        if (res.count === 0) {
          results.push({ itemId, status: "already", yield: 0 });
          continue;
        }
        salvaged.push({ itemId, yield: gained, tier: template.tier, rarity: template.rarity });
        results.push({ itemId, status: "salvaged", yield: gained });
      }

      const totalMaterials = salvaged.reduce((acc, s) => acc + s.yield, 0);
      let materials: number;
      if (salvaged.length > 0) {
        await tx.itemEvent.createMany({
          data: salvaged.map((s) => ({
            itemId: s.itemId,
            type: "salvaged",
            fromCharacterId: characterId,
            meta: JSON.stringify({
              salvaged: true,
              yield: s.yield,
              tier: s.tier,
              rarity: s.rarity,
              currency: "materials",
            }),
          })),
        });
        // Credit the authoritative counter in the SAME tx (won set only).
        const updated = await tx.character.update({
          where: { id: characterId },
          data: { materials: { increment: totalMaterials } },
          select: { materials: true },
        });
        materials = updated.materials;
      } else {
        const cur = await tx.character.findUnique({
          where: { id: characterId },
          select: { materials: true },
        });
        materials = cur?.materials ?? 0;
      }

      return { results, totalMaterials, materials };
    },
    // Same headroom as the sell batch (≤100 indexed single-row writes on a shared host).
    { maxWait: 10_000, timeout: 20_000 },
  );
}

// ── Refine (ตีบวก — server-authoritative roll) ───────────────────────────────

export type RefineOutcome = "success" | "degrade" | "break" | "safe";

export type RefineResult =
  | {
      ok: true;
      outcome: RefineOutcome;
      /** New +level after the attempt (0 when broken). */
      refineLevel: number;
      /** True when the item was destroyed (fail on the break band). */
      destroyed: boolean;
      /** New authoritative material balance after debiting. */
      materials: number;
      /** Deltas for the client to apply via engine intents (materialsDelta + gold). */
      materialsDelta: number;
      goldDelta: number;
      cost: { materials: number; gold: number };
    }
  | {
      ok: false;
      reason:
        | "not_found"
        | "unknown_template"
        | "max"
        | "insufficient_materials"
        | "insufficient_gold";
    };

/** Crypto-backed uniform roll in [0, 1). Injectable for deterministic tests. This
 *  is the SERVER roll (outside the engine determinism rule — CLAUDE.md). */
function cryptoRoll(): number {
  return randomInt(0, 1_000_000) / 1_000_000;
}

/**
 * Refine ONE owned item (M7.6 "ตีบวก"). SERVER-AUTHORITATIVE — the client never
 * rolls (anti-cheat). One `prisma.$transaction`:
 *   1. read the item (owned, non-deleted) → tier (engine config) + current +level;
 *   2. reject if already at `REFINE.maxRefine`;
 *   3. cost = `refineCost(tier, current+1)`; reject if `goldBalance` < cost.gold
 *      (gold lives in the save blob — the route passes the PERSISTED balance; it is
 *      returned as a delta, not debited here);
 *   4. debit `cost.materials` from `Character.materials` via a guarded `updateMany`
 *      (`materials >= cost.materials`) — the atomic materials check-and-set; count 0
 *      → insufficient_materials (tx aborts, nothing charged);
 *   5. ROLL success vs `successChanceForLevel(target)`. success → +1; fail →
 *      `failModeForLevel`: safe → unchanged, degrade → −1 (floor 0), break → soft-
 *      destroy (deletedAt + equippedSlot NULL — invariant 5, unequips if equipped);
 *   6. apply the item change via a guarded `updateMany` (`refineLevel: current`,
 *      `deletedAt: null`) — a COMPARE-AND-SET: a concurrent/retried attempt that
 *      already moved the level matches 0 rows → aborts the tx (materials restored),
 *      so no double-charge (every real outcome changes the level or deletes, since
 *      the safe band is 100%-success in config → no no-op write to double-apply);
 *   7. append a `refined` ItemEvent (meta {from,to,outcome,cost}; break also carries
 *      destroyed:true and is the destroy record for that row — invariant 9).
 *
 * Returns the new +level/outcome + the authoritative material balance and the
 * materials/gold DELTAS the client feeds into its `materialsDelta` + gold intents.
 */
export async function refineItem(
  characterId: string,
  itemId: string,
  goldBalance: number,
  opts: { roll?: () => number; now?: Date } = {},
): Promise<RefineResult> {
  const roll = opts.roll ?? cryptoRoll;
  const now = opts.now ?? new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      const item = await tx.itemInstance.findFirst({
        where: { id: itemId, ownerId: characterId, deletedAt: null },
        select: { id: true, templateId: true, refineLevel: true, equippedSlot: true },
      });
      if (!item) throw new RefineOpError("not_found");

      const template = ITEM_TEMPLATES[item.templateId];
      if (!template) throw new RefineOpError("unknown_template");

      const current = clampRefine(item.refineLevel);
      if (current >= REFINE.maxRefine) throw new RefineOpError("max");
      const target = current + 1;
      const cost = refineCost(template.tier, target);

      // Gold is client-authoritative (save blob) — check the persisted balance the
      // route passed in; it is returned as a delta, never debited server-side (yet).
      if (goldBalance < cost.gold) throw new RefineOpError("insufficient_gold");

      // Atomic materials check-and-set (locks the Character row → serialises the
      // character's concurrent refines). Count 0 = not enough materials → abort.
      const debit = await tx.character.updateMany({
        where: { id: characterId, materials: { gte: cost.materials } },
        data: { materials: { decrement: cost.materials } },
      });
      if (debit.count === 0) throw new RefineOpError("insufficient_materials");

      // Server roll → outcome.
      const success = roll() < successChanceForLevel(target);
      let outcome: RefineOutcome;
      let newLevel = current;
      let destroyed = false;
      if (success) {
        outcome = "success";
        newLevel = target;
      } else {
        const mode = failModeForLevel(target);
        if (mode === "degrade") {
          outcome = "degrade";
          newLevel = Math.max(0, current - 1);
        } else if (mode === "break") {
          outcome = "break";
          destroyed = true;
        } else {
          outcome = "safe";
          newLevel = current;
        }
      }

      // Compare-and-set on the item (refineLevel:current guard). A retry/concurrent
      // attempt that already changed the level matches 0 → abort (materials restored).
      const applied = destroyed
        ? await tx.itemInstance.updateMany({
            where: { id: itemId, ownerId: characterId, deletedAt: null, refineLevel: current },
            data: { deletedAt: now, equippedSlot: null },
          })
        : await tx.itemInstance.updateMany({
            where: { id: itemId, ownerId: characterId, deletedAt: null, refineLevel: current },
            data: { refineLevel: newLevel },
          });
      if (applied.count === 0) throw new RefineOpError("not_found");

      await tx.itemEvent.create({
        data: {
          itemId,
          type: "refined",
          fromCharacterId: characterId,
          meta: JSON.stringify({
            from: current,
            to: destroyed ? current : newLevel,
            outcome,
            cost,
            ...(destroyed ? { destroyed: true } : {}),
          }),
        },
      });

      // M7.9 server-wide announcement: ONLY a SUCCESS landing at +8/+9/+10,
      // written in this SAME tx (schema doc: a row can never exist without the
      // refine having actually landed). See `docs`/schema.prisma comment for
      // why this is deliberately not a Character relation.
      if (outcome === "success" && newLevel >= ANNOUNCE_MIN_REFINE_LEVEL) {
        const owner = await tx.character.findUnique({
          where: { id: characterId },
          select: { name: true },
        });
        if (owner) {
          await tx.refineAnnouncement.create({
            data: {
              characterId,
              charName: owner.name,
              templateId: item.templateId,
              refineLevel: newLevel,
            },
          });
        }
        // Opportunistic prune (keep the table tiny; no cron) — piggybacked on
        // this write path per the M7.9 design.
        await tx.refineAnnouncement.deleteMany({
          where: { createdAt: { lt: new Date(now.getTime() - ANNOUNCEMENT_PRUNE_MS) } },
        });
        // A fresh row just landed — drop the short in-process feed cache so
        // the very next poll (this refiner's own next autosave, or anyone
        // else's) sees it immediately instead of waiting out the TTL.
        announcementsCache = null;
      }

      const after = await tx.character.findUnique({
        where: { id: characterId },
        select: { materials: true },
      });

      return {
        ok: true as const,
        outcome,
        refineLevel: destroyed ? 0 : newLevel,
        destroyed,
        materials: after?.materials ?? 0,
        materialsDelta: -cost.materials,
        goldDelta: -cost.gold,
        cost,
      };
    });
  } catch (err) {
    if (err instanceof RefineOpError) return { ok: false, reason: err.reason };
    throw err;
  }
}

// ── NPC buy-back (owner-approved) ─────────────────────────────────────────────
//
// When a player SELLS an item, `sellItems` records a `SoldItem` row (above). For
// BUYBACK_WINDOW_DAYS the merchant offers it BACK at exactly the credited price.
// The clock is SERVER-AUTHORITATIVE: the window is measured from the server-stamped
// `soldAt` vs the server's `now`, never a client timestamp. Salvaged items are never
// recorded, so they can't be bought back. Manual-only — no bot/auto path calls this.

/** Buy-back window: an item stays repurchasable for this many days after sale. */
export const BUYBACK_WINDOW_DAYS = 3;
/** Same window in milliseconds (server wall-clock math). */
export const BUYBACK_WINDOW_MS = BUYBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export interface BuybackEntryDTO {
  soldItemId: string;
  templateId: string;
  refineLevel: number;
  price: number;
  /** ISO server-stamped sale time. */
  soldAt: string;
  /** ISO soldAt + BUYBACK_WINDOW (when this offer lapses). */
  expiresAt: string;
}

/**
 * This character's still-repurchasable sold items — unrestored rows whose `soldAt`
 * is within BUYBACK_WINDOW_DAYS of `now`, SOONEST-TO-EXPIRE FIRST (oldest sale first).
 * Opportunistically purges this owner's already-expired rows on read (no cron — keeps
 * the table tiny, same philosophy as the announcement prune).
 */
export async function loadBuyback(
  characterId: string,
  now: Date = new Date(),
): Promise<BuybackEntryDTO[]> {
  const windowStart = new Date(now.getTime() - BUYBACK_WINDOW_MS);
  // Lazy purge: this owner's rows past the window are dead (restored or not) — drop
  // them so the list query and the table stay small.
  await prisma.soldItem.deleteMany({
    where: { ownerId: characterId, soldAt: { lt: windowStart } },
  });
  const rows = await prisma.soldItem.findMany({
    where: { ownerId: characterId, restoredAt: null, soldAt: { gte: windowStart } },
    orderBy: { soldAt: "asc" }, // oldest sale = soonest to expire = first
    select: { id: true, templateId: true, refineLevel: true, price: true, soldAt: true },
  });
  return rows.map((r) => ({
    soldItemId: r.id,
    templateId: r.templateId,
    refineLevel: r.refineLevel,
    price: r.price,
    soldAt: r.soldAt.toISOString(),
    expiresAt: new Date(r.soldAt.getTime() + BUYBACK_WINDOW_MS).toISOString(),
  }));
}

/** Buy back ONE sold item. Single soldItemId — the server re-mints the instance. */
export const buybackSchema = z.object({ soldItemId: z.string().min(1).max(64) }).strict();

export type BuybackResult =
  | { ok: true; goldDelta: number; item: ItemInstanceDTO }
  | { ok: false; reason: "notFound" | "expired" | "insufficientGold" | "bagFull" };

/**
 * Repurchase ONE sold item (owner-approved). One `prisma.$transaction`:
 *   1. read the SoldItem (must belong to THIS character) — missing OR wrong-owner OR
 *      ALREADY restored → "notFound";
 *   2. window check vs the SERVER clock (soldAt within BUYBACK_WINDOW_MS of `now`) →
 *      "expired" (a client that forwards its clock can't extend this);
 *   3. gold check against the PERSISTED save balance the route passes in (gold lives
 *      in the save blob — MVP client-authoritative, SAME pattern as refine: checked
 *      here, returned as `goldDelta`, never debited server-side) → "insufficientGold";
 *   4. bag-cap backstop mirroring the claim mint path (server refuses to mint past
 *      INVENTORY_CAP non-deleted instances) → "bagFull";
 *   5. atomic check-and-set `restoredAt` (guarded updateMany, restoredAt:null) so a
 *      row redeems AT MOST ONCE (a concurrent/retried buy-back matches 0 → notFound);
 *   6. re-create a FRESH ItemInstance (new cuid, same templateId + refineLevel, origin
 *      "buyback" so it never counts against the drop-rate ceiling) + a `boughtBack`
 *      ItemEvent — all in the same tx.
 *
 * Returns `goldDelta: -price` for the client to apply via its gold intent.
 */
export async function buybackItem(
  characterId: string,
  soldItemId: string,
  goldBalance: number,
  opts: { now?: Date } = {},
): Promise<BuybackResult> {
  const now = opts.now ?? new Date();
  const windowStart = new Date(now.getTime() - BUYBACK_WINDOW_MS);
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.soldItem.findFirst({
        where: { id: soldItemId, ownerId: characterId },
        select: { id: true, templateId: true, refineLevel: true, price: true, soldAt: true, restoredAt: true },
      });
      // Missing, wrong-owner (ownerId filter), or already redeemed → not a valid target.
      if (!row || row.restoredAt !== null) throw new BuybackOpError("notFound");
      if (row.soldAt.getTime() < windowStart.getTime()) throw new BuybackOpError("expired");
      if (goldBalance < row.price) throw new BuybackOpError("insufficientGold");

      // Bag-cap backstop (mirrors the claim mint backstop) — refuse to mint past cap.
      const inventoryCount = await tx.itemInstance.count({
        where: { ownerId: characterId, deletedAt: null },
      });
      if (inventoryCount >= INVENTORY_CAP) throw new BuybackOpError("bagFull");

      // Atomic check-and-set: redeem at most once (loses the race → notFound).
      const claimed = await tx.soldItem.updateMany({
        where: { id: soldItemId, ownerId: characterId, restoredAt: null },
        data: { restoredAt: now },
      });
      if (claimed.count === 0) throw new BuybackOpError("notFound");

      const created = await tx.itemInstance.create({
        data: {
          ownerId: characterId,
          templateId: row.templateId,
          origin: "buyback", // NOT drop/boss → excluded from the drop-rate plausibility ceiling
          sourceDetail: `buyback:${soldItemId}`,
          refineLevel: row.refineLevel,
        },
        select: INSTANCE_SELECT,
      });
      await tx.itemEvent.create({
        data: {
          itemId: created.id,
          type: "boughtBack",
          toCharacterId: characterId,
          meta: JSON.stringify({ soldItemId, price: row.price, refineLevel: row.refineLevel }),
        },
      });

      const dto = toItemDTO(created);
      if (!dto) throw new BuybackOpError("notFound"); // retired template — defensive
      return { ok: true as const, goldDelta: -row.price, item: dto };
    });
  } catch (err) {
    if (err instanceof BuybackOpError) return { ok: false, reason: err.reason };
    throw err;
  }
}

/** Internal control-flow error for the buy-back tx. */
class BuybackOpError extends Error {
  constructor(
    public readonly reason: "notFound" | "expired" | "insufficientGold" | "bagFull",
  ) {
    super(reason);
  }
}

/** Internal control-flow error so a tx callback can abort with a typed reason. */
class ItemOpError extends Error {
  constructor(public readonly reason: "not_found" | "unknown_template" | "class_req") {
    super(reason);
  }
}

/** Internal control-flow error for the refine tx. */
class RefineOpError extends Error {
  constructor(
    public readonly reason:
      | "not_found"
      | "unknown_template"
      | "max"
      | "insufficient_materials"
      | "insufficient_gold",
  ) {
    super(reason);
  }
}
