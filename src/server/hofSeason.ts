/**
 * HOF SEASONAL REWARDS — server-authoritative season finalize + reads + claim.
 * (owner-approved design: docs/hof-rewards-design.md.)
 *
 * SEASONS are monthly, cut at Thai (Asia/Bangkok, UTC+7) midnight end-of-month —
 * the SAME timezone axis the dailies use (`DAILY_TZ_OFFSET_SECONDS`). There is NO
 * cron in this project, so finalize is LAZY: the first HOF-related request after a
 * cutoff triggers `ensureSeasonFinalized`, which snapshots the just-ended month's
 * top-3 of the 4 REWARD boards (level / power / gold / online — boss-time is
 * excluded from rewards v1) into `HofAward` rows, inside a tx guarded by the unique
 * `HofSeason.month` row (double-finalize = P2002 no-op; concurrent = one winner) —
 * the DailyClaim / WorldBossClaim idempotency pattern.
 *
 * Trust model (identical to the rest of the server layer): every ranked value is the
 * ALREADY server-derived, anti-cheat-filtered `LeaderboardEntry` projection — suspect
 * rows are absent from the boards and therefore never win. Deleted characters are
 * skipped at finalize (the next rank moves up). The board ordering MIRRORS the HOF
 * panel's (`entryOrderBy` in leaderboard.ts) so a season snapshot matches what players
 * saw ranked.
 *
 * TITLES are NEVER persisted separately: they derive from the LATEST finalized
 * season's awards (so last season's titles auto-expire). Title ids are STRUCTURAL —
 * `${board}.${rank}` (e.g. "level.1") — the UI wave maps them to the Thai strings.
 * The rank-1 fortifier is minted through the SAME pipeline as the world-boss claim,
 * guarded by a compare-and-set on `HofAward.claimedAt` (claim at most once).
 */

import { Prisma } from "@prisma/client";
import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { DAILY_TZ_OFFSET_SECONDS } from "@/server/dailyQuests";
import { pickFortifier } from "@/server/worldBoss";
import { getOwnedLiveCharacter } from "@/server/characters";
import { INSTANCE_SELECT, toItemDTO, type ItemInstanceDTO } from "@/server/items";

// ── Reward boards (a strict subset of the HOF boards — boss-time excluded) ─────

export const REWARD_BOARDS = ["level", "power", "gold", "online"] as const;
export type RewardBoard = (typeof REWARD_BOARDS)[number];

/** Boards whose rank-1 award carries a claimable "แกร่ง" fortifier (NOT online). */
const FORTIFIER_BOARDS = new Set<RewardBoard>(["level", "power", "gold"]);

/** The structural title id for a (board, rank) slot — the UI localizes it. */
export function titleId(board: string, rank: number): string {
  return `${board}.${rank}`;
}

// ── Asia/Bangkok month-key math (reuses the dailies' UTC+7 offset) ─────────────

/** The Bangkok wall-clock calendar (year, 0-based month) for an instant. Shifting
 *  the epoch by +7h then reading UTC components yields the Bangkok civil date. */
function bangkokYearMonth(now: Date): { year: number; month0: number } {
  const shifted = new Date(now.getTime() + DAILY_TZ_OFFSET_SECONDS * 1000);
  return { year: shifted.getUTCFullYear(), month0: shifted.getUTCMonth() };
}

