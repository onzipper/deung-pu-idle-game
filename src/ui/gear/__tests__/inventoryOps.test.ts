import { describe, expect, it } from "vitest";
import {
  applyEquipChange,
  applyUnequipChange,
  discoveredTemplateIds,
  mergeClaimedItems,
} from "@/ui/gear/inventoryOps";
import type { InventoryItem, ItemInstanceWire } from "@/ui/gear/types";

function item(over: Partial<InventoryItem> = {}): InventoryItem {
  return {
    instanceId: "i1",
    templateId: "w_sword_t1_rusty",
    slot: "weapon",
    equippedSlot: null,
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
