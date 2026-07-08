import { describe, expect, it } from "vitest";
import { compareInventoryItems, sellAllCommonIds } from "@/ui/gear/sortRank";
import type { InventoryItem } from "@/ui/gear/types";

function item(overrides: Partial<InventoryItem> & Pick<InventoryItem, "instanceId" | "templateId">): InventoryItem {
  return {
    slot: "weapon",
    equippedSlot: null,
    refineLevel: 0,
    ...overrides,
  };
}

describe("compareInventoryItems", () => {
  it("puts the EQUIPPED item first regardless of tier/rarity/refine", () => {
    // a lowly t1 common, equipped, must outrank an unequipped t6 epic +10.
    const equippedWeak = item({
      instanceId: "a",
      templateId: "w_sword_t1_rusty",
      equippedSlot: "weapon",
      refineLevel: 0,
    });
    const unequippedStrong = item({
      instanceId: "b",
      templateId: "w_sword_t6_ragna",
      equippedSlot: null,
      refineLevel: 10,
    });
    const sorted = [unequippedStrong, equippedWeak].sort(compareInventoryItems);
    expect(sorted.map((i) => i.instanceId)).toEqual(["a", "b"]);
  });

  it("falls back to tier/refine/rarity/stat ranking among unequipped items", () => {
    const higherTier = item({ instanceId: "hi", templateId: "w_sword_t6_ragna" });
    const lowerTier = item({ instanceId: "lo", templateId: "w_sword_t1_rusty" });
    const sorted = [lowerTier, higherTier].sort(compareInventoryItems);
    expect(sorted.map((i) => i.instanceId)).toEqual(["hi", "lo"]);
  });

  it("never selects an equipped item for sellAllCommonIds", () => {
    const equippedCommon = item({
      instanceId: "eq",
      templateId: "w_sword_t1_rusty",
      equippedSlot: "weapon",
    });
    const unequippedCommon = item({ instanceId: "un", templateId: "w_sword_t1_rusty" });
    const ids = sellAllCommonIds([equippedCommon, unequippedCommon]);
    expect(ids).toEqual(["un"]);
  });
});
