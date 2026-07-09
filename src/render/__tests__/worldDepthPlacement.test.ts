/**
 * Headless correctness guard for W2's "โลกมีมิติ" placement algebra — the
 * foot-pivot + terrain-lift + depth-scale transform GameRenderer applies to
 * every entity root, plus the camera-aware hit-test un-projection.
 *
 * Like `views/__tests__/rig.test.ts`, this exercises REAL pixi `getBounds()`
 * scene-graph math (no WebGL/Application needed) on the REAL `createXView`
 * rigs, plus the REAL pure seam modules (`worldFxContext`, `depthBand`,
 * `hitTestMath`) — never a hand-restatement of the same math. It replicates the
 * exact sequence GameRenderer runs (pivot at creation, `view.y = footY` +
 * `scale` after `updateXView`) so a regression in that sequence is caught here
 * even though the renderer itself needs a canvas to instantiate.
 *
 * THE load-bearing invariants:
 *   1. feet stay planted at `footY` as the depth scale changes (scaling happens
 *      AROUND the foot line — a wrong root pivot flings the rig ~GROUND_Y px off);
 *   2. flags OFF is byte-for-byte today's render (pivoted+placed === virgin);
 *   3. depth zIndex sorts near-over-far under a sortableChildren layer;
 *   4. the hit-test math round-trips a screen tap back to world coords with the
 *      camera both off (today's math) and on.
 */

import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import type { Enemy, Hero } from "@/engine/entities";
import { defaultHeroConfig, emptyDailies } from "@/engine/entities";
import { GROUND_Y } from "@/render/layout";
import { createEnemyView, updateEnemyView } from "@/render/views/enemyView";
import { createHeroView, updateHeroView } from "@/render/views/heroView";
import { depthZIndex } from "@/render/worldDepth/depthBand";
import {
  canvasToWorld,
  enemyTapCenterY,
  worldScale,
} from "@/render/worldDepth/hitTestMath";
import {
  createWorldFxContext,
  DEPTH_NEUTRAL,
} from "@/render/worldDepth/worldFxContext";

// ---------------------------------------------------------------------------
// Fixtures (mirror rig.test.ts — full valid engine shapes so the rigs build).
// ---------------------------------------------------------------------------
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

function makeEnemy(): Enemy {
  return {
    id: 7,
    kind: "normal",
    x: 0,
    y: 0,
    hp: 20,
    maxHp: 20,
    atk: 5,
    speed: 40,
    size: 1,
    behavior: "melee",
    range: 0,
    cd: 1,
    engageOffset: 0,
    homeX: 0,
    aggressive: false,
    aggroRadius: 0,
    engaged: false,
  };
}

const SCALES = [0.8, 1.0, 1.12] as const;

/** Bottom (max-y / lowest-on-screen) of a world-space bounds = the feet line. */
function bottomOf(b: { y: number; height: number }): number {
  return b.y + b.height;
}

// ---------------------------------------------------------------------------
// 1. Pivot algebra — feet stay planted at footY across every depth scale.
//    With the root pivot at GROUND_Y and view.y = F, the feet render at F for
//    ANY scale (the rig grows/shrinks AROUND the foot line). A wrong pivot
//    (e.g. 0) would swing the feet ~scale*GROUND_Y px — an ~80px spread across
//    these scales — so the tight spread bound below is the real regression trap.
//    ONE view per rig, varying only the scale, isolates the transform from
//    heroView's per-instance random idle phase.
// ---------------------------------------------------------------------------
describe("world-depth placement: feet stay planted at footY across depth scales", () => {
  it("enemy root: bounds bottom holds the placed foot line, not world y≈0", () => {
    const F = GROUND_Y + 30; // deliberate lift: proves footY actually moves the feet
    const view = createEnemyView();
    view.pivot.y = GROUND_Y; // set once at creation in GameRenderer's pool factory
    updateEnemyView(view, makeEnemy(), { dt: 0, events: [] }); // first sight (spawn hop)
    updateEnemyView(view, makeEnemy(), { dt: 0.5, events: [] }); // settle spawn → feet at rest
    view.y = F; // GameRenderer's per-frame foot plant
    const bottoms = SCALES.map((s) => {
      view.scale.set(s);
      return bottomOf(view.getBounds());
    });
    // Feet sit at F (within a few px — the rig's lowest point is ~GROUND_Y·s)
    // for every scale, and barely move across scales (the planted invariant).
    for (const b of bottoms) expect(Math.abs(b - F)).toBeLessThan(6);
    expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(1.5);
    view.destroy({ children: true });
  });

  it("hero root: bodyRoot bounds bottom holds the placed foot line across scales", () => {
    const F = GROUND_Y + 30;
    const view = createHeroView();
    view.pivot.y = GROUND_Y;
    updateHeroView(view, makeHero("swordsman"), { dt: 0, slot: 0, events: [], marching: false });
    updateHeroView(view, makeHero("swordsman"), { dt: 0.5, slot: 0, events: [], marching: false });
    view.y = F;
    const bottoms = SCALES.map((s) => {
      view.scale.set(s);
      // bodyRoot (not view.getBounds) — avoids the reviveLabel Text a headless
      // node can't measure, same reasoning as rig.test.ts.
      return bottomOf(view.bodyRoot.getBounds());
    });
    for (const b of bottoms) expect(Math.abs(b - F)).toBeLessThan(8);
    expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(1.5);
    view.destroy({ children: true });
  });
});

