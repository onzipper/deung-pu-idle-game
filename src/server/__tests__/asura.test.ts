import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ดินแดนอสูร endgame server wave (docs/endgame-design.md v1.3) — trust-boundary unit
 * tests. Prisma is mocked (no DB), same idiom as the rest of the server layer. We exercise:
 * the daily sigil once/day P2002 gate, the legendary craft (idempotent claimKey /
 * one-per-class / consumes the t10 weapon / wrong-class 403 / not-t10), and that the refine
 * path rejects a legendary target.
 */

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    asuraSigilClaim: { create: vi.fn() },
    character: { findUnique: vi.fn(), updateMany: vi.fn() },
    itemInstance: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    itemEvent: { create: vi.fn() },
    refineAnnouncement: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import { Prisma } from "@prisma/client";
import {
  awakenLegendary,
  awakenSchema,
  claimAsuraSigil,
  craftLegendaryWeapon,
  craftSchema,
  legendaryClaimKey,
  LEGENDARY_CRAFT_KIND,
} from "@/server/asura";
import { refineItem } from "@/server/items";
import { serverDayFor } from "@/server/dailyQuests";
import { awakenCost } from "@/engine/config/items";

const CHAR = "char_1";
const NOW = new Date("2026-07-08T05:00:00Z"); // ~12:00 Bangkok

function instanceRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "leg_1",
    templateId: "w_legend_sword_emberfall",
    equippedSlot: null,
    origin: "craft",
    acquiredAt: new Date("2026-07-08T05:00:00Z"),
    refineLevel: 0,
    ...over,
  };
}

function p2002(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "6",
    meta: { target },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => unknown) =>
    fn(mockPrisma),
  );
});

describe("claimAsuraSigil (once/day ledger)", () => {
  it("stamps the Bangkok server-day and inserts the claim on the first claim of the day", async () => {
    mockPrisma.asuraSigilClaim.create.mockResolvedValue({ id: "sig_1" });
    const r = await claimAsuraSigil(CHAR, NOW);
    expect(r).toEqual({ ok: true, day: serverDayFor(NOW) });
    expect(mockPrisma.asuraSigilClaim.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { characterId: CHAR, day: serverDayFor(NOW) } }),
    );
  });

  it("rejects a second claim on the same day (P2002 → already_claimed)", async () => {
    mockPrisma.asuraSigilClaim.create.mockRejectedValue(p2002(["characterId", "day"]));
    const r = await claimAsuraSigil(CHAR, NOW);
    expect(r).toEqual({ ok: false, reason: "already_claimed" });
  });
});

