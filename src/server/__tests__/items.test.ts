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
    character: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
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
    refineAnnouncement: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
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
  salvageItems,
  refineItem,
  salvageSchema,
  refineSchema,
  CLAIM_GRACE,
  KILLS_PER_SEC_CEILING,
  MAX_CLAIM_BATCH,
  MAX_SELL_BATCH,
  MAX_SALVAGE_BATCH,
  ANNOUNCE_MIN_REFINE_LEVEL,
  recentAnnouncements,
} from "@/server/items";
import {
  maxSummedDropChance,
  vendorPriceForTemplate,
  INVENTORY_CAP,
} from "@/engine/config/items";
import { REFINE, refineCost, salvageYield } from "@/engine/config/refine";

const CHAR = "char_1";

function instanceRow(over: Record<string, unknown> = {}) {
  return {
    id: "item_1",
    templateId: "w_sword_t1_rusty",
    equippedSlot: null,
    origin: "drop",
    acquiredAt: new Date("2026-01-01T00:00:00Z"),
    refineLevel: 0,
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

describe("salvageItems — refine materials (M7.6)", () => {
  beforeEach(() => {
    mockPrisma.itemEvent.createMany.mockResolvedValue({ count: 0 });
  });

  function stockFindMany(rows: Record<string, unknown>[]): void {
    mockPrisma.itemInstance.findMany.mockResolvedValue(
      rows.map((r) => ({ id: "item_1", deletedAt: null, ...r })),
    );
  }

  it("salvages an unequipped item: atomic soft-delete + salvaged event + material credit", async () => {
    stockFindMany([{ templateId: "w_sword_t3_knight", equippedSlot: null }]);
    mockPrisma.itemInstance.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.character.update.mockResolvedValue({ materials: 12 });
    const gained = salvageYield(3, "rare"); // knight = tier 3, rare
    const now = new Date("2026-07-06T00:00:00Z");
    const { results, totalMaterials, materials } = await salvageItems(CHAR, ["item_1"], now);

    expect(results[0]).toEqual({ itemId: "item_1", status: "salvaged", yield: gained });
    expect(totalMaterials).toBe(gained);
    expect(materials).toBe(12);
    // conditional check-and-set guarded by deletedAt:null + equippedSlot:null
    expect(mockPrisma.itemInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "item_1", deletedAt: null, equippedSlot: null }),
        data: { deletedAt: now },
      }),
    );
    // authoritative counter credited by the WON set in the same tx
    expect(mockPrisma.character.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { materials: { increment: gained } } }),
    );
    expect(mockPrisma.itemEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ type: "salvaged" })] }),
    );
  });

  it("rejects an equipped item (reason equipped) — never auto-unequips, no materials", async () => {
    stockFindMany([{ equippedSlot: "weapon" }]);
    const { results, totalMaterials } = await salvageItems(CHAR, ["item_1"]);
    expect(results[0]).toEqual({ itemId: "item_1", status: "rejected", reason: "equipped" });
    expect(totalMaterials).toBe(0);
    expect(mockPrisma.itemInstance.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.character.update).not.toHaveBeenCalled();
  });

  it("does not double-credit an already-deleted item (status already, yield 0)", async () => {
    stockFindMany([{ equippedSlot: null, deletedAt: new Date("2026-01-01T00:00:00Z") }]);
    mockPrisma.character.findUnique.mockResolvedValue({ materials: 5 });
    const { results, totalMaterials, materials } = await salvageItems(CHAR, ["item_1"]);
    expect(results[0]).toEqual({ itemId: "item_1", status: "already", yield: 0 });
    expect(totalMaterials).toBe(0);
    expect(materials).toBe(5);
    expect(mockPrisma.character.update).not.toHaveBeenCalled();
  });

  it("credits at most once when the atomic write loses the race (count 0 → already)", async () => {
    stockFindMany([{ templateId: "w_sword_t1_rusty", equippedSlot: null }]);
    mockPrisma.itemInstance.updateMany.mockResolvedValue({ count: 0 }); // concurrent salvager won
    mockPrisma.character.findUnique.mockResolvedValue({ materials: 0 });
    const { results, totalMaterials } = await salvageItems(CHAR, ["item_1"]);
    expect(results[0]).toEqual({ itemId: "item_1", status: "already", yield: 0 });
    expect(totalMaterials).toBe(0);
    expect(mockPrisma.character.update).not.toHaveBeenCalled();
  });

  it("dedupes ids: a duplicated id salvages/credits exactly once", async () => {
    stockFindMany([{ templateId: "w_sword_t1_rusty", equippedSlot: null }]);
    mockPrisma.itemInstance.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.character.update.mockResolvedValue({ materials: 1 });
    const { results, totalMaterials } = await salvageItems(CHAR, ["item_1", "item_1", "item_1"]);
    expect(results).toHaveLength(1);
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
    expect(totalMaterials).toBe(salvageYield(1, "common")); // rusty = tier 1 common
  });
});

