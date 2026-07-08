/**
 * Headless correctness guard for M8 party P6 "render the party" —
 * multi-hero pooling/z-order, the shadow-body dim/tint, and the nameplate
 * hook, exercised the same way `rig.test.ts` exercises the rig transform math
 * (real `pixi.js` Graphics/Container path-building runs fine in plain Node;
 * no canvas/WebGL needed).
 */

import { describe, expect, it } from "vitest";
import type { Hero } from "@/engine/entities";
import { defaultHeroConfig, emptyDailies } from "@/engine/entities";
import { Pool } from "@/render/Pool";
import { GROUND_Y } from "@/render/layout";
import {
  createHeroView,
  getChampionAnchorPos,
  updateHeroView,
  type HeroFrameContext,
} from "@/render/views/heroView";
import { Container } from "pixi.js";

function makeHero(id: number, cls: Hero["cls"], x: number): Hero {
  return {
    id,
    cls,
    x,
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
  };
}

const ctx = (over: Partial<HeroFrameContext> = {}): HeroFrameContext => ({
  dt: 1 / 60,
  slot: 0,
  events: [],
  marching: false,
  ...over,
});

const MIN_Y = GROUND_Y - 90;
const MAX_Y = GROUND_Y + 10;

describe("M8 party P6 — multiple hero views pool/build correctly", () => {
  it("3-hero state -> 3 distinct rigs, each with its own position and sane bounds", () => {
    const heroes = [
      makeHero(1, "swordsman", 100),
      makeHero(2, "archer", 220),
      makeHero(3, "mage", 340),
    ];
    const views = heroes.map((h, slot) => {
      const v = createHeroView();
      updateHeroView(v, h, ctx({ slot }));
      return v;
    });

    const xs = views.map((v) => v.position.x);
    expect(new Set(xs).size).toBe(3); // distinct positions
    expect(xs).toEqual([100, 220, 340]);

    for (const v of views) {
      const b = v.bodyRoot.getBounds();
      expect(b.y).toBeGreaterThan(MIN_Y);
      expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);
      v.destroy({ children: true });
    }
  });

  it("keeps the existing 1-hero (solo) visual output IDENTICAL: no nameplate/shadow tag, full alpha, default tint", () => {
    const view = createHeroView();
    const hero = makeHero(1, "swordsman", 0);
    updateHeroView(view, hero, ctx({ slot: 0 }));

    expect(view.nameplate.visible).toBe(false);
    expect(view.shadowTag.visible).toBe(false);
    expect(view.socialTitle.visible).toBe(false); // HOF seam never called -> no title tag
    expect(view.bodyRoot.alpha).toBe(1);
    expect(view.torso.tint).toBe(0xffffff);
    view.destroy({ children: true });
  });

  it("Pool: views are removed when a hero drops out of the array (mark-and-sweep)", () => {
    const layer = new Container();
    const pool = new Pool(layer, createHeroView);
    const heroes = [makeHero(1, "swordsman", 0), makeHero(2, "archer", 100)];

    pool.beginFrame();
    for (const h of heroes) updateHeroView(pool.get(h.id), h, ctx());
    pool.endFrame();
    expect(layer.children.length).toBe(2);

    // Hero 2 leaves the cohort (array shrinks) — its view must be swept.
    pool.beginFrame();
    updateHeroView(pool.get(heroes[0].id), heroes[0], ctx());
    pool.endFrame();
    expect(layer.children.length).toBe(1);
    expect(pool.peek(2)).toBeUndefined();
    expect(pool.peek(1)).toBeDefined();

    pool.clear();
  });
});

