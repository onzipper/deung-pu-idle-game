/**
 * Character CRUD + derived caches (M5 Character Pivot).
 *
 * Trust boundary: every mutation is scoped by the identity-cookie `userId` and
 * validated with zod before it touches a row. A player owns up to THREE live
 * characters (soft-deleted rows keep their id for audit but free the slot + name).
 *
 * `power`/`level` on `Character` are DENORMALISED CACHES (see schema) — the engine
 * save blob stays the source of truth. `powerFromSave` re-derives power via the
 * engine's `combatPower` (one-way import from `@/engine` is fine; the server never
 * re-implements game math — rule 4).
 */

import { z } from "zod";
import {
  SLOT_ORDER,
  combatPower,
  makeHero,
  emptyEquipped,
  type CharacterSave,
  type EquippedGear,
  type HeroClass,
} from "@/engine";
import { prisma } from "@/lib/db";

/** Max LIVE characters per account (GDD v2). Enforced at app level — see schema. */
export const MAX_LIVE_CHARACTERS = 3;

const KNOWN_CLASSES = [...SLOT_ORDER] as [HeroClass, ...HeroClass[]];

/**
 * Name rules: trimmed 2–24 chars, Thai and/or EN alphanumerics only (no spaces or
 * punctuation). VARCHAR(24) is utf8mb4 so Thai is safe. Uniqueness (global,
 * case-insensitive, among LIVE rows) is enforced separately in `createCharacter`
 * (MySQL's default utf8mb4 collation makes the equality check case-insensitive).
 */
const NAME_RE = /^[A-Za-z0-9฀-๿]+$/;
export const nameSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .min(2, "name must be at least 2 characters")
      .max(24, "name must be at most 24 characters")
      .regex(NAME_RE, "name may contain only Thai/English letters and digits"),
  );

/** POST /api/characters body. */
export const createCharacterSchema = z
  .object({
    name: nameSchema,
    baseClass: z.enum(KNOWN_CLASSES),
  })
  .strict();

export type CreateCharacterInput = z.infer<typeof createCharacterSchema>;

/** Public character shape returned to the client (never leaks internal columns). */
export interface CharacterDTO {
  id: string;
  name: string;
  baseClass: string;
  level: number;
  power: number;
  createdAt: string;
}

function toDTO(c: {
  id: string;
  name: string;
  baseClass: string;
  level: number;
  power: number;
  createdAt: Date;
}): CharacterDTO {
  return {
    id: c.id,
    name: c.name,
    baseClass: c.baseClass,
    level: c.level,
    power: c.power,
    createdAt: c.createdAt.toISOString(),
  };
}

/**
 * Re-derive the combat-power cache from a (validated) character save block.
 * Builds a live `Hero` via the engine factory and runs the engine's `combatPower`
 * — the single rules authority for the metric (rule 4). Shared by `persistSave`
 * (cache refresh) and the one-off backfill so the value is computed one way.
 */
export function powerFromSave(hero: CharacterSave): number {
  const h = makeHero(0, hero.cls, hero.level, hero.xp, hero.tier, hero.statPoints, hero.stats);
  return combatPower(h);
}

/**
 * Re-derive combat power INCLUDING equipped gear + refine (the Hall-of-Fame board
 * metric). Same one authority (`combatPower`), but the hero is rebuilt with the
 * AUTHORITATIVE equipped loadout resolved from the DB item ledger (never the
 * client's `equipped` save cache) — so the ranked power is server-derived from
 * stats + gear + refine and cannot be inflated by a tampered save. `makeHero`
 * folds refined weapon/armor ATK/HP/DEF into the derived stats combatPower reads.
 */
export function powerFromSaveAndGear(hero: CharacterSave, equipped: EquippedGear): number {
  const h = makeHero(
    0,
    hero.cls,
    hero.level,
    hero.xp,
    hero.tier,
    hero.statPoints,
    hero.stats,
    undefined, // mana → derived full pool (irrelevant to combatPower)
    undefined, // autoSlots → class default (irrelevant to combatPower)
    null, // quest (irrelevant)
    equipped ?? emptyEquipped(),
  );
  return combatPower(h);
}

