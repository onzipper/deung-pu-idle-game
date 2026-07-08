import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * HOF seasonal rewards — trust-boundary unit tests. Prisma is mocked (no DB) the same
 * way the rest of the server layer is tested. We exercise: the Asia/Bangkok month-key /
 * cutoff math, lazy finalize (happy / idempotent / concurrent-guard / short-board /
 * deleted-char skip), title derivation (latest season only — previous expires), the
 * fortifier claim (idempotent, wrong-owner, online-rank-1 has NO fortifier), and the
 * display-title validation.
 */

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    hofSeason: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    hofAward: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    leaderboardEntry: { findMany: vi.fn() },
    character: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    itemInstance: { create: vi.fn() },
    itemEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import { Prisma } from "@prisma/client";
import {
  currentMonthKey,
  previousMonthKey,
  titleId,
  ensureSeasonFinalized,
  readRewards,
  claimAward,
  setDisplayTitle,
  titlesForCharacters,
  _resetFinalizedCache,
} from "@/server/hofSeason";

const ME = "user_m";
const CHAR = "char_m";

function p2002() {
  return new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "6",
    meta: { target: ["month"] },
  });
}

function entry(characterId: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    characterId,
    userId: `u_${characterId}`,
    charName: `N_${characterId}`,
    cls: "swordsman",
    level: 90,
    power: 5000,
    goldEarned: BigInt(1_000_000),
    onlineSeconds: 3600,
    ...over,
  };
}

function fortifierRow(templateId: string) {
  return {
    id: "fort_1",
    templateId,
    equippedSlot: null,
    origin: "hof",
    acquiredAt: new Date("2026-08-01T00:00:00Z"),
    refineLevel: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetFinalizedCache();
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => unknown) =>
    fn(mockPrisma),
  );
});

// ── Month-key / Bangkok cutoff math ──────────────────────────────────────────

describe("month-key math (Asia/Bangkok UTC+7)", () => {
  it("rolls the month at Bangkok midnight, not UTC midnight", () => {
    // 2026-07-31T18:00Z is already 2026-08-01T01:00 in Bangkok.
    const afterCut = new Date("2026-07-31T18:00:00Z");
    expect(currentMonthKey(afterCut)).toBe("2026-08");
    expect(previousMonthKey(afterCut)).toBe("2026-07");
    // 2026-07-31T16:00Z is still 2026-07-31T23:00 Bangkok (same month).
    const beforeCut = new Date("2026-07-31T16:00:00Z");
    expect(currentMonthKey(beforeCut)).toBe("2026-07");
    expect(previousMonthKey(beforeCut)).toBe("2026-06");
  });

  it("handles the January year rollover", () => {
    const jan = new Date("2026-01-05T00:00:00Z"); // Bangkok Jan 5
    expect(currentMonthKey(jan)).toBe("2026-01");
    expect(previousMonthKey(jan)).toBe("2025-12");
  });

  it("builds structural title ids", () => {
    expect(titleId("level", 1)).toBe("level.1");
    expect(titleId("online", 3)).toBe("online.3");
  });
});

// ── Lazy finalize ─────────────────────────────────────────────────────────────

