/**
 * Headless correctness guard for the hero/enemy/boss rigs' transform math.
 *
 * `pixi.js` scene-graph math (Graphics path building + `Container` transform
 * composition) runs fine in plain Node — no canvas/WebGL needed for
 * `getBounds()` — so this exercises the REAL `createXView`/`updateXView`
 * code, not a hand-derived re-statement of the same math (which could
 * silently reproduce the same bug in the test itself).
 *
 * The bug this guards against: every rig container here sets `pivot ===
 * position` at some fixed point (hip/shoulder/feet/front) so it can rotate
 * about that point with zero net translation at rest. Pixi's transform is
 * `parent = position + R·(local − pivot)` — it already performs the
 * `local − pivot` subtraction. A part's Graphics path must therefore be
 * drawn in ABSOLUTE coordinates; pre-subtracting the same offset in the path
 * data (as task-2's first commit did) cancels it a second time and collapses
 * the whole part toward world y≈0 (the "hero parts floating in the sky" bug).
 *
 * These assertions would fail loudly (bounds near y≈0 instead of the
 * GROUND_Y-relative band) if that class of bug reappears in any rig.
 */

import { describe, expect, it } from "vitest";
import type { Enemy, Hero } from "@/engine/entities";
import { GROUND_Y } from "@/render/layout";
import { createEnemyView, updateEnemyView } from "@/render/views/enemyView";
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

function makeEnemy(kind: Enemy["kind"]): Enemy {
  return {
    id: 1,
    kind,
    x: 0,
    y: 0,
    hp: 20,
    maxHp: 20,
    atk: 5,
    speed: 40,
    size: 1,
    behavior: kind === "ranged" ? "ranged" : "melee",
    range: kind === "ranged" ? 160 : 0,
    cd: 1,
    engageOffset: 0,
    homeX: 0,
    aggressive: false,
    aggroRadius: 0,
    engaged: false,
  };
}

// Generous but meaningful band: the whole rig (head to feet, plus the HP bar
// a little above the head) must land within GROUND_Y-70..GROUND_Y+10. The
// double-subtraction bug collapsed parts to y≈-70..10 (near world y=0) —
// nowhere close to this band — so this reliably catches a regression without
// being so tight it breaks on ordinary tuning tweaks.
const MIN_Y = GROUND_Y - 90;
const MAX_Y = GROUND_Y + 10;

describe("heroView rig transform math (regression guard)", () => {
  for (const cls of ["swordsman", "archer", "mage"] as const) {
    it(`${cls}: rest-pose geometry lands in the GROUND_Y-relative band, not near world y=0`, () => {
      const view = createHeroView();
      updateHeroView(view, makeHero(cls), { dt: 0, slot: 0, events: [], marching: false });
      // `bodyRoot` only (legs/torso/arms) — NOT `view.getBounds()`, which
      // would also recurse into the sibling `reviveLabel` Text and try to
      // measure it via a canvas 2D context unavailable in headless Node;
      // `bodyRoot` is exactly the subtree the double-subtraction bug broke.
      const b = view.bodyRoot.getBounds();
      expect(b.y).toBeGreaterThan(MIN_Y);
      expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);
      view.destroy({ children: true });
    });
  }
});

describe("enemyView rig transform math (regression guard)", () => {
  for (const kind of ["normal", "fast", "tank", "ranged"] as const) {
    it(`${kind}: rest-pose geometry lands in the GROUND_Y-relative band, not near world y=0`, () => {
      const view = createEnemyView();
      updateEnemyView(view, makeEnemy(kind), { dt: 0, events: [] });
      const b = view.getBounds();
      expect(b.y).toBeGreaterThan(MIN_Y);
      expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);
      view.destroy({ children: true });
    });
  }
});

// ---------------------------------------------------------------------------
// M7 gear paper-doll (86d3... gear-wow pass): a fully tier-6/epic-geared hero
// grows a bigger weapon silhouette + armor accent overlay (`gearWeapon`/
// `gearArmor`, children of `weaponArm`/`upperBody` respectively) — this
// guards the SAME class of bug the bare-rig tests above do, extended to
// cover those two new Graphics (an empty-but-visible `gearArmor` when
// unequipped was exactly this bug in an early draft — see
// `buildGearArmor`'s "EMPTY but VISIBLE" doc comment).
// ---------------------------------------------------------------------------
const T6_WEAPON: Record<Hero["cls"], string> = {
  swordsman: "w_sword_t6_ragna",
  archer: "w_bow_t6_ragna",
  mage: "w_staff_t6_ragna",
};
const T6_ARMOR = "a_aegis_t6_bulwark";

// A fully-geared t6 rig is DELIBERATELY bigger (blade/bow/staff grow with
// tier per the GDD's "อาวุธใหญ่อลัง" — see `GEAR_TIER_SCALE` in
// `heroView.ts`), so its bounds legitimately extend a bit further above the
// bare-rig band above — a wider (but still meaningfully bounded, still
// nowhere near the world-y≈0 double-subtraction collapse) allowance here.
const GEARED_MIN_Y = GROUND_Y - 110;

describe("heroView rig transform math with tier-6/epic gear equipped (regression guard)", () => {
  for (const cls of ["swordsman", "archer", "mage"] as const) {
    it(`${cls}: t6 weapon + t6 armor geometry lands in the GROUND_Y-relative band, not near world y=0`, () => {
      const view = createHeroView();
      const hero = makeHero(cls);
      hero.equipped = { weapon: T6_WEAPON[cls], armor: T6_ARMOR };
      updateHeroView(view, hero, { dt: 0, slot: 0, events: [], marching: false });
      const b = view.bodyRoot.getBounds();
      expect(b.y).toBeGreaterThan(GEARED_MIN_Y);
      expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);
      view.destroy({ children: true });
    });

    it(`${cls}: re-gearing from nothing -> t6 -> unequipped never leaves a stray empty-but-visible gear layer`, () => {
      const view = createHeroView();
      const hero = makeHero(cls);
      // Frame 1: unequipped (bare rig look).
      updateHeroView(view, hero, { dt: 0, slot: 0, events: [], marching: false });
      let b = view.bodyRoot.getBounds();
      expect(b.y).toBeGreaterThan(MIN_Y);
      expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);

      // Frame 2: equip t6 weapon + t6 armor (forces a gearWeapon/gearArmor rebuild).
      hero.equipped = { weapon: T6_WEAPON[cls], armor: T6_ARMOR };
      updateHeroView(view, hero, { dt: 0.016, slot: 0, events: [], marching: false });
      b = view.bodyRoot.getBounds();
      expect(b.y).toBeGreaterThan(GEARED_MIN_Y);
      expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);

      // Frame 3: unequip again (gearArmor must hide itself, not just clear()).
      hero.equipped = { weapon: null, armor: null };
      updateHeroView(view, hero, { dt: 0.016, slot: 0, events: [], marching: false });
      b = view.bodyRoot.getBounds();
      expect(b.y).toBeGreaterThan(MIN_Y);
      expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);

      view.destroy({ children: true });
    });
  }
});
