/**
 * M7.95 "Hall of Fame" — server-authoritative leaderboard ingest + board reads.
 *
 * Trust model (identical to `lastSeen`): the client is hostile, and every ranked
 * value is DERIVED SERVER-SIDE from the already-validated (zod + migrate) save blob
 * plus the authoritative DB item ledger — never a client-supplied number:
 *   - `power` is recomputed via the engine's `combatPower` over the hero rebuilt
 *     WITH the DB equipped loadout + refine (`powerFromSaveAndGear`).
 *   - `goldEarned` / `bossBest` are copied from the validated save.
 *   - `levelCapAt` and every `bossBest[stage].at` are SERVER-STAMPED from the
 *     server wall-clock (the engine emits 0/null); a client cannot forge a time.
 *   - `onlineSeconds` accumulates only plausible in-session gaps (0 < Δ < 300s).
 *   - a boss clear below the plausibility floor is DROPPED (kept: any prior best).
 *
 * `LeaderboardEntry` (one row/character) is a DENORMALIZED PROJECTION of the save
 * blob — rebuilt on every `persistSave`; the save stays the source of truth.
 * `BossRecord` is the indexed projection of `bossBest` (MySQL can't index a JSON
 * path), written in the SAME tx so board and blob never skew.
 */

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { CONFIG, type SaveData, type BossClearBest, type HeroClass } from "@/engine";
import { prisma } from "@/lib/db";
import { powerFromSaveAndGear } from "@/server/characters";
import { loadInventory, equippedLoadoutFrom } from "@/server/items";
import { judgePlausibility } from "@/server/plausibility";

// ── Boss-time plausibility floor ─────────────────────────────────────────────
//
// floor = 0.5 × the FASTEST recorded boss-iso clear (docs/balance-m79.md). A
// submitted clear below its stage floor is physically implausible → dropped.
// s20/s25/s30 fastest are the boss-iso table (maxed L90 tier-3, full t10 +10 gear):
//   s20 7.0s (mage) · s25 7.7s (swordsman) · s30 14.5s (mage).
// s5/s10/s15 are NOT tabulated in that doc (its boss-iso table only covers the
// s20+ bosses). Early bosses are weaker, but the hero is far weaker at that stage
// too; these fastest values are CONSERVATIVE ESTIMATES, deliberately kept low so a
// legit fast clear is never rejected — the floor only exists to catch near-zero /
// sub-second forged times.
export const BOSS_TIME_FLOOR: Record<number, number> = {
  5: 1.0, //  0.5 × ~2.0s  (estimate — not in the boss-iso table)
  10: 1.5, // 0.5 × ~3.0s  (estimate)
  15: 2.5, // 0.5 × ~5.0s  (estimate)
  20: 3.5, // 0.5 × 7.0s   (boss-iso: mage)
  25: 3.85, // 0.5 × 7.7s  (boss-iso: swordsman)
  30: 7.25, // 0.5 × 14.5s (boss-iso: mage)
};

/** Plausibility floor (seconds) for a boss `stage`. A non-gate stage still gets a
 *  tiny non-zero floor so a 0 / negative submission is always rejected. */
export function bossTimeFloor(stage: number): number {
  return BOSS_TIME_FLOOR[stage] ?? 0.5;
}

/** Max plausible in-session gap between two autosaves (~30s cadence) that counts
 *  toward `onlineSeconds`. A larger gap is an offline stretch (or a clock jump) and
 *  is NOT credited. */
export const ONLINE_TICK_MAX_SECONDS = 300;

/** Board list size. */
export const TOP_N = 10;

// ── Stored JSON shapes ───────────────────────────────────────────────────────

/** A stamped boss best as stored in `LeaderboardEntry.bossBest` (ISO `at`). */
interface StoredBossBest {
  seconds: number;
  at: string;
}

/** The paper-doll snapshot stored in `LeaderboardEntry.profile`. */
interface ProfileSnapshot {
  loadout: { weapon: string | null; armor: string | null };
  refineLevels: { weapon: number; armor: number };
}

