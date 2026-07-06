import { describe, expect, it } from "vitest";
import {
  applyEquipChange,
  applyRefineLevelChange,
  applyUnequipChange,
  discoveredTemplateIds,
  isNewTemplate,
  mergeClaimedItems,
  removeInstanceId,
  removeSalvagedItems,
  removeSoldItems,
} from "@/ui/gear/inventoryOps";
import type {
  InventoryItem,
  ItemInstanceWire,
  SalvageItemResultWire,
  SellItemResultWire,
} from "@/ui/gear/types";

function item(over: Partial<InventoryItem> = {}): InventoryItem {
  return {
    instanceId: "i1",
    templateId: "w_sword_t1_rusty",
    slot: "weapon",
    equippedSlot: null,
    refineLevel: 0,
    ...over,
  };
}

function wire(over: Partial<ItemInstanceWire> = {}): ItemInstanceWire {
  return {
    id: "i2",
    templateId: "a_cloth_t1_tunic",
    slot: "armor",
    equippedSlot: null,
    origin: "drop",
    acquiredAt: new Date().toISOString(),
    refineLevel: 0,
    ...over,
  };
}

describe("mergeClaimedItems", () => {
  it("adds a newly claimed item not already present", () => {
    const merged = mergeClaimedItems([item()], [wire()]);
    expect(merged).toHaveLength(2);
    expect(merged.some((i) => i.instanceId === "i2")).toBe(true);
  });

  it("does not duplicate an already-present instance id (idempotent claim retry)", () => {
    const merged = mergeClaimedItems(
      [item()],
      [wire({ id: "i1", templateId: "w_sword_t1_rusty", slot: "weapon" })],
    );
    expect(merged).toHaveLength(1);
  });

  it("is a no-op on an empty claimed list", () => {
    const items = [item()];
    expect(mergeClaimedItems(items, [])).toEqual(items);
  });
});

describe("applyEquipChange", () => {
  it("sets equippedSlot on the target item", () => {
    const result = applyEquipChange([item()], "i1", "weapon");
    expect(result[0].equippedSlot).toBe("weapon");
  });

  it("displaces any other item occupying the same slot", () => {
    const items = [
      item({ instanceId: "i1", equippedSlot: "weapon" }),
      item({ instanceId: "i2", equippedSlot: null }),
    ];
    const result = applyEquipChange(items, "i2", "weapon");
    const byId = Object.fromEntries(result.map((i) => [i.instanceId, i]));
    expect(byId.i2.equippedSlot).toBe("weapon");
    expect(byId.i1.equippedSlot).toBeNull();
  });

  it("leaves items in other slots untouched", () => {
    const items = [item({ instanceId: "i1", slot: "armor", equippedSlot: "armor" })];
    const result = applyEquipChange(items, "i2", "weapon");
    expect(result[0].equippedSlot).toBe("armor");
  });
});

describe("applyUnequipChange", () => {
  it("clears equippedSlot on the target item", () => {
    const result = applyUnequipChange([item({ equippedSlot: "weapon" })], "i1");
    expect(result[0].equippedSlot).toBeNull();
  });

  it("is idempotent on an already-unequipped item", () => {
    const result = applyUnequipChange([item({ equippedSlot: null })], "i1");
    expect(result[0].equippedSlot).toBeNull();
  });
});

describe("discoveredTemplateIds", () => {
  it("derives the set of currently-owned template ids", () => {
    const set = discoveredTemplateIds([
      item({ templateId: "w_sword_t1_rusty" }),
      item({ instanceId: "i2", templateId: "a_cloth_t1_tunic" }),
    ]);
    expect(set.has("w_sword_t1_rusty")).toBe(true);
    expect(set.has("a_cloth_t1_tunic")).toBe(true);
    expect(set.has("w_bow_t1_short")).toBe(false);
  });

  it("is empty for an empty inventory", () => {
    expect(discoveredTemplateIds([]).size).toBe(0);
  });
});

describe("removeSoldItems", () => {
  const results: SellItemResultWire[] = [
    { itemId: "sold1", status: "sold", price: 5 },
    { itemId: "already1", status: "already", price: 0 },
    { itemId: "rejected1", status: "rejected", reason: "equipped" },
  ];

  it("removes items with status sold or already", () => {
    const items = [
      item({ instanceId: "sold1" }),
      item({ instanceId: "already1" }),
      item({ instanceId: "rejected1" }),
      item({ instanceId: "untouched" }),
    ];
    const result = removeSoldItems(items, results);
    expect(result.map((i) => i.instanceId).sort()).toEqual(["rejected1", "untouched"]);
  });

  it("is a no-op copy when nothing sold/already", () => {
    const items = [item({ instanceId: "rejected1" })];
    expect(removeSoldItems(items, results)).toEqual(items);
  });
});

describe("removeSalvagedItems (M7.6)", () => {
  const results: SalvageItemResultWire[] = [
    { itemId: "salvaged1", status: "salvaged", yield: 3 },
    { itemId: "already1", status: "already", yield: 0 },
    { itemId: "rejected1", status: "rejected", reason: "equipped" },
  ];

  it("removes items with status salvaged or already", () => {
    const items = [
      item({ instanceId: "salvaged1" }),
      item({ instanceId: "already1" }),
      item({ instanceId: "rejected1" }),
      item({ instanceId: "untouched" }),
    ];
    const result = removeSalvagedItems(items, results);
    expect(result.map((i) => i.instanceId).sort()).toEqual(["rejected1", "untouched"]);
  });

  it("is a no-op copy when nothing salvaged/already", () => {
    const items = [item({ instanceId: "rejected1" })];
    expect(removeSalvagedItems(items, results)).toEqual(items);
  });
});

describe("applyRefineLevelChange (M7.6)", () => {
  it("bumps the target instance's refineLevel and leaves others untouched", () => {
    const items = [item({ instanceId: "i1", refineLevel: 0 }), item({ instanceId: "i2" })];
    const result = applyRefineLevelChange(items, "i1", 1);
    expect(result.find((i) => i.instanceId === "i1")?.refineLevel).toBe(1);
    expect(result.find((i) => i.instanceId === "i2")?.refineLevel).toBe(0);
  });
});

describe("removeInstanceId (M7.6 refine break)", () => {
  it("removes exactly the destroyed instance", () => {
    const items = [item({ instanceId: "i1" }), item({ instanceId: "i2" })];
    expect(removeInstanceId(items, "i1").map((i) => i.instanceId)).toEqual(["i2"]);
  });
});

describe("isNewTemplate", () => {
  it("is true for a template not in the session baseline", () => {
    expect(isNewTemplate("w_sword_t1_rusty", [])).toBe(true);
    expect(isNewTemplate("w_sword_t1_rusty", ["a_cloth_t1_tunic"])).toBe(true);
  });

  it("is false for a template already in the session baseline", () => {
    expect(isNewTemplate("w_sword_t1_rusty", ["w_sword_t1_rusty"])).toBe(false);
  });
});