describe("ensureSeasonFinalized", () => {
  const NOW = new Date("2026-08-01T05:00:00Z"); // finalizes "2026-07"

  it("snapshots top-3 of each reward board with the right fortifier flags", async () => {
    mockPrisma.hofSeason.findUnique.mockResolvedValue(null);
    mockPrisma.leaderboardEntry.findMany.mockResolvedValue([entry("a"), entry("b"), entry("c")]);
    mockPrisma.character.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);
    mockPrisma.hofSeason.create.mockResolvedValue({ id: "season_1" });
    mockPrisma.hofAward.create.mockResolvedValue({});

    await ensureSeasonFinalized(NOW);

    expect(mockPrisma.hofSeason.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ month: "2026-07" }) }),
    );
    // 4 boards × 3 ranks = 12 awards.
    expect(mockPrisma.hofAward.create).toHaveBeenCalledTimes(12);
    const created = mockPrisma.hofAward.create.mock.calls.map((c) => c[0].data);
    const levelR1 = created.find((d) => d.board === "level" && d.rank === 1);
    const onlineR1 = created.find((d) => d.board === "online" && d.rank === 1);
    const goldR1 = created.find((d) => d.board === "gold" && d.rank === 1);
    expect(levelR1.fortifier).toBe(true);
    expect(goldR1.fortifier).toBe(true);
    expect(onlineR1.fortifier).toBe(false); // online rank-1 = title only
    // gold snapshots the BigInt metric; level snapshots the level.
    expect(goldR1.value).toBe(BigInt(1_000_000));
    expect(levelR1.value).toBe(BigInt(90));
  });

  it("is a no-op when the month is already finalized (no create)", async () => {
    mockPrisma.hofSeason.findUnique.mockResolvedValue({ id: "existing" });
    await ensureSeasonFinalized(NOW);
    expect(mockPrisma.hofSeason.create).not.toHaveBeenCalled();
    expect(mockPrisma.hofAward.create).not.toHaveBeenCalled();
  });

  it("swallows the concurrent-finalize P2002 (one winner)", async () => {
    mockPrisma.hofSeason.findUnique.mockResolvedValue(null);
    mockPrisma.leaderboardEntry.findMany.mockResolvedValue([entry("a")]);
    mockPrisma.character.findMany.mockResolvedValue([{ id: "a" }]);
    mockPrisma.hofSeason.create.mockRejectedValue(p2002()); // lost the race
    await expect(ensureSeasonFinalized(NOW)).resolves.toBeUndefined();
  });

  it("awards only what exists on a short board (fewer than 3 eligible)", async () => {
    mockPrisma.hofSeason.findUnique.mockResolvedValue(null);
    mockPrisma.leaderboardEntry.findMany.mockResolvedValue([entry("a")]); // one entrant
    mockPrisma.character.findMany.mockResolvedValue([{ id: "a" }]);
    mockPrisma.hofSeason.create.mockResolvedValue({ id: "season_1" });
    mockPrisma.hofAward.create.mockResolvedValue({});
    await ensureSeasonFinalized(NOW);
    // 4 boards × 1 rank each.
    expect(mockPrisma.hofAward.create).toHaveBeenCalledTimes(4);
    const created = mockPrisma.hofAward.create.mock.calls.map((c) => c[0].data);
    expect(created.every((d) => d.rank === 1)).toBe(true);
  });

  it("skips a deleted character at finalize (the next rank moves up)", async () => {
    mockPrisma.hofSeason.findUnique.mockResolvedValue(null);
    mockPrisma.leaderboardEntry.findMany.mockResolvedValue([entry("a"), entry("b"), entry("c")]);
    // 'a' is soft-deleted → absent from the live set.
    mockPrisma.character.findMany.mockResolvedValue([{ id: "b" }, { id: "c" }]);
    mockPrisma.hofSeason.create.mockResolvedValue({ id: "season_1" });
    mockPrisma.hofAward.create.mockResolvedValue({});
    await ensureSeasonFinalized(NOW);
    const created = mockPrisma.hofAward.create.mock.calls.map((c) => c[0].data);
    expect(created.some((d) => d.characterId === "a")).toBe(false);
    const levelR1 = created.find((d) => d.board === "level" && d.rank === 1);
    const levelR2 = created.find((d) => d.board === "level" && d.rank === 2);
    expect(levelR1.characterId).toBe("b"); // b promoted to rank 1
    expect(levelR2.characterId).toBe("c");
  });
});

// ── Title derivation (latest season only) ─────────────────────────────────────