/** Narrow a stored `bossBest` JSON blob into a typed record (defensive). */
function parseStoredBossBest(raw: unknown): Record<number, StoredBossBest> {
  const out: Record<number, StoredBossBest> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const stage = Number(k);
    if (!Number.isFinite(stage)) continue;
    const rec = v as { seconds?: unknown; at?: unknown };
    const seconds = typeof rec?.seconds === "number" ? rec.seconds : NaN;
    if (!Number.isFinite(seconds)) continue;
    const at = typeof rec?.at === "string" ? rec.at : new Date(0).toISOString();
    out[stage] = { seconds, at };
  }
  return out;
}

/**
 * Merge an incoming (validated) `bossBest` into the stored bests. PURE + unit-
 * testable. Enforces the plausibility floor and SERVER-STAMPS a new best's `at`
 * (the client's `at` is never trusted): a strictly-better clear takes `now`; an
 * equal-or-worse clear keeps the stored best and its original stamp. A sub-floor
 * clear is dropped (with an audit line) and never replaces a prior best.
 */
export function mergeBossBest(
  existing: Record<number, StoredBossBest>,
  incoming: Record<number, BossClearBest> | undefined,
  characterId: string,
  now: Date,
): Record<number, StoredBossBest> {
  const out: Record<number, StoredBossBest> = { ...existing };
  for (const [k, rec] of Object.entries(incoming ?? {})) {
    const stage = Number(k);
    if (!Number.isFinite(stage)) continue;
    const seconds = rec?.seconds;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) continue;

    const floor = bossTimeFloor(stage);
    if (seconds < floor) {
      // Implausible clear — ignore it, keep any previous best (audit; there is no
      // item-scoped ItemEvent to attach a leaderboard anomaly to, so this logs).
      console.warn(
        `[hof] boss-time floor rejected char=${characterId} stage=${stage} seconds=${seconds} floor=${floor}`,
      );
      continue;
    }

    const prev = out[stage];
    if (!prev || seconds < prev.seconds) {
      out[stage] = { seconds, at: now.toISOString() }; // server-stamp the new best
    }
  }
  return out;
}

// ── Ingest (called from persistSave) ─────────────────────────────────────────

/**
 * Rebuild the character's `LeaderboardEntry` + `BossRecord` projection from a
 * validated (migrated) save. Called AFTER the save persists (best-effort — a
 * leaderboard-cache failure must never fail the player's save; the caller wraps
 * this in try/catch). All ranked values are re-derived here; nothing is trusted.
 */
