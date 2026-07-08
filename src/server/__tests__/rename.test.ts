import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Self-service RENAME (account displayName + character name), once per
 * Asia/Bangkok server-day. Prisma is mocked (no DB) — same pattern as
 * auth.test.ts / characters.test.ts. These cover the day-boundary cooldown, the
 * atomic compare-and-set (guarded updateMany → count 0 = no double-rename),
 * validation reuse, ownership gating, and the character name_taken collision.
 */

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    character: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import { renameDisplayName, renameDisplayNameSchema } from "@/server/auth";
import { renameCharacter, renameCharacterSchema } from "@/server/characters";
import { serverDayFor } from "@/server/dailyQuests";

const USER = "user_1";
const NOW = new Date("2026-07-09T12:00:00Z");
const TODAY = serverDayFor(NOW);
const YESTERDAY = TODAY - 1;

beforeEach(() => {
  vi.clearAllMocks();
  // Interactive transaction: run the callback with the mocked client as `tx`.
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => unknown) =>
    fn(mockPrisma),
  );
});

// ── Account displayName rename ────────────────────────────────────────────────

describe("renameDisplayName", () => {
  it("renames a registered account when the day is fresh (CAS matches one row)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ registeredAt: new Date() });
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

    const res = await renameDisplayName(USER, "NewName", NOW);

    expect(res).toEqual({ ok: true, displayName: "NewName" });
    // CAS guard: only writes when renameDay is null or a prior day, stamps TODAY.
    const call = mockPrisma.user.updateMany.mock.calls[0][0];
    expect(call.data).toEqual({ displayName: "NewName", renameDay: TODAY });
    expect(call.where.OR).toEqual([{ renameDay: null }, { renameDay: { not: TODAY } }]);
  });

  it("passes the caller-trimmed name through unchanged (route pre-validates/clamps)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ registeredAt: new Date() });
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
    const res = await renameDisplayName(USER, "Zephyr", NOW);
    expect(res).toEqual({ ok: true, displayName: "Zephyr" });
  });

  it("returns rename_cooldown when the CAS matches zero rows (already renamed today)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ registeredAt: new Date() });
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });
    const res = await renameDisplayName(USER, "NewName", NOW);
    expect(res).toEqual({ ok: false, code: "rename_cooldown" });
  });

  it("rejects a guest (no account) with account_required, never touching the row", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ registeredAt: null });
    const res = await renameDisplayName(USER, "NewName", NOW);
    expect(res).toEqual({ ok: false, code: "account_required" });
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });
});

describe("renameDisplayNameSchema", () => {
  it("trims + clamps to 24 chars (reuses the registration handle shape)", () => {
    const long = "x".repeat(40);
    const parsed = renameDisplayNameSchema.parse({ displayName: `  ${long}  ` });
    expect(parsed.displayName).toBe("x".repeat(24));
  });

  it("rejects a blank / whitespace-only name (rename must be non-empty)", () => {
    expect(renameDisplayNameSchema.safeParse({ displayName: "   " }).success).toBe(false);
    expect(renameDisplayNameSchema.safeParse({ displayName: "" }).success).toBe(false);
  });
});

// ── Character name rename ─────────────────────────────────────────────────────

describe("renameCharacter", () => {
  const CHAR = "char_1";

  it("renames a live owned character on a fresh day (CAS matches one row)", async () => {
    mockPrisma.character.findFirst
      .mockResolvedValueOnce({ id: CHAR, renameDay: YESTERDAY }) // ownership + cooldown read
      .mockResolvedValueOnce(null) // dup check: no collision
      .mockResolvedValueOnce({
        id: CHAR,
        name: "Renamed",
        baseClass: "archer",
        level: 5,
        power: 100,
        tier: 1,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
    mockPrisma.character.updateMany.mockResolvedValue({ count: 1 });

    const res = await renameCharacter(USER, CHAR, "Renamed", NOW);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.character.name).toBe("Renamed");
    const call = mockPrisma.character.updateMany.mock.calls[0][0];
    expect(call.data).toEqual({ name: "Renamed", renameDay: TODAY });
  });

  it("rejects a non-owned / deleted character with not_found", async () => {
    mockPrisma.character.findFirst.mockResolvedValueOnce(null);
    const res = await renameCharacter(USER, CHAR, "Renamed", NOW);
    expect(res).toEqual({ ok: false, code: "not_found" });
    expect(mockPrisma.character.updateMany).not.toHaveBeenCalled();
  });

  it("blocks a second rename the SAME day (renameDay === today → cooldown)", async () => {
    mockPrisma.character.findFirst.mockResolvedValueOnce({ id: CHAR, renameDay: TODAY });
    const res = await renameCharacter(USER, CHAR, "Renamed", NOW);
    expect(res).toEqual({ ok: false, code: "rename_cooldown" });
    expect(mockPrisma.character.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a name collision among live rows with name_taken", async () => {
    mockPrisma.character.findFirst
      .mockResolvedValueOnce({ id: CHAR, renameDay: null })
      .mockResolvedValueOnce({ id: "other" }); // dup exists
    const res = await renameCharacter(USER, CHAR, "Taken", NOW);
    expect(res).toEqual({ ok: false, code: "name_taken" });
    expect(mockPrisma.character.updateMany).not.toHaveBeenCalled();
  });

  it("returns rename_cooldown when the CAS write races to zero rows", async () => {
    mockPrisma.character.findFirst
      .mockResolvedValueOnce({ id: CHAR, renameDay: YESTERDAY })
      .mockResolvedValueOnce(null);
    mockPrisma.character.updateMany.mockResolvedValue({ count: 0 });
    const res = await renameCharacter(USER, CHAR, "Renamed", NOW);
    expect(res).toEqual({ ok: false, code: "rename_cooldown" });
  });
});

describe("renameCharacterSchema", () => {
  it("reuses the creation name rules (2-24 Thai/EN alnum) + bounds characterId", () => {
    expect(renameCharacterSchema.safeParse({ characterId: "c1", name: "Hero1" }).success).toBe(true);
    expect(renameCharacterSchema.safeParse({ characterId: "c1", name: "a" }).success).toBe(false);
    expect(renameCharacterSchema.safeParse({ characterId: "c1", name: "bad name!" }).success).toBe(
      false,
    );
    expect(renameCharacterSchema.safeParse({ characterId: "", name: "Hero1" }).success).toBe(false);
  });
});
