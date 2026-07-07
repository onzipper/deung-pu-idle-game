import { describe, expect, it } from "vitest";
import { sellPriceOf, sumSellPrices, toggleSelected } from "@/ui/gear/multiSelect";
import type { InventoryItem } from "@/ui/gear/types";

function item(over: Partial<InventoryItem>): InventoryItem {
  return {
    instanceId: "id",
    templateId: "w_sword_t1_rusty",
    slot: "weapon",
    equippedSlot: null,
    refineLevel: 0,
    ...over,
  };
}

describe("toggleSelected", () => {
  it("adds an unselected id", () => {
    expect(toggleSelected([], "a")).toEqual(["a"]);
    expect(toggleSelected(["a"], "b")).toEqual(["a", "b"]);
  });

  it("removes an already-selected id, leaving the rest in place", () => {
    expect(toggleSelected(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});

describe("sellPriceOf / sumSellPrices", () => {
  it("matches vendorPriceForTemplate's tier^2 * rarityMult formula, refine-agnostic", () => {
    const common = item({ templateId: "w_sword_t1_rusty", refineLevel: 0 }); // tier1 common: round(1*1)=1
    const commonRefined = item({ templateId: "w_sword_t1_rusty", refineLevel: 7 }); // same price, refine doesn't matter
    const rare = item({ templateId: "w_sword_t3_knight" }); // tier3 rare: round(9*1.5)=14
    const epic = item({ templateId: "w_sword_t6_ragna" }); // tier6 epic: round(36*2.5)=90

    expect(sellPriceOf(common)).toBe(1);
    expect(sellPriceOf(commonRefined)).toBe(sellPriceOf(common));
    expect(sellPriceOf(rare)).toBe(14);
    expect(sellPriceOf(epic)).toBe(90);
  });

  it("sums across a selection and returns 0 for an empty list", () => {
    expect(sumSellPrices([])).toBe(0);
    expect(
      sumSellPrices([
        item({ templateId: "w_sword_t1_rusty" }),
        item({ templateId: "w_sword_t3_knight" }),
      ]),
    ).toBe(1 + 14);
  });

  it("returns 0 for an unknown/retired templateId (defensive, mirrors vendorPriceForTemplate)", () => {
    expect(sellPriceOf(item({ templateId: "not_a_real_template" }))).toBe(0);
  });
});
