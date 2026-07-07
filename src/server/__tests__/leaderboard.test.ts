import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * M7.95 Hall of Fame trust-boundary tests. Prisma is mocked (no DB) — same pattern
 * as items.test.ts. We exercise the server-authority rules the ranked boards rest
 * on: the boss-time plausibility floor + server-stamped `at`, the onlineSeconds AFK
 * accumulator, first-to-cap `levelCapAt` stamping, suspect preservation, and the
 * frozen query contract + board mapping. Pure helpers are tested directly.
 */

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    character: { findUnique: vi.fn(), findMany: vi.fn() },
    itemInstance: { findMany: vi.fn() },
    leaderboardEntry: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    bossRecord: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    refineAnnouncement: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import {
  bossTimeFloor,
  BOSS_TIME_FLOOR,
  mergeBossBest,
  hofQuerySchema,
  upsertLeaderboardEntry,
  sweepOrphanedLeaderboardRows,
  readBoard,
  ONLINE_TICK_MAX_SECONDS,
} from "@/server/leaderboard";
import { SAVE_VERSION, CONFIG, type SaveData } from "@/engine";

const CHAR = "char_1";
const USER = "user_1";
const NOW = new Date("2026-07-07T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => unknown) =>
    fn(mockPrisma),
  );
  // Announcement + overtake defaults: no prior board leader, no throttle hit, no
  // orphan backlog (these are exercised explicitly in their own describe blocks).
  mockPrisma.leaderboardEntry.findFirst.mockResolvedValue(null);
  mockPrisma.leaderboardEntry.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.bossRecord.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.character.findMany.mockResolvedValue([]);
  mockPrisma.refineAnnouncement.findFirst.mockResolvedValue(null);
  mockPrisma.refineAnnouncement.create.mockResolvedValue({});
});

// A minimal migrated SaveData (only the fields the ingest reads matter here).
function saveData(over: Partial<SaveData> = {}): SaveData {
  return {
    version: SAVE_VERSION,
    stage: 20,
    gold: 100,
    goldEarned: 5_000,
    bossBest: {},
    levelCapAt: null,
    hero: {
      cls: "mage",
      level: 50,
      xp: 0,
      tier: 2,
      statPoints: 0,
      stats: { str: 5, dex: 5, int: 80, vit: 20 },
      mana: 100,
      autoSlots: [null, null, null],
      quest: null,
    },
    // Unused-by-ingest fields (present for shape completeness).
    location: { mapId: "m1", zoneIdx: 0 },
    unlockedZones: {},
    lastFarmZone: { mapId: "m1", zoneIdx: 0 },
    consumables: { hpPotion: 0, manaPotion: 0, returnScroll: 0 },
    bot: {
      enabled: false,
      sellTripEnabled: false,
      hpPotionTarget: 0,
      mpPotionTarget: 0,
      scrollReserve: 0,
      goldReserve: 0,
    },
    autoHunt: true,
    zoneKills: {},
    equipped: { weapon: null, armor: null, refine: { weapon: 0, armor: 0 } },
    lootSalt: 0,
    lootCounter: 0,
    materials: 0,
    lastSeen: 0,
    ...over,
  } as SaveData;
}

describe("bossTimeFloor", () => {
  it("is 0.5 × the fastest recorded boss-iso clear for s20/s25/s30", () => {
    expect(BOSS_TIME_FLOOR[20]).toBeCloseTo(3.5);
    expect(BOSS_TIME_FLOOR[25]).toBeCloseTo(3.85);
    expect(BOSS_TIME_FLOOR[30]).toBeCloseTo(7.25);
  });
  it("has conservative early-boss floors and a non-zero fallback", () => {
    expect(bossTimeFloor(5)).toBe(1.0);
    expect(bossTimeFloor(10)).toBe(1.5);
    expect(bossTimeFloor(15)).toBe(2.5);
    expect(bossTimeFloor(999)).toBeGreaterThan(0); // unknown stage still rejects 0/neg
  });
});

