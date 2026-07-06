import { describe, expect, it } from "vitest";
import { selectAutoSellItemIds, type SellableTemplate } from "@/ui/gear/autoSell";
import type { InventoryItem } from "@/ui/gear/types";

const TEMPLATES: Record<string, SellableTemplate> = {
  common_sword: { rarity: "common", slot: "weapon", stats: { atk: 3 } },
  rare_sword: { rarity: "rare", slot: "weapon", stats: { atk: 8 } },
  epic_sword: { rarity: "epic", slot: "weapon", stats: { atk: 22 } },
  common_armor: { rarity: "common", slot: "armor", stats: { def: 1, hp: 20 } },
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

describe("selectAutoSellItemIds", () => {
  it("sells commons when sellCommon is on", () => {
    const ids = selectAutoSellItemIds(
      [item({ instanceId: "a", templateId: "common_sword" })],
      TEMPLATES,
      { sellCommon: true, sellRare: false, keepBetterStat: false },
    );
    expect(ids).toEqual(["a"]);
  });

  it("does not sell commons when sellCommon is off", () => {
    const ids = selectAutoSellItemIds(
      [item({ instanceId: "a", templateId: "common_sword" })],
      TEMPLATES,
      { sellCommon: false, sellRare: false, keepBetterStat: false },
    );
    expect(ids).toEqual([]);
  });

  it("sells rares only when sellRare is on", () => {
    const items = [item({ instanceId: "a", templateId: "rare_sword" })];
    expect(
      selectAutoSellItemIds(items, TEMPLATES, {
        sellCommon: true,
        sellRare: false,
        keepBetterStat: false,
      }),
    ).toEqual([]);
    expect(
      selectAutoSellItemIds(items, TEMPLATES, {
        sellCommon: true,
        sellRare: true,
        keepBetterStat: false,
      }),
    ).toEqual(["a"]);
  });

  it("NEVER sells epic, even with every rule maximally permissive", () => {
    const ids = selectAutoSellItemIds(
      [item({ instanceId: "a", templateId: "epic_sword" })],
      TEMPLATES,
      { sellCommon: true, sellRare: true, keepBetterStat: false },
    );
    expect(ids).toEqual([]);
  });

  it("NEVER sells an equipped item regardless of rules", () => {
    const ids = selectAutoSellItemIds(
      [item({ instanceId: "a", templateId: "common_sword", equippedSlot: "weapon" })],
      TEMPLATES,
      { sellCommon: true, sellRare: true, keepBetterStat: false },
    );
    expect(ids).toEqual([]);
  });

  it("keep-guard: keeps a candidate that beats the equipped item's stat total", () => {
    const items = [
      item({
        instanceId: "equipped",
        templateId: "common_sword",
        equippedSlot: "weapon",
      }),
      item({ instanceId: "better", templateId: "rare_sword" }), // atk 8 > equipped atk 3
    ];
    const ids = selectAutoSellItemIds(items, TEMPLATES, {
      sellCommon: true,
      sellRare: true,
      keepBetterStat: true,
    });
    expect(ids).toEqual([]); // "better" is kept, "equipped" is never touched
  });

  it("REGRESSION keep-guard: an EMPTY slot keeps ONLY the best backup, sells the rest", () => {
    // 2026-07-06 bug: an empty slot baselined to 0, so EVERY item "beat" it and
    // was kept — auto-sell matched nothing and the sell-trip bot warp-looped.
    // v1.1: keep the single best candidate per empty slot, sell the copies.
    const items = [
      item({ instanceId: "w1", templateId: "common_sword" }),
      item({ instanceId: "w2", templateId: "common_sword" }),
      item({ instanceId: "w3", templateId: "rare_sword" }), // best weapon backup
      item({ instanceId: "a1", templateId: "common_armor" }),
      item({ instanceId: "a2", templateId: "common_armor" }), // a1 wins the id tie-break
    ]; // NOTHING equipped in either slot
    const ids = selectAutoSellItemIds(items, TEMPLATES, {
      sellCommon: true,
      sellRare: true,
      keepBetterStat: true,
    });
    expect(ids.sort()).toEqual(["a2", "w1", "w2"]); // w3 + a1 kept as backups
  });

  it("empty-slot backup is scoped to the hero's class (foreign-class gear sells)", () => {
    const templates = {
      ...TEMPLATES,
      archer_bow: {
        rarity: "rare",
        slot: "weapon",
        stats: { atk: 8 },
        classReq: "archer",
      } as const,
    };
    const items = [
      item({ instanceId: "bow", templateId: "archer_bow" }), // unwearable by a swordsman
      item({ instanceId: "sword", templateId: "common_sword" }),
    ];
    const ids = selectAutoSellItemIds(
      items,
      templates,
      { sellCommon: true, sellRare: true, keepBetterStat: true },
      "swordsman",
    );
    // The bow can't be this hero's backup → sold; the wearable sword is kept.
    expect(ids).toEqual(["bow"]);
  });

  it("keep-guard: still sells a candidate that does NOT beat the equipped item", () => {
    const items = [
      item({ instanceId: "equipped", templateId: "rare_sword", equippedSlot: "weapon" }),
      item({ instanceId: "worse", templateId: "common_sword" }), // atk 3 < equipped atk 8
    ];
    const ids = selectAutoSellItemIds(items, TEMPLATES, {
      sellCommon: true,
      sellRare: true,
      keepBetterStat: true,
    });
    expect(ids).toEqual(["worse"]);
  });

  it("keep-guard off: sells a stat-upgrade candidate anyway", () => {
    const items = [
      item({
        instanceId: "equipped",
        templateId: "common_sword",
        equippedSlot: "weapon",
      }),
      item({ instanceId: "better", templateId: "rare_sword" }),
    ];
    const ids = selectAutoSellItemIds(items, TEMPLATES, {
      sellCommon: true,
      sellRare: true,
      keepBetterStat: false,
    });
    expect(ids).toEqual(["better"]);
  });

  it("skips an unknown/retired template defensively", () => {
    const ids = selectAutoSellItemIds(
      [item({ instanceId: "a", templateId: "does_not_exist" })],
      TEMPLATES,
      { sellCommon: true, sellRare: true, keepBetterStat: false },
    );
    expect(ids).toEqual([]);
  });
});
