import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression for "MY TITLE INVISIBLE TO OTHERS" (owner bug batch A #1).
 *
 * Root cause: `persistSave`'s optional `uiConfig` sibling used to WRITE the incoming
 * (validated) blob straight over `Character.uiConfig` — a blind overwrite, not a
 * merge. The client-owned `UiConfig` shape (gameStore.ts `selectUiConfig`) carries
 * NONE of the HOF `displayTitle` field (that field is written ONLY by
 * `setDisplayTitle` / POST /api/hof/title). So the very next autosave tick after a
 * player picked a title clobbered it back to absent, and every peer's friends-poll
 * (`titlesForCharacters` + `presenceTitleFor` in friends.ts) read `displayTitle: null`
 * off the row — the title never actually reached anyone else's screen for longer
 * than one autosave interval.
 *
 * Fix: read-merge-write — fields the incoming payload doesn't carry (displayTitle
 * today) keep their stored value; fields it does carry still win.
 */

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    character: { findUnique: vi.fn(), update: vi.fn() },
    saveState: { upsert: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/server/characters", () => ({ powerFromSave: vi.fn(() => 100) }));
vi.mock("@/server/leaderboard", () => ({ upsertLeaderboardEntry: vi.fn(async () => {}) }));

import { persistSave } from "@/server/save";
import { SAVE_VERSION } from "@/engine";

function validSave() {
  return {
    version: SAVE_VERSION,
    stage: 3,
    gold: 500,
    hero: { cls: "archer" as const, level: 4, xp: 12, tier: 2 as const },
    lastSeen: 0,
  };
}

const autoUiConfig = {
  autoCast: true,
  autoAllocate: true,
  autoReturn: false,
  autoAdvance: false,
  autoHpPotion: true,
  autoManaPotion: true,
  autoHpThreshold: 0.5,
  autoManaThreshold: 0.5,
  autoSellCommon: "sell" as const,
  autoSellRare: "off" as const,
  autoSellEpic: "off" as const,
  autoSellKeepBetterStat: true,
  autoEquip: true,
};

describe("persistSave — uiConfig merge (never blind-overwrite)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.character.update.mockResolvedValue({});
    mockPrisma.saveState.upsert.mockResolvedValue({});
  });

  it("preserves a previously-set displayTitle when the autosave body omits it", async () => {
    // Row already carries a chosen title (set via a prior POST /api/hof/title).
    mockPrisma.character.findUnique.mockResolvedValue({
      uiConfig: { ...autoUiConfig, displayTitle: "level.1" },
    });

    const result = await persistSave("char1", "user1", validSave(), new Date(), autoUiConfig);
    expect(result.ok).toBe(true);

    const updateArg = mockPrisma.character.update.mock.calls[0][0];
    expect(updateArg.data.uiConfig).toMatchObject({
      ...autoUiConfig,
      displayTitle: "level.1",
    });
  });

  it("still applies fields the incoming payload DOES send, on top of the merge", async () => {
    mockPrisma.character.findUnique.mockResolvedValue({
      uiConfig: { ...autoUiConfig, autoCast: false, displayTitle: "power.1" },
    });

    const result = await persistSave(
      "char1",
      "user1",
      validSave(),
      new Date(),
      { ...autoUiConfig, autoCast: true },
    );
    expect(result.ok).toBe(true);

    const updateArg = mockPrisma.character.update.mock.calls[0][0];
    expect(updateArg.data.uiConfig).toMatchObject({ autoCast: true, displayTitle: "power.1" });
  });

  it("a fresh character (no prior uiConfig row) still writes the sent fields cleanly", async () => {
    mockPrisma.character.findUnique.mockResolvedValue({ uiConfig: null });

    const result = await persistSave("char1", "user1", validSave(), new Date(), autoUiConfig);
    expect(result.ok).toBe(true);

    const updateArg = mockPrisma.character.update.mock.calls[0][0];
    expect(updateArg.data.uiConfig).toMatchObject(autoUiConfig);
    expect(updateArg.data.uiConfig.displayTitle).toBeUndefined();
  });

  it("uiConfig omitted entirely (undefined) never touches the column", async () => {
    const result = await persistSave("char1", "user1", validSave(), new Date(), undefined);
    expect(result.ok).toBe(true);
    expect(mockPrisma.character.findUnique).not.toHaveBeenCalled();

    const updateArg = mockPrisma.character.update.mock.calls[0][0];
    expect(updateArg.data.uiConfig).toBeUndefined();
  });
});