export async function upsertLeaderboardEntry(
  characterId: string,
  userId: string,
  data: SaveData,
  now: Date = new Date(),
): Promise<void> {
  // Authoritative identity (name/class immutable at creation).
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { name: true, baseClass: true, createdAt: true },
  });
  if (!character) return; // defensive: the caller already verified ownership

  const cls = character.baseClass;
  const tier = data.hero.tier;
  const level = data.hero.level;

  // Server-derived power: rebuild the hero with the AUTHORITATIVE equipped loadout
  // (DB item ledger wins over the save's `equipped` cache) + refine.
  const inventory = await loadInventory(characterId);
  // EquippedLoadout (refine always present) is assignable to EquippedGear.
  const equipped = equippedLoadoutFrom(inventory);
  const power = powerFromSaveAndGear(data.hero, equipped);

  const profile: ProfileSnapshot = {
    loadout: { weapon: equipped.weapon, armor: equipped.armor },
    refineLevels: { weapon: equipped.refine.weapon, armor: equipped.refine.armor },
  };
  const goldEarned = BigInt(Math.max(0, Math.floor(data.goldEarned)));

  await prisma.$transaction(async (tx) => {
    const existing = await tx.leaderboardEntry.findUnique({
      where: { characterId },
      select: {
        levelCapAt: true,
        lastTickAt: true,
        onlineSeconds: true,
        bossBest: true,
        suspect: true,
      },
    });

    // onlineSeconds AFK accumulator — only plausible in-session gaps count.
    let onlineSeconds = existing?.onlineSeconds ?? 0;
    if (existing?.lastTickAt) {
      const deltaSec = (now.getTime() - existing.lastTickAt.getTime()) / 1000;
      if (deltaSec > 0 && deltaSec < ONLINE_TICK_MAX_SECONDS) {
        onlineSeconds += Math.round(deltaSec);
      }
    }

    // levelCapAt — stamp once, on the first save at/above the cap.
    let levelCapAt = existing?.levelCapAt ?? null;
    if (levelCapAt === null && level >= CONFIG.leveling.levelCap) {
      levelCapAt = now;
    }

    // bossBest — merge with the floor + server-stamp.
    const merged = mergeBossBest(parseStoredBossBest(existing?.bossBest), data.bossBest, characterId, now);

    // Anti-cheat re-derive (M7.95 W2b): judge whether the character's headline stats
    // are achievable for its REAL elapsed play time. suspect=true hides it from every
    // board (the /api/hof query filters suspect=false); gameplay/saves are NEVER
    // blocked. Recovery: level/gold latch via monotonic re-detection, power can regress
    // — see @/server/plausibility. Pure verdict → persisted + audited (console.warn).
    const prevSuspect = existing?.suspect ?? false;
    const verdict = judgePlausibility(
      {
        cls: cls as HeroClass,
        level,
        power,
        goldEarned: Number(goldEarned),
        onlineSeconds,
        createdAt: character.createdAt,
        now,
        levelCapAt,
      },
      prevSuspect,
    );
    const suspect = verdict.suspect;
    if (verdict.reasons.length > 0) {
      console.warn(
        `[hof] plausibility char=${characterId} suspect=${suspect} (was ${prevSuspect}): ${verdict.reasons.join("; ")}`,
      );
    }

    const bossBestJson = merged as unknown as Prisma.InputJsonValue;
    const profileJson = profile as unknown as Prisma.InputJsonValue;

    await tx.leaderboardEntry.upsert({
      where: { characterId },
      create: {
        characterId,
        userId,
        charName: character.name,
        cls,
        tier,
        level,
        levelCapAt,
        power,
        goldEarned,
        onlineSeconds,
        bossBest: bossBestJson,
        profile: profileJson,
        suspect,
        lastTickAt: now,
        levelAt: now,
        powerAt: now,
        goldAt: now,
        onlineAt: now,
      },
      update: {
        charName: character.name,
        cls,
        tier,
        level,
        levelCapAt,
        power,
        goldEarned,
        onlineSeconds,
        bossBest: bossBestJson,
        profile: profileJson,
        // Anti-cheat verdict (M7.95 W2b) — this IS the re-derive wave; suspect is
        // recomputed + written every save (recovers a power flag, latches level/gold).
        suspect,
        lastTickAt: now,
        levelAt: now,
        powerAt: now,
        goldAt: now,
        onlineAt: now,
      },
    });

    // Project each best into the indexed BossRecord (same tx → no skew).
    for (const [stageStr, rec] of Object.entries(merged)) {
      const stage = Number(stageStr);
      const at = new Date(rec.at);
      await tx.bossRecord.upsert({
        where: { characterId_stage: { characterId, stage } },
        create: {
          characterId,
          userId,
          charName: character.name,
          cls,
          tier,
          level,
          stage,
          seconds: rec.seconds,
          at,
          suspect,
        },
        update: {
          charName: character.name,
          cls,
          tier,
          level,
          seconds: rec.seconds,
          at,
          suspect,
        },
      });
    }
  });
}

// ── Read (GET /api/hof) ──────────────────────────────────────────────────────

export const HOF_BOARDS = ["level", "power", "gold", "boss", "online"] as const;
export type HofBoard = (typeof HOF_BOARDS)[number];

export const HOF_BOSS_STAGES = ["5", "10", "15", "20", "25", "30"] as const;
export const HOF_CLASSES = ["all", "swordsman", "archer", "mage"] as const;
export type HofClass = (typeof HOF_CLASSES)[number];

/** Strict query contract for GET /api/hof (frozen for the parallel UI wave). */
export const hofQuerySchema = z
  .object({
    board: z.enum(HOF_BOARDS),
    // Required + one of the known boss gates when board=boss (checked below).
    bossStage: z
      .enum(HOF_BOSS_STAGES)
      .transform((s) => Number(s))
      .optional(),
    cls: z.enum(HOF_CLASSES).default("all"),
  })
  .refine((q) => q.board !== "boss" || q.bossStage !== undefined, {
    message: "bossStage is required when board=boss",
    path: ["bossStage"],
  });

