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
  type GearSlot,
} from "@/engine/config/items";
import type { HeroClass } from "@/engine";
import { prisma } from "@/lib/db";

// ── Tunables (plausibility cap) ──────────────────────────────────────────────
/** Hard cap on items per POST /api/items/claim batch (DoS / abuse bound). */
export const MAX_CLAIM_BATCH = 64;
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
}

interface InstanceRow {
  id: string;
  templateId: string;
  equippedSlot: string | null;
  origin: string;
  acquiredAt: Date;
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
  };
}

const INSTANCE_SELECT = {
  id: true,
  templateId: true,
  equippedSlot: true,
  origin: true,
  acquiredAt: true,
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

/** The equipped loadout (weapon/armor → templateId) for the boot payload. */
export interface EquippedLoadout {
  weapon: string | null;
  armor: string | null;
}

export function equippedLoadoutFrom(inventory: ItemInstanceDTO[]): EquippedLoadout {
  const loadout: EquippedLoadout = { weapon: null, armor: null };
  for (const item of inventory) {
    if (item.equippedSlot === "weapon") loadout.weapon = item.templateId;
    else if (item.equippedSlot === "armor") loadout.armor = item.templateId;
  }
  return loadout;
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
  | { status: "rejected"; reason: "unknown_template" | "not_in_table" | "rate"; rollId: string };

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

    if (remaining <= 0) {
      // Budget exhausted — still honour an idempotent retry of an already-minted
      // claim (it doesn't add an item), otherwise reject as rate abuse.
      const existing = await prisma.itemInstance.findUnique({
        where: { claimKey },
        select: INSTANCE_SELECT,
      });
      if (existing) {
        const dto = toItemDTO(existing);
        if (dto) results.push({ status: "existing", item: dto });
        continue;
      }
      results.push({ status: "rejected", reason: "rate", rollId: entry.rollId });
      continue;
    }

    const minted = await mintOne(characterId, entry, cls.origin, claimKey);
    if (minted.status === "minted") remaining--;
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

/** Internal control-flow error so a tx callback can abort with a typed reason. */
class ItemOpError extends Error {
  constructor(public readonly reason: "not_found" | "unknown_template" | "class_req") {
    super(reason);
  }
}