describe("craftLegendaryWeapon", () => {
  it("consumes the t10 class weapon and mints the bind-on-craft legendary in one tx", async () => {
    mockPrisma.character.findUnique.mockResolvedValue({ baseClass: "swordsman", name: "อสูร" });
    mockPrisma.itemInstance.findUnique.mockResolvedValue(null); // not yet crafted
    mockPrisma.itemInstance.findFirst.mockResolvedValue({
      id: "w1",
      templateId: "w_sword_t10_apocalypse",
    });
    mockPrisma.itemInstance.create.mockResolvedValue(instanceRow());
    mockPrisma.itemInstance.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.itemEvent.create.mockResolvedValue({});
    mockPrisma.refineAnnouncement.create.mockResolvedValue({});

    const r = await craftLegendaryWeapon(CHAR, "w1", NOW);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe("minted");
      expect(r.item.templateId).toBe("w_legend_sword_emberfall");
      expect(r.item.kind).toBe("legendary");
    }
    // Legendary minted with the idempotency claimKey + origin "craft".
    expect(mockPrisma.itemInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: CHAR,
          templateId: "w_legend_sword_emberfall",
          origin: "craft",
          claimKey: legendaryClaimKey(CHAR, "swordsman"),
        }),
      }),
    );
    // t10 weapon consumed (soft-delete + unequip) with a `consumed` event.
    expect(mockPrisma.itemInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "w1", deletedAt: null }),
        data: expect.objectContaining({ deletedAt: NOW, equippedSlot: null }),
      }),
    );
    expect(mockPrisma.itemEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "consumed" }) }),
    );
    // First-craft-per-class announce (singleton per class).
    expect(mockPrisma.refineAnnouncement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: LEGENDARY_CRAFT_KIND,
          singletonKey: "legendary:swordsman",
          templateId: "w_legend_sword_emberfall",
        }),
      }),
    );
  });

  it("is idempotent: an already-crafted legendary returns existing and consumes nothing", async () => {
    mockPrisma.character.findUnique.mockResolvedValue({ baseClass: "swordsman", name: "อสูร" });
    mockPrisma.itemInstance.findUnique.mockResolvedValue(instanceRow()); // fast-path exists
    const r = await craftLegendaryWeapon(CHAR, "w1", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toBe("existing");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.itemInstance.updateMany).not.toHaveBeenCalled();
  });

  it("returns the existing legendary (idempotent) when the claimKey race is lost mid-tx (P2002, nothing consumed)", async () => {
    mockPrisma.character.findUnique.mockResolvedValue({ baseClass: "swordsman", name: "อสูร" });
    mockPrisma.itemInstance.findUnique
      .mockResolvedValueOnce(null) // fast-path: not yet crafted
      .mockResolvedValueOnce(instanceRow()); // post-race: now exists
    mockPrisma.itemInstance.findFirst.mockResolvedValue({
      id: "w1",
      templateId: "w_sword_t10_apocalypse",
    });
    mockPrisma.itemInstance.create.mockRejectedValue(p2002(["claimKey"]));

    const r = await craftLegendaryWeapon(CHAR, "w1", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toBe("existing");
    // The tx rolled back — the weapon was never soft-deleted.
    expect(mockPrisma.itemInstance.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a foreign-class t10 weapon (wrong_class → route 403), consuming nothing", async () => {
    mockPrisma.character.findUnique.mockResolvedValue({ baseClass: "swordsman", name: "อสูร" });
    mockPrisma.itemInstance.findUnique.mockResolvedValue(null);
    mockPrisma.itemInstance.findFirst.mockResolvedValue({
      id: "w1",
      templateId: "w_bow_t10_apocalypse", // classReq archer
    });
    const r = await craftLegendaryWeapon(CHAR, "w1", NOW);
    expect(r).toEqual({ ok: false, reason: "wrong_class" });
    expect(mockPrisma.itemInstance.create).not.toHaveBeenCalled();
    expect(mockPrisma.itemInstance.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a sub-t10 weapon (not_t10)", async () => {
    mockPrisma.character.findUnique.mockResolvedValue({ baseClass: "swordsman", name: "อสูร" });
    mockPrisma.itemInstance.findUnique.mockResolvedValue(null);
    mockPrisma.itemInstance.findFirst.mockResolvedValue({
      id: "w1",
      templateId: "w_sword_t9_obsidian", // tier 9
    });
    const r = await craftLegendaryWeapon(CHAR, "w1", NOW);
    expect(r).toEqual({ ok: false, reason: "not_t10" });
    expect(mockPrisma.itemInstance.create).not.toHaveBeenCalled();
  });

  it("rejects a missing / unowned material instance (no_weapon)", async () => {
    mockPrisma.character.findUnique.mockResolvedValue({ baseClass: "swordsman", name: "อสูร" });
    mockPrisma.itemInstance.findUnique.mockResolvedValue(null);
    mockPrisma.itemInstance.findFirst.mockResolvedValue(null);
    const r = await craftLegendaryWeapon(CHAR, "missing", NOW);
    expect(r).toEqual({ ok: false, reason: "no_weapon" });
  });
});

describe("craftSchema", () => {
  it("requires a bounded instanceId and rejects extras", () => {
    expect(craftSchema.safeParse({ instanceId: "w1" }).success).toBe(true);
    expect(craftSchema.safeParse({ instanceId: "" }).success).toBe(false);
    expect(craftSchema.safeParse({ instanceId: "w1", extra: 1 }).success).toBe(false);
  });
});

describe("awakenLegendary (ปลุกพลัง — guaranteed +1, no roll/break)", () => {
  const BIG_GOLD = 10_000_000;

  it("awakens +0 → +1: debits stones from Character.materials, patches refineLevel, returns signed deltas", async () => {
    mockPrisma.itemInstance.findFirst.mockResolvedValue(instanceRow({ refineLevel: 0 }));
    mockPrisma.character.updateMany.mockResolvedValue({ count: 1 }); // stone debit succeeded
    mockPrisma.itemInstance.updateMany.mockResolvedValue({ count: 1 }); // compare-and-set +1
    mockPrisma.itemEvent.create.mockResolvedValue({});
    mockPrisma.character.findUnique.mockResolvedValue({ materials: 4321 });

    const r = await awakenLegendary(CHAR, "leg_1", BIG_GOLD);

    const cost = awakenCost(1)!;
    expect(r).toEqual({
      ok: true,
      refineLevel: 1,
      materials: 4321,
      materialsDelta: -cost.stones,
      goldDelta: -cost.gold,
      cost,
    });
    // Stones debited atomically with the `>= cost.stones` guard.
    expect(mockPrisma.character.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CHAR, materials: { gte: cost.stones } },
        data: { materials: { decrement: cost.stones } },
      }),
    );
    // Compare-and-set on the level READ (guard refineLevel: 0), applied +1.
    expect(mockPrisma.itemInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "leg_1", deletedAt: null, refineLevel: 0 }),
        data: { refineLevel: 1 },
      }),
    );
    expect(mockPrisma.itemEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "awakened" }) }),
    );
  });

  it("caps at +5 (max) — nothing debited", async () => {
    mockPrisma.itemInstance.findFirst.mockResolvedValue(instanceRow({ refineLevel: 5 }));
    const r = await awakenLegendary(CHAR, "leg_1", BIG_GOLD);
    expect(r).toEqual({ ok: false, reason: "max" });
    expect(mockPrisma.character.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.itemInstance.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a non-legendary item (not_legendary) — the refine path owns ordinary gear", async () => {
    mockPrisma.itemInstance.findFirst.mockResolvedValue({
      id: "g1",
      templateId: "w_sword_t10_apocalypse", // ordinary t10 gear, not kind legendary
      refineLevel: 3,
    });
    const r = await awakenLegendary(CHAR, "g1", BIG_GOLD);
    expect(r).toEqual({ ok: false, reason: "not_legendary" });
    expect(mockPrisma.character.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a missing / unowned instance (not_found)", async () => {
    mockPrisma.itemInstance.findFirst.mockResolvedValue(null);
    const r = await awakenLegendary(CHAR, "nope", BIG_GOLD);
    expect(r).toEqual({ ok: false, reason: "not_found" });
  });

  it("insufficient gold: balance below the target cost → insufficient_gold, stones untouched", async () => {
    mockPrisma.itemInstance.findFirst.mockResolvedValue(instanceRow({ refineLevel: 0 }));
    const cost = awakenCost(1)!;
    const r = await awakenLegendary(CHAR, "leg_1", cost.gold - 1);
    expect(r).toEqual({ ok: false, reason: "insufficient_gold" });
    expect(mockPrisma.character.updateMany).not.toHaveBeenCalled();
  });

  it("insufficient stones: the atomic materials guard matches 0 rows → insufficient_materials", async () => {
    mockPrisma.itemInstance.findFirst.mockResolvedValue(instanceRow({ refineLevel: 0 }));
    mockPrisma.character.updateMany.mockResolvedValue({ count: 0 }); // not enough stones
    const r = await awakenLegendary(CHAR, "leg_1", BIG_GOLD);
    expect(r).toEqual({ ok: false, reason: "insufficient_materials" });
    // The item level was never touched (tx would roll the debit back too).
    expect(mockPrisma.itemInstance.updateMany).not.toHaveBeenCalled();
  });

  it("idempotent-safety: a concurrent/retried awaken that already moved the level matches 0 rows → not_found (no double-apply)", async () => {
    mockPrisma.itemInstance.findFirst.mockResolvedValue(instanceRow({ refineLevel: 0 }));
    mockPrisma.character.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.itemInstance.updateMany.mockResolvedValue({ count: 0 }); // level already advanced
    const r = await awakenLegendary(CHAR, "leg_1", BIG_GOLD);
    expect(r).toEqual({ ok: false, reason: "not_found" });
    expect(mockPrisma.itemEvent.create).not.toHaveBeenCalled();
  });
});