describe("mergeBossBest", () => {
  it("server-stamps a NEW best and ignores the client's `at`", () => {
    const out = mergeBossBest({}, { 20: { seconds: 8.0, at: 999 } }, CHAR, NOW);
    expect(out[20].seconds).toBe(8.0);
    expect(out[20].at).toBe(NOW.toISOString()); // NOT the client 999
  });

  it("drops a sub-floor (implausible) clear and keeps any prior best", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const prev = { 20: { seconds: 9.0, at: "2026-01-01T00:00:00.000Z" } };
    const out = mergeBossBest(prev, { 20: { seconds: 1.0, at: 0 } }, CHAR, NOW); // 1.0 < floor 3.5
    expect(out[20]).toEqual(prev[20]); // unchanged
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps the existing best (and its stamp) when the incoming is not faster", () => {
    const prev = { 20: { seconds: 5.0, at: "2026-01-01T00:00:00.000Z" } };
    const out = mergeBossBest(prev, { 20: { seconds: 6.0, at: 0 } }, CHAR, NOW);
    expect(out[20]).toEqual(prev[20]);
  });

  it("replaces + re-stamps only when strictly faster", () => {
    const prev = { 20: { seconds: 5.0, at: "2026-01-01T00:00:00.000Z" } };
    const out = mergeBossBest(prev, { 20: { seconds: 4.0, at: 0 } }, CHAR, NOW);
    expect(out[20]).toEqual({ seconds: 4.0, at: NOW.toISOString() });
  });
});

describe("hofQuerySchema (frozen query contract)", () => {
  it("defaults cls to all and accepts a plain entry board", () => {
    const r = hofQuerySchema.safeParse({ board: "level" });
    expect(r.success && r.data.cls).toBe("all");
  });
  it("requires bossStage when board=boss", () => {
    expect(hofQuerySchema.safeParse({ board: "boss" }).success).toBe(false);
    const ok = hofQuerySchema.safeParse({ board: "boss", bossStage: "20" });
    expect(ok.success && ok.data.bossStage).toBe(20);
  });
  it("rejects an unknown board / cls / bossStage", () => {
    expect(hofQuerySchema.safeParse({ board: "kills" }).success).toBe(false);
    expect(hofQuerySchema.safeParse({ board: "power", cls: "ninja" }).success).toBe(false);
    expect(hofQuerySchema.safeParse({ board: "boss", bossStage: "7" }).success).toBe(false);
  });
});

