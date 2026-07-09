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
  // Mirrors a real LEGENDARY entry as seen through ALL_ITEM_TEMPLATES
  // (w_legend_sword_emberfall: atk 126 = t10's 70 × 1.8, tier 11).
  legend_sword: { rarity: "epic", slot: "weapon", stats: { atk: 126 }, tier: 11 },
  t10_sword: { rarity: "epic", slot: "weapon", stats: { atk: 70 }, tier: 10 },
};

function item(over: Partial<InventoryItem>): InventoryItem {
  return {
    instanceId: "id",
    templateId: "common_sword",
    slot: "weapon",
    equippedSlot: null,
    refineLevel: 0,
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

  it("with an UNKNOWN hero class, never touches class-restricted gear (boot race guard)", () => {
    // Inventory can hydrate before the first engine snapshot fills the store's
    // heroes — an undefined class must not pick classReq gear (the server would
    // 409 `class_req` every wrong-class drop), but unrestricted gear is still fine.
    const items = [
      item({ instanceId: "bow", templateId: "archer_bow" }),
      item({ instanceId: "a1", templateId: "common_armor", slot: "armor" }),
    ];
    expect(selectAutoEquip(items, TEMPLATES, undefined)).toEqual([
      { instanceId: "a1", templateId: "common_armor", slot: "armor" },
    ]);
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

  // ---- worn-LEGENDARY protection (owner report 2026-07-09: the bot swapped
  // ordinary drops over an equipped legendary because the gear-only template
  // map didn't know its id → the slot read as EMPTY) --------------------------

  it("never swaps a worn legendary out for ordinary gear (legendary resolvable in the record)", () => {
    const items = [
      item({ instanceId: "legend", templateId: "legend_sword", equippedSlot: "weapon" }),
      item({ instanceId: "t10", templateId: "t10_sword" }),
      item({ instanceId: "r", templateId: "rare_sword" }),
    ];
    expect(selectAutoEquip(items, TEMPLATES, "swordsman")).toEqual([]);
  });

  it("a worn item with an UNKNOWN template makes its slot UNSWAPPABLE (belt-and-braces guard)", () => {
    // Even if a caller ever regresses to a map that lacks the worn item's id,
    // an unknown worn item can never be judged "worse" — the bot must not
    // replace it. Armor slot stays independently functional.
    const items = [
      item({ instanceId: "mystery", templateId: "not_in_this_map", equippedSlot: "weapon" }),
      item({ instanceId: "t10", templateId: "t10_sword" }),
      item({ instanceId: "a1", templateId: "common_armor", slot: "armor" }),
    ];
    expect(selectAutoEquip(items, TEMPLATES, "swordsman")).toEqual([
      { instanceId: "a1", templateId: "common_armor", slot: "armor" },
    ]);
  });

  it("an UNEQUIPPED legendary in the bag wins the weapon pick over a worn t10", () => {
    const items = [
      item({ instanceId: "worn10", templateId: "t10_sword", equippedSlot: "weapon" }),
      item({ instanceId: "legend", templateId: "legend_sword" }),
    ];
    expect(selectAutoEquip(items, TEMPLATES, "swordsman")).toEqual([
      { instanceId: "legend", templateId: "legend_sword", slot: "weapon" },
    ]);
  });
});