function formatMonthKey(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}`;
}

/** The month key ("YYYY-MM", Bangkok) of the season currently IN PROGRESS. */
export function currentMonthKey(now: Date): string {
  const { year, month0 } = bangkokYearMonth(now);
  return formatMonthKey(year, month0);
}

/** The month key of the season that most recently ENDED (the finalize target). */
export function previousMonthKey(now: Date): string {
  const { year, month0 } = bangkokYearMonth(now);
  return month0 === 0 ? formatMonthKey(year - 1, 11) : formatMonthKey(year, month0 - 1);
}

// ── Board snapshot (mirrors leaderboard.ts entryOrderBy) ───────────────────────

/** Board ranking order — MUST mirror `entryOrderBy` in leaderboard.ts so a season
 *  snapshot matches the live HOF panel the players saw. */
function orderForBoard(board: RewardBoard): Prisma.LeaderboardEntryOrderByWithRelationInput[] {
  switch (board) {
    case "level":
      return [{ level: "desc" }, { levelCapAt: "asc" }];
    case "power":
      return [{ power: "desc" }];
    case "gold":
      return [{ goldEarned: "desc" }];
    case "online":
      return [{ onlineSeconds: "desc" }];
  }
}

interface SnapshotEntry {
  characterId: string;
  userId: string;
  charName: string;
  cls: string;
  value: bigint;
}

const SNAP_SELECT = {
  characterId: true,
  userId: true,
  charName: true,
  cls: true,
  level: true,
  power: true,
  goldEarned: true,
  onlineSeconds: true,
} as const;

type SnapRow = Prisma.LeaderboardEntryGetPayload<{ select: typeof SNAP_SELECT }>;

function boardValue(r: SnapRow, board: RewardBoard): bigint {
  switch (board) {
    case "level":
      return BigInt(r.level);
    case "power":
      return BigInt(r.power);
    case "gold":
      return r.goldEarned;
    case "online":
      return BigInt(r.onlineSeconds);
  }
}

/**
 * The top-3 LIVE, non-suspect entries for a board. Reads a wider window (TOP_N) then
 * drops any character no longer live (soft-deleted → the next rank moves up), matching
 * the design's "deleted at finalize = skipped". Fewer than 3 eligible → award what
 * exists.
 */
async function top3ForBoard(board: RewardBoard): Promise<SnapshotEntry[]> {
  const rows = await prisma.leaderboardEntry.findMany({
    where: { suspect: false },
    orderBy: orderForBoard(board),
    take: 10, // headroom to survive deleted-char filtering below
    select: SNAP_SELECT,
  });
  if (rows.length === 0) return [];

  const live = await prisma.character.findMany({
    where: { id: { in: rows.map((r) => r.characterId) }, deletedAt: null },
    select: { id: true },
  });
  const liveIds = new Set(live.map((c) => c.id));

  return rows
    .filter((r) => liveIds.has(r.characterId))
    .slice(0, 3)
    .map((r) => ({
      characterId: r.characterId,
      userId: r.userId,
      charName: r.charName,
      cls: r.cls,
      value: boardValue(r, board),
    }));
}

// ── Lazy finalize ──────────────────────────────────────────────────────────────

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** In-process cache of month keys already known finalized — skips the DB probe on the
 *  hot read path after the first request of a process sees each season closed. */
const finalizedMonths = new Set<string>();

/**
 * Finalize the just-ended month if it has not been yet (LAZY, idempotent, concurrency-
 * safe). Snapshots the top-3 of each reward board into `HofAward` rows in ONE tx; the
 * unique `HofSeason.month` insert is the guard — a concurrent/duplicate finalize
 * collides on P2002 and is swallowed (single winner). Best-effort by the caller (a
 * finalize failure must never fail a HOF read).
 */
export async function ensureSeasonFinalized(now: Date = new Date()): Promise<void> {
  const month = previousMonthKey(now);
  if (finalizedMonths.has(month)) return;

  const existing = await prisma.hofSeason.findUnique({ where: { month }, select: { id: true } });
  if (existing) {
    finalizedMonths.add(month);
    return;
  }

  // Collect every reward board's snapshot (reads only) BEFORE opening the tx.
  const perBoard = await Promise.all(REWARD_BOARDS.map((b) => top3ForBoard(b)));

  try {
    await prisma.$transaction(async (tx) => {
      const season = await tx.hofSeason.create({
        data: { month, finalizedAt: now },
        select: { id: true },
      });
      for (let b = 0; b < REWARD_BOARDS.length; b++) {
        const board = REWARD_BOARDS[b];
        const entries = perBoard[b];
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          const rank = i + 1;
          await tx.hofAward.create({
            data: {
              seasonId: season.id,
              board,
              rank,
              characterId: e.characterId,
              userId: e.userId,
              charName: e.charName,
              cls: e.cls,
              value: e.value,
              fortifier: rank === 1 && FORTIFIER_BOARDS.has(board),
            },
          });
        }
      }
    });
    finalizedMonths.add(month);
  } catch (err) {
    if (isUniqueViolation(err)) {
      finalizedMonths.add(month); // another request/process finalized it — done
      return;
    }
    throw err;
  }
}

/** Test-only: clear the in-process finalized-month cache. */
export function _resetFinalizedCache(): void {
  finalizedMonths.clear();
}

// ── Reads (GET /api/hof/rewards + the friends-poll title lookup) ───────────────

export interface ChampionRow {
  rank: number;
  charName: string;
  cls: string;
  value: number;
  titleId: string;
}

export interface MyTitle {
  titleId: string;
  board: string;
  rank: number;
  charName: string;
}

export interface UnclaimedAward {
  awardId: string;
  board: string;
  titleId: string;
}

export interface BadgeRow {
  titleId: string;
  board: string;
  rank: number;
  month: string;
  charName: string;
}

export interface HofRewardsResponse {
  /** The latest finalized season's month key, or null (no season finalized yet). */
  season: string | null;
  /** Current champions per reward board (ranks 1-3), for the panel + town honor board. */
  champions: Record<RewardBoard, ChampionRow[]>;
  /** The active character's standing this season (null when no active character). */
  me: {
    titles: MyTitle[];
    displayTitle: string | null;
    unclaimedAwards: UnclaimedAward[];
  } | null;
  /** Per-character PERMANENT rank-1 badge history (all seasons) for the profile view —
   *  present only when `characterId` was supplied to the read. */
  badges: BadgeRow[] | null;
}

function emptyChampions(): Record<RewardBoard, ChampionRow[]> {
  return { level: [], power: [], gold: [], online: [] };
}

/** Read a character's chosen-display-title from its uiConfig (raw, unvalidated). */
function chosenTitleOf(uiConfig: unknown): string | null {
  if (uiConfig && typeof uiConfig === "object" && !Array.isArray(uiConfig)) {
    const v = (uiConfig as Record<string, unknown>).displayTitle;
    if (typeof v === "string") return v;
  }
  return null;
}

/**
 * The HOF rewards read model (GET /api/hof/rewards). Triggers a lazy finalize first,
 * then derives everything from the LATEST finalized season (so previous-season titles
 * expire). `meCharacterId` is the caller's active character (null → me:null); when
 * `badgeCharacterId` is given, the per-character permanent badge history is included.
 */
export async function readRewards(
  meCharacterId: string | null,
  badgeCharacterId: string | null,
  now: Date = new Date(),
): Promise<HofRewardsResponse> {
  await ensureSeasonFinalized(now);

  const season = await prisma.hofSeason.findFirst({
    orderBy: { month: "desc" },
    select: { id: true, month: true },
  });

  const champions = emptyChampions();
  let me: HofRewardsResponse["me"] = null;

  if (season) {
    const awards = await prisma.hofAward.findMany({
      where: { seasonId: season.id },
      orderBy: [{ board: "asc" }, { rank: "asc" }],
      select: {
        id: true,
        board: true,
        rank: true,
        characterId: true,
        charName: true,
        cls: true,
        value: true,
        fortifier: true,
        claimedAt: true,
      },
    });

    for (const a of awards) {
      if ((REWARD_BOARDS as readonly string[]).includes(a.board)) {
        champions[a.board as RewardBoard].push({
          rank: a.rank,
          charName: a.charName,
          cls: a.cls,
          value: Number(a.value),
          titleId: titleId(a.board, a.rank),
        });
      }
    }

    if (meCharacterId) {
      const mine = awards.filter((a) => a.characterId === meCharacterId);
      const titles: MyTitle[] = mine.map((a) => ({
        titleId: titleId(a.board, a.rank),
        board: a.board,
        rank: a.rank,
        charName: a.charName,
      }));
      const heldIds = new Set(titles.map((t) => t.titleId));
      const unclaimedAwards: UnclaimedAward[] = mine
        .filter((a) => a.fortifier && a.claimedAt === null)
        .map((a) => ({ awardId: a.id, board: a.board, titleId: titleId(a.board, a.rank) }));

      // Chosen display title — only surfaced when the character actually holds it.
      const charRow = await prisma.character.findUnique({
        where: { id: meCharacterId },
        select: { uiConfig: true },
      });
      const chosen = chosenTitleOf(charRow?.uiConfig);
      const displayTitle = chosen && heldIds.has(chosen) ? chosen : null;

      me = { titles, displayTitle, unclaimedAwards };
    }
  } else if (meCharacterId) {
    me = { titles: [], displayTitle: null, unclaimedAwards: [] };
  }

  let badges: BadgeRow[] | null = null;
  if (badgeCharacterId) {
    const rows = await prisma.hofAward.findMany({
      where: { characterId: badgeCharacterId, rank: 1 },
      orderBy: { createdAt: "desc" },
      select: { board: true, rank: true, charName: true, season: { select: { month: true } } },
    });
    badges = rows.map((r) => ({
      titleId: titleId(r.board, r.rank),
      board: r.board,
      rank: r.rank,
      month: r.season.month,
      charName: r.charName,
    }));
  }

  return { season: season?.month ?? null, champions, me, badges };
}

// ── Other-player titles (rides the friends poll — see src/server/friends.ts) ───

export interface CharTitleInfo {
  titleIds: string[];
  /** Holds a gold-aura title (rank-1 of level/power/gold — NOT online). */
  champion: boolean;
}

/**
 * The latest-season titles held by each of `charIds` — the payload the friends poll
 * folds into every friend/party-member row so the game client can render OTHER
 * players' chosen title + champion aura WITHOUT a new poll. Best-effort by the caller.
 */
export async function titlesForCharacters(charIds: string[]): Promise<Map<string, CharTitleInfo>> {
  const out = new Map<string, CharTitleInfo>();
  if (charIds.length === 0) return out;

  const season = await prisma.hofSeason.findFirst({
    orderBy: { month: "desc" },
    select: { id: true },
  });
  if (!season) return out;

  const awards = await prisma.hofAward.findMany({
    where: { seasonId: season.id, characterId: { in: charIds } },
    select: { characterId: true, board: true, rank: true },
  });
  for (const a of awards) {
    let e = out.get(a.characterId);
    if (!e) {
      e = { titleIds: [], champion: false };
      out.set(a.characterId, e);
    }
    e.titleIds.push(titleId(a.board, a.rank));
    if (a.rank === 1 && a.board !== "online") e.champion = true;
  }
  return out;
}

// ── Chosen display title (POST /api/hof/title) ─────────────────────────────────

export type SetTitleResult =
  | { ok: true; displayTitle: string | null }
  | { ok: false; code: "no_character" | "invalid_title" };

/**
 * Set (or clear, with `null`) the active character's chosen display title. The pick is
 * VALIDATED server-side against the titles the character actually holds THIS season (a
 * client cannot show a title it did not win). Persisted into the per-character
 * `uiConfig.displayTitle` (the existing cross-device preference sidecar).
 */
export async function setDisplayTitle(
  characterId: string | null,
  titleIdInput: string | null,
): Promise<SetTitleResult> {
  if (!characterId) return { ok: false, code: "no_character" };

  if (titleIdInput !== null) {
    const season = await prisma.hofSeason.findFirst({
      orderBy: { month: "desc" },
      select: { id: true },
    });
    const held = season
      ? await prisma.hofAward.findMany({
          where: { seasonId: season.id, characterId },
          select: { board: true, rank: true },
        })
      : [];
    const heldIds = new Set(held.map((a) => titleId(a.board, a.rank)));
    if (!heldIds.has(titleIdInput)) return { ok: false, code: "invalid_title" };
  }

  // Merge into the existing uiConfig JSON (preserve every other preference).
  const row = await prisma.character.findUnique({
    where: { id: characterId },
    select: { uiConfig: true },
  });
  const base =
    row?.uiConfig && typeof row.uiConfig === "object" && !Array.isArray(row.uiConfig)
      ? (row.uiConfig as Record<string, unknown>)
      : {};
  const merged: Record<string, unknown> = { ...base, displayTitle: titleIdInput };
  await prisma.character.update({
    where: { id: characterId },
    data: { uiConfig: merged as unknown as Prisma.InputJsonValue },
  });
  return { ok: true, displayTitle: titleIdInput };
}

// ── Fortifier claim (POST /api/hof/claim) ──────────────────────────────────────

/** Uniform [0,1) crypto roll (server-authoritative; same idiom as the world-boss/refine
 *  roll — outside the engine determinism rule). Injectable for tests. */
function cryptoRoll(): number {
  return randomInt(0, 1_000_000) / 1_000_000;
}

export type ClaimAwardResult =
  | { ok: true; item: ItemInstanceDTO }
  | { ok: false; reason: "not_owned" | "no_reward" | "already_claimed" };

/**
 * Claim the rank-1 fortifier entitlement of `awardId` as `userId`. Validates award
 * ownership + that the award actually carries a fortifier (online rank-1 does NOT),
 * then re-checks owner+liveness of the winning character (a deleted winner cannot mint).
 * Idempotency is a compare-and-set on `HofAward.claimedAt` inside the mint tx: the
 * FIRST claim flips null→now and mints; a retry finds count 0 → `already_claimed`.
 * Mirrors `claimWorldBoss` (same fortifier mint + minted ItemEvent anti-dupe recipe).
 */
export async function claimAward(
  userId: string,
  awardId: string,
  opts: { now?: Date; roll?: () => number } = {},
): Promise<ClaimAwardResult> {
  const now = opts.now ?? new Date();
  const roll = opts.roll ?? cryptoRoll;

  const award = await prisma.hofAward.findUnique({
    where: { id: awardId },
    select: {
      userId: true,
      characterId: true,
      board: true,
      fortifier: true,
      claimedAt: true,
      season: { select: { month: true } },
    },
  });
  // Unknown award or a foreign owner → not_owned (never leak existence).
  if (!award || award.userId !== userId) return { ok: false, reason: "not_owned" };
  // Online rank-1 / any non-fortifier award grants a title only.
  if (!award.fortifier) return { ok: false, reason: "no_reward" };
  if (award.claimedAt) return { ok: false, reason: "already_claimed" };

  // The winning character must still be live + owned to receive the mint.
  const owned = await getOwnedLiveCharacter(userId, award.characterId);
  if (!owned) return { ok: false, reason: "not_owned" };

  const templateId = pickFortifier(roll());

  return prisma.$transaction(async (tx) => {
    // Compare-and-set idempotency: only the transition null → now proceeds to mint.
    const set = await tx.hofAward.updateMany({
      where: { id: awardId, claimedAt: null },
      data: { claimedAt: now },
    });
    if (set.count === 0) return { ok: false as const, reason: "already_claimed" as const };

    const created = await tx.itemInstance.create({
      data: {
        ownerId: award.characterId,
        templateId,
        origin: "hof",
        sourceDetail: `hof:${award.season.month}:${award.board}`,
      },
      select: INSTANCE_SELECT,
    });
    await tx.itemEvent.create({
      data: {
        itemId: created.id,
        type: "minted",
        toCharacterId: award.characterId,
        meta: JSON.stringify({ origin: "hof", awardId, month: award.season.month, board: award.board, templateId }),
      },
    });

    const dto = toItemDTO(created);
    if (!dto) throw new Error("hof fortifier template missing"); // defensive (frozen ids)
    return { ok: true as const, item: dto };
  });
}