describe("upsertLeaderboardEntry — server-derived, server-stamped", () => {
  beforeEach(() => {
    // createdAt far in the past → generous playtime, so a normal save is plausible
    // (the anti-cheat re-derive only flags physically-impossible progress).
    mockPrisma.character.findUnique.mockResolvedValue({
      name: "Alice",
      baseClass: "mage",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    mockPrisma.itemInstance.findMany.mockResolvedValue([]); // no gear
    mockPrisma.leaderboardEntry.upsert.mockResolvedValue({});
    mockPrisma.bossRecord.upsert.mockResolvedValue({});
  });

  it("derives power server-side (never a client number) and stamps a new boss best", async () => {
    mockPrisma.leaderboardEntry.findUnique.mockResolvedValue(null); // first save
    await upsertLeaderboardEntry(
      CHAR,
      USER,
      saveData({ bossBest: { 20: { seconds: 8.0, at: 0 } } }),
      NOW,
    );
    const args = mockPrisma.leaderboardEntry.upsert.mock.calls[0][0];
    expect(args.create.power).toBeGreaterThan(0); // combatPower over stats+gear
    expect(args.create.charName).toBe("Alice");
    expect(args.create.goldEarned).toBe(BigInt(5_000));
    // Boss projection was written with the server-stamped time.
    const bossArgs = mockPrisma.bossRecord.upsert.mock.calls[0][0];
    expect(bossArgs.create.seconds).toBe(8.0);
    expect(bossArgs.create.at).toEqual(NOW);
  });

  it("stamps levelCapAt only on the first save at/above the cap", async () => {
    mockPrisma.leaderboardEntry.findUnique.mockResolvedValue(null);
    await upsertLeaderboardEntry(
      CHAR,
      USER,
      saveData({ hero: { ...saveData().hero, level: CONFIG.leveling.levelCap } }),
      NOW,
    );
    expect(mockPrisma.leaderboardEntry.upsert.mock.calls[0][0].create.levelCapAt).toEqual(NOW);
  });

  it("does NOT stamp levelCapAt below the cap", async () => {
    mockPrisma.leaderboardEntry.findUnique.mockResolvedValue(null);
    await upsertLeaderboardEntry(CHAR, USER, saveData({ hero: { ...saveData().hero, level: 50 } }), NOW);
    expect(mockPrisma.leaderboardEntry.upsert.mock.calls[0][0].create.levelCapAt).toBeNull();
  });

  it("accumulates onlineSeconds for a plausible in-session gap only", async () => {
    const prevTick = new Date(NOW.getTime() - 30_000); // 30s ago -> counts
    mockPrisma.leaderboardEntry.findUnique.mockResolvedValue({
      levelCapAt: null,
      lastTickAt: prevTick,
      onlineSeconds: 100,
      bossBest: {},
      suspect: false,
    });
    await upsertLeaderboardEntry(CHAR, USER, saveData(), NOW);
    expect(mockPrisma.leaderboardEntry.upsert.mock.calls[0][0].update.onlineSeconds).toBe(130);
  });

  it("does NOT accumulate onlineSeconds across an offline gap (Δ > cap)", async () => {
    const prevTick = new Date(NOW.getTime() - (ONLINE_TICK_MAX_SECONDS + 60) * 1000);
    mockPrisma.leaderboardEntry.findUnique.mockResolvedValue({
      levelCapAt: null,
      lastTickAt: prevTick,
      onlineSeconds: 100,
      bossBest: {},
      suspect: false,
    });
    await upsertLeaderboardEntry(CHAR, USER, saveData(), NOW);
    expect(mockPrisma.leaderboardEntry.upsert.mock.calls[0][0].update.onlineSeconds).toBe(100);
  });

  it("re-derives suspect every save: an implausible level stays flagged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Character created 1h before NOW but already at the level cap → impossible.
    mockPrisma.character.findUnique.mockResolvedValue({
      name: "Cheater",
      baseClass: "mage",
      createdAt: new Date(NOW.getTime() - 3600 * 1000),
    });
    mockPrisma.leaderboardEntry.findUnique.mockResolvedValue({
      levelCapAt: null,
      lastTickAt: null,
      onlineSeconds: 0,
      bossBest: {},
      suspect: true,
    });
    await upsertLeaderboardEntry(
      CHAR,
      USER,
      saveData({ hero: { ...saveData().hero, level: CONFIG.leveling.levelCap } }),
      NOW,
    );
    // The re-derive wave OWNS suspect: it is written on every save (create + update).
    expect(mockPrisma.leaderboardEntry.upsert.mock.calls[0][0].update.suspect).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("recovers a clean character (suspect true → false) when back within bounds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockPrisma.leaderboardEntry.findUnique.mockResolvedValue({
      levelCapAt: null,
      lastTickAt: null,
      onlineSeconds: 0,
      bossBest: {},
      suspect: true, // was flagged before
    });
    // Plausible save (level 50, gold 5000, createdAt far in past via beforeEach).
    await upsertLeaderboardEntry(CHAR, USER, saveData(), NOW);
    expect(mockPrisma.leaderboardEntry.upsert.mock.calls[0][0].update.suspect).toBe(false);
    warn.mockRestore();
  });
});

