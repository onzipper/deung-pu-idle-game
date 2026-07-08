import { describe, it, expect } from "vitest";
import {
  CONFIG,
  dpow,
  SAVE_VERSION,
  initGameState,
  migrate,
  step,
  toSaveData,
  zoneAt,
  shopPriceAt,
  SHOP_ITEMS,
  canUseConsumable,
  type GameState,
} from "@/engine";
import { soloSave } from "./helpers";

/**
 * M6 "เมืองหลัก + NPC shops": NPC consumables — town-only purchase, stack caps,
 * gold accounting, threshold + per-type-cooldown auto-use determinism, potion
 * quick-use, return-scroll teleport + respawn interplay, and SAVE v8->v9 migration.
 * All deterministic (no RNG in the consumables layer).
 */

const TOWN = { mapId: "map1", zoneIdx: 0 };

/** A solo state parked in the town zone (where the NPC shop is valid). */
function inTown(
  cls: "swordsman" | "archer" | "mage" = "swordsman",
  stage = 1,
): GameState {
  const s = initGameState(1, soloSave(cls, stage));
  s.location = { ...TOWN };
  s.stage = zoneAt(s.location).stage;
  return s;
}

describe("shop pricing", () => {
  it("follows the config formula from the base price", () => {
    for (const item of SHOP_ITEMS) {
      const base = CONFIG.shop.items[item].basePrice;
      expect(shopPriceAt(item, 1)).toBe(base);
      expect(shopPriceAt(item, 5)).toBe(Math.round(base * dpow(CONFIG.shop.priceStageBase, 4)));
    }
  });
  it("is FLAT at every depth (owner call 2026-07-08: fixed prices, no stage scaling)", () => {
    // priceStageBase is 1.0 — a frontier player pays the same as a fresh one.
    // If this fails because the knob was raised again, that's a deliberate
    // economy re-tune: update the patch notes + balance docs alongside it.
    for (const item of SHOP_ITEMS) {
      const base = CONFIG.shop.items[item].basePrice;
      expect(shopPriceAt(item, 10)).toBe(base);
      expect(shopPriceAt(item, 30)).toBe(base);
    }
  });
});

describe("buyShopItem — town-only + gold accounting", () => {
  it("buys in town, deducting exact stage-scaled gold and adding to the stack", () => {
    const s = inTown("swordsman", 1);
    s.gold = 10_000;
    const before = s.gold;
    step(s, { buyShopItem: { item: "hpPotion", qty: 3 } });
    expect(s.consumables.hpPotion).toBe(3);
    expect(before - s.gold).toBe(shopPriceAt("hpPotion", 1) * 3);
    expect(s.events.some((e) => e.type === "shopPurchase")).toBe(true);
  });

  it("REJECTS a purchase outside town (the NPC is only in town)", () => {
    const s = initGameState(1, soloSave("swordsman", 3)); // a farm zone
    expect(zoneAt(s.location).kind).toBe("farm");
    s.gold = 10_000;
    step(s, { buyShopItem: { item: "hpPotion", qty: 2 } });
    expect(s.consumables.hpPotion).toBe(0);
    expect(s.gold).toBe(10_000); // no gold spent
  });

  it("clamps the buy to the stack cap", () => {
    const s = inTown();
    s.gold = 10_000_000;
    step(s, { buyShopItem: { item: "manaPotion", qty: 999 } });
    expect(s.consumables.manaPotion).toBe(CONFIG.shop.stackCap);
  });

  it("buys only as many as gold allows (partial), never overspending", () => {
    const s = inTown("swordsman", 1);
    const unit = shopPriceAt("hpPotion", 1);
    s.gold = unit * 2 + 5; // affords exactly 2
    step(s, { buyShopItem: { item: "hpPotion", qty: 10 } });
    expect(s.consumables.hpPotion).toBe(2);
    expect(s.gold).toBe(5); // spent unit*2, kept the remainder
  });

  it("no-ops a buy the hero cannot afford even one of", () => {
    const s = inTown("swordsman", 1);
    s.gold = shopPriceAt("hpPotion", 1) - 1;
    const before = s.gold;
    step(s, { buyShopItem: { item: "hpPotion", qty: 1 } });
    expect(s.consumables.hpPotion).toBe(0);
    expect(s.gold).toBe(before);
  });
});

