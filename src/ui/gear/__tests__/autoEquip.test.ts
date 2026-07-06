import { describe, expect, it } from "vitest";
import { selectAutoEquip } from "@/ui/gear/autoEquip";
import type { SellableTemplate } from "@/ui/gear/autoSell";
import type { InventoryItem } from "@/ui/gear/types";

const TEMPLATES: Record<string, SellableTemplate> = {
  common_sword: { rarity: "common", slot: "weapon", stats: { atk: 3 }, tier: 1 },
  rare_sword: { rarity: "rare", slot: "weapon", stats: { atk: 8 }, tier: 3 },
  archer_bow: {
    rarity: "rare",
    slot: "weapon",
    stats: { atk: 8 },
    classReq: "archer",
    tier: 3,
  },
  common_armor: { rarity: "common", slot: "armor", stats: { def: 1, hp: 20 }, tier: 1 },
  rare_armor: { rarity: "rare", slot: "armor", stats: { def: 4, hp: 55 }, tier: 3 },
};

function item(over: Partial<InventoryItem>): InventoryItem {
  return {
    instanceId: "id",
    templateId: "common_sword",
    slot: "weapon",
    equippedSlot: null,
    ...over,
  };
}

describe("selectAutoEquip", () => {
  it("fills EMPTY slots with the best equippable candidate", () => {
    const items = [
      item({ instanceId: "w1", templateId: "common_sword" }),
      item({ instanceId: "w2", templateId: "rare_sword" }),
      item({ instanceId: "a1", templateId: "common_armor", slot: "armor" }),
    ];
    const picks = selectAutoEquip(items, TEMPLATES, "swordsman");
    expect(picks).toEqual([
      { instanceId: "w2", templateId: "rare_sword", slot: "weapon" },
      { instanceId: "a1", templateId: "common_armor", slot: "armor" },
    ]);
  });

  it("swaps only on a STRICT stat upgrade (tie = no churn)", () => {
    const worn = [
      item({ instanceId: "worn", templateId: "rare_sword", equippedSlot: "weapon" }),
      item({ instanceId: "same", templateId: "rare_sword" }), // equal stats — no swap
      item({ instanceId: "worse", templateId: "common_sword" }),
    ];
    expect(selectAutoEquip(worn, TEMPLATES, "swordsman")).toEqual([]);
  });

  it("upgrades over the worn item when a strictly better candidate exists", () => {
    const items = [
      item({ instanceId: "worn", templateId: "common_sword", equippedSlot: "weapon" }),
      item({ instanceId: "up", templateId: "rare_sword" }),
    ];
    expect(selectAutoEquip(items, TEMPLATES, "swordsman")).toEqual([
      { instanceId: "up", templateId: "rare_sword", slot: "weapon" },
    ]);
  });

  it("never picks gear the hero's class cannot wear", () => {
    const items = [item({ instanceId: "bow", templateId: "archer_bow" })];
    expect(selectAutoEquip(items, TEMPLATES, "swordsman")).toEqual([]);
    // The right class DOES pick it up.
    expect(selectAutoEquip(items, TEMPLATES, "archer")).toEqual([
      { instanceId: "bow", templateId: "archer_bow", slot: "weapon" },
    ]);
  });

  it("deterministic tie-break: equal stats+tier picks the lower instanceId", () => {
    const items = [
      item({ instanceId: "b", templateId: "rare_sword" }),
      item({ instanceId: "a", templateId: "rare_sword" }),
    ];
    const picks = selectAutoEquip(items, TEMPLATES, "swordsman");
    expect(picks.map((p) => p.instanceId)).toEqual(["a"]);
  });

  it("skips instances whose template is unknown (retired) without crashing", () => {
    const items = [
      item({ instanceId: "ghost", templateId: "gone_from_catalog" }),
      item({ instanceId: "w1", templateId: "common_sword" }),
    ];
    expect(selectAutoEquip(items, TEMPLATES, "swordsman")).toEqual([
      { instanceId: "w1", templateId: "common_sword", slot: "weapon" },
    ]);
  });
});