describe("refineItem — server-authoritative roll (M7.6)", () => {
  beforeEach(() => {
    mockPrisma.itemEvent.create.mockResolvedValue({});
    mockPrisma.character.updateMany.mockResolvedValue({ count: 1 }); // materials debit ok
    mockPrisma.itemInstance.updateMany.mockResolvedValue({ count: 1 }); // compare-and-set wins
    // Serves BOTH lookups inside the tx: the name read for a >=+8 announcement
    // (M7.9) and the final materials re-read — both go through the same
    // mocked `character.findUnique`.
    mockPrisma.character.findUnique.mockResolvedValue({ materials: 99, name: "TestHero" });
    mockPrisma.refineAnnouncement.create.mockResolvedValue({});
    mockPrisma.refineAnnouncement.deleteMany.mockResolvedValue({ count: 0 });
  });

  function stockItem(over: Record<string, unknown> = {}): void {
    mockPrisma.itemInstance.findFirst.mockResolvedValue({
      id: "item_1",
      templateId: "w_sword_t1_rusty", // tier 1
      refineLevel: 0,
      equippedSlot: null,
      ...over,
    });
  }

  it("success (+1): debits materials, writes refined event, returns new level + deltas", async () => {
    stockItem({ refineLevel: 0 }); // target +1 → chance 1.0
    const cost = refineCost(1, 1);
    const r = await refineItem(CHAR, "item_1", 1000, { roll: () => 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.outcome).toBe("success");
      expect(r.refineLevel).toBe(1);
      expect(r.materialsDelta).toBe(-cost.materials);
      expect(r.goldDelta).toBe(-cost.gold);
      expect(r.materials).toBe(99);
    }
    expect(mockPrisma.character.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ materials: { gte: cost.materials } }),
        data: { materials: { decrement: cost.materials } },
      }),
    );
    expect(mockPrisma.itemInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ refineLevel: 0, deletedAt: null }),
        data: { refineLevel: 1 },
      }),
    );
    expect(mockPrisma.itemEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "refined" }) }),
    );
  });

  it("degrade (−1) on a failed +4-7 attempt", async () => {
    stockItem({ refineLevel: 4 }); // target +5 → chance .75; roll .99 fails → degrade
    const r = await refineItem(CHAR, "item_1", 1e9, { roll: () => 0.99 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.outcome).toBe("degrade");
      expect(r.refineLevel).toBe(3);
    }
    expect(mockPrisma.itemInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { refineLevel: 3 } }),
    );
  });

  it("break: soft-destroys AND unequips (invariant 5) on a failed +8-10 attempt", async () => {
    stockItem({ refineLevel: 8, equippedSlot: "weapon" }); // target +9 → break on fail
    const now = new Date("2026-07-06T00:00:00Z");
    const r = await refineItem(CHAR, "item_1", 1e9, { roll: () => 0.99, now });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.outcome).toBe("break");
      expect(r.destroyed).toBe(true);
      expect(r.refineLevel).toBe(0);
    }
    expect(mockPrisma.itemInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ refineLevel: 8, deletedAt: null }),
        data: { deletedAt: now, equippedSlot: null },
      }),
    );
    expect(mockPrisma.itemEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "refined" }) }),
    );
  });

  it("rejects insufficient materials (guarded debit count 0) — nothing applied", async () => {
    stockItem({ refineLevel: 0 });
    mockPrisma.character.updateMany.mockResolvedValue({ count: 0 });
    const r = await refineItem(CHAR, "item_1", 1e9, { roll: () => 0 });
    expect(r).toEqual({ ok: false, reason: "insufficient_materials" });
    expect(mockPrisma.itemInstance.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.itemEvent.create).not.toHaveBeenCalled();
  });

  it("rejects insufficient gold before touching materials or the item", async () => {
    stockItem({ refineLevel: 0 }); // cost.gold = refineCost(1,1).gold > 0
    const r = await refineItem(CHAR, "item_1", 0, { roll: () => 0 });
    expect(r).toEqual({ ok: false, reason: "insufficient_gold" });
    expect(mockPrisma.character.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.itemInstance.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an item already at max +level", async () => {
    stockItem({ refineLevel: REFINE.maxRefine });
    const r = await refineItem(CHAR, "item_1", 1e9);
    expect(r).toEqual({ ok: false, reason: "max" });
  });

  it("rejects a missing/deleted item", async () => {
    mockPrisma.itemInstance.findFirst.mockResolvedValue(null);
    const r = await refineItem(CHAR, "nope", 1e9);
    expect(r).toEqual({ ok: false, reason: "not_found" });
  });

  it("aborts (not_found) when the compare-and-set loses the race — no double-apply", async () => {
    stockItem({ refineLevel: 0 });
    mockPrisma.itemInstance.updateMany.mockResolvedValue({ count: 0 }); // level already moved
    const r = await refineItem(CHAR, "item_1", 1e9, { roll: () => 0 });
    expect(r).toEqual({ ok: false, reason: "not_found" });
  });

  describe("M7.9 server-wide announcement — same-tx write on a >=+8 success", () => {
    it("ANNOUNCE_MIN_REFINE_LEVEL is +8 (owner spec)", () => {
      expect(ANNOUNCE_MIN_REFINE_LEVEL).toBe(8);
    });

    it("writes a RefineAnnouncement row (+ opportunistic prune) on a success landing at +8", async () => {
      stockItem({ refineLevel: 7 }); // target +8 → chance .45; roll 0 succeeds
      const now = new Date("2026-07-07T12:00:00Z");
      const r = await refineItem(CHAR, "item_1", 1e9, { roll: () => 0, now });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.refineLevel).toBe(8);
      expect(mockPrisma.refineAnnouncement.create).toHaveBeenCalledWith({
        data: {
          characterId: CHAR,
          charName: "TestHero",
          templateId: "w_sword_t1_rusty",
          refineLevel: 8,
        },
      });
      // Opportunistic prune piggybacked on the SAME write path (~1h horizon).
      expect(mockPrisma.refineAnnouncement.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: new Date(now.getTime() - 60 * 60 * 1000) } },
      });
    });

    it("does NOT announce a success below +8 (e.g. +1)", async () => {
      stockItem({ refineLevel: 0 }); // target +1 → chance 1.0, always succeeds
      const r = await refineItem(CHAR, "item_1", 1000, { roll: () => 0 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.refineLevel).toBe(1);
      expect(mockPrisma.refineAnnouncement.create).not.toHaveBeenCalled();
    });

    it("does NOT announce a break outcome even though the TARGET level was >=8", async () => {
      stockItem({ refineLevel: 8, equippedSlot: "weapon" }); // target +9 → break on fail
      const r = await refineItem(CHAR, "item_1", 1e9, { roll: () => 0.99 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.outcome).toBe("break");
      expect(mockPrisma.refineAnnouncement.create).not.toHaveBeenCalled();
    });

    it("does NOT announce a degrade outcome (fail on a +4-7 target)", async () => {
      stockItem({ refineLevel: 4 }); // target +5 → chance .75; roll .99 fails → degrade
      const r = await refineItem(CHAR, "item_1", 1e9, { roll: () => 0.99 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.outcome).toBe("degrade");
      expect(mockPrisma.refineAnnouncement.create).not.toHaveBeenCalled();
    });
  });
});

