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
import { loadInventory, equippedLoadoutFrom, invalidateAnnouncementsCache } from "@/server/items";
import { judgePlausibility } from "@/server/plausibility";

// ── Server-wide announcement emission (M7.95) ────────────────────────────────
//
// The leaderboard ingest is the ONE place where fresh rank/level data lives, so
// the two HOF announcements are fired here (reusing the M7.9 `RefineAnnouncement`
// feed via its generalized `kind` column — see prisma/schema.prisma). Both writes
// happen AFTER the main projection tx commits, as best-effort standalone inserts:
// a singleton P2002 collision (levelCap) or any feed error must never roll back
// (or fail) the player's leaderboard projection.

/** Re-announce cooldown for a character re-taking #1 on the power board. */
const RANK_ONE_THROTTLE_MS = 24 * 60 * 60 * 1000; // 24h

/** The deterministic order that resolves the single #1 on the power board (mirror
 *  of the board read's DESC power; `powerAt` ASC breaks a tie so an equal-power
 *  challenger does NOT count as an overtake unless it strictly passes the leader). */
const POWER_TOP_ORDER: Prisma.LeaderboardEntryOrderByWithRelationInput[] = [
  { power: "desc" },
  { powerAt: "asc" },
];

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

/**
 * Fire the "เวลตัน" (level-cap reached) celebration for THIS character — owner
 * call 2026-07-09: every capper gets announced, not just the server's first
 * (the old global "levelCap" singleton read as "first player to Lv.90" and
 * silenced everyone after). Exactly-once PER CHARACTER is enforced by the DB:
 * `singletonKey="cap:<characterId>"` is @unique (same idiom as asura's
 * "legendary:<cls>"), so the concurrent double-save race on a null `levelCapAt`
 * collides on P2002 → swallowed. All other errors are swallowed too (the feed
 * is best-effort). Standalone insert (NOT in the projection tx) so a collision
 * never rolls the projection back. "cap:"+cuid ≤ 29 chars, fits VarChar(32).
 */
async function emitLevelCapAnnouncement(
  characterId: string,
  charName: string,
  capLevel: number,
  now: Date,
): Promise<void> {
  try {
    await prisma.refineAnnouncement.create({
      data: {
        kind: "levelCap",
        characterId,
        charName,
        refineLevel: capLevel, // carried into the client copy ("Lv.{level}")
        singletonKey: `cap:${characterId}`, // @unique → exactly-once per character
        createdAt: now,
      },
    });
    invalidateAnnouncementsCache();
  } catch {
    // P2002 (this character already announced) or any feed error → best-effort.
  }
}

/**
 * Fire the "NEWLY took #1 on the power board" announcement, throttled to at most
 * one per character per `RANK_ONE_THROTTLE_MS` (dedupe by kind+characterId+window,
 * served by the `@@index([kind, characterId, createdAt])`). Best-effort standalone
 * insert. The overtake decision itself is made inside the projection tx (see below).
 */
async function emitRankOneAnnouncement(
  characterId: string,
  charName: string,
  now: Date,
): Promise<void> {
  try {
    const since = new Date(now.getTime() - RANK_ONE_THROTTLE_MS);
    const recent = await prisma.refineAnnouncement.findFirst({
      where: { kind: "rankOne", characterId, createdAt: { gte: since } },
      select: { id: true },
    });
    if (recent) return; // throttled — same character already announced this window
    await prisma.refineAnnouncement.create({
      data: { kind: "rankOne", characterId, charName, createdAt: now },
    });
    invalidateAnnouncementsCache();
  } catch {
    // Best-effort — an announcement failure must never affect the save.
  }
}

// ── Orphan cleanup (deleted characters must leave the boards) ─────────────────
//
// Characters are SOFT-deleted (`Character.deletedAt`, see src/server/characters.ts),
// so a FK ON DELETE CASCADE never fires — the row still exists. New deletions purge
// their board rows inline (in the delete tx). This one-shot sweep clears the BACKLOG
// of characters soft-deleted BEFORE that inline cleanup existed: it removes every
// LeaderboardEntry/BossRecord whose character is no longer LIVE. Idempotent + cheap
// after the first run (finds nothing). Announcement history is intentionally NOT
// touched (immutable event record, not a live board row).

let orphanSweepDone: Promise<void> | null = null;

/** Delete every leaderboard/boss row whose character is not currently LIVE
 *  (soft-deleted or gone). Directly callable (tests); production goes through the
 *  memoized `ensureOrphanSweep`. */
export async function sweepOrphanedLeaderboardRows(): Promise<void> {
  const live = await prisma.character.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });
  const liveIds = live.map((c) => c.id);
  await prisma.$transaction(async (tx) => {
    await tx.leaderboardEntry.deleteMany({ where: { characterId: { notIn: liveIds } } });
    await tx.bossRecord.deleteMany({ where: { characterId: { notIn: liveIds } } });
  });
}

/** Run the orphan sweep AT MOST ONCE per process (best-effort; a failure clears the
 *  latch so a later call retries). Awaited by the ingest so the backlog self-heals on
 *  the first save after a deploy — no cron, no module-init top-level await. */
function ensureOrphanSweep(): Promise<void> {
  if (!orphanSweepDone) {
    orphanSweepDone = sweepOrphanedLeaderboardRows().catch((err) => {
      console.warn("[hof] orphan sweep failed:", err);
      orphanSweepDone = null; // allow a retry next call
    });
  }
  return orphanSweepDone;
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
  // Self-heal the boards' backlog of soft-deleted characters, once per process.
  await ensureOrphanSweep();

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

  const { firstToCap, newlyRankOne } = await prisma.$transaction(async (tx) => {
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

    // rank-1 overtake (M7.95): capture who leads the POWER board BEFORE this write
    // (non-suspect only, matching the board reads). Compared against the post-write
    // leader below to detect a genuine overtake. One indexed query.
    const prevTop = await tx.leaderboardEntry.findFirst({
      where: { suspect: false },
      orderBy: POWER_TOP_ORDER,
      select: { characterId: true },
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
    const capJustStamped = levelCapAt === null && level >= CONFIG.leveling.levelCap;
    if (capJustStamped) {
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

    // rank-1 overtake decision (M7.95): who leads the POWER board AFTER this write?
    // (this tx sees its own upsert). A NEWLY-#1 = I am now top AND I was NOT top
    // before (prevTop), AND there WAS a prior different leader (a genuine overtake,
    // not the first-ever entry on an empty board), AND I am not suspect.
    const newTop = await tx.leaderboardEntry.findFirst({
      where: { suspect: false },
      orderBy: POWER_TOP_ORDER,
      select: { characterId: true },
    });
    const wasTop = prevTop?.characterId === characterId;
    const newlyRankOne =
      !suspect && newTop?.characterId === characterId && prevTop != null && !wasTop;

    return { firstToCap: capJustStamped && !suspect, newlyRankOne };
  });

  // Best-effort server-wide announcements — AFTER the projection commits, so a
  // singleton collision / feed error can never roll the projection back.
  if (firstToCap) {
    await emitLevelCapAnnouncement(characterId, character.name, CONFIG.leveling.levelCap, now);
  }
  if (newlyRankOne) {
    await emitRankOneAnnouncement(characterId, character.name, now);
  }
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
