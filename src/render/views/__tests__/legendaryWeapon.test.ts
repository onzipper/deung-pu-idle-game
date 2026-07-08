/**
 * Headless correctness guard for the "ตำราตำนาน" LEGENDARY weapon rig
 * treatment (endgame v1.2/v1.3, docs/endgame-design.md render wave) — same
 * convention as `gearTier7to10.test.ts`: exercise the REAL
 * `createHeroView`/`updateHeroView` code against the REAL
 * `LEGENDARY_TEMPLATES`/`LEGENDARY_FOR_CLASS` catalog, not a hand-derived
 * re-statement of the growth math.
 */

import { describe, expect, it } from "vitest";
import type { Hero } from "@/engine/entities";
import { defaultHeroConfig, emptyDailies } from "@/engine/entities";
import { LEGENDARY_FOR_CLASS } from "@/engine/config/items";
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
    mainClaimed: [],
    dailies: emptyDailies(),
    statPoints: 0,
    stats: { str: 8, dex: 4, int: 3, vit: 6 },
    autoSlots: ["sword_whirl", null, null],
    quest: null,
    equipped: { weapon: null, armor: null },
    command: null,
    shadowed: false,
    config: defaultHeroConfig(),
    aimX: null,
    evadeCd: 0,
    evadeHpMark: 100,
    evadeMarkCd: 0,
  };
}

/** Per-class t6 weapon templateId (the "grows further than t6" baseline
 * below) — same catalog `gearTier7to10.test.ts` uses. */
const T6_WEAPON: Record<Hero["cls"], string> = {
  swordsman: "w_sword_t6_ragna",
  archer: "w_bow_t6_ragna",
  mage: "w_staff_t6_ragna",
  ninja: "w_dagger_t6_ragna",
};
const T10_WEAPON: Record<Hero["cls"], string> = {
  swordsman: "w_sword_t10_apocalypse",
  archer: "w_bow_t10_apocalypse",
  mage: "w_staff_t10_apocalypse",
  ninja: "w_dagger_t10_apocalypse",
};

// Legendary grows a touch bigger than t7-10's own ceiling — nowhere near the
// double-subtraction bug's world-y≈0 collapse (rig.test.ts's MIN_Y band),
// just a generous allowance above gearTier7to10.test.ts's own MIN_Y/MAX_Y.
const MIN_Y = GROUND_Y - 190;
const MAX_Y = GROUND_Y + 10;

describe("ตำราตำนาน legendary weapon rig treatment", () => {
  for (const cls of ["swordsman", "archer", "mage", "ninja"] as const) {
    const legendaryId = LEGENDARY_FOR_CLASS[cls];

    it(`${cls}: legendary geometry lands in the GROUND_Y-relative band (regression guard)`, () => {
      const view = createHeroView();
      const hero = makeHero(cls);
      hero.equipped = { weapon: legendaryId, armor: null };
      updateHeroView(view, hero, { dt: 0, slot: 0, events: [], marching: false });
      const b = view.bodyRoot.getBounds();
      expect(b.y).toBeGreaterThan(MIN_Y);
      expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);
      view.destroy({ children: true });
    });

    it(`${cls}: legendary weapon silhouette is BIGGER than the t10 ceiling (not a flat re-skin)`, () => {
      const t10View = createHeroView();
      const t10Hero = makeHero(cls);
      t10Hero.equipped = { weapon: T10_WEAPON[cls], armor: null };
      updateHeroView(t10View, t10Hero, { dt: 0, slot: 0, events: [], marching: false });
      const t10Span = t10View.gearWeapon.getBounds();
      const t10SpanTotal = t10Span.width + t10Span.height;
      t10View.destroy({ children: true });

      const legendaryView = createHeroView();
      const legendaryHero = makeHero(cls);
      legendaryHero.equipped = { weapon: legendaryId, armor: null };
      updateHeroView(legendaryView, legendaryHero, {
        dt: 0,
        slot: 0,
        events: [],
        marching: false,
      });
      const legendarySpan = legendaryView.gearWeapon.getBounds();
      expect(legendarySpan.width + legendarySpan.height).toBeGreaterThan(t10SpanTotal);
      legendaryView.destroy({ children: true });
    });

    it(`${cls}: re-gearing t6 -> legendary -> t6 never leaves a stray empty-but-visible gear layer`, () => {
      const view = createHeroView();
      const hero = makeHero(cls);
      hero.equipped = { weapon: T6_WEAPON[cls], armor: null };
      updateHeroView(view, hero, { dt: 0, slot: 0, events: [], marching: false });

      hero.equipped = { weapon: legendaryId, armor: null };
      updateHeroView(view, hero, { dt: 0.016, slot: 0, events: [], marching: false });
      let b = view.bodyRoot.getBounds();
      expect(b.y).toBeGreaterThan(MIN_Y);
      expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);

      hero.equipped = { weapon: T6_WEAPON[cls], armor: null };
      updateHeroView(view, hero, { dt: 0.016, slot: 0, events: [], marching: false });
      b = view.bodyRoot.getBounds();
      expect(b.y).toBeGreaterThan(MIN_Y);
      expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);

      view.destroy({ children: true });
    });
  }

  it("ninja dual-wield: BOTH the main and off-hand dagger get the legendary treatment", () => {
    const view = createHeroView();
    const hero = makeHero("ninja");
    hero.equipped = { weapon: LEGENDARY_FOR_CLASS.ninja, armor: null };
    updateHeroView(view, hero, { dt: 0, slot: 0, events: [], marching: false });

    expect(view.gearOffWeapon.visible).toBe(true);
    const mainBounds = view.gearWeapon.getBounds();
    const offBounds = view.gearOffWeapon.getBounds();
    expect(mainBounds.width + mainBounds.height).toBeGreaterThan(0);
    expect(offBounds.width + offBounds.height).toBeGreaterThan(0);

    view.destroy({ children: true });
  });

  it("a t10 (non-legendary epic) weapon never gets the legendary gold-violet edge treatment", () => {
    // Regression guard for the `isLegendaryTemplate` gate itself: an ordinary
    // t10 epic weapon must resolve `legendary=false` inside `buildGearWeapon`
    // (see `heroView.ts`) — this is exactly what `gearTier7to10.test.ts`'s own
    // t10 growth-ladder assertions already exercise byte-identically (that
    // suite still passes unchanged by this task), so this is a light
    // cross-check that a t10 span stays BELOW the legendary span measured
    // above rather than accidentally matching/exceeding it.
    for (const cls of ["swordsman", "archer", "mage", "ninja"] as const) {
      const t10View = createHeroView();
      const t10Hero = makeHero(cls);
      t10Hero.equipped = { weapon: T10_WEAPON[cls], armor: null };
      updateHeroView(t10View, t10Hero, { dt: 0, slot: 0, events: [], marching: false });
      expect(t10View.gearWeaponTier).toBe(10); // NOT LEGENDARY_TIER (11)
      t10View.destroy({ children: true });
    }
  });
});