// ---------------------------------------------------------------------------
// 2. OFF-identity — the foot-pivot + placement transform, with flags OFF, is
//    bit-for-bit today's virgin transform. Tested on the SAME frozen rig
//    (measure virgin transform → apply the OFF placement → re-measure) so the
//    comparison isolates the transform and never depends on anim randomness.
//    This is the whole feature's "toggles OFF == today" contract.
// ---------------------------------------------------------------------------
describe("world-depth placement: flags OFF is pixel-identical to today", () => {
  const ctx = createWorldFxContext(); // both flags default OFF
  ctx.setZone(null); // flat

  function assertBoundsEqual(
    a: { x: number; y: number; width: number; height: number },
    b: typeof a,
  ): void {
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.02);
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.02);
    expect(Math.abs(a.width - b.width)).toBeLessThan(0.02);
    expect(Math.abs(a.height - b.height)).toBeLessThan(0.02);
  }

  function copyBounds(b: { x: number; y: number; width: number; height: number }) {
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }

  it("enemy: applying the flags-off placement to a rig leaves its bounds unchanged", () => {
    const X = 200;
    const view = createEnemyView();
    updateEnemyView(view, { ...makeEnemy(), x: X }, { dt: 0, events: [] });
    const virgin = copyBounds(view.getBounds()); // pivot 0, y 0 = today

    // Apply exactly what GameRenderer does with the flags off.
    view.pivot.y = GROUND_Y;
    const d = ctx.depthOf("enemy", 7); // DEPTH_NEUTRAL when off
    view.y = ctx.footY(X, d); // GROUND_Y when off
    view.scale.set(ctx.depthScaleOf(d)); // 1 when off
    const placed = copyBounds(view.getBounds());

    assertBoundsEqual(virgin, placed);
    view.destroy({ children: true });
  });

  it("hero: applying the flags-off placement to a rig leaves its bodyRoot bounds unchanged", () => {
    const X = 200;
    const view = createHeroView();
    updateHeroView(view, { ...makeHero("mage"), x: X }, { dt: 0, slot: 0, events: [], marching: false });
    const virgin = copyBounds(view.bodyRoot.getBounds());

    view.pivot.y = GROUND_Y;
    const d = ctx.depthOf("hero", 1, 0, 1);
    view.y = ctx.footY(X, d);
    view.scale.set(ctx.depthScaleOf(d));
    const placed = copyBounds(view.bodyRoot.getBounds());

    assertBoundsEqual(virgin, placed);
    view.destroy({ children: true });
  });

  it("depth flag ON actually lifts a far row higher and shrinks it (feature does something)", () => {
    const on = createWorldFxContext();
    on.setFlags({ depth: true, terrain: false });
    on.setZone(null);
    const far = on.depthOf("enemy", 100);
    const near = on.depthOf("enemy", 101);
    // Pick two ids whose hashed depths differ enough to compare (deterministic).
    const [lo, hi] = far < near ? [far, near] : [near, far];
    expect(on.footY(200, lo)).toBeLessThan(on.footY(200, hi)); // far row = smaller y (higher)
    expect(on.depthScaleOf(lo)).toBeLessThan(on.depthScaleOf(hi)); // far row = smaller
  });
});