describe("useConsumable — quick-use potions", () => {
  it("restores % max HP, consumes one, and sets the per-type cooldown", () => {
    const s = initGameState(1, soloSave("swordsman", 2));
    s.consumables.hpPotion = 2;
    const h = s.heroes[0];
    h.hp = 1; // well below full
    step(s, { useConsumable: "hpPotion" });
    expect(s.consumables.hpPotion).toBe(1);
    expect(h.hp).toBeGreaterThan(1);
    expect(h.hp).toBeLessThanOrEqual(h.maxHp);
    expect(s.consumableCds.hpPotion).toBeGreaterThan(0);
    expect(s.events.some((e) => e.type === "consumableUsed")).toBe(true);
  });

  it("respects the cooldown — a second use is blocked until it elapses", () => {
    const s = initGameState(1, soloSave("swordsman", 2));
    s.consumables.hpPotion = 5;
    s.heroes[0].hp = 1;
    step(s, { useConsumable: "hpPotion" }); // uses one
    expect(s.consumables.hpPotion).toBe(4);
    s.heroes[0].hp = 1; // hurt again immediately
    step(s, { useConsumable: "hpPotion" }); // still on cooldown -> no-op
    expect(s.consumables.hpPotion).toBe(4);
  });

  it("does not waste a potion at a full pool", () => {
    const s = initGameState(1, soloSave("swordsman", 2));
    s.consumables.hpPotion = 3;
    s.heroes[0].hp = s.heroes[0].maxHp; // already full
    expect(canUseConsumable(s, "hpPotion")).toBe(false);
    step(s, { useConsumable: "hpPotion" });
    expect(s.consumables.hpPotion).toBe(3); // untouched
  });

  it("a return scroll is not a quick-use potion (no-op)", () => {
    const s = initGameState(1, soloSave("swordsman", 2));
    s.consumables.returnScroll = 1;
    step(s, { useConsumable: "returnScroll" });
    expect(s.consumables.returnScroll).toBe(1);
  });
});

describe("auto-use — threshold + cooldown, deterministic", () => {
  it("auto hp-potion fires below the threshold, then holds on cooldown", () => {
    const s = initGameState(1, soloSave("swordsman", 2));
    s.autoHpPotion = true;
    s.autoHpThreshold = CONFIG.shop.autoDefaults.hpThreshold;
    s.consumables.hpPotion = 5;
    const h = s.heroes[0];
    h.hp = h.maxHp * 0.1; // below 35%
    step(s, {}); // auto-use fires (no manual input)
    expect(s.consumables.hpPotion).toBe(4);
    const cd = s.consumableCds.hpPotion ?? 0;
    expect(cd).toBeGreaterThan(0);
    // Still hurt, but the cooldown blocks another auto-use next step.
    h.hp = h.maxHp * 0.1;
    step(s, {});
    expect(s.consumables.hpPotion).toBe(4);
  });

  it("auto mana-potion fires below the mana threshold", () => {
    const s = initGameState(1, soloSave("mage", 3));
    s.autoManaPotion = true;
    s.autoManaThreshold = CONFIG.shop.autoDefaults.manaThreshold;
    s.consumables.manaPotion = 3;
    const h = s.heroes[0];
    h.mana = h.maxMana * 0.05;
    step(s, {});
    expect(s.consumables.manaPotion).toBe(2);
    expect(h.mana).toBeGreaterThan(h.maxMana * 0.05);
  });

  it("does not auto-use when the toggle is off", () => {
    const s = initGameState(1, soloSave("swordsman", 2));
    s.autoHpPotion = false;
    s.consumables.hpPotion = 5;
    s.heroes[0].hp = s.heroes[0].maxHp * 0.05;
    step(s, {});
    expect(s.consumables.hpPotion).toBe(5);
  });

  it("the auto-use + cooldown loop is deterministic", () => {
    function run(): string {
      const s = initGameState(42, soloSave("archer", 3));
      s.autoCast = true;
      s.autoHpPotion = true;
      s.autoManaPotion = true;
      s.consumables.hpPotion = 30;
      s.consumables.manaPotion = 30;
      for (let i = 0; i < 1500; i++) step(s, {});
      return JSON.stringify({
        hp: s.consumables.hpPotion,
        mana: s.consumables.manaPotion,
        cds: s.consumableCds,
        gold: s.gold,
        kills: s.kills,
      });
    }
    expect(run()).toBe(run());
  });
});

