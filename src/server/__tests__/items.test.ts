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
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    itemEvent: { create: vi.fn(), createMany: vi.fn() },
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
  sellSchema,
  claimBatch,
  equipItem,
  unequipItem,
  destroyItem,
  sellItems,
  CLAIM_GRACE,
  KILLS_PER_SEC_CEILING,
  MAX_CLAIM_BATCH,
  MAX_SELL_BATCH,
} from "@/server/items";
import {
  maxSummedDropChance,
  vendorPriceForTemplate,
  INVENTORY_CAP,
} from "@/engine/config/items";

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
  it("accepts an on-band farm template as origin drop (farm wins over boss-pool overlap)", () => {
    // Stage 1 is tier-1 band: w_sword_t1_rusty is in the farm table AND (by the
    // on-curve+next-tier pool rule) the boss table — farm membership must win
    // the origin label or every ordinary drop would audit as "boss".
    const r = classifyClaim("w_sword_t1_rusty", 1);
    expect(r).toEqual({ ok: true, origin: "drop", membershipKnown: true });
  });
  it("classifies a boss-pool exclusive (next-tier seed) as origin boss", () => {
    // Tier-2 iron sword at stage 1: not in the tier-1 farm table, only in the
    // boss pool (on-curve + next tier).
    const r = classifyClaim("w_sword_t2_iron", 1);
    expect(r).toEqual({ ok: true, origin: "boss", membershipKnown: true });
  });
  it("rejects an off-band template (populated table, not a member)", () => {
    // Stage 3 is tier-2 band; the tier-1 rusty sword is in neither table there.
    const r = classifyClaim("w_sword_t1_rusty", 3);
    expect(r).toEqual({ ok: false, reason: "not_in_table" });
  });
});