describe("M8 party P6 — nameplate hook", () => {
  it("shows only for non-primary slots (slot !== 0) with a supplied displayName", () => {
    const primary = createHeroView();
    updateHeroView(primary, makeHero(1, "swordsman", 0), ctx({ slot: 0, displayName: "Ally" }));
    expect(primary.nameplate.visible).toBe(false); // slot 0 never shows its own nameplate

    const ally = createHeroView();
    updateHeroView(ally, makeHero(2, "archer", 0), ctx({ slot: 1, displayName: "Ally" }));
    expect(ally.nameplate.visible).toBe(true);
    expect(ally.nameplate.text).toBe("Ally");

    const allyNoName = createHeroView();
    updateHeroView(allyNoName, makeHero(3, "mage", 0), ctx({ slot: 2, displayName: null }));
    expect(allyNoName.nameplate.visible).toBe(false); // no name supplied yet -> hidden

    primary.destroy({ children: true });
    ally.destroy({ children: true });
    allyNoName.destroy({ children: true });
  });
});

describe("M8 party P6 — shadow-body visuals", () => {
  it("dims + tags 'ออฟไลน์' once shadowed, reverts once unshadowed (0.4s ease, state-driven)", () => {
    const view = createHeroView();
    const hero = makeHero(1, "archer", 0);

    // A few frames while normal.
    for (let i = 0; i < 5; i++) updateHeroView(view, hero, ctx());
    expect(view.shadowTag.visible).toBe(false);
    expect(view.bodyRoot.alpha).toBe(1);
    expect(view.torso.tint).toBe(0xffffff);

    // Flip shadowed mid-scene; step past the full 0.4s fade.
    hero.shadowed = true;
    for (let i = 0; i < 60; i++) updateHeroView(view, hero, ctx()); // 1s of real time
    expect(view.shadowTag.visible).toBe(true);
    expect(view.bodyRoot.alpha).toBeLessThan(1);
    expect(view.bodyRoot.alpha).toBeCloseTo(0.45, 1);
    expect(view.torso.tint).not.toBe(0xffffff); // desaturation tint applied

    // Unshadow — eases back to normal.
    hero.shadowed = false;
    for (let i = 0; i < 60; i++) updateHeroView(view, hero, ctx());
    expect(view.shadowTag.visible).toBe(false);
    expect(view.bodyRoot.alpha).toBeCloseTo(1, 5);
    expect(view.torso.tint).toBe(0xffffff);

    view.destroy({ children: true });
  });

  it("a hero that SPAWNS already-shadowed dims immediately (state-driven, no fade-in pop)", () => {
    const view = createHeroView();
    const hero = makeHero(1, "mage", 0);
    hero.shadowed = true;

    // First frame ever for this view.
    updateHeroView(view, hero, ctx());

    expect(view.shadowTag.visible).toBe(true);
    expect(view.bodyRoot.alpha).toBeCloseTo(0.45, 1); // already fully dimmed, no ramp-up needed
    view.destroy({ children: true });
  });

  it("dead ghost tint is untouched by a non-shadowed hero's death (regression guard)", () => {
    const view = createHeroView();
    const hero = makeHero(1, "swordsman", 0);
    updateHeroView(view, hero, ctx());

    hero.dead = true;
    for (let i = 0; i < 60; i++) updateHeroView(view, hero, ctx()); // play out the death fall
    expect(view.bodyRoot.alpha).toBeCloseTo(0.5, 1); // GHOST_ALPHA, no shadow dim applied
    view.destroy({ children: true });
  });
});

