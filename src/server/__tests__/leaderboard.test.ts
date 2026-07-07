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
    character: { findUnique: vi.fn() },
    itemInstance: { findMany: vi.fn() },
    leaderboardEntry: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
    },
    bossRecord: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
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
    mockPrisma.character.findUnique.mockResolvedValue({ name: "Alice", baseClass: "mage" });
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

  it("preserves an existing suspect verdict (ingest never clears it)", async () => {
    mockPrisma.leaderboardEntry.findUnique.mockResolvedValue({
      levelCapAt: null,
      lastTickAt: null,
      onlineSeconds: 0,
      bossBest: { 25: { seconds: 8.0, at: "2026-01-01T00:00:00.000Z" } },
      suspect: true,
    });
    await upsertLeaderboardEntry(CHAR, USER, saveData({ bossBest: { 25: { seconds: 8.0, at: 0 } } }), NOW);
    // LeaderboardEntry.update omits suspect (Prisma leaves it unchanged); the boss
    // projection mirrors the character's suspect flag.
    expect(mockPrisma.leaderboardEntry.upsert.mock.calls[0][0].update.suspect).toBeUndefined();
    expect(mockPrisma.bossRecord.upsert.mock.calls[0][0].update.suspect).toBe(true);
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