describe("readRewards (title derivation)", () => {
  const NOW = new Date("2026-08-05T05:00:00Z");

  function seasonAlreadyFinalized() {
    // Make the lazy finalize a no-op (month already present).
    mockPrisma.hofSeason.findUnique.mockResolvedValue({ id: "prev" });
  }

  it("derives champions + my titles from the LATEST season only", async () => {
    seasonAlreadyFinalized();
    mockPrisma.hofSeason.findFirst.mockResolvedValue({ id: "s_latest", month: "2026-07" });
    mockPrisma.hofAward.findMany.mockResolvedValue([
      { id: "aw1", board: "level", rank: 1, characterId: CHAR, charName: "Me", cls: "mage", value: BigInt(90), fortifier: true, claimedAt: null },
      { id: "aw2", board: "power", rank: 2, characterId: "other", charName: "Other", cls: "archer", value: BigInt(4000), fortifier: false, claimedAt: null },
    ]);
    mockPrisma.character.findUnique.mockResolvedValue({ uiConfig: { displayTitle: "level.1" } });

    const res = await readRewards(CHAR, null, NOW);

    // latest-season lookup ordered by month desc (previous season's titles expire).
    expect(mockPrisma.hofSeason.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { month: "desc" } }),
    );
    expect(res.season).toBe("2026-07");
    expect(res.champions.level).toEqual([
      { rank: 1, charName: "Me", cls: "mage", value: 90, titleId: "level.1" },
    ]);
    expect(res.me?.titles).toEqual([
      { titleId: "level.1", board: "level", rank: 1, charName: "Me" },
    ]);
    // Chosen title is surfaced because the character holds it.
    expect(res.me?.displayTitle).toBe("level.1");
    // The rank-1 fortifier award is listed as unclaimed.
    expect(res.me?.unclaimedAwards).toEqual([{ awardId: "aw1", board: "level", titleId: "level.1" }]);
  });

  it("hides a chosen display title the character does NOT hold", async () => {
    seasonAlreadyFinalized();
    mockPrisma.hofSeason.findFirst.mockResolvedValue({ id: "s_latest", month: "2026-07" });
    mockPrisma.hofAward.findMany.mockResolvedValue([]); // I hold nothing this season
    mockPrisma.character.findUnique.mockResolvedValue({ uiConfig: { displayTitle: "power.1" } });
    const res = await readRewards(CHAR, null, NOW);
    expect(res.me?.displayTitle).toBeNull();
  });

  it("returns per-character permanent badges when a characterId is supplied", async () => {
    seasonAlreadyFinalized();
    mockPrisma.hofSeason.findFirst.mockResolvedValue({ id: "s_latest", month: "2026-07" });
    mockPrisma.hofAward.findMany
      .mockResolvedValueOnce([]) // the season-awards read (champions/me)
      .mockResolvedValueOnce([
        { board: "level", rank: 1, charName: "Me", season: { month: "2026-06" } },
        { board: "online", rank: 1, charName: "Me", season: { month: "2026-05" } },
      ]); // the badge-history read
    mockPrisma.character.findUnique.mockResolvedValue({ uiConfig: null });
    const res = await readRewards(CHAR, CHAR, NOW);
    expect(res.badges).toEqual([
      { titleId: "level.1", board: "level", rank: 1, month: "2026-06", charName: "Me" },
      { titleId: "online.1", board: "online", rank: 1, month: "2026-05", charName: "Me" },
    ]);
  });
});

// ── Fortifier claim ───────────────────────────────────────────────────────────

