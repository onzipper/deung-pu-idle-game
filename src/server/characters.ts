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
import { serverDayFor } from "@/server/dailyQuests";

/**
 * Max LIVE characters per account. Ninja wave: 3 → 4. The first three slots hold
 * the base-class lines (sword/bow/magic); the 4th slot is the NINJA unlock slot
 * (doc §5: "การ์ดสร้างตัวละครใบที่ 4"). Enforced at app level — see schema.
 */
export const MAX_LIVE_CHARACTERS = 4;

const KNOWN_CLASSES = [...SLOT_ORDER] as [HeroClass, ...HeroClass[]];

/**
 * The three BASE-class lines. The ninja-unlock gate requires each of these present
 * on the account at tier ≥ 3; the base classes also fill slots 1–3.
 */
export const BASE_CLASSES = ["swordsman", "archer", "mage"] as const;
export type BaseClass = (typeof BASE_CLASSES)[number];

/** Tier every base line must reach to unlock the ninja class. */
export const NINJA_UNLOCK_TIER = 3;

/**
 * THE single removable gate (doc §5: "ภายหลังค่อยปลดเงื่อนไขนี้"). Flip to `false`
 * to open the ninja class + 4th slot to everyone regardless of tier progress —
 * `computeNinjaUnlock().unlocked` then always returns true and `createCharacter`
 * stops rejecting ninja creation. This is the ONLY switch the owner needs to touch.
 */
export const REQUIRE_NINJA_UNLOCK = false;

/**
 * Ninja-unlock progress for an account, derived from the `Character.tier` caches
 * (never a save blob). `baseTier3` drives the UI "ปลดล็อก: อาชีพ tier 3 แล้ว N/3"
 * readout; `unlocked` is the server-authoritative gate the create path enforces.
 */
export interface NinjaUnlock {
  /** Server-authoritative: may this account create a ninja? */
  unlocked: boolean;
  /** Tier each base line must reach (NINJA_UNLOCK_TIER). */
  requiredTier: number;
  /** Per-base-class: does the account have that line at tier ≥ requiredTier? */
  baseTier3: Record<BaseClass, boolean>;
  /** Highest tier seen per base line across the account's LIVE characters. */
  maxTier: Record<BaseClass, number>;
  /** How many of the 3 base lines have cleared the gate (0..3). */
  cleared: number;
  /** Total base lines needed (BASE_CLASSES.length = 3). */
  needed: number;
}

/**
 * Pure gate evaluator over an account's (baseClass, tier) cache rows. Kept pure so
 * both the create path (reads inside the tx) and the roster endpoint (plain read)
 * feed it the same way. A row whose `tier` cache is still the default 1 (pre-ninja
 * rows / never-saved-since-deploy) simply counts as tier 1 — progress may undercount
 * until that character next saves; ACCEPTED (no blob-parsing backfill, see schema).
 */
export function computeNinjaUnlock(rows: { baseClass: string; tier: number }[]): NinjaUnlock {
  const maxTier: Record<BaseClass, number> = { swordsman: 0, archer: 0, mage: 0 };
  for (const r of rows) {
    if ((BASE_CLASSES as readonly string[]).includes(r.baseClass)) {
      const cls = r.baseClass as BaseClass;
      const t = r.tier ?? 1;
      if (t > maxTier[cls]) maxTier[cls] = t;
    }
  }
  const baseTier3: Record<BaseClass, boolean> = {
    swordsman: maxTier.swordsman >= NINJA_UNLOCK_TIER,
    archer: maxTier.archer >= NINJA_UNLOCK_TIER,
    mage: maxTier.mage >= NINJA_UNLOCK_TIER,
  };
  const cleared = BASE_CLASSES.filter((c) => baseTier3[c]).length;
  const conditionMet = cleared === BASE_CLASSES.length;
  return {
    unlocked: REQUIRE_NINJA_UNLOCK ? conditionMet : true,
    requiredTier: NINJA_UNLOCK_TIER,
    baseTier3,
    maxTier,
    cleared,
    needed: BASE_CLASSES.length,
  };
}

