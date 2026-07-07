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
  createCharacter,
  createCharacterSchema,
  deleteCharacter,
  getOwnedLiveCharacter,
  listCharacters,
  powerFromSave,
  MAX_LIVE_CHARACTERS,
} from "@/server/characters";
import { CONFIG } from "@/engine";

const USER = "user_owner";
const ROW = {
  id: "char_1",
  name: "Alice",
  baseClass: "archer",
  level: 3,
  power: 400,
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

  it("rejects a 4th live character (limit)", async () => {
    mockPrisma.character.count.mockResolvedValue(MAX_LIVE_CHARACTERS); // already 3 live
    const r = await createCharacter(USER, { name: "Fourth", baseClass: "mage" });
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
