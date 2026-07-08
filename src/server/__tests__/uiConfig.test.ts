import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Cross-device UI/automation config (owner request 2026-07-07) — trust-boundary
 * + persistence round-trip tests. Prisma is mocked (no DB), same pattern as
 * leaderboard.test.ts; `@/server/leaderboard` is stubbed so `persistSave`'s
 * best-effort HOF upsert doesn't pull the real board machinery into this unit.
 *
 * The rules under test: the STRICT + bounded zod schema (unknown keys / bad
 * enums / out-of-range thresholds rejected), `loadUiConfig` narrowing, and that
 * a valid uiConfig rides the save write while a MISSING one leaves the stored
 * value untouched and an INVALID one is dropped WITHOUT failing the save.
 */

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    saveState: { upsert: vi.fn() },
    character: { update: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/server/leaderboard", () => ({ upsertLeaderboardEntry: vi.fn() }));

import { parseUiConfig, loadUiConfig, uiConfigSchema } from "@/server/uiConfig";
import { persistSave } from "@/server/save";
import { SAVE_VERSION } from "@/engine";

const CHAR = "char_1";
const USER = "user_1";
const NOW = new Date("2026-07-07T12:00:00.000Z");

/** A full, valid preference blob a well-behaved client POSTs. */
function validUiConfig(over: Record<string, unknown> = {}) {
  return {
    autoCast: true,
    autoAllocate: false,
    autoReturn: true,
    autoAdvance: true,
    autoHpPotion: true,
    autoManaPotion: false,
    autoHpThreshold: 0.5,
    autoManaThreshold: 0.3,
    autoSellCommon: "sell",
    autoSellRare: "salvage",
    autoSellEpic: "off",
    autoSellKeepBetterStat: true,
    autoEquip: true,
    ...over,
  };
}

/** A minimal valid save payload (mirrors save.test.ts's `validSave`). */
function validSave(over: Record<string, unknown> = {}) {
  return {
    version: SAVE_VERSION,
    stage: 3,
    gold: 500,
    hero: { cls: "archer", level: 4, xp: 12, tier: 2 },
    lastSeen: 0,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockResolvedValue([]);
  mockPrisma.saveState.upsert.mockReturnValue({});
  mockPrisma.character.update.mockReturnValue({});
});

describe("parseUiConfig — accepts", () => {
  it("accepts a full valid config", () => {
    const r = parseUiConfig(validUiConfig());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.autoSellRare).toBe("salvage");
  });

  it("accepts a PARTIAL config (every field optional — forward/back compat)", () => {
    const r = parseUiConfig({ autoCast: false, autoSellEpic: "salvage" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.autoCast).toBe(false);
      expect(r.data.autoAllocate).toBeUndefined();
    }
  });

  it("accepts the threshold bounds 0 and 1", () => {
    expect(parseUiConfig({ autoHpThreshold: 0, autoManaThreshold: 1 }).ok).toBe(true);
  });
});

describe("parseUiConfig — rejects (strict + bounded)", () => {
  it("rejects an unknown key", () => {
    expect(parseUiConfig(validUiConfig({ hacked: true })).ok).toBe(false);
  });

  it("rejects an out-of-range threshold", () => {
    expect(parseUiConfig({ autoHpThreshold: 1.5 }).ok).toBe(false);
    expect(parseUiConfig({ autoManaThreshold: -0.1 }).ok).toBe(false);
    expect(parseUiConfig({ autoHpThreshold: Number.NaN }).ok).toBe(false);
  });

  it("rejects an unknown auto-sell action", () => {
    expect(parseUiConfig({ autoSellCommon: "vaporize" }).ok).toBe(false);
  });

  it("rejects a wrong-typed field", () => {
    expect(parseUiConfig({ autoCast: "yes" }).ok).toBe(false);
    expect(parseUiConfig(null).ok).toBe(false);
    expect(parseUiConfig("nope").ok).toBe(false);
  });

  it("surfaces a field-scoped error message", () => {
    const r = parseUiConfig({ autoSellCommon: "vaporize" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("autoSellCommon");
  });

  it("schema is strict at the type level (sanity: safeParse rejects extras)", () => {
    expect(uiConfigSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});

describe("loadUiConfig", () => {
  it("returns the stored (narrowed) blob", async () => {
    mockPrisma.character.findUnique.mockResolvedValue({ uiConfig: validUiConfig() });
    const cfg = await loadUiConfig(CHAR);
    expect(cfg?.autoSellRare).toBe("salvage");
  });

  it("returns null for a character with no stored config", async () => {
    mockPrisma.character.findUnique.mockResolvedValue({ uiConfig: null });
    expect(await loadUiConfig(CHAR)).toBeNull();
  });

  it("returns null for a missing character row", async () => {
    mockPrisma.character.findUnique.mockResolvedValue(null);
    expect(await loadUiConfig(CHAR)).toBeNull();
  });

  it("degrades a corrupt stored shape to null (never leaks junk)", async () => {
    mockPrisma.character.findUnique.mockResolvedValue({ uiConfig: { autoCast: 5, junk: 1 } });
    expect(await loadUiConfig(CHAR)).toBeNull();
  });
});

describe("persistSave — uiConfig round-trip", () => {
  it("writes a valid uiConfig in the SAME Character.update as the HOF caches", async () => {
    const res = await persistSave(CHAR, USER, validSave(), NOW, validUiConfig());
    expect(res.ok).toBe(true);
    const updateArgs = mockPrisma.character.update.mock.calls[0][0];
    expect(updateArgs.data.uiConfig).toMatchObject({ autoSellRare: "salvage", autoCast: true });
    // Still refreshes the denormalized caches alongside it.
    expect(updateArgs.data.level).toBe(4);
    expect(typeof updateArgs.data.power).toBe("number");
    // Ninja wave: the class-advancement tier cache is stamped from the blob too.
    expect(updateArgs.data.tier).toBe(2);
  });

  it("leaves the stored config untouched when uiConfig is OMITTED", async () => {
    const res = await persistSave(CHAR, USER, validSave());
    expect(res.ok).toBe(true);
    const updateArgs = mockPrisma.character.update.mock.calls[0][0];
    expect(updateArgs.data).not.toHaveProperty("uiConfig");
  });

  it("DROPS an invalid uiConfig without failing the save", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await persistSave(CHAR, USER, validSave(), NOW, { autoSellCommon: "vaporize" });
    expect(res.ok).toBe(true); // the save itself still succeeds
    const updateArgs = mockPrisma.character.update.mock.calls[0][0];
    expect(updateArgs.data).not.toHaveProperty("uiConfig");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("still rejects a structurally-invalid SAVE regardless of uiConfig", async () => {
    const res = await persistSave(CHAR, USER, validSave({ gold: -1 }), NOW, validUiConfig());
    expect(res.ok).toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
