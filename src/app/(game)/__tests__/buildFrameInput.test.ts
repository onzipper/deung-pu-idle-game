import { describe, expect, it } from "vitest";
import { buildFrameInput } from "../buildFrameInput";
import type { PendingInput } from "@/ui/store/gameStore";

function emptyPending(): PendingInput {
  return {
    castSkills: [],
    setAutoSlots: [],
    challengeBoss: false,
    advanceStage: false,
    walkToZone: null,
    evolveHero: null,
    acceptQuest: null,
    allocateStat: null,
    buyShopItem: null,
    useConsumable: null,
    useReturnScroll: false,
    equip: null,
    setBotSettings: null,
    fastTravel: null,
    goldCredit: null,
    setAutoHunt: null,
    materialsDelta: null,
    moveTo: null,
    attackTarget: null,
    cancelCommand: false,
    setDailies: null,
    claimDaily: null,
    claimMainReward: null,
    useWarpScroll: null,
  };
}

describe("buildFrameInput hero-index remap", () => {
  it("remaps every castSkills entry's slot to myHeroIndex (targets MY hero, not hero[0])", () => {
    const pending = emptyPending();
    pending.castSkills = [
      { slot: 0, skillId: "sword_slash" },
      { slot: 0, skillId: "sword_guard" },
    ];
    const fi = buildFrameInput(pending, 3, 2);
    expect(fi.castSkills).toEqual([
      { slot: 2, skillId: "sword_slash" },
      { slot: 2, skillId: "sword_guard" },
    ]);
  });

  it("remaps evolveHero / acceptQuest to myHeroIndex when set", () => {
    const pending = emptyPending();
    pending.evolveHero = 0;
    pending.acceptQuest = 0;
    const fi = buildFrameInput(pending, 0, 1);
    expect(fi.evolveHero).toBe(1);
    expect(fi.acceptQuest).toBe(1);
  });

  it("leaves setAutoSlots[].slot (an auto-cast slot, NOT a hero index) untouched", () => {
    const pending = emptyPending();
    pending.setAutoSlots = [{ slot: 1, skillId: "mage_bolt" }];
    const fi = buildFrameInput(pending, 0, 2);
    expect(fi.setAutoSlots).toEqual([{ slot: 1, skillId: "mage_bolt" }]);
  });

  it("myHeroIndex 0 deep-equals the legacy solo literal for a representative full pending", () => {
    const pending = emptyPending();
    pending.castSkills = [{ slot: 0, skillId: "sword_slash" }];
    pending.setAutoSlots = [{ slot: 2, skillId: "mage_bolt" }];
    pending.challengeBoss = true;
    pending.advanceStage = true;
    pending.walkToZone = { mapId: "map1", zoneIdx: 3 };
    pending.evolveHero = 0;
    pending.acceptQuest = 0;
    pending.allocateStat = { str: 3 };
    pending.buyShopItem = { item: "hpPotion", qty: 5 };
    pending.useConsumable = "manaPotion";
    pending.useReturnScroll = true;
    pending.equip = { slot: "weapon", templateId: "t7_sword", refineLevel: 2 };
    pending.setBotSettings = { sellTripEnabled: true };
    pending.fastTravel = { mapId: "map2", zoneIdx: 1 };
    pending.goldCredit = 120;
    pending.setAutoHunt = true;
    pending.materialsDelta = -3;
    pending.moveTo = { x: 200 };
    pending.attackTarget = { id: 42 };
    pending.cancelCommand = true;
    pending.setDailies = { serverDay: 5, questIds: ["killMobs"] };
    pending.claimDaily = "killMobs";
    pending.claimMainReward = "ch1";
    pending.useWarpScroll = { mapId: "map3", zoneIdx: 2 };

    // The exact object the pre-refactor in-loop literal produced (solo, index 0).
    const legacy = {
      castSkills: pending.castSkills,
      setAutoSlots: pending.setAutoSlots,
      challengeBoss: true,
      advanceStage: true,
      walkToZone: pending.walkToZone,
      evolveHero: 0,
      acceptQuest: 0,
      allocateStat: pending.allocateStat,
      buyShopItem: pending.buyShopItem,
      useConsumable: pending.useConsumable,
      useReturnScroll: true,
      equip: pending.equip,
      setBotSettings: pending.setBotSettings,
      setAutoHunt: true,
      fastTravel: pending.fastTravel,
      goldCredit: 120,
      materialsDelta: -3,
      inventoryCount: 7,
      moveTo: pending.moveTo,
      attackTarget: pending.attackTarget,
      cancelCommand: true,
      setDailies: pending.setDailies,
      claimDaily: "killMobs",
      claimMainReward: "ch1",
      useWarpScroll: pending.useWarpScroll,
    };
    expect(buildFrameInput(pending, 7, 0)).toEqual(legacy);
  });
});
