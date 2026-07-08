import { describe, expect, it } from "vitest";
import { buildRealDollSlots, findEquipped, TEASER_SLOT_ORDER } from "@/ui/gear/dollModel";
import type { InventoryItem } from "@/ui/gear/types";

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

describe("findEquipped", () => {
  it("returns null on an empty inventory", () => {
    expect(findEquipped([], "weapon")).toBeNull();
  });

  it("returns null when nothing is equipped in the requested slot", () => {
    const inv = [item({ instanceId: "a" }), item({ instanceId: "b", equippedSlot: "armor" })];
    expect(findEquipped(inv, "weapon")).toBeNull();
  });

  it("returns the instance equipped in the requested slot, ignoring other slots", () => {
    const inv = [
      item({ instanceId: "a", equippedSlot: "weapon" }),
      item({ instanceId: "b", slot: "armor", equippedSlot: "armor" }),
    ];
    expect(findEquipped(inv, "weapon")?.instanceId).toBe("a");
    expect(findEquipped(inv, "armor")?.instanceId).toBe("b");
  });
});

describe("buildRealDollSlots", () => {
  it("builds weapon+armor slots with null items when nothing is equipped", () => {
    const [weapon, armor] = buildRealDollSlots([]);
    expect(weapon).toEqual({ kind: "real", slot: "weapon", item: null });
    expect(armor).toEqual({ kind: "real", slot: "armor", item: null });
  });

  it("attaches the equipped instance per slot", () => {
    const inv = [
      item({ instanceId: "sw", equippedSlot: "weapon" }),
      item({ instanceId: "ar", templateId: "a_cloth_t1_tunic", slot: "armor", equippedSlot: "armor" }),
      item({ instanceId: "spare" }),
    ];
    const [weapon, armor] = buildRealDollSlots(inv);
    expect(weapon.item?.instanceId).toBe("sw");
    expect(armor.item?.instanceId).toBe("ar");
  });
});

describe("TEASER_SLOT_ORDER", () => {
  it("has the 4 approved ghost slots in the mockup's spatial order", () => {
    expect(TEASER_SLOT_ORDER).toEqual(["helmet", "gloves", "boots", "amulet"]);
  });
});