describe("upsertLeaderboardEntry — server-wide announcements (M7.95)", () => {
  beforeEach(() => {
    mockPrisma.character.findUnique.mockResolvedValue({
      name: "Alice",
      baseClass: "mage",
      createdAt: new Date("2026-01-01T00:00:00.000Z"), // generous playtime → non-suspect
    });
    mockPrisma.itemInstance.findMany.mockResolvedValue([]);
    mockPrisma.leaderboardEntry.upsert.mockResolvedValue({});
    mockPrisma.bossRecord.upsert.mockResolvedValue({});
    mockPrisma.leaderboardEntry.findUnique.mockResolvedValue(null); // first save
  });

  const capHero = () => ({ ...saveData().hero, level: CONFIG.leveling.levelCap });

  // ── first-to-cap (levelCap singleton) ──────────────────────────────────────
  it("emits a levelCap singleton the first time a non-suspect char hits the cap", async () => {
    await upsertLeaderboardEntry(CHAR, USER, saveData({ hero: capHero() }), NOW);
    const create = mockPrisma.refineAnnouncement.create.mock.calls.find(
      (c) => c[0].data.kind === "levelCap",
    );
    expect(create).toBeDefined();
    expect(create![0].data).toMatchObject({
      kind: "levelCap",
      characterId: CHAR,
      charName: "Alice",
      refineLevel: CONFIG.leveling.levelCap, // carried into the "Lv.{level}" copy
      singletonKey: "levelCap", // @unique → exactly-once globally
    });
  });

  it("is exactly-once: a singleton P2002 collision is swallowed (save never throws)", async () => {
    mockPrisma.refineAnnouncement.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint"), { code: "P2002" }),
    );
    await expect(
      upsertLeaderboardEntry(CHAR, USER, saveData({ hero: capHero() }), NOW),
    ).resolves.toBeUndefined();
  });

  it("does NOT emit levelCap below the cap", async () => {
    await upsertLeaderboardEntry(CHAR, USER, saveData(), NOW); // level 50
    expect(
      mockPrisma.refineAnnouncement.create.mock.calls.some((c) => c[0].data.kind === "levelCap"),
    ).toBe(false);
  });

  it("does NOT emit levelCap for a suspect character at the cap", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockPrisma.character.findUnique.mockResolvedValue({
      name: "Cheater",
      baseClass: "mage",
      createdAt: new Date(NOW.getTime() - 3600 * 1000), // 1h old but at cap → impossible
    });
    await upsertLeaderboardEntry(CHAR, USER, saveData({ hero: capHero() }), NOW);
    expect(
      mockPrisma.refineAnnouncement.create.mock.calls.some((c) => c[0].data.kind === "levelCap"),
    ).toBe(false);
    warn.mockRestore();
  });

  it("does NOT re-emit levelCap when the cap was already stamped earlier", async () => {
    mockPrisma.leaderboardEntry.findUnique.mockResolvedValue({
      levelCapAt: new Date("2026-02-01T00:00:00.000Z"), // already at cap before
      lastTickAt: null,
      onlineSeconds: 0,
      bossBest: {},
      suspect: false,
    });
    await upsertLeaderboardEntry(CHAR, USER, saveData({ hero: capHero() }), NOW);
    expect(
      mockPrisma.refineAnnouncement.create.mock.calls.some((c) => c[0].data.kind === "levelCap"),
    ).toBe(false);
  });

  // ── rank-1 overtake (rankOne) ──────────────────────────────────────────────
  it("emits rankOne when a char NEWLY takes #1 on the power board", async () => {
    // prevTop = someone else, newTop (post-write) = me → genuine overtake.
    mockPrisma.leaderboardEntry.findFirst
      .mockResolvedValueOnce({ characterId: "other" }) // prevTop (before upsert)
      .mockResolvedValueOnce({ characterId: CHAR }); // newTop (after upsert)
    await upsertLeaderboardEntry(CHAR, USER, saveData(), NOW);
    const create = mockPrisma.refineAnnouncement.create.mock.calls.find(
      (c) => c[0].data.kind === "rankOne",
    );
    expect(create).toBeDefined();
    expect(create![0].data).toMatchObject({ kind: "rankOne", characterId: CHAR, charName: "Alice" });
  });

  it("throttles a rankOne re-take within the 24h window", async () => {
    mockPrisma.leaderboardEntry.findFirst
      .mockResolvedValueOnce({ characterId: "other" })
      .mockResolvedValueOnce({ characterId: CHAR });
    mockPrisma.refineAnnouncement.findFirst.mockResolvedValue({ id: "recent_rankone" }); // within 24h
    await upsertLeaderboardEntry(CHAR, USER, saveData(), NOW);
    expect(
      mockPrisma.refineAnnouncement.create.mock.calls.some((c) => c[0].data.kind === "rankOne"),
    ).toBe(false);
  });

  it("does NOT emit rankOne when the char was ALREADY #1 (no overtake)", async () => {
    mockPrisma.leaderboardEntry.findFirst
      .mockResolvedValueOnce({ characterId: CHAR }) // prevTop = me
      .mockResolvedValueOnce({ characterId: CHAR }); // newTop = me
    await upsertLeaderboardEntry(CHAR, USER, saveData(), NOW);
    expect(
      mockPrisma.refineAnnouncement.create.mock.calls.some((c) => c[0].data.kind === "rankOne"),
    ).toBe(false);
  });

  it("does NOT emit rankOne when the char did not reach #1", async () => {
    mockPrisma.leaderboardEntry.findFirst
      .mockResolvedValueOnce({ characterId: "other" }) // prevTop
      .mockResolvedValueOnce({ characterId: "other" }); // newTop still someone else
    await upsertLeaderboardEntry(CHAR, USER, saveData(), NOW);
    expect(
      mockPrisma.refineAnnouncement.create.mock.calls.some((c) => c[0].data.kind === "rankOne"),
    ).toBe(false);
  });
});