/** Roster read: the account's ninja-unlock progress (piggybacks GET /api/characters). */
export async function getNinjaUnlock(userId: string): Promise<NinjaUnlock> {
  const rows = await prisma.character.findMany({
    where: { userId, deletedAt: null },
    select: { baseClass: true, tier: true },
  });
  return computeNinjaUnlock(rows);
}

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

/**
 * POST /api/characters/rename body. Reuses the EXACT creation `nameSchema` (2–24
 * Thai/EN alnum, trimmed) — rename is held to the same validity + global-CI
 * uniqueness bar as creation. `characterId` is bounded (opaque cuid).
 */
export const renameCharacterSchema = z
  .object({
    characterId: z.string().min(1).max(64),
    name: nameSchema,
  })
  .strict();

export type RenameCharacterInput = z.infer<typeof renameCharacterSchema>;

/** Public character shape returned to the client (never leaks internal columns). */
export interface CharacterDTO {
  id: string;
  name: string;
  baseClass: string;
  level: number;
  power: number;
  /** Class-advancement tier cache (1..3); display + ninja-unlock progress. */
  tier: number;
  createdAt: string;
}

function toDTO(c: {
  id: string;
  name: string;
  baseClass: string;
  level: number;
  power: number;
  tier: number;
  createdAt: Date;
}): CharacterDTO {
  return {
    id: c.id,
    name: c.name,
    baseClass: c.baseClass,
    level: c.level,
    power: c.power,
    tier: c.tier,
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
    select: {
      id: true,
      name: true,
      baseClass: true,
      level: true,
      power: true,
      tier: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toDTO);
}

export type CreateErrorCode = "limit" | "duplicate" | "ninja_locked" | "ninja_only_slot";

export type CreateResult =
  | { ok: true; character: CharacterDTO }
  | { ok: false; code: CreateErrorCode; error: string };

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
  const isNinja = baseClass === "ninja";
  try {
    const character = await prisma.$transaction(async (tx) => {
      const live = await tx.character.count({ where: { userId, deletedAt: null } });
      if (live >= MAX_LIVE_CHARACTERS) throw new SlotError("limit");

      // Ninja class gate (server-authoritative). The account must hold all three
      // base lines at tier ≥ 3, checked via the Character.tier caches (never a save
      // blob). Behind the single REQUIRE_NINJA_UNLOCK flag so the owner can lift it.
      // NOTE: because the unlock condition needs 3 LIVE base characters at tier 3,
      // it structurally consumes slots 1–3, so a ninja can only ever be the 4th —
      // the two rules below are equivalent in practice, enforced separately for
      // defense-in-depth + a precise error code the UI can map.
      if (isNinja) {
        const rows = await tx.character.findMany({
          where: { userId, deletedAt: null },
          select: { baseClass: true, tier: true },
        });
        if (!computeNinjaUnlock(rows).unlocked) throw new SlotError("ninja_locked");
      } else if (live >= MAX_LIVE_CHARACTERS - 1) {
        // The 4th slot is reserved for the ninja unlock (doc §5). A non-ninja 4th
        // character is rejected with its own code so the UI shows the ninja card.
        throw new SlotError("ninja_only_slot");
      }

      // utf8mb4 default collation is case-insensitive, so equality here is a CI
      // match — the required global-CI-uniqueness-among-live check.
      const dup = await tx.character.findFirst({
        where: { deletedAt: null, name },
        select: { id: true },
      });
      if (dup) throw new SlotError("duplicate");

      return tx.character.create({
        data: { userId, name, baseClass, level: 1, power: 0, tier: 1 },
        select: {
          id: true,
          name: true,
          baseClass: true,
          level: true,
          power: true,
          tier: true,
          createdAt: true,
        },
      });
    });
    return { ok: true, character: toDTO(character) };
  } catch (err) {
    if (err instanceof SlotError) return { ok: false, code: err.kind, error: SLOT_ERROR_MSG[err.kind] };
    throw err;
  }
}

