import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * World boss "เสี่ยจ๋อง" claim — trust-boundary unit tests. Prisma + node:crypto are
 * mocked (no DB, deterministic roll) the same way the rest of the server layer is
 * tested. We exercise: server-clock window validation, the P2002 idempotency gate,
 * the one-tx grant composition (materials + mint + goldCredit), the 50:50 crypto roll
 * seam, and the owner/liveness rejection.
 */

const { mockPrisma, randomIntMock } = vi.hoisted(() => ({
  mockPrisma: {
    character: { findFirst: vi.fn(), update: vi.fn() },
    itemInstance: { create: vi.fn() },
    itemEvent: { create: vi.fn() },
    worldBossClaim: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  randomIntMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("node:crypto", () => ({ randomInt: randomIntMock }));

import { Prisma } from "@prisma/client";
import {
  worldBossWindowId,
  isClaimableWindow,
  pickFortifier,
  worldBossClaimSchema,
  claimWorldBoss,
  WORLD_BOSS,
  WORLD_BOSS_REWARD,
} from "@/server/worldBoss";

const USER = "user_1";
const CHAR = "char_1";
const P = WORLD_BOSS.periodMs; // 3_600_000
const W = 1000;
const SPAWN = W * P; // window W's spawn instant (ms)

function fortifierRow(templateId: string) {
  return {
    id: "fort_1",
    templateId,
    equippedSlot: null,
    origin: "worldboss",
    acquiredAt: new Date("2026-07-08T00:00:00Z"),
    refineLevel: 0,
  };
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "6",
    meta: { target: ["characterId", "windowId"] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => unknown) =>
    fn(mockPrisma),
  );
});

describe("worldBossWindowId", () => {
  it("floor-divides the instant into hourly buckets", () => {
    expect(worldBossWindowId(SPAWN)).toBe(W);
    expect(worldBossWindowId(SPAWN + P - 1)).toBe(W); // still the same bucket
    expect(worldBossWindowId(SPAWN + P)).toBe(W + 1); // next bucket
  });
});

describe("isClaimableWindow (server clock)", () => {
  it("accepts the current window (fresh kill)", () => {
    expect(isClaimableWindow(W, SPAWN + 60_000)).toBe(true);
  });

  it("accepts a just-expired boss still within its window (post-lifetime, within grace)", () => {
    const now = SPAWN + WORLD_BOSS.lifetimeMs + 60_000; // boss's 15-min life ended, same hour
    expect(worldBossWindowId(now)).toBe(W); // still the current window
    expect(isClaimableWindow(W, now)).toBe(true);
  });

  it("rejects a stale past window (a client re-claiming last hour's boss)", () => {
    const now = SPAWN + 60_000; // current window is W
    expect(isClaimableWindow(W - 1, now)).toBe(false);
  });

  it("rejects a future window (a client that forwarded its clock)", () => {
    const now = SPAWN + 60_000;
    expect(isClaimableWindow(W + 1, now)).toBe(false);
  });
});

describe("pickFortifier (50:50)", () => {
  it("weapon on the low half, armor on the high half", () => {
    expect(pickFortifier(0)).toBe("fort_weapon");
    expect(pickFortifier(0.4999)).toBe("fort_weapon");
    expect(pickFortifier(0.5)).toBe("fort_armor");
    expect(pickFortifier(0.999)).toBe("fort_armor");
  });
});

describe("worldBossClaimSchema", () => {
  it("requires a characterId + a non-negative int windowId, rejects extras", () => {
    expect(worldBossClaimSchema.safeParse({ characterId: CHAR, windowId: W }).success).toBe(true);
    expect(worldBossClaimSchema.safeParse({ characterId: CHAR, windowId: -1 }).success).toBe(false);
    expect(worldBossClaimSchema.safeParse({ characterId: CHAR, windowId: 1.5 }).success).toBe(false);
    expect(worldBossClaimSchema.safeParse({ characterId: "", windowId: W }).success).toBe(false);
    expect(
      worldBossClaimSchema.safeParse({ characterId: CHAR, windowId: W, extra: 1 }).success,
    ).toBe(false);
  });
});

describe("claimWorldBoss", () => {
  const NOW = new Date(SPAWN + 60_000); // inside window W

  function ownershipOk() {
    mockPrisma.character.findFirst.mockResolvedValue({ id: CHAR });
  }

  it("rejects a foreign character / guest with no such character (not_owned, no tx)", async () => {
    mockPrisma.character.findFirst.mockResolvedValue(null);
    const r = await claimWorldBoss(USER, CHAR, W, { now: NOW, roll: () => 0.2 });
    expect(r).toEqual({ ok: false, reason: "not_owned" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a stale/forged window before any DB write (stale_window)", async () => {
    ownershipOk();
    const r = await claimWorldBoss(USER, CHAR, W + 5, { now: NOW, roll: () => 0.2 });
    expect(r).toEqual({ ok: false, reason: "stale_window" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("grants materials + a minted fortifier + goldCredit in one tx (weapon on a low roll)", async () => {
    ownershipOk();
    mockPrisma.worldBossClaim.create.mockResolvedValue({ id: "wbc_1" });
    mockPrisma.character.update.mockResolvedValue({ materials: 450 }); // 100 + 350
    mockPrisma.itemInstance.create.mockResolvedValue(fortifierRow("fort_weapon"));
    mockPrisma.itemEvent.create.mockResolvedValue({});

    const r = await claimWorldBoss(USER, CHAR, W, { now: NOW, roll: () => 0.2 });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.goldCredit).toBe(WORLD_BOSS_REWARD.gold);
      expect(r.materialsTotal).toBe(450);
      expect(r.item.templateId).toBe("fort_weapon");
      expect(r.item.kind).toBe("fortifier");
    }
    // idempotency row
    expect(mockPrisma.worldBossClaim.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { characterId: CHAR, windowId: W } }),
    );
    // +350 materials on the authoritative column
    expect(mockPrisma.character.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { materials: { increment: WORLD_BOSS_REWARD.materials } },
      }),
    );
    // fortifier minted with origin "worldboss" + its minted event
    expect(mockPrisma.itemInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: CHAR, templateId: "fort_weapon", origin: "worldboss" }),
      }),
    );
    expect(mockPrisma.itemEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "minted" }) }),
    );
  });

  it("mints an armor fortifier on a high roll", async () => {
    ownershipOk();
    mockPrisma.worldBossClaim.create.mockResolvedValue({ id: "wbc_1" });
    mockPrisma.character.update.mockResolvedValue({ materials: 350 });
    mockPrisma.itemInstance.create.mockResolvedValue(fortifierRow("fort_armor"));
    mockPrisma.itemEvent.create.mockResolvedValue({});

    const r = await claimWorldBoss(USER, CHAR, W, { now: NOW, roll: () => 0.8 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.item.templateId).toBe("fort_armor");
    expect(mockPrisma.itemInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ templateId: "fort_armor" }) }),
    );
  });

  it("uses the crypto roll (node:crypto.randomInt) when no roll is injected", async () => {
    ownershipOk();
    randomIntMock.mockReturnValue(900_000); // → 0.9 → armor
    mockPrisma.worldBossClaim.create.mockResolvedValue({ id: "wbc_1" });
    mockPrisma.character.update.mockResolvedValue({ materials: 350 });
    mockPrisma.itemInstance.create.mockResolvedValue(fortifierRow("fort_armor"));
    mockPrisma.itemEvent.create.mockResolvedValue({});

    const r = await claimWorldBoss(USER, CHAR, W, { now: NOW });
    expect(randomIntMock).toHaveBeenCalledWith(0, 1_000_000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.item.templateId).toBe("fort_armor");
  });

  it("returns already_claimed when the WorldBossClaim unique index collides (P2002)", async () => {
    ownershipOk();
    mockPrisma.worldBossClaim.create.mockRejectedValue(p2002());
    const r = await claimWorldBoss(USER, CHAR, W, { now: NOW, roll: () => 0.2 });
    expect(r).toEqual({ ok: false, reason: "already_claimed" });
    // nothing granted past the failed idempotency insert
    expect(mockPrisma.character.update).not.toHaveBeenCalled();
    expect(mockPrisma.itemInstance.create).not.toHaveBeenCalled();
  });
});