describe("recentAnnouncements — feed query shape + in-process cache (M7.9)", () => {
  beforeEach(() => {
    mockPrisma.refineAnnouncement.findMany.mockResolvedValue([
      {
        id: "ann_1",
        characterId: "char_2",
        charName: "Bob",
        templateId: "w_sword_t3_epic",
        refineLevel: 9,
        createdAt: new Date("2026-07-07T00:00:00Z"),
      },
    ]);
  });

  it("queries the last-5-minutes window newest-first capped at 10, mapped to the wire DTO shape", async () => {
    const now = new Date("2026-07-07T00:10:00Z");
    const result = await recentAnnouncements(now);
    expect(mockPrisma.refineAnnouncement.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: new Date(now.getTime() - 5 * 60 * 1000) } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    expect(result).toEqual([
      {
        id: "ann_1",
        characterId: "char_2",
        charName: "Bob",
        templateId: "w_sword_t3_epic",
        refineLevel: 9,
        at: "2026-07-07T00:00:00.000Z",
      },
    ]);
  });

  it("serves a repeat call within the cache TTL from cache (no second DB hit)", async () => {
    const now = new Date("2026-07-07T01:00:00Z");
    await recentAnnouncements(now);
    mockPrisma.refineAnnouncement.findMany.mockClear();
    await recentAnnouncements(new Date(now.getTime() + 5_000)); // +5s, within the 10s TTL
    expect(mockPrisma.refineAnnouncement.findMany).not.toHaveBeenCalled();
  });

  it("re-queries once the cache TTL has elapsed", async () => {
    const now = new Date("2026-07-07T02:00:00Z");
    await recentAnnouncements(now);
    mockPrisma.refineAnnouncement.findMany.mockClear();
    await recentAnnouncements(new Date(now.getTime() + 11_000)); // past the 10s TTL
    expect(mockPrisma.refineAnnouncement.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("salvageSchema / refineSchema", () => {
  it("salvageSchema accepts a batch and rejects empty/over-cap/extra", () => {
    expect(salvageSchema.safeParse({ itemIds: ["a", "b"] }).success).toBe(true);
    expect(salvageSchema.safeParse({ itemIds: [] }).success).toBe(false);
    expect(
      salvageSchema.safeParse({
        itemIds: Array.from({ length: MAX_SALVAGE_BATCH + 1 }, (_, i) => `i${i}`),
      }).success,
    ).toBe(false);
    expect(salvageSchema.safeParse({ itemIds: ["a"], hacked: true }).success).toBe(false);
  });
  it("refineSchema requires one non-empty itemId and rejects extras", () => {
    expect(refineSchema.safeParse({ itemId: "item_1" }).success).toBe(true);
    expect(refineSchema.safeParse({ itemId: "" }).success).toBe(false);
    expect(refineSchema.safeParse({ itemId: "a", extra: 1 }).success).toBe(false);
  });
});