describe("useReturnScroll — teleport + respawn interplay", () => {
  it("consumes a scroll and teleports to town from a farm zone (auto-return off = stays)", () => {
    const s = initGameState(1, soloSave("swordsman", 3));
    s.autoReturn = false;
    s.consumables.returnScroll = 2;
    expect(zoneAt(s.location).kind).toBe("farm");
    step(s, { useReturnScroll: true });
    expect(s.consumables.returnScroll).toBe(1);
    expect(zoneAt(s.location).kind).toBe("town");
    expect(s.traveling).toBeNull(); // instant, and no auto-return
    expect(s.events.some((e) => e.type === "townReturned")).toBe(true);
  });

  it("with auto-return ON, the scroll pops to town then walks back to farming", () => {
    const s = initGameState(1, soloSave("swordsman", 3));
    s.autoReturn = true;
    const farm = { ...s.lastFarmZone };
    s.consumables.returnScroll = 1;
    step(s, { useReturnScroll: true }); // -> town + begins auto-return transit
    expect(zoneAt(s.location).kind).toBe("town");
    expect(s.traveling).not.toBeNull();
    // Walks back to the last farm zone.
    let ok = false;
    for (let i = 0; i < 2000; i++) {
      step(s, {});
      if (s.traveling === null && zoneAt(s.location).kind === "farm") {
        ok = true;
        break;
      }
    }
    expect(ok).toBe(true);
    expect(s.location).toEqual(farm);
  });

  it("no-ops with no scroll held or when already in town", () => {
    const s = initGameState(1, soloSave("swordsman", 3));
    s.consumables.returnScroll = 0;
    step(s, { useReturnScroll: true });
    expect(zoneAt(s.location).kind).toBe("farm"); // didn't move

    const t = inTown();
    t.consumables.returnScroll = 1;
    step(t, { useReturnScroll: true });
    expect(t.consumables.returnScroll).toBe(1); // already in town -> not consumed
  });
});

describe("SAVE v8 -> v9 migration + round-trip", () => {
  it("backfills consumables to zeros for a pre-v9 save", () => {
    const m = migrate({
      version: 8,
      stage: 5,
      gold: 10,
      hero: { cls: "mage", level: 20, tier: 1 },
    });
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.consumables).toEqual({ hpPotion: 0, manaPotion: 0, returnScroll: 0, warpScroll: 0 });
  });

  it("preserves + clamps a v9 save's counts", () => {
    const m = migrate({
      version: 9,
      stage: 5,
      gold: 10,
      hero: { cls: "mage", level: 20, tier: 1 },
      consumables: { hpPotion: 500, manaPotion: 7, returnScroll: -3 },
    });
    expect(m.consumables.hpPotion).toBe(CONFIG.shop.stackCap); // clamped to cap
    expect(m.consumables.manaPotion).toBe(7);
    expect(m.consumables.returnScroll).toBe(0); // negative -> 0
  });

  it("round-trips consumables through initGameState + toSaveData", () => {
    const save = migrate({
      version: 9,
      stage: 8,
      gold: 55,
      hero: { cls: "archer", level: 22, tier: 2 },
      consumables: { hpPotion: 12, manaPotion: 4, returnScroll: 1 },
    });
    const restored = toSaveData(initGameState(9, save));
    expect(restored.consumables).toEqual({
      hpPotion: 12,
      manaPotion: 4,
      returnScroll: 1,
      warpScroll: 0,
    });
  });
});
