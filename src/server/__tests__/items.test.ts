import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * M7 item ledger trust-boundary tests. Prisma is mocked (no DB) the same way the
 * rest of the server is unit-tested — we exercise the invariants Prisma can't
 * express in app terms: claimKey idempotency (no double-mint), the rate-
 * plausibility ceiling, drop-table membership gating, and the equip incumbent-
 * unequip (≤1 per slot) recipe. Pure helpers are tested directly.
 */

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    character: { findUnique: vi.fn() },
    itemInstance: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    itemEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import { Prisma } from "@prisma/client";
import {
  deriveClaimKey,
  plausibleDropCeiling,
  classifyClaim,
  claimBatchSchema,
  equipSchema,
  claimBatch,
  equipItem,
  unequipItem,
  destroyItem,
  CLAIM_GRACE,
  KILLS_PER_SEC_CEILING,
  MAX_CLAIM_BATCH,
} from "@/server/items";
import { maxSummedDropChance } from "@/engine/config/items";

const CHAR = "char_1";

function instanceRow(over: Record<string, unknown> = {}) {
  return {
    id: "item_1",
    templateId: "w_sword_t1_rusty",
    equippedSlot: null,
    origin: "drop",
    acquiredAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

function p2002(target: string) {
  return new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "6",
    meta: { target: [target] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Interactive transaction: invoke the callback with the mocked client as `tx`.
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => unknown) =>
    fn(mockPrisma),
  );
});

describe("deriveClaimKey", () => {
  it("is deterministic and scopes rollId by character", () => {
    expect(deriveClaimKey(CHAR, "42")).toBe("char_1:42");
    expect(deriveClaimKey(CHAR, "42")).toBe(deriveClaimKey(CHAR, "42"));
    expect(deriveClaimKey("char_2", "42")).not.toBe(deriveClaimKey(CHAR, "42"));
  });
});

describe("plausibleDropCeiling", () => {
  it("is the grace allowance at zero/negative elapsed", () => {
    expect(plausibleDropCeiling(0)).toBe(CLAIM_GRACE);
    expect(plausibleDropCeiling(-100)).toBe(CLAIM_GRACE);
  });
  it("scales with elapsed seconds × kills/sec × maxSummedDropChance", () => {
    const secs = 3600;
    const expected = Math.floor(secs * KILLS_PER_SEC_CEILING * maxSummedDropChance()) + CLAIM_GRACE;
    expect(plausibleDropCeiling(secs)).toBe(expected);
    expect(plausibleDropCeiling(secs)).toBeGreaterThan(CLAIM_GRACE);
  });
});

describe("classifyClaim", () => {
  it("rejects an unknown templateId", () => {
    const r = classifyClaim("does_not_exist", 1);
    expect(r.ok).toBe(false);
  });
  it("accepts a known template with unverifiable membership while tables are empty", () => {
    // Engine drop tables are placeholder-[] today → membershipKnown is false.
    const r = classifyClaim("w_sword_t1_rusty", 3);
    expect(r).toEqual({ ok: true, origin: "drop", membershipKnown: false });
  });
});

describe("claimBatchSchema / equipSchema", () => {
  it("accepts a well-formed batch and coerces numeric rollId to string", () => {
    const r = claimBatchSchema.safeParse({
      items: [{ rollId: 7, templateId: "w_sword_t1_rusty", stage: 3 }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.items[0].rollId).toBe("7");
  });
  it("rejects an empty batch, an over-cap batch, and extra keys", () => {
    expect(claimBatchSchema.safeParse({ items: [] }).success).toBe(false);
    const tooMany = {
      items: Array.from({ length: MAX_CLAIM_BATCH + 1 }, (_, i) => ({
        rollId: i,
        templateId: "w_sword_t1_rusty",
        stage: 1,
      })),
    };
    expect(claimBatchSchema.safeParse(tooMany).success).toBe(false);
    expect(
      claimBatchSchema.safeParse({ items: [{ rollId: 1, templateId: "x", stage: 1, hacked: true }] })
        .success,
    ).toBe(false);
  });
  it("rejects a stage below 1 or non-integer", () => {
    expect(
      claimBatchSchema.safeParse({ items: [{ rollId: 1, templateId: "x", stage: 0 }] }).success,
    ).toBe(false);
    expect(
      claimBatchSchema.safeParse({ items: [{ rollId: 1, templateId: "x", stage: 2.5 }] }).success,
    ).toBe(false);
  });
  it("equipSchema requires a non-empty itemId and rejects extras", () => {
    expect(equipSchema.safeParse({ itemId: "item_1" }).success).toBe(true);
    expect(equipSchema.safeParse({ itemId: "" }).success).toBe(false);
    expect(equipSchema.safeParse({ itemId: "a", extra: 1 }).success).toBe(false);
  });
});

describe("claimBatch — mint / idempotency / rate cap", () => {
  beforeEach(() => {
    mockPrisma.character.findUnique.mockResolvedValue({ createdAt: new Date() });
    mockPrisma.itemInstance.count.mockResolvedValue(0);
    mockPrisma.itemEvent.create.mockResolvedValue({});
  });

  it("mints a new claim in one tx (instance + minted event)", async () => {
    mockPrisma.itemInstance.create.mockResolvedValue(instanceRow());
    const { results } = await claimBatch(
      CHAR,
      [{ rollId: "1", templateId: "w_sword_t1_rusty", stage: 3 }],
      Date.now(),
    );
    expect(results[0].status).toBe("minted");
    expect(mockPrisma.itemInstance.create).toHaveBeenCalledOnce();
    expect(mockPrisma.itemEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "minted" }) }),
    );
  });

  it("is idempotent: a claimKey collision returns the existing item, never re-mints", async () => {
    mockPrisma.itemInstance.create.mockRejectedValue(p2002("claimKey"));
    mockPrisma.itemInstance.findUnique.mockResolvedValue(instanceRow({ id: "existing" }));
    const { results } = await claimBatch(
      CHAR,
      [{ rollId: "1", templateId: "w_sword_t1_rusty", stage: 3 }],
      Date.now(),
    );
    expect(results[0].status).toBe("existing");
    if (results[0].status === "existing") expect(results[0].item.id).toBe("existing");
  });

  it("rejects excess claims beyond the plausibility ceiling (rate), does not mint", async () => {
    // createdAt = now → ceiling = CLAIM_GRACE; existing count already at ceiling.
    mockPrisma.character.findUnique.mockResolvedValue({ createdAt: new Date() });
    mockPrisma.itemInstance.count.mockResolvedValue(CLAIM_GRACE);
    mockPrisma.itemInstance.findUnique.mockResolvedValue(null); // not an idempotent retry
    const { results } = await claimBatch(
      CHAR,
      [{ rollId: "999", templateId: "w_sword_t1_rusty", stage: 3 }],
      Date.now(),
    );
    expect(results[0]).toMatchObject({ status: "rejected", reason: "rate" });
    expect(mockPrisma.itemInstance.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown template without minting", async () => {
    const { results } = await claimBatch(
      CHAR,
      [{ rollId: "1", templateId: "ghost_item", stage: 3 }],
      Date.now(),
    );
    expect(results[0]).toMatchObject({ status: "rejected", reason: "unknown_template" });
    expect(mockPrisma.itemInstance.create).not.toHaveBeenCalled();
  });
});