describe("claimAward", () => {
  const NOW = new Date("2026-08-02T00:00:00Z");

  function award(over: Partial<Record<string, unknown>> = {}) {
    return {
      userId: ME,
      characterId: CHAR,
      board: "level",
      fortifier: true,
      claimedAt: null,
      season: { month: "2026-07" },
      ...over,
    };
  }

  it("mints a fortifier once via the claimedAt compare-and-set", async () => {
    mockPrisma.hofAward.findUnique.mockResolvedValue(award());
    mockPrisma.character.findFirst.mockResolvedValue({ id: CHAR }); // owner+live
    mockPrisma.hofAward.updateMany.mockResolvedValue({ count: 1 }); // won the CAS
    mockPrisma.itemInstance.create.mockResolvedValue(fortifierRow("fort_weapon"));
    mockPrisma.itemEvent.create.mockResolvedValue({});

    const r = await claimAward(ME, "aw1", { now: NOW, roll: () => 0.2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.item.templateId).toBe("fort_weapon");
      expect(r.item.kind).toBe("fortifier");
    }
    expect(mockPrisma.hofAward.updateMany).toHaveBeenCalledWith({
      where: { id: "aw1", claimedAt: null },
      data: { claimedAt: NOW },
    });
    expect(mockPrisma.itemInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ origin: "hof", templateId: "fort_weapon" }) }),
    );
  });

  it("returns already_claimed when the CAS loses (count 0)", async () => {
    mockPrisma.hofAward.findUnique.mockResolvedValue(award());
    mockPrisma.character.findFirst.mockResolvedValue({ id: CHAR });
    mockPrisma.hofAward.updateMany.mockResolvedValue({ count: 0 }); // already flipped
    const r = await claimAward(ME, "aw1", { now: NOW, roll: () => 0.2 });
    expect(r).toEqual({ ok: false, reason: "already_claimed" });
    expect(mockPrisma.itemInstance.create).not.toHaveBeenCalled();
  });

  it("returns already_claimed when the award is already stamped (pre-tx)", async () => {
    mockPrisma.hofAward.findUnique.mockResolvedValue(award({ claimedAt: NOW }));
    const r = await claimAward(ME, "aw1", { now: NOW, roll: () => 0.2 });
    expect(r).toEqual({ ok: false, reason: "already_claimed" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a foreign owner (not_owned, no mint)", async () => {
    mockPrisma.hofAward.findUnique.mockResolvedValue(award({ userId: "someone_else" }));
    const r = await claimAward(ME, "aw1", { now: NOW, roll: () => 0.2 });
    expect(r).toEqual({ ok: false, reason: "not_owned" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an unknown award (not_owned)", async () => {
    mockPrisma.hofAward.findUnique.mockResolvedValue(null);
    const r = await claimAward(ME, "aw_missing", { now: NOW, roll: () => 0.2 });
    expect(r).toEqual({ ok: false, reason: "not_owned" });
  });

  it("gives an online-board rank-1 NO fortifier (title only → no_reward)", async () => {
    mockPrisma.hofAward.findUnique.mockResolvedValue(award({ board: "online", fortifier: false }));
    const r = await claimAward(ME, "aw1", { now: NOW, roll: () => 0.2 });
    expect(r).toEqual({ ok: false, reason: "no_reward" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a deleted winning character (not_owned)", async () => {
    mockPrisma.hofAward.findUnique.mockResolvedValue(award());
    mockPrisma.character.findFirst.mockResolvedValue(null); // character gone
    const r = await claimAward(ME, "aw1", { now: NOW, roll: () => 0.2 });
    expect(r).toEqual({ ok: false, reason: "not_owned" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("mints an armor fortifier on a high roll", async () => {
    mockPrisma.hofAward.findUnique.mockResolvedValue(award());
    mockPrisma.character.findFirst.mockResolvedValue({ id: CHAR });
    mockPrisma.hofAward.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.itemInstance.create.mockResolvedValue(fortifierRow("fort_armor"));
    mockPrisma.itemEvent.create.mockResolvedValue({});
    const r = await claimAward(ME, "aw1", { now: NOW, roll: () => 0.8 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.item.templateId).toBe("fort_armor");
  });
});

// ── Display-title validation ──────────────────────────────────────────────────

describe("setDisplayTitle", () => {
  it("rejects when there is no active character", async () => {
    const r = await setDisplayTitle(null, "level.1");
    expect(r).toEqual({ ok: false, code: "no_character" });
  });

  it("accepts a title the character actually holds this season", async () => {
    mockPrisma.hofSeason.findFirst.mockResolvedValue({ id: "s1" });
    mockPrisma.hofAward.findMany.mockResolvedValue([{ board: "level", rank: 1 }]);
    mockPrisma.character.findUnique.mockResolvedValue({ uiConfig: { autoCast: true } });
    mockPrisma.character.update.mockResolvedValue({});
    const r = await setDisplayTitle(CHAR, "level.1");
    expect(r).toEqual({ ok: true, displayTitle: "level.1" });
    // Merges into the existing uiConfig (preserves other prefs).
    expect(mockPrisma.character.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { uiConfig: { autoCast: true, displayTitle: "level.1" } },
      }),
    );
  });

  it("rejects a title the character does NOT hold", async () => {
    mockPrisma.hofSeason.findFirst.mockResolvedValue({ id: "s1" });
    mockPrisma.hofAward.findMany.mockResolvedValue([]); // holds nothing
    const r = await setDisplayTitle(CHAR, "power.1");
    expect(r).toEqual({ ok: false, code: "invalid_title" });
    expect(mockPrisma.character.update).not.toHaveBeenCalled();
  });

  it("clears the title with null (no held-title check needed)", async () => {
    mockPrisma.character.findUnique.mockResolvedValue({ uiConfig: { displayTitle: "level.1" } });
    mockPrisma.character.update.mockResolvedValue({});
    const r = await setDisplayTitle(CHAR, null);
    expect(r).toEqual({ ok: true, displayTitle: null });
    expect(mockPrisma.hofAward.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.character.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { uiConfig: { displayTitle: null } } }),
    );
  });
});

// ── Other-player title lookup (rides the friends poll) ────────────────────────

describe("titlesForCharacters", () => {
  it("returns an empty map for no ids (no query)", async () => {
    const m = await titlesForCharacters([]);
    expect(m.size).toBe(0);
    expect(mockPrisma.hofSeason.findFirst).not.toHaveBeenCalled();
  });

  it("returns an empty map when no season is finalized", async () => {
    mockPrisma.hofSeason.findFirst.mockResolvedValue(null);
    const m = await titlesForCharacters(["c1"]);
    expect(m.size).toBe(0);
  });

  it("maps titles + a gold-aura champion flag (online rank-1 is NOT champion)", async () => {
    mockPrisma.hofSeason.findFirst.mockResolvedValue({ id: "s1" });
    mockPrisma.hofAward.findMany.mockResolvedValue([
      { characterId: "c1", board: "power", rank: 1 },
      { characterId: "c2", board: "online", rank: 1 },
    ]);
    const m = await titlesForCharacters(["c1", "c2"]);
    expect(m.get("c1")).toEqual({ titleIds: ["power.1"], champion: true });
    expect(m.get("c2")).toEqual({ titleIds: ["online.1"], champion: false });
  });
});