describe("claimBatchSchema / equipSchema", () => {
  it("accepts a well-formed batch and coerces numeric rollId to string", () => {
    const r = claimBatchSchema.safeParse({
      items: [{ rollId: 7, templateId: "w_sword_t1_rusty", stage: 1 }],
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
      [{ rollId: "1", templateId: "w_sword_t1_rusty", stage: 1 }],
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
      [{ rollId: "1", templateId: "w_sword_t1_rusty", stage: 1 }],
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
      [{ rollId: "999", templateId: "w_sword_t1_rusty", stage: 1 }],
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

describe("claimBatch — inventory cap backstop (M7.5)", () => {
  beforeEach(() => {
    mockPrisma.character.findUnique.mockResolvedValue({ createdAt: new Date() });
    mockPrisma.itemEvent.create.mockResolvedValue({});
    // Two distinct count() calls: origin-scoped (rate budget) vs deletedAt:null
    // (inventory usage). Only the latter is at the cap here.
    mockPrisma.itemInstance.count.mockImplementation(
      async ({ where }: { where?: { deletedAt?: unknown } }) =>
        where?.deletedAt === null ? INVENTORY_CAP : 0,
    );
  });

  it("rejects a new mint at the cap (inventory_full), never minting", async () => {
    mockPrisma.itemInstance.findUnique.mockResolvedValue(null); // not an idempotent retry
    const { results } = await claimBatch(
      CHAR,
      [{ rollId: "1", templateId: "w_sword_t1_rusty", stage: 1 }],
      Date.now(),
    );
    expect(results[0]).toMatchObject({ status: "rejected", reason: "inventory_full" });
    expect(mockPrisma.itemInstance.create).not.toHaveBeenCalled();
  });

  it("still returns existing for an idempotent retry at the cap (cap must not break idempotency)", async () => {
    mockPrisma.itemInstance.findUnique.mockResolvedValue(instanceRow({ id: "existing" }));
    const { results } = await claimBatch(
      CHAR,
      [{ rollId: "1", templateId: "w_sword_t1_rusty", stage: 1 }],
      Date.now(),
    );
    expect(results[0].status).toBe("existing");
    expect(mockPrisma.itemInstance.create).not.toHaveBeenCalled();
  });
});

describe("sellItems — NPC vendor (M7.5)", () => {
  beforeEach(() => {
    mockPrisma.itemEvent.createMany.mockResolvedValue({ count: 0 });
  });

  /** The batched read now returns the rows for the whole request. */
  function stockFindMany(rows: Record<string, unknown>[]): void {
    mockPrisma.itemInstance.findMany.mockResolvedValue(
      rows.map((r) => ({ id: "item_1", deletedAt: null, ...r })),
    );
  }

  it("sells an unequipped item: atomic soft-delete + destroyed event, price from vendorPriceForTemplate", async () => {
    stockFindMany([{ templateId: "w_sword_t3_knight", equippedSlot: null }]);
    mockPrisma.itemInstance.updateMany.mockResolvedValue({ count: 1 });
    const now = new Date("2026-07-06T00:00:00Z");
    const { results, totalGold } = await sellItems(CHAR, ["item_1"], now);

    const expectedPrice = vendorPriceForTemplate("w_sword_t3_knight");
    expect(results[0]).toEqual({ itemId: "item_1", status: "sold", price: expectedPrice });
    expect(totalGold).toBe(expectedPrice);
    // conditional check-and-set guarded by deletedAt:null + equippedSlot:null
    expect(mockPrisma.itemInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "item_1", deletedAt: null, equippedSlot: null }),
        data: { deletedAt: now },
      }),
    );
    // ledger records the sell-time price (single createMany for the batch)
    expect(mockPrisma.itemEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            type: "destroyed",
            meta: JSON.stringify({ sold: true, price: expectedPrice, currency: "gold" }),
          }),
        ],
      }),
    );
  });

  it("rejects an equipped item (reason equipped) — never auto-unequips, no gold", async () => {
    stockFindMany([{ equippedSlot: "weapon" }]);
    const { results, totalGold } = await sellItems(CHAR, ["item_1"]);
    expect(results[0]).toEqual({ itemId: "item_1", status: "rejected", reason: "equipped" });
    expect(totalGold).toBe(0);
    expect(mockPrisma.itemInstance.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.itemEvent.createMany).not.toHaveBeenCalled();
  });

  it("does not double-credit an already-deleted item (status already, price 0)", async () => {
    stockFindMany([{ equippedSlot: null, deletedAt: new Date("2026-01-01T00:00:00Z") }]);
    const { results, totalGold } = await sellItems(CHAR, ["item_1"]);
    expect(results[0]).toEqual({ itemId: "item_1", status: "already", price: 0 });
    expect(totalGold).toBe(0);
    expect(mockPrisma.itemInstance.updateMany).not.toHaveBeenCalled();
  });

  it("credits at most once when the atomic write loses the race (count 0 → already)", async () => {
    stockFindMany([{ equippedSlot: null }]);
    mockPrisma.itemInstance.updateMany.mockResolvedValue({ count: 0 }); // concurrent seller won
    const { results, totalGold } = await sellItems(CHAR, ["item_1"]);
    expect(results[0]).toEqual({ itemId: "item_1", status: "already", price: 0 });
    expect(totalGold).toBe(0);
    expect(mockPrisma.itemEvent.createMany).not.toHaveBeenCalled();
  });

  it("rejects a not-found item", async () => {
    mockPrisma.itemInstance.findMany.mockResolvedValue([]);
    const { results } = await sellItems(CHAR, ["ghost"]);
    expect(results[0]).toEqual({ itemId: "ghost", status: "rejected", reason: "not_found" });
  });

  it("dedupes ids: a duplicated id sells/credits exactly once", async () => {
    stockFindMany([{ templateId: "w_sword_t1_rusty", equippedSlot: null }]);
    mockPrisma.itemInstance.updateMany.mockResolvedValue({ count: 1 });
    const { results, totalGold } = await sellItems(CHAR, ["item_1", "item_1", "item_1"]);
    expect(results).toHaveLength(1);
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
    expect(totalGold).toBe(vendorPriceForTemplate("w_sword_t1_rusty"));
  });
});

describe("sellSchema", () => {
  it("accepts a well-formed batch", () => {
    expect(sellSchema.safeParse({ itemIds: ["a", "b"] }).success).toBe(true);
  });
  it("rejects empty, over-cap, empty-string id, and extra keys", () => {
    expect(sellSchema.safeParse({ itemIds: [] }).success).toBe(false);
    expect(
      sellSchema.safeParse({
        itemIds: Array.from({ length: MAX_SELL_BATCH + 1 }, (_, i) => `i${i}`),
      }).success,
    ).toBe(false);
    expect(sellSchema.safeParse({ itemIds: [""] }).success).toBe(false);
    expect(sellSchema.safeParse({ itemIds: ["a"], hacked: true }).success).toBe(false);
  });
});