describe("HOF seasonal rewards — title tag (docs/hof-rewards-design.md §3)", () => {
  it("shows for ANY slot (incl. primary/solo), unlike the nameplate", () => {
    const primary = createHeroView();
    updateHeroView(
      primary,
      makeHero(1, "swordsman", 0),
      ctx({ slot: 0, socialBadge: { title: "จ้าวยุทธภพ", champion: true } }),
    );
    expect(primary.socialTitle.visible).toBe(true);
    expect(primary.socialTitle.text).toBe("จ้าวยุทธภพ");
    // The nameplate stays governed by its own (non-primary + displayName) rule
    // — the title tag is a wholly separate lane/gate.
    expect(primary.nameplate.visible).toBe(false);

    const ally = createHeroView();
    updateHeroView(
      ally,
      makeHero(2, "archer", 0),
      ctx({ slot: 1, socialBadge: { title: "ยอดยุทธ์", champion: false } }),
    );
    expect(ally.socialTitle.visible).toBe(true);
    expect(ally.socialTitle.text).toBe("ยอดยุทธ์");

    primary.destroy({ children: true });
    ally.destroy({ children: true });
  });

  it("hides when the badge (or its title) is null/omitted", () => {
    const view = createHeroView();
    updateHeroView(view, makeHero(1, "mage", 0), ctx({ slot: 0, socialBadge: null }));
    expect(view.socialTitle.visible).toBe(false);

    updateHeroView(
      view,
      makeHero(1, "mage", 0),
      ctx({ slot: 0, socialBadge: { title: null, champion: true } }),
    );
    expect(view.socialTitle.visible).toBe(false); // champion aura is a separate concern (fx layer)

    view.destroy({ children: true });
  });

  it("clears again once the badge is dropped (no stale text/visibility)", () => {
    const view = createHeroView();
    updateHeroView(
      view,
      makeHero(1, "swordsman", 0),
      ctx({ slot: 0, socialBadge: { title: "เสี่ยใหญ่", champion: false } }),
    );
    expect(view.socialTitle.visible).toBe(true);

    updateHeroView(view, makeHero(1, "swordsman", 0), ctx({ slot: 0, socialBadge: null }));
    expect(view.socialTitle.visible).toBe(false);

    view.destroy({ children: true });
  });

  it("survives a Pool mark-and-sweep rebuild (same convention as the nameplate)", () => {
    const layer = new Container();
    const pool = new Pool(layer, createHeroView);
    const heroes = [makeHero(1, "swordsman", 0), makeHero(2, "archer", 100)];

    pool.beginFrame();
    updateHeroView(
      pool.get(heroes[0].id),
      heroes[0],
      ctx({ slot: 0, socialBadge: { title: "จ้าวยุทธภพ", champion: true } }),
    );
    updateHeroView(pool.get(heroes[1].id), heroes[1], ctx({ slot: 1 }));
    pool.endFrame();

    expect(pool.peek(1)?.socialTitle.visible).toBe(true);

    // Hero 2 drops, hero 1 stays — its view (and title) must survive the sweep.
    pool.beginFrame();
    updateHeroView(
      pool.get(heroes[0].id),
      heroes[0],
      ctx({ slot: 0, socialBadge: { title: "จ้าวยุทธภพ", champion: true } }),
    );
    pool.endFrame();

    expect(pool.peek(1)?.socialTitle.visible).toBe(true);
    expect(pool.peek(1)?.socialTitle.text).toBe("จ้าวยุทธภพ");
    expect(pool.peek(2)).toBeUndefined();

    pool.clear();
  });
});

describe("HOF seasonal rewards — champion aura anchor composes cleanly with the tier-2 aura", () => {
  it("getChampionAnchorPos resolves a finite point once attached, independent of the tier-2 idle aura's own visibility", () => {
    const layer = new Container();
    const view = createHeroView();
    layer.addChild(view);
    const hero = makeHero(1, "mage", 50);
    hero.tier = 2; // evolution tier -> `view.auraRing` (a SEPARATE, ground-anchored ellipse) activates

    updateHeroView(view, hero, ctx({ slot: 0, socialBadge: { title: "จอมยุทธ์", champion: true } }));

    // Tier-2 idle aura is unaffected by (and drawn independently of) the
    // champion badge — the two auras never share Graphics/state.
    expect(view.auraRing.visible).toBe(true);

    const out = { x: 0, y: 0 };
    const ok = getChampionAnchorPos(view, out);
    expect(ok).toBe(true);
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
    // The champion halo anchors well above the ground and clear of the HP bar
    // lane (GROUND_Y-58) — see `championAura.ts`'s module doc comment.
    expect(out.y).toBeLessThan(GROUND_Y);
    expect(out.y).toBeGreaterThan(GROUND_Y - 58);

    view.destroy({ children: true });
  });

  it("returns false for a view not yet attached under a parent Container", () => {
    const view = createHeroView();
    const out = { x: 0, y: 0 };
    expect(getChampionAnchorPos(view, out)).toBe(false);
    view.destroy({ children: true });
  });
});