/** List an account's LIVE characters, newest first. */
export async function listCharacters(userId: string): Promise<CharacterDTO[]> {
  const rows = await prisma.character.findMany({
    where: { userId, deletedAt: null },
    select: { id: true, name: true, baseClass: true, level: true, power: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toDTO);
}

export type CreateResult =
  | { ok: true; character: CharacterDTO }
  | { ok: false; code: "limit" | "duplicate"; error: string };

/**
 * Create a live character for `userId`. Enforces the ≤3-live cap and global
 * case-insensitive name uniqueness among live rows INSIDE a transaction to
 * narrow the TOCTOU window (there is no DB unique — a soft-deleted name must be
 * reclaimable; see schema). A residual concurrent-create race is accepted per
 * docs/persistence-m5.md; it can at worst seat a 4th slot / dup name, never
 * corrupt a save.
 */
export async function createCharacter(
  userId: string,
  input: CreateCharacterInput,
): Promise<CreateResult> {
  const { name, baseClass } = input;
  try {
    const character = await prisma.$transaction(async (tx) => {
      const live = await tx.character.count({ where: { userId, deletedAt: null } });
      if (live >= MAX_LIVE_CHARACTERS) throw new SlotError("limit");

      // utf8mb4 default collation is case-insensitive, so equality here is a CI
      // match — the required global-CI-uniqueness-among-live check.
      const dup = await tx.character.findFirst({
        where: { deletedAt: null, name },
        select: { id: true },
      });
      if (dup) throw new SlotError("duplicate");

      return tx.character.create({
        data: { userId, name, baseClass, level: 1, power: 0 },
        select: {
          id: true,
          name: true,
          baseClass: true,
          level: true,
          power: true,
          createdAt: true,
        },
      });
    });
    return { ok: true, character: toDTO(character) };
  } catch (err) {
    if (err instanceof SlotError) {
      return err.kind === "limit"
        ? { ok: false, code: "limit", error: `at most ${MAX_LIVE_CHARACTERS} characters per account` }
        : { ok: false, code: "duplicate", error: "that name is already taken" };
    }
    throw err;
  }
}

/** Internal control-flow error so the tx callback can abort with a reason. */
class SlotError extends Error {
  constructor(public readonly kind: "limit" | "duplicate") {
    super(kind);
  }
}

/**
 * Fetch a LIVE character owned by `userId`, or null. The `deletedAt: null` +
 * `userId` filter is the owner + liveness gate reused by select/delete/save.
 */
export async function getOwnedLiveCharacter(
  userId: string,
  characterId: string,
): Promise<{ id: string } | null> {
  return prisma.character.findFirst({
    where: { id: characterId, userId, deletedAt: null },
    select: { id: true },
  });
}

/**
 * Fetch a LIVE character's base class (owner-checked), or null. Used by the M7
 * equip endpoint to enforce an item's `classReq` against the account's character
 * server-side (the client class is never trusted). `baseClass` is the immutable
 * creation class — the classReq gate keys off it, not the transient current tier.
 */
export async function getOwnedLiveCharacterClass(
  userId: string,
  characterId: string,
): Promise<{ id: string; baseClass: HeroClass } | null> {
  const row = await prisma.character.findFirst({
    where: { id: characterId, userId, deletedAt: null },
    select: { id: true, baseClass: true },
  });
  if (!row) return null;
  return { id: row.id, baseClass: row.baseClass as HeroClass };
}

export type DeleteResult = { ok: true } | { ok: false; error: string };

/**
 * Soft-delete a character (owner-checked). Orphan policy: the character's
 * `SaveState` row is KEPT (audit / possible undelete) with `characterId` still
 * pointing at the now-soft-deleted row — load/persist only ever resolve through a
 * LIVE active character, so an orphaned save is never served. We deliberately do
 * NOT null the link or delete the save.
 */
export async function deleteCharacter(userId: string, characterId: string): Promise<DeleteResult> {
  const res = await prisma.character.updateMany({
    where: { id: characterId, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (res.count === 0) return { ok: false, error: "character not found" };
  return { ok: true };
}
