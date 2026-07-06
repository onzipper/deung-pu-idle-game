import { describe, expect, it } from "vitest";
import { selectAutoSellSalvageIds, type SellableTemplate } from "@/ui/gear/autoSell";
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

describe("selectAutoSellSalvageIds", () => {
  it("sells commons when common is set to sell", () => {
    const { sellIds, salvageIds } = selectAutoSellSalvageIds(
      [item({ instanceId: "a", templateId: "common_sword" })],
      TEMPLATES,
      { common: "sell", rare: "off", keepBetterStat: false },
    );
    expect(sellIds).toEqual(["a"]);
    expect(salvageIds).toEqual([]);
  });

  it("salvages commons when common is set to salvage", () => {
    const { sellIds, salvageIds } = selectAutoSellSalvageIds(
      [item({ instanceId: "a", templateId: "common_sword" })],
      TEMPLATES,
      { common: "salvage", rare: "off", keepBetterStat: false },
    );
    expect(salvageIds).toEqual(["a"]);
    expect(sellIds).toEqual([]);
  });

  it("does not touch commons when common is off", () => {
    const { sellIds, salvageIds } = selectAutoSellSalvageIds(
      [item({ instanceId: "a", templateId: "common_sword" })],
      TEMPLATES,
      { common: "off", rare: "off", keepBetterStat: false },
    );
    expect(sellIds).toEqual([]);
    expect(salvageIds).toEqual([]);
  });

  it("rares only dispose when rare's action is not off, matching the chosen action", () => {
    const items = [item({ instanceId: "a", templateId: "rare_sword" })];
    expect(
      selectAutoSellSalvageIds(items, TEMPLATES, {
        common: "sell",
        rare: "off",
        keepBetterStat: false,
      }),
    ).toEqual({ sellIds: [], salvageIds: [] });
    expect(
      selectAutoSellSalvageIds(items, TEMPLATES, {
        common: "sell",
        rare: "sell",
        keepBetterStat: false,
      }),
    ).toEqual({ sellIds: ["a"], salvageIds: [] });
    expect(
      selectAutoSellSalvageIds(items, TEMPLATES, {
        common: "sell",
        rare: "salvage",
        keepBetterStat: false,
      }),
    ).toEqual({ sellIds: [], salvageIds: ["a"] });
  });

  it("NEVER disposes of epic, even with every rule maximally permissive", () => {
    const { sellIds, salvageIds } = selectAutoSellSalvageIds(
      [item({ instanceId: "a", templateId: "epic_sword" })],
      TEMPLATES,
      { common: "salvage", rare: "salvage", keepBetterStat: false },
    );
    expect(sellIds).toEqual([]);
    expect(salvageIds).toEqual([]);
  });

  it("NEVER disposes of an equipped item regardless of rules", () => {
    const { sellIds, salvageIds } = selectAutoSellSalvageIds(
      [item({ instanceId: "a", templateId: "common_sword", equippedSlot: "weapon" })],
      TEMPLATES,
      { common: "sell", rare: "sell", keepBetterStat: false },
    );
    expect(sellIds).toEqual([]);
    expect(salvageIds).toEqual([]);
  });

  it("keep-guard: keeps a candidate that beats the equipped item's stat total (sell action)", () => {
    const items = [
      item({
        instanceId: "equipped",
        templateId: "common_sword",
        equippedSlot: "weapon",
      }),
      item({ instanceId: "better", templateId: "rare_sword" }), // atk 8 > equipped atk 3
    ];
    const { sellIds, salvageIds } = selectAutoSellSalvageIds(items, TEMPLATES, {
      common: "sell",
      rare: "sell",
      keepBetterStat: true,
    });
    expect(sellIds).toEqual([]); // "better" is kept, "equipped" is never touched
    expect(salvageIds).toEqual([]);
  });

  it("keep-guard parity: also keeps a stat-upgrade candidate when rare's action is salvage", () => {
    const items = [
      item({
        instanceId: "equipped",
        templateId: "common_sword",
        equippedSlot: "weapon",
      }),
      item({ instanceId: "better", templateId: "rare_sword" }), // atk 8 > equipped atk 3
    ];
    const { sellIds, salvageIds } = selectAutoSellSalvageIds(items, TEMPLATES, {
      common: "sell",
      rare: "salvage",
      keepBetterStat: true,
    });
    expect(sellIds).toEqual([]);
    expect(salvageIds).toEqual([]);
  });

  it("REGRESSION keep-guard: an EMPTY slot keeps ONLY the best backup, disposes the rest", () => {
    // 2026-07-06 bug: an empty slot baselined to 0, so EVERY item "beat" it and
    // was kept — auto-sell matched nothing and the sell-trip bot warp-looped.
    // v1.1: keep the single best candidate per empty slot, dispose of the copies.
    const items = [
      item({ instanceId: "w1", templateId: "common_sword" }),
      item({ instanceId: "w2", templateId: "common_sword" }),
      item({ instanceId: "w3", templateId: "rare_sword" }), // best weapon backup
      item({ instanceId: "a1", templateId: "common_armor" }),
      item({ instanceId: "a2", templateId: "common_armor" }), // a1 wins the id tie-break
    ]; // NOTHING equipped in either slot
    const { sellIds } = selectAutoSellSalvageIds(items, TEMPLATES, {
      common: "sell",
      rare: "sell",
      keepBetterStat: true,
    });
    expect(sellIds.sort()).toEqual(["a2", "w1", "w2"]); // w3 + a1 kept as backups
  });

  it("REGRESSION keep-guard parity: the empty-slot best-backup pick is action-agnostic", () => {
    // Same scenario as above but common is routed to salvage instead of sell —
    // the single-sweep guard must still keep exactly one backup per slot.
    const items = [
      item({ instanceId: "w1", templateId: "common_sword" }),
      item({ instanceId: "w2", templateId: "common_sword" }),
      item({ instanceId: "w3", templateId: "rare_sword" }), // best weapon backup
      item({ instanceId: "a1", templateId: "common_armor" }),
      item({ instanceId: "a2", templateId: "common_armor" }), // a1 wins the id tie-break
    ];
    const { salvageIds, sellIds } = selectAutoSellSalvageIds(items, TEMPLATES, {
      common: "salvage",
      rare: "sell",
      keepBetterStat: true,
    });
    expect(salvageIds.sort()).toEqual(["a2", "w1", "w2"]);
    expect(sellIds).toEqual([]);
  });

  it("empty-slot backup is scoped to the hero's class (foreign-class gear disposes)", () => {
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
    const { sellIds } = selectAutoSellSalvageIds(
      items,
      templates,
      { common: "sell", rare: "sell", keepBetterStat: true },
      "swordsman",
    );
    // The bow can't be this hero's backup → sold; the wearable sword is kept.
    expect(sellIds).toEqual(["bow"]);
  });

  it("keep-guard: still disposes of a candidate that does NOT beat the equipped item", () => {
    const items = [
      item({ instanceId: "equipped", templateId: "rare_sword", equippedSlot: "weapon" }),
      item({ instanceId: "worse", templateId: "common_sword" }), // atk 3 < equipped atk 8
    ];
    const { sellIds } = selectAutoSellSalvageIds(items, TEMPLATES, {
      common: "sell",
      rare: "sell",
      keepBetterStat: true,
    });
    expect(sellIds).toEqual(["worse"]);
  });

  it("keep-guard off: disposes of a stat-upgrade candidate anyway", () => {
    const items = [
      item({
        instanceId: "equipped",
        templateId: "common_sword",
        equippedSlot: "weapon",
      }),
      item({ instanceId: "better", templateId: "rare_sword" }),
    ];
    const { sellIds } = selectAutoSellSalvageIds(items, TEMPLATES, {
      common: "sell",
      rare: "sell",
      keepBetterStat: false,
    });
    expect(sellIds).toEqual(["better"]);
  });

  it("skips an unknown/retired template defensively", () => {
    const { sellIds, salvageIds } = selectAutoSellSalvageIds(
      [item({ instanceId: "a", templateId: "does_not_exist" })],
      TEMPLATES,
      { common: "sell", rare: "sell", keepBetterStat: false },
    );
    expect(sellIds).toEqual([]);
    expect(salvageIds).toEqual([]);
  });
});
