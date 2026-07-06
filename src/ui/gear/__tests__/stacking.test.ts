import { describe, expect, it } from "vitest";
import { groupIntoStacks } from "@/ui/gear/stacking";
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

describe("groupIntoStacks", () => {
  it("groups same-templateId instances into one stack with the right count", () => {
    const stacks = groupIntoStacks([
      item({ instanceId: "a" }),
      item({ instanceId: "b" }),
      item({ instanceId: "c", templateId: "a_cloth_t1_tunic", slot: "armor" }),
    ]);
    expect(stacks).toHaveLength(2);
    const sword = stacks.find((s) => s.templateId === "w_sword_t1_rusty")!;
    expect(sword.count).toBe(2);
    expect(sword.unequippedIds.sort()).toEqual(["a", "b"]);
  });

  it("picks an UNEQUIPPED instance as the representative when one exists", () => {
    const stacks = groupIntoStacks([
      item({ instanceId: "a", equippedSlot: "weapon" }),
      item({ instanceId: "b" }),
    ]);
    const sword = stacks[0];
    expect(sword.representativeId).toBe("b");
    expect(sword.equippedInstanceId).toBe("a");
  });

  it("falls back to the equipped instance as representative when the whole stack is worn", () => {
    const stacks = groupIntoStacks([item({ instanceId: "a", equippedSlot: "weapon" })]);
    expect(stacks[0].representativeId).toBe("a");
    expect(stacks[0].unequippedIds).toEqual([]);
  });

  it("is empty for an empty inventory", () => {
    expect(groupIntoStacks([])).toEqual([]);
  });

  it("M7.6: keeps a +0 and a +5 instance of the SAME template as separate stacks", () => {
    const stacks = groupIntoStacks([
      item({ instanceId: "a", refineLevel: 0 }),
      item({ instanceId: "b", refineLevel: 5 }),
      item({ instanceId: "c", refineLevel: 0 }),
    ]);
    expect(stacks).toHaveLength(2);
    const plain = stacks.find((s) => s.refineLevel === 0)!;
    const refined = stacks.find((s) => s.refineLevel === 5)!;
    expect(plain.count).toBe(2);
    expect(refined.count).toBe(1);
    expect(refined.representativeId).toBe("b");
  });

  it("M7.6: an equipped +3 stack keeps its own refine level + representative", () => {
    const stacks = groupIntoStacks([
      item({ instanceId: "a", refineLevel: 3, equippedSlot: "weapon" }),
      item({ instanceId: "b", refineLevel: 0 }),
    ]);
    expect(stacks).toHaveLength(2);
    const refined = stacks.find((s) => s.refineLevel === 3)!;
    expect(refined.equippedInstanceId).toBe("a");
    expect(refined.unequippedIds).toEqual([]);
  });
});