export type HofQuery = z.infer<typeof hofQuerySchema>;

export interface HofProfile {
  loadout: { weapon: string | null; armor: string | null };
  refineLevels: { weapon: number; armor: number };
  /** Highest equipped refine +level — the profile's prestige badge tier. */
  prestigeTier: number;
}

export interface HofBoardRow {
  rank: number;
  charName: string;
  cls: string;
  tier: number;
  level: number;
  /** Board-specific value: level / power / gold / seconds(boss) / onlineSeconds. */
  value: number;
  /** Board-specific achievement time (ISO), or null (e.g. below level cap). */
  at: string | null;
  profile: HofProfile;
}

export interface HofBoardResponse {
  top: HofBoardRow[];
  me: { rank: number; value: number } | null;
}

function toProfile(raw: unknown): HofProfile {
  const p = (raw ?? {}) as Partial<ProfileSnapshot>;
  const weapon = p.loadout?.weapon ?? null;
  const armor = p.loadout?.armor ?? null;
  const rw = typeof p.refineLevels?.weapon === "number" ? p.refineLevels.weapon : 0;
  const ra = typeof p.refineLevels?.armor === "number" ? p.refineLevels.armor : 0;
  return {
    loadout: { weapon, armor },
    refineLevels: { weapon: rw, armor: ra },
    prestigeTier: Math.max(rw, ra),
  };
}

const ENTRY_SELECT = {
  characterId: true,
  charName: true,
  cls: true,
  tier: true,
  level: true,
  levelCapAt: true,
  power: true,
  goldEarned: true,
  onlineSeconds: true,
  levelAt: true,
  powerAt: true,
  goldAt: true,
  onlineAt: true,
  profile: true,
  suspect: true,
} as const;

type EntryRow = Prisma.LeaderboardEntryGetPayload<{ select: typeof ENTRY_SELECT }>;

/** The board-specific value for an entry row. */
function entryValue(r: EntryRow, board: Exclude<HofBoard, "boss">): number {
  switch (board) {
    case "level":
      return r.level;
    case "power":
      return r.power;
    case "gold":
      return Number(r.goldEarned);
    case "online":
      return r.onlineSeconds;
  }
}

/** The board-specific achievement timestamp (ISO) for an entry row. */
function entryAt(r: EntryRow, board: Exclude<HofBoard, "boss">): string | null {
  const d =
    board === "level"
      ? r.levelCapAt
      : board === "power"
        ? r.powerAt
        : board === "gold"
          ? r.goldAt
          : r.onlineAt;
  return d ? d.toISOString() : null;
}

function entryToRow(r: EntryRow, board: Exclude<HofBoard, "boss">, rank: number): HofBoardRow {
  return {
    rank,
    charName: r.charName,
    cls: r.cls,
    tier: r.tier,
    level: r.level,
    value: entryValue(r, board),
    at: entryAt(r, board),
    profile: toProfile(r.profile),
  };
}

function entryOrderBy(
  board: Exclude<HofBoard, "boss">,
): Prisma.LeaderboardEntryOrderByWithRelationInput[] {
  switch (board) {
    case "level":
      // Tiebreak: first-to-cap wins (levelCapAt ASC). Only engages at level==cap
      // (below the cap, level itself differentiates; levelCapAt is null there).
      return [{ level: "desc" }, { levelCapAt: "asc" }];
    case "power":
      return [{ power: "desc" }];
    case "gold":
      return [{ goldEarned: "desc" }];
    case "online":
      return [{ onlineSeconds: "desc" }];
  }
}