describe("equipItem — class gate + incumbent unequip (invariant 6)", () => {
  beforeEach(() => {
    mockPrisma.itemEvent.create.mockResolvedValue({});
  });

  it("rejects when the item's classReq does not match the character class", async () => {
    // w_sword_t1_rusty requires swordsman.
    mockPrisma.itemInstance.findFirst.mockResolvedValue(instanceRow());
    const r = await equipItem(CHAR, "item_1", "mage");
    expect(r).toEqual({ ok: false, reason: "class_req" });
    expect(mockPrisma.itemInstance.update).not.toHaveBeenCalled();
  });

  it("rejects a missing/deleted item", async () => {
    mockPrisma.itemInstance.findFirst.mockResolvedValue(null);
    const r = await equipItem(CHAR, "nope", "swordsman");
    expect(r).toEqual({ ok: false, reason: "not_found" });
  });

  it("unequips the incumbent in the same tx before equipping", async () => {
    mockPrisma.itemInstance.findFirst
      .mockResolvedValueOnce(instanceRow({ id: "item_1", equippedSlot: null })) // target
      .mockResolvedValueOnce({ id: "old_weapon" }); // incumbent in slot
    mockPrisma.itemInstance.update.mockResolvedValue(instanceRow({ equippedSlot: "weapon" }));
    const r = await equipItem(CHAR, "item_1", "swordsman");
    expect(r.ok).toBe(true);
    // incumbent NULLed + unequipped event, then target equipped + equipped event.
    expect(mockPrisma.itemInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "old_weapon" }, data: { equippedSlot: null } }),
    );
    const eventTypes = mockPrisma.itemEvent.create.mock.calls.map((c) => c[0].data.type);
    expect(eventTypes).toEqual(["unequipped", "equipped"]);
  });

  it("is a no-op when already equipped in the same slot", async () => {
    mockPrisma.itemInstance.findFirst.mockResolvedValue(instanceRow({ equippedSlot: "weapon" }));
    const r = await equipItem(CHAR, "item_1", "swordsman");
    expect(r.ok).toBe(true);
    expect(mockPrisma.itemInstance.update).not.toHaveBeenCalled();
  });
});

describe("unequipItem / destroyItem", () => {
  beforeEach(() => {
    mockPrisma.itemEvent.create.mockResolvedValue({});
  });

  it("unequips an equipped item (slot NULL + unequipped event)", async () => {
    mockPrisma.itemInstance.findFirst.mockResolvedValue(instanceRow({ equippedSlot: "armor" }));
    mockPrisma.itemInstance.update.mockResolvedValue(instanceRow({ equippedSlot: null }));
    const r = await unequipItem(CHAR, "item_1");
    expect(r.ok).toBe(true);
    expect(mockPrisma.itemInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { equippedSlot: null } }),
    );
  });

  it("destroy NULLs equippedSlot AND sets deletedAt in the same tx (invariant 5)", async () => {
    mockPrisma.itemInstance.findFirst.mockResolvedValue({ id: "item_1" });
    mockPrisma.itemInstance.update.mockResolvedValue({});
    const now = new Date("2026-07-06T00:00:00Z");
    const r = await destroyItem(CHAR, "item_1", now);
    expect(r.ok).toBe(true);
    expect(mockPrisma.itemInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: now, equippedSlot: null } }),
    );
    expect(mockPrisma.itemEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "destroyed" }) }),
    );
  });
});