const SLOT_ERROR_MSG: Record<CreateErrorCode, string> = {
  limit: `at most ${MAX_LIVE_CHARACTERS} characters per account`,
  duplicate: "that name is already taken",
  ninja_locked: "ninja requires all three base classes at tier 3",
  ninja_only_slot: "the 4th character slot is reserved for the ninja class",
};

/** Internal control-flow error so the tx callback can abort with a reason. */
class SlotError extends Error {
  constructor(public readonly kind: CreateErrorCode) {
    super(kind);
  }
}

export type RenameErrorCode = "not_found" | "name_taken" | "rename_cooldown";

export type RenameResult =
  | { ok: true; character: CharacterDTO }
  | { ok: false; code: RenameErrorCode };

/**
 * Rename a LIVE character owned by `userId`, limited to ONCE per Asia/Bangkok
 * server-day. All checks + the write run in ONE transaction:
 *   1. owner + liveness gate (`userId` + `deletedAt: null`) — else `not_found`
 *      (never leaks whether the id exists for another account),
 *   2. once/day guard: `renameDay === today` → `rename_cooldown`,
 *   3. global case-insensitive uniqueness among LIVE rows EXCLUDING self (the
 *      same bar `createCharacter` enforces; utf8mb4 CI collation) → `name_taken`,
 *   4. the write is an ATOMIC compare-and-set (guarded `updateMany` where
 *      `renameDay` is null or a prior day) so a concurrent double-rename lands
 *      zero rows → `rename_cooldown`. The server computes the day from its own
 *      wall-clock (client clocks never trusted). HOF/announcement snapshots keep
 *      the historical name by design (no backfill).
 */
export async function renameCharacter(
  userId: string,
  characterId: string,
  name: string,
  now: Date = new Date(),
): Promise<RenameResult> {
  const today = serverDayFor(now);
  return prisma.$transaction(async (tx) => {
    const row = await tx.character.findFirst({
      where: { id: characterId, userId, deletedAt: null },
      select: { id: true, renameDay: true },
    });
    if (!row) return { ok: false, code: "not_found" };
    if (row.renameDay === today) return { ok: false, code: "rename_cooldown" };

    // Global CI uniqueness among LIVE rows, excluding this character itself
    // (renaming to your own current name would otherwise self-collide).
    const dup = await tx.character.findFirst({
      where: { deletedAt: null, name, id: { not: characterId } },
      select: { id: true },
    });
    if (dup) return { ok: false, code: "name_taken" };

    const res = await tx.character.updateMany({
      where: {
        id: characterId,
        userId,
        deletedAt: null,
        OR: [{ renameDay: null }, { renameDay: { not: today } }],
      },
      data: { name, renameDay: today },
    });
    if (res.count === 0) return { ok: false, code: "rename_cooldown" };

    const updated = await tx.character.findFirst({
      where: { id: characterId },
      select: {
        id: true,
        name: true,
        baseClass: true,
        level: true,
        power: true,
        tier: true,
        createdAt: true,
      },
    });
    // updated is non-null: the guarded update above matched exactly this row.
    return { ok: true, character: toDTO(updated!) };
  });
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
 *
 * Hall of Fame: the character's board projection (LeaderboardEntry + every
 * BossRecord) IS purged in the SAME tx — a soft delete never fires an FK cascade,
 * so leaving them would keep a deleted character occupying rank space. Announcement
 * history (RefineAnnouncement, incl. a first-to-cap singleton) is LEFT intact: it is
 * an immutable record of an event that genuinely happened, not a live board row.
 */
export async function deleteCharacter(userId: string, characterId: string): Promise<DeleteResult> {
  return prisma.$transaction(async (tx) => {
    const res = await tx.character.updateMany({
      where: { id: characterId, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (res.count === 0) return { ok: false, error: "character not found" };
    // Remove the deleted character from every ranked board (soft delete ≠ cascade).
    await tx.leaderboardEntry.deleteMany({ where: { characterId } });
    await tx.bossRecord.deleteMany({ where: { characterId } });
    return { ok: true };
  });
}
