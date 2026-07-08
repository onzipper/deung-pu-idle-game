import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Character CRUD trust-boundary tests (M5 Character Pivot). The Prisma layer is
 * mocked (no DB) the same way the rest of the server is unit-tested — we exercise
 * the app-level invariants Prisma can't enforce on the shared host: the ≤3-live
 * cap, global case-insensitive live-name uniqueness, strict name validation, and
 * owner/liveness gating on select + delete.
 */

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    character: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    leaderboardEntry: { deleteMany: vi.fn() },
    bossRecord: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import {
  computeNinjaUnlock,
  createCharacter,
  createCharacterSchema,
  deleteCharacter,
  getNinjaUnlock,
  getOwnedLiveCharacter,
  listCharacters,
  powerFromSave,
  MAX_LIVE_CHARACTERS,
  NINJA_UNLOCK_TIER,
  REQUIRE_NINJA_UNLOCK,
} from "@/server/characters";
import { CONFIG, emptyDailies } from "@/engine";

const USER = "user_owner";
const ROW = {
  id: "char_1",
  name: "Alice",
  baseClass: "archer",
  level: 3,
  power: 400,
  tier: 1,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Interactive transaction: invoke the callback with the mocked client as `tx`.
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => unknown) =>
    fn(mockPrisma),
  );
  mockPrisma.leaderboardEntry.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.bossRecord.deleteMany.mockResolvedValue({ count: 0 });
});

