import { describe, expect, it } from "vitest";
import { ITEM_TEMPLATES } from "@/engine/config/items";
import { selectAutoSellIds, type SellableTemplate } from "@/ui/gear/autoSell";
import type { InventoryItem } from "@/ui/gear/types";

const TEMPLATES: Record<string, SellableTemplate> = {
  common_sword: { rarity: "common", slot: "weapon", stats: { atk: 3 } },
  rare_sword: { rarity: "rare", slot: "weapon", stats: { atk: 8 } },
  epic_sword: { rarity: "epic", slot: "weapon", stats: { atk: 22 } },
  epic_dagger: { rarity: "epic", slot: "weapon", stats: { atk: 2 } }, // weaker epic (M7.9 epic-toggle tests)
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

describe("selectAutoSellIds", () => {
  it("sells commons when common is set to sell", () => {
    const sellIds = selectAutoSellIds(
      [item({ instanceId: "a", templateId: "common_sword" })],
      TEMPLATES,
      { common: "sell", rare: "off", keepBetterStat: false },
    );
    expect(sellIds).toEqual(["a"]);
  });

  it("does not touch commons when common is off", () => {
    const sellIds = selectAutoSellIds(
      [item({ instanceId: "a", templateId: "common_sword" })],
      TEMPLATES,
      { common: "off", rare: "off", keepBetterStat: false },
    );
    expect(sellIds).toEqual([]);
  });

  it("rares only dispose when rare's action is not off", () => {
    const items = [item({ instanceId: "a", templateId: "rare_sword" })];
    expect(
      selectAutoSellIds(items, TEMPLATES, { common: "sell", rare: "off", keepBetterStat: false }),
    ).toEqual([]);
    expect(
      selectAutoSellIds(items, TEMPLATES, { common: "sell", rare: "sell", keepBetterStat: false }),
    ).toEqual(["a"]);
  });

  it("NEVER disposes of epic, even with every rule maximally permissive", () => {
    const sellIds = selectAutoSellIds(
      [item({ instanceId: "a", templateId: "epic_sword" })],
      TEMPLATES,
      { common: "sell", rare: "sell", keepBetterStat: false },
    );
    expect(sellIds).toEqual([]);
  });

  it("NEVER disposes of an equipped item regardless of rules", () => {
    const sellIds = selectAutoSellIds(
      [item({ instanceId: "a", templateId: "common_sword", equippedSlot: "weapon" })],
      TEMPLATES,
      { common: "sell", rare: "sell", keepBetterStat: false },
    );
    expect(sellIds).toEqual([]);
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
    const sellIds = selectAutoSellIds(items, TEMPLATES, {
      common: "sell",
      rare: "sell",
      keepBetterStat: true,
    });
    expect(sellIds).toEqual([]); // "better" is kept, "equipped" is never touched
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
    const sellIds = selectAutoSellIds(items, TEMPLATES, {
      common: "sell",
      rare: "sell",
      keepBetterStat: true,
    });
    expect(sellIds.sort()).toEqual(["a2", "w1", "w2"]); // w3 + a1 kept as backups
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
    const sellIds = selectAutoSellIds(
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
    const sellIds = selectAutoSellIds(items, TEMPLATES, {
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
    const sellIds = selectAutoSellIds(items, TEMPLATES, {
      common: "sell",
      rare: "sell",
      keepBetterStat: false,
    });
    expect(sellIds).toEqual(["better"]);
  });

  it("REGRESSION (2026-07-07 bot warps but never sells): DEFAULT rules over a REAL full bag must dispose something", () => {
    // Owner report: the town trip fires but nothing sells. Guards the whole
    // selection contract end-to-end against the ACTUAL catalog (not the toy
    // fixture above): with the shipped default rules (common/rare "sell",
    // keep-guard ON) and a realistic drop-minted bag (equippedSlot: null on
    // every drop — the wire always sends null, never undefined), the sweep
    // must return a NON-EMPTY sell list.
    const catalog = ITEM_TEMPLATES as unknown as Record<string, SellableTemplate>;
    const weaponIds = Object.keys(ITEM_TEMPLATES).filter(
      (k) => ITEM_TEMPLATES[k].slot === "weapon",
    );
    const armorIds = Object.keys(ITEM_TEMPLATES).filter(
      (k) => ITEM_TEMPLATES[k].slot === "armor",
    );
    // A weapon + armor equipped, plus a bag full of duplicate & lower drops.
    const bag: InventoryItem[] = [
      item({ instanceId: "eqW", templateId: weaponIds[2], slot: "weapon", equippedSlot: "weapon" }),
      item({ instanceId: "eqA", templateId: armorIds[1], slot: "armor", equippedSlot: "armor" }),
      item({ instanceId: "w1", templateId: weaponIds[0], slot: "weapon" }),
      item({ instanceId: "w2", templateId: weaponIds[0], slot: "weapon" }),
      item({ instanceId: "w3", templateId: weaponIds[1], slot: "weapon", refineLevel: 5 }),
      item({ instanceId: "a1", templateId: armorIds[0], slot: "armor" }),
      item({ instanceId: "a2", templateId: armorIds[0], slot: "armor" }),
    ];
    const sellIds = selectAutoSellIds(
      bag,
      catalog,
      { common: "sell", rare: "sell", keepBetterStat: true },
      ITEM_TEMPLATES[weaponIds[0]].classReq ?? undefined,
    );
    expect(sellIds.length).toBeGreaterThan(0);
    // Equipped gear is never disposed.
    expect(sellIds).not.toContain("eqW");
    expect(sellIds).not.toContain("eqA");
  });

  it("epic option A: default (epic field omitted) still keeps epic, even with everything else permissive", () => {
    const sellIds = selectAutoSellIds(
      [item({ instanceId: "a", templateId: "epic_sword" })],
      TEMPLATES,
      { common: "sell", rare: "sell", keepBetterStat: false },
    );
    expect(sellIds).toEqual([]);
  });

  it("epic option A: toggling epic ON disposes only non-upgrade epics (kept-guard forced ON)", () => {
    const items = [
      item({ instanceId: "equipped", templateId: "rare_sword", equippedSlot: "weapon" }), // atk 8
      item({ instanceId: "weakEpic", templateId: "epic_dagger" }), // atk 2 < 8 -> disposable
      item({ instanceId: "strongEpic", templateId: "epic_sword" }), // atk 22 > 8 -> upgrade, kept
    ];
    // Global keepBetterStat is OFF, but epic protection must still apply.
    const sellIds = selectAutoSellIds(items, TEMPLATES, {
      common: "sell",
      rare: "sell",
      epic: "sell",
      keepBetterStat: false,
    });
    expect(sellIds).toEqual(["weakEpic"]);
  });

  it("epic option A: protection cannot be bypassed by the global keepBetterStat toggle", () => {
    const items = [
      item({ instanceId: "equipped", templateId: "rare_sword", equippedSlot: "weapon" }),
      item({ instanceId: "strongEpic", templateId: "epic_sword" }), // atk 22, an upgrade
    ];
    for (const keepBetterStat of [true, false]) {
      const sellIds = selectAutoSellIds(items, TEMPLATES, {
        common: "sell",
        rare: "sell",
        epic: "sell",
        keepBetterStat,
      });
      expect(sellIds).toEqual([]);
    }
  });

  it("epic option A: a t10-class best-backup epic for an EMPTY slot is never disposed", () => {
    // No gear equipped in the weapon slot at all — the epic is the strongest
    // candidate and must be kept as the best-backup pick, common still sells.
    const items = [
      item({ instanceId: "commonSword", templateId: "common_sword" }),
      item({ instanceId: "bestEpic", templateId: "epic_sword" }),
    ];
    const sellIds = selectAutoSellIds(items, TEMPLATES, {
      common: "sell",
      rare: "sell",
      epic: "sell",
      keepBetterStat: false, // forced protection must still hold the epic back
    });
    expect(sellIds).toEqual(["commonSword"]);
  });

  it("skips an unknown/retired template defensively", () => {
    const sellIds = selectAutoSellIds(
      [item({ instanceId: "a", templateId: "does_not_exist" })],
      TEMPLATES,
      { common: "sell", rare: "sell", keepBetterStat: false },
    );
    expect(sellIds).toEqual([]);
  });
});
