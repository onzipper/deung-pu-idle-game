/**
 * Headless correctness guard for the M7.9 "Grand Expansion" gear paper-doll
 * ladder — tiers 7-10, continuing `GEAR_TIER_SCALE`/`drawApexOrnament` past
 * the t1-6 band `rig.test.ts` already covers. Same convention as that file
 * (real `pixi.js` Graphics path-building, no canvas/WebGL needed): exercises
 * the REAL `createHeroView`/`updateHeroView` code against the REAL t7-10
 * `ITEM_TEMPLATES` entries the parallel M7.9 engine item-catalog task landed
 * (`w_sword_t7_frost`..`w_sword_t10_apocalypse` etc., `a_*_t7..t10_*`/
 * `a_infernal_t10_aegis`), not a hand-derived re-statement of the same math.
 */

import { describe, expect, it } from "vitest";
import type { Hero } from "@/engine/entities";
import { GROUND_Y } from "@/render/layout";
import { createHeroView, updateHeroView } from "@/render/views/heroView";

function makeHero(cls: Hero["cls"]): Hero {
  return {
    id: 1,
    cls,
    x: 0,
    y: 0,
    hp: 100,
    maxHp: 100,
    cd: 1,
    dead: false,
    reviveTimer: 0,
    skillCds: {},
    mana: 60,
    maxMana: 60,
    atkBuffMult: 1,
    atkBuffTimer: 0,
    level: 1,
    xp: 0,
    tier: 1,
    statPoints: 0,
    stats: { str: 8, dex: 4, int: 3, vit: 6 },
    autoSlots: ["sword_whirl", null, null],
    quest: null,
    equipped: { weapon: null, armor: null },
    command: null,
  };
}

/** Per-class t7-10 weapon templateId, per the M7.9 catalog (parallel engine
 * task, `src/engine/config/items.ts`). */
const WEAPON_BY_TIER: Record<Hero["cls"], Record<7 | 8 | 9 | 10, string>> = {
  swordsman: {
    7: "w_sword_t7_frost",
    8: "w_sword_t8_dune",
    9: "w_sword_t9_obsidian",
    10: "w_sword_t10_apocalypse",
  },
  archer: {
    7: "w_bow_t7_frost",
    8: "w_bow_t8_dune",
    9: "w_bow_t9_obsidian",
    10: "w_bow_t10_apocalypse",
  },
  mage: {
    7: "w_staff_t7_frost",
    8: "w_staff_t8_dune",
    9: "w_staff_t9_obsidian",
    10: "w_staff_t10_apocalypse",
  },
};
/** Universal (class-null) armor per tier. */
const ARMOR_BY_TIER: Record<7 | 8 | 9 | 10, string> = {
  7: "a_frost_t7_mail",
  8: "a_dune_t8_plate",
  9: "a_obsidian_t9_scale",
  10: "a_infernal_t10_aegis",
};

// t7-10 grows further than t6's own GEARED_MIN_Y allowance (rig.test.ts) —
// still a generous, meaningful band, nowhere near the double-subtraction
// bug's world-y≈0 collapse (which would put y+height near 0, not merely
// extend a bit further up for a bigger silhouette).
const MIN_Y = GROUND_Y - 165;
const MAX_Y = GROUND_Y + 10;

describe("M7.9 gear paper-doll: tiers 7-10 continue the t1-6 ladder", () => {
  for (const cls of ["swordsman", "archer", "mage"] as const) {
    for (const tier of [7, 8, 9, 10] as const) {
      it(`${cls} t${tier}: geometry lands in the GROUND_Y-relative band (regression guard)`, () => {
        const view = createHeroView();
        const hero = makeHero(cls);
        hero.equipped = { weapon: WEAPON_BY_TIER[cls][tier], armor: ARMOR_BY_TIER[tier] };
        updateHeroView(view, hero, { dt: 0, slot: 0, events: [], marching: false });
        const b = view.bodyRoot.getBounds();
        expect(b.y).toBeGreaterThan(MIN_Y);
        expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);
        expect(view.gearWeaponTier).toBe(tier);
        view.destroy({ children: true });
      });
    }

    it(`${cls}: weapon silhouette keeps growing monotonically t7 -> t10 (not a flat re-skin)`, () => {
      const spans: number[] = [];
      for (const tier of [7, 8, 9, 10] as const) {
        const view = createHeroView();
        const hero = makeHero(cls);
        hero.equipped = { weapon: WEAPON_BY_TIER[cls][tier], armor: null };
        updateHeroView(view, hero, { dt: 0, slot: 0, events: [], marching: false });
        const b = view.gearWeapon.getBounds();
        spans.push(b.width + b.height);
        view.destroy({ children: true });
      }
      // Each tier's ornament ladder (`drawApexOrnament`) strictly adds more
      // (a bigger halo, then an inner ring, then motes, then a max halo
      // pass) — bounds should never shrink going up the ladder.
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i]).toBeGreaterThanOrEqual(spans[i - 1]);
      }
      expect(spans[spans.length - 1]).toBeGreaterThan(spans[0]);
    });

    it(`${cls}: re-gearing from t6 -> t10 -> unequipped never leaves a stray empty-but-visible gear layer`, () => {
      const view = createHeroView();
      const hero = makeHero(cls);
      hero.equipped = {
        weapon: cls === "swordsman" ? "w_sword_t6_ragna" : cls === "archer" ? "w_bow_t6_ragna" : "w_staff_t6_ragna",
        armor: "a_aegis_t6_bulwark",
      };
      updateHeroView(view, hero, { dt: 0, slot: 0, events: [], marching: false });

      hero.equipped = { weapon: WEAPON_BY_TIER[cls][10], armor: ARMOR_BY_TIER[10] };
      updateHeroView(view, hero, { dt: 0.016, slot: 0, events: [], marching: false });
      let b = view.bodyRoot.getBounds();
      expect(b.y).toBeGreaterThan(MIN_Y);
      expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);

      hero.equipped = { weapon: null, armor: null };
      updateHeroView(view, hero, { dt: 0.016, slot: 0, events: [], marching: false });
      b = view.bodyRoot.getBounds();
      expect(b.y).toBeGreaterThan(GROUND_Y - 90);
      expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);
      expect(view.gearArmor.visible).toBe(false);

      view.destroy({ children: true });
    });
  }
});