describe("createCharacterSchema — name/class validation", () => {
  it("accepts a valid Thai or EN alphanumeric name and trims it", () => {
    const r = createCharacterSchema.safeParse({ name: "  Nong123  ", baseClass: "mage" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Nong123");
    expect(createCharacterSchema.safeParse({ name: "ดึ๋งปุ๊", baseClass: "swordsman" }).success).toBe(
      true,
    );
  });

  it("rejects too-short / too-long names (after trim)", () => {
    expect(createCharacterSchema.safeParse({ name: " a ", baseClass: "mage" }).success).toBe(false);
    expect(
      createCharacterSchema.safeParse({ name: "x".repeat(25), baseClass: "mage" }).success,
    ).toBe(false);
  });

  it("rejects spaces / punctuation / symbols in the name", () => {
    expect(createCharacterSchema.safeParse({ name: "no spaces", baseClass: "mage" }).success).toBe(
      false,
    );
    expect(createCharacterSchema.safeParse({ name: "bad!name", baseClass: "mage" }).success).toBe(
      false,
    );
  });

  it("rejects an unknown base class and extra keys", () => {
    expect(createCharacterSchema.safeParse({ name: "Valid", baseClass: "necromancer" }).success).toBe(
      false,
    );
    expect(
      createCharacterSchema.safeParse({ name: "Valid", baseClass: "mage", hacked: 1 }).success,
    ).toBe(false);
  });
});

describe("createCharacter — cap + uniqueness (inside tx)", () => {
  it("creates when under the cap and the name is free", async () => {
    mockPrisma.character.count.mockResolvedValue(1);
    mockPrisma.character.findFirst.mockResolvedValue(null);
    mockPrisma.character.create.mockResolvedValue(ROW);

    const r = await createCharacter(USER, { name: "Alice", baseClass: "archer" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.character.id).toBe("char_1");
      expect(r.character.createdAt).toBe("2026-01-01T00:00:00.000Z");
    }
    expect(mockPrisma.character.create).toHaveBeenCalledOnce();
  });

  it("rejects a character over the live cap (limit)", async () => {
    mockPrisma.character.count.mockResolvedValue(MAX_LIVE_CHARACTERS); // already at cap
    const r = await createCharacter(USER, { name: "Fifth", baseClass: "mage" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("limit");
    expect(mockPrisma.character.create).not.toHaveBeenCalled();
  });

  it("rejects a duplicate live name (case-insensitive check)", async () => {
    mockPrisma.character.count.mockResolvedValue(1);
    mockPrisma.character.findFirst.mockResolvedValue({ id: "existing" });
    const r = await createCharacter(USER, { name: "Alice", baseClass: "archer" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("duplicate");
    expect(mockPrisma.character.create).not.toHaveBeenCalled();
  });
});

describe("owner/liveness gating", () => {
  it("getOwnedLiveCharacter returns null for a non-owner (query scoped by userId)", async () => {
    // A character the user doesn't own (or is deleted) is filtered out by the
    // where-clause, so Prisma returns null -> select/save must 404.
    mockPrisma.character.findFirst.mockResolvedValue(null);
    const owned = await getOwnedLiveCharacter("someone_else", "char_1");
    expect(owned).toBeNull();
    expect(mockPrisma.character.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "char_1", userId: "someone_else", deletedAt: null },
      }),
    );
  });

  it("deleteCharacter rejects when nothing was owned/live to soft-delete", async () => {
    mockPrisma.character.updateMany.mockResolvedValue({ count: 0 });
    const r = await deleteCharacter("non_owner", "char_1");
    expect(r.ok).toBe(false);
  });

  it("deleteCharacter soft-deletes an owned live character AND purges its board rows", async () => {
    mockPrisma.character.updateMany.mockResolvedValue({ count: 1 });
    const r = await deleteCharacter(USER, "char_1");
    expect(r.ok).toBe(true);
    expect(mockPrisma.character.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "char_1", userId: USER, deletedAt: null },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
    // Hall-of-Fame projection removed in the same tx (soft delete ≠ FK cascade).
    expect(mockPrisma.leaderboardEntry.deleteMany).toHaveBeenCalledWith({
      where: { characterId: "char_1" },
    });
    expect(mockPrisma.bossRecord.deleteMany).toHaveBeenCalledWith({
      where: { characterId: "char_1" },
    });
  });

  it("deleteCharacter does NOT purge board rows when nothing was deleted", async () => {
    mockPrisma.character.updateMany.mockResolvedValue({ count: 0 });
    await deleteCharacter("non_owner", "char_1");
    expect(mockPrisma.leaderboardEntry.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.bossRecord.deleteMany).not.toHaveBeenCalled();
  });
});

describe("listCharacters + powerFromSave", () => {
  it("maps live rows to DTOs (createdAt as ISO string, no internal columns)", async () => {
    mockPrisma.character.findMany.mockResolvedValue([ROW]);
    const list = await listCharacters(USER);
    expect(list).toEqual([
      {
        id: "char_1",
        name: "Alice",
        baseClass: "archer",
        level: 3,
        power: 400,
        tier: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("derives a positive, monotonic power from a save via the engine", () => {
    const base = CONFIG.stats.base.archer;
    const autoSlots = ["archer_rain", null, null];
    const low = powerFromSave({
      cls: "archer",
      level: 1,
      xp: 0,
      tier: 1,
      mainClaimed: [],
      dailies: emptyDailies(),
      statPoints: 0,
      stats: base,
      mana: CONFIG.mana.base,
      autoSlots,
      quest: null,
    });
    const high = powerFromSave({
      cls: "archer",
      level: 30,
      xp: 0,
      tier: 2,
      mainClaimed: [],
      dailies: emptyDailies(),
      statPoints: 0,
      stats: { ...base, dex: base.dex + 50 },
      mana: CONFIG.mana.base,
      autoSlots,
      quest: null,
    });
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low);
  });
});

// Rows shaped as the tier-cache select {baseClass, tier}.
const tierRows = (specs: [string, number][]) => specs.map(([baseClass, tier]) => ({ baseClass, tier }));
const ALL_TIER3 = tierRows([
  ["swordsman", 3],
  ["archer", 3],
  ["mage", 3],
]);

describe("computeNinjaUnlock — gate math over tier caches", () => {
  it("the gate flag is off (owner lifted it) — sanity for the test suite", () => {
    expect(REQUIRE_NINJA_UNLOCK).toBe(false);
  });

  it("unlocks when all three base lines are at tier 3", () => {
    const u = computeNinjaUnlock(ALL_TIER3);
    expect(u.unlocked).toBe(true);
    expect(u.cleared).toBe(3);
    expect(u.needed).toBe(3);
    expect(u.requiredTier).toBe(NINJA_UNLOCK_TIER);
    expect(u.baseTier3).toEqual({ swordsman: true, archer: true, mage: true });
  });

  it("computes partial progress (2/3) but stays UNLOCKED because the flag is off", () => {
    const u = computeNinjaUnlock(
      tierRows([
        ["swordsman", 3],
        ["archer", 3],
        ["mage", 2],
      ]),
    );
    expect(u.unlocked).toBe(true);
    expect(u.cleared).toBe(2);
    expect(u.baseTier3.mage).toBe(false);
  });

  it("computes a missing base line but stays UNLOCKED because the flag is off", () => {
    const u = computeNinjaUnlock(
      tierRows([
        ["swordsman", 3],
        ["archer", 3],
      ]),
    );
    expect(u.unlocked).toBe(true);
    expect(u.cleared).toBe(2);
    expect(u.maxTier.mage).toBe(0);
  });

  it("takes the MAX tier per base line across duplicate-class characters", () => {
    const u = computeNinjaUnlock(
      tierRows([
        ["swordsman", 1],
        ["swordsman", 3],
        ["archer", 3],
        ["mage", 3],
      ]),
    );
    expect(u.maxTier.swordsman).toBe(3);
    expect(u.unlocked).toBe(true);
  });

  it("ignores a ninja character's own tier for the gate", () => {
    const u = computeNinjaUnlock(
      tierRows([
        ["swordsman", 3],
        ["archer", 3],
        ["mage", 3],
        ["ninja", 3],
      ]),
    );
    expect(u.unlocked).toBe(true);
    expect(u.cleared).toBe(3);
  });

  it("treats a stale default-1 tier cache as tier 1 (may undercount, accepted) but stays UNLOCKED", () => {
    const u = computeNinjaUnlock(
      tierRows([
        ["swordsman", 3],
        ["archer", 3],
        ["mage", 1], // never re-saved since deploy
      ]),
    );
    expect(u.unlocked).toBe(true);
    expect(u.cleared).toBe(2);
  });
});

describe("getNinjaUnlock — roster progress payload", () => {
  it("derives progress from the tier caches (never a save blob)", async () => {
    mockPrisma.character.findMany.mockResolvedValue(ALL_TIER3);
    const u = await getNinjaUnlock(USER);
    expect(u.unlocked).toBe(true);
    expect(mockPrisma.character.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER, deletedAt: null },
        select: { baseClass: true, tier: true },
      }),
    );
  });
});

describe("createCharacter — ninja unlock gate", () => {
  it("allows a ninja when all three base lines are tier 3 (4th slot)", async () => {
    mockPrisma.character.count.mockResolvedValue(3); // three base characters live
    mockPrisma.character.findMany.mockResolvedValue(ALL_TIER3);
    mockPrisma.character.findFirst.mockResolvedValue(null); // name free
    mockPrisma.character.create.mockResolvedValue({ ...ROW, baseClass: "ninja", name: "Kage" });

    const r = await createCharacter(USER, { name: "Kage", baseClass: "ninja" });
    expect(r.ok).toBe(true);
    expect(mockPrisma.character.create).toHaveBeenCalledOnce();
  });

  it("allows a ninja even when the account has not cleared 3× tier 3 — flag is off", async () => {
    mockPrisma.character.count.mockResolvedValue(3);
    mockPrisma.character.findMany.mockResolvedValue(
      tierRows([
        ["swordsman", 3],
        ["archer", 3],
        ["mage", 2],
      ]),
    );
    mockPrisma.character.findFirst.mockResolvedValue(null); // name free
    mockPrisma.character.create.mockResolvedValue({ ...ROW, baseClass: "ninja", name: "Kage" });
    const r = await createCharacter(USER, { name: "Kage", baseClass: "ninja" });
    expect(r.ok).toBe(true);
    expect(mockPrisma.character.create).toHaveBeenCalledOnce();
  });

  it("allows a ninja on a mixed account missing a base line entirely — flag is off", async () => {
    mockPrisma.character.count.mockResolvedValue(2);
    mockPrisma.character.findMany.mockResolvedValue(
      tierRows([
        ["swordsman", 3],
        ["archer", 3],
      ]),
    );
    mockPrisma.character.findFirst.mockResolvedValue(null); // name free
    mockPrisma.character.create.mockResolvedValue({ ...ROW, baseClass: "ninja", name: "Kage" });
    const r = await createCharacter(USER, { name: "Kage", baseClass: "ninja" });
    expect(r.ok).toBe(true);
    expect(mockPrisma.character.create).toHaveBeenCalledOnce();
  });
});

describe("createCharacter — 4th slot is ninja-only", () => {
  it("rejects a non-ninja 4th character (ninja_only_slot)", async () => {
    mockPrisma.character.count.mockResolvedValue(MAX_LIVE_CHARACTERS - 1); // 3 live → next is the 4th
    const r = await createCharacter(USER, { name: "Fourth", baseClass: "mage" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ninja_only_slot");
    expect(mockPrisma.character.create).not.toHaveBeenCalled();
    // The 4th-slot guard short-circuits before the name-uniqueness read.
    expect(mockPrisma.character.findFirst).not.toHaveBeenCalled();
  });

  it("still allows a non-ninja 3rd character (base slots 1–3)", async () => {
    mockPrisma.character.count.mockResolvedValue(2); // creating the 3rd
    mockPrisma.character.findFirst.mockResolvedValue(null);
    mockPrisma.character.create.mockResolvedValue(ROW);
    const r = await createCharacter(USER, { name: "Third", baseClass: "mage" });
    expect(r.ok).toBe(true);
  });
});