/** Count of rows strictly ranked ABOVE `mine` on an entry board → its rank. */
async function entryRank(
  board: Exclude<HofBoard, "boss">,
  cls: HofClass,
  mine: EntryRow,
): Promise<number> {
  const base: Prisma.LeaderboardEntryWhereInput = { suspect: false };
  if (cls !== "all") base.cls = cls;

  if (board === "level") {
    const better = await prisma.leaderboardEntry.count({
      where: { ...base, level: { gt: mine.level } },
    });
    let tie = 0;
    if (mine.levelCapAt) {
      tie = await prisma.leaderboardEntry.count({
        where: { ...base, level: mine.level, levelCapAt: { lt: mine.levelCapAt } },
      });
    }
    return better + tie + 1;
  }

  const where: Prisma.LeaderboardEntryWhereInput = { ...base };
  if (board === "power") where.power = { gt: mine.power };
  else if (board === "gold") where.goldEarned = { gt: mine.goldEarned };
  else where.onlineSeconds = { gt: mine.onlineSeconds }; // online
  const better = await prisma.leaderboardEntry.count({ where });
  return better + 1;
}

async function readEntryBoard(
  board: Exclude<HofBoard, "boss">,
  cls: HofClass,
  meCharacterId: string | null,
): Promise<HofBoardResponse> {
  const where: Prisma.LeaderboardEntryWhereInput = { suspect: false };
  if (cls !== "all") where.cls = cls;

  const rows = await prisma.leaderboardEntry.findMany({
    where,
    orderBy: entryOrderBy(board),
    take: TOP_N,
    select: ENTRY_SELECT,
  });
  const top = rows.map((r, i) => entryToRow(r, board, i + 1));

  let me: HofBoardResponse["me"] = null;
  if (meCharacterId) {
    const mine = await prisma.leaderboardEntry.findUnique({
      where: { characterId: meCharacterId },
      select: ENTRY_SELECT,
    });
    if (mine && !mine.suspect && (cls === "all" || mine.cls === cls)) {
      me = { rank: await entryRank(board, cls, mine), value: entryValue(mine, board) };
    }
  }
  return { top, me };
}

const BOSS_SELECT = {
  characterId: true,
  charName: true,
  cls: true,
  tier: true,
  level: true,
  seconds: true,
  at: true,
} as const;

async function readBossBoard(
  stage: number,
  cls: HofClass,
  meCharacterId: string | null,
): Promise<HofBoardResponse> {
  const where: Prisma.BossRecordWhereInput = { stage, suspect: false };
  if (cls !== "all") where.cls = cls;

  const recs = await prisma.bossRecord.findMany({
    where,
    orderBy: { seconds: "asc" }, // fastest first
    take: TOP_N,
    select: BOSS_SELECT,
  });

  // Fetch the paper-doll profiles for just the top-N ids (one indexed IN query).
  const ids = recs.map((r) => r.characterId);
  const profs = ids.length
    ? await prisma.leaderboardEntry.findMany({
        where: { characterId: { in: ids } },
        select: { characterId: true, profile: true },
      })
    : [];
  const profMap = new Map(profs.map((p) => [p.characterId, toProfile(p.profile)]));
  const emptyProfile: HofProfile = {
    loadout: { weapon: null, armor: null },
    refineLevels: { weapon: 0, armor: 0 },
    prestigeTier: 0,
  };

  const top: HofBoardRow[] = recs.map((r, i) => ({
    rank: i + 1,
    charName: r.charName,
    cls: r.cls,
    tier: r.tier,
    level: r.level,
    value: r.seconds,
    at: r.at.toISOString(),
    profile: profMap.get(r.characterId) ?? emptyProfile,
  }));

  let me: HofBoardResponse["me"] = null;
  if (meCharacterId) {
    const mine = await prisma.bossRecord.findUnique({
      where: { characterId_stage: { characterId: meCharacterId, stage } },
      select: { seconds: true, cls: true, suspect: true },
    });
    if (mine && !mine.suspect && (cls === "all" || mine.cls === cls)) {
      const better = await prisma.bossRecord.count({
        where: { ...where, seconds: { lt: mine.seconds } },
      });
      me = { rank: better + 1, value: mine.seconds };
    }
  }
  return { top, me };
}

/**
 * Read a Hall-of-Fame board (the GET /api/hof handler's engine). `meCharacterId`
 * is the caller's OWN character (resolved from the identity cookie), or null.
 */
export async function readBoard(query: HofQuery, meCharacterId: string | null): Promise<HofBoardResponse> {
  if (query.board === "boss") {
    return readBossBoard(query.bossStage as number, query.cls, meCharacterId);
  }
  return readEntryBoard(query.board, query.cls, meCharacterId);
}