// ---------------------------------------------------------------------------
// 3. zIndex sort — depth flag ON puts nearer rows AFTER (over) farther rows in
//    a sortableChildren layer, regardless of insertion order.
// ---------------------------------------------------------------------------
describe("world-depth placement: depth zIndex sorts near over far", () => {
  it("nearer d ends up at a higher child index after sortChildren()", () => {
    const parent = new Container();
    parent.sortableChildren = true;
    const far = new Container();
    const near = new Container();
    far.zIndex = depthZIndex(0.2);
    near.zIndex = depthZIndex(0.85);
    // Add in the WRONG paint order (near first) — the sort must fix it.
    parent.addChild(near, far);
    parent.sortChildren();
    expect(parent.getChildIndex(near)).toBeGreaterThan(parent.getChildIndex(far));
    parent.destroy({ children: true });
  });

  it("equal (neutral) zIndex preserves insertion order = OFF-identity", () => {
    const parent = new Container();
    parent.sortableChildren = true;
    const a = new Container();
    const b = new Container();
    a.zIndex = depthZIndex(DEPTH_NEUTRAL);
    b.zIndex = depthZIndex(DEPTH_NEUTRAL);
    parent.addChild(a, b);
    parent.sortChildren();
    // Stable sort: insertion order (a before b) survives equal zIndex.
    expect(parent.getChildIndex(a)).toBeLessThan(parent.getChildIndex(b));
    parent.destroy({ children: true });
  });
});

// ---------------------------------------------------------------------------
// 4. Hit-test integration — the exact composition GameRenderer.hitTestPointer
//    uses (canvasToWorld → enemyTapCenterY), round-tripped with the camera off
//    (today's tap math) and on (two-transform inverse).
// ---------------------------------------------------------------------------
describe("world-depth hit-test: screen tap round-trips to world coords", () => {
  const base = { x: 100, y: 50, scale: 2 };

  it("camera OFF: reproduces today's (canvas − base)/scale and GROUND_Y − 14·size center", () => {
    const cam = { x: 0, y: 0, scale: 1 };
    const size = 1;
    const worldX = 200;
    const cy = enemyTapCenterY(size, GROUND_Y, 1); // footY=GROUND_Y, scl=1 → GROUND_Y − 14
    expect(cy).toBeCloseTo(GROUND_Y - 14, 6);
    // Screen point of that ellipse center, forward-projected:
    const canvasX = base.x + (cam.x + worldX * cam.scale) * base.scale;
    const canvasY = base.y + (cam.y + cy * cam.scale) * base.scale;
    const w = canvasToWorld(canvasX, canvasY, base, cam);
    expect(w.x).toBeCloseTo(worldX, 6);
    expect(w.y).toBeCloseTo(cy, 6);
    // Tap exactly on center → inside the ellipse (dist 0).
    const rx = Math.max(TOUCH(base, cam), 16 * size);
    const ry = Math.max(TOUCH(base, cam), 22 * size);
    const dist = ((w.x - worldX) / rx) ** 2 + ((w.y - cy) / ry) ** 2;
    expect(dist).toBeLessThanOrEqual(1);
  });

  it("camera ON: two-transform inverse recovers the world point", () => {
    const cam = { x: 40, y: -18, scale: 1.06 };
    const worldX = 512;
    const worldY = GROUND_Y - 22;
    const canvasX = base.x + (cam.x + worldX * cam.scale) * base.scale;
    const canvasY = base.y + (cam.y + worldY * cam.scale) * base.scale;
    const w = canvasToWorld(canvasX, canvasY, base, cam);
    expect(w.x).toBeCloseTo(worldX, 4);
    expect(w.y).toBeCloseTo(worldY, 4);
    // Touch half-extent shrinks by BOTH scales.
    expect(worldScale(base, cam)).toBeCloseTo(base.scale * cam.scale, 6);
  });
});

/** Local mirror of GameRenderer's `touchHalf = 24 / worldScale(base, cam)`. */
function TOUCH(base: { scale: number }, cam: { scale: number }): number {
  return 24 / worldScale(base, cam);
}