describe("awakenSchema", () => {
  it("requires a bounded instanceId and rejects extras", () => {
    expect(awakenSchema.safeParse({ instanceId: "leg_1" }).success).toBe(true);
    expect(awakenSchema.safeParse({ instanceId: "" }).success).toBe(false);
    expect(awakenSchema.safeParse({ instanceId: "leg_1", extra: 1 }).success).toBe(false);
  });
});

describe("awakenCost ladder (owner-tuned long-tail sink)", () => {
  it("escalates gold + stones across +1..+5 and is undefined past the cap", () => {
    expect(awakenCost(1)).toEqual({ gold: 100_000, stones: 250 });
    expect(awakenCost(5)).toEqual({ gold: 1_500_000, stones: 3_000 });
    expect(awakenCost(6)).toBeNull();
    // Strictly increasing on both axes.
    for (let lvl = 2; lvl <= 5; lvl++) {
      expect(awakenCost(lvl)!.gold).toBeGreaterThan(awakenCost(lvl - 1)!.gold);
      expect(awakenCost(lvl)!.stones).toBeGreaterThan(awakenCost(lvl - 1)!.stones);
    }
  });
});

describe("refineItem rejects a legendary target", () => {
  it("refuses to server-refine a legendary weapon (awakening is engine-side)", async () => {
    mockPrisma.itemInstance.findFirst.mockResolvedValue({
      id: "leg_1",
      templateId: "w_legend_sword_emberfall",
      refineLevel: 0,
      equippedSlot: "weapon",
    });
    const r = await refineItem(CHAR, "leg_1", 1_000_000);
    expect(r).toEqual({ ok: false, reason: "legendary" });
    // Never rolled / debited materials.
    expect(mockPrisma.character.updateMany).not.toHaveBeenCalled();
  });
});