describe("sweepOrphanedLeaderboardRows (deleted characters leave the boards)", () => {
  it("deletes leaderboard + boss rows whose character is not LIVE", async () => {
    mockPrisma.character.findMany.mockResolvedValue([{ id: "live_1" }, { id: "live_2" }]);
    mockPrisma.leaderboardEntry.deleteMany.mockResolvedValue({ count: 3 });
    mockPrisma.bossRecord.deleteMany.mockResolvedValue({ count: 5 });

    await sweepOrphanedLeaderboardRows();

    expect(mockPrisma.leaderboardEntry.deleteMany).toHaveBeenCalledWith({
      where: { characterId: { notIn: ["live_1", "live_2"] } },
    });
    expect(mockPrisma.bossRecord.deleteMany).toHaveBeenCalledWith({
      where: { characterId: { notIn: ["live_1", "live_2"] } },
    });
  });
});

describe("readBoard", () => {
  it("maps an entry board (gold) with rank + BigInt→Number value", async () => {
    mockPrisma.leaderboardEntry.findMany.mockResolvedValue([
      {
        characterId: "c1",
        charName: "Alice",
        cls: "mage",
        tier: 3,
        level: 90,
        levelCapAt: NOW,
        power: 999,
        goldEarned: BigInt(1_000_000),
        onlineSeconds: 500,
        levelAt: NOW,
        powerAt: NOW,
        goldAt: NOW,
        onlineAt: NOW,
        profile: { loadout: { weapon: "w1", armor: null }, refineLevels: { weapon: 9, armor: 0 } },
        suspect: false,
      },
    ]);
    // me: caller's own entry + rank counts.
    mockPrisma.leaderboardEntry.findUnique.mockResolvedValue({
      characterId: "cMe",
      charName: "Me",
      cls: "archer",
      tier: 2,
      level: 40,
      levelCapAt: null,
      power: 50,
      goldEarned: BigInt(200),
      onlineSeconds: 10,
      levelAt: NOW,
      powerAt: NOW,
      goldAt: NOW,
      onlineAt: NOW,
      profile: {},
      suspect: false,
    });
    mockPrisma.leaderboardEntry.count.mockResolvedValue(3); // 3 richer -> rank 4

    const res = await readBoard({ board: "gold", cls: "all" }, "cMe");
    expect(res.top[0]).toMatchObject({
      rank: 1,
      charName: "Alice",
      value: 1_000_000,
      profile: { prestigeTier: 9 },
    });
    expect(res.top[0].at).toBe(NOW.toISOString());
    expect(res.me).toEqual({ rank: 4, value: 200 });
  });

  it("maps the boss board (seconds asc) and joins profiles for the top ids", async () => {
    mockPrisma.bossRecord.findMany.mockResolvedValue([
      { characterId: "c1", charName: "Alice", cls: "mage", tier: 3, level: 90, seconds: 7.0, at: NOW },
    ]);
    mockPrisma.leaderboardEntry.findMany.mockResolvedValue([
      { characterId: "c1", profile: { loadout: { weapon: "w1", armor: "a1" }, refineLevels: { weapon: 10, armor: 8 } } },
    ]);
    mockPrisma.bossRecord.findUnique.mockResolvedValue({ seconds: 12.0, cls: "mage", suspect: false });
    mockPrisma.bossRecord.count.mockResolvedValue(5); // 5 faster -> rank 6

    const res = await readBoard({ board: "boss", bossStage: 20, cls: "all" }, "cMe");
    expect(res.top[0]).toMatchObject({ rank: 1, value: 7.0, profile: { prestigeTier: 10 } });
    expect(res.top[0].at).toBe(NOW.toISOString());
    expect(res.me).toEqual({ rank: 6, value: 12.0 });
  });

  it("returns me:null when the caller has no character", async () => {
    mockPrisma.leaderboardEntry.findMany.mockResolvedValue([]);
    const res = await readBoard({ board: "power", cls: "all" }, null);
    expect(res.me).toBeNull();
    expect(res.top).toEqual([]);
  });
});
