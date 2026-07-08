/**
 * ดินแดนอสูร (ASURA endgame v1) ELITE mob treatment — headless bounds/pool
 * guard, mirroring `rig.test.ts`'s conventions (real pixi.js `Graphics` +
 * `getBounds()` runs fine in plain Node against the REAL `createEnemyView`/
 * `updateEnemyView` code).
 *
 * Covers: (1) an elite draws visibly SCALED UP vs the same kind/size normal
 * mob, still landing in the GROUND_Y-relative band (never collapsing toward
 * world y≈0 — footgun 1); (2) the pulsing aura ring only ever appears for an
 * elite, and its `safeRadius()`-clamped geometry/alpha never goes
 * degenerate across a full pulse cycle; (3) a small pool of concurrent elite
 * views (build -> many frames -> destroy) never throws — the "pool sweep"
 * the render brief asked for.
 */

import { describe, expect, it } from "vitest";
import type { Enemy } from "@/engine/entities";
import { GROUND_Y } from "@/render/layout";
import { createEnemyView, updateEnemyView } from "@/render/views/enemyView";

const MIN_Y = GROUND_Y - 120; // a touch looser than rig.test.ts's band — elites draw bigger
const MAX_Y = GROUND_Y + 40; // ELITE_SIZE_SCALE (1.35x) pushes attack/lunge overshoot a bit further

function expectSaneBounds(b: { x: number; y: number; width: number; height: number }): void {
  expect(Number.isFinite(b.x)).toBe(true);
  expect(Number.isFinite(b.y)).toBe(true);
  expect(b.width).toBeGreaterThan(0);
  expect(b.height).toBeGreaterThan(0);
  expect(b.y).toBeGreaterThan(MIN_Y);
  expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);
}

function makeEnemy(kind: Enemy["kind"], elite: boolean): Enemy {
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
    elite,
  };
}

describe("enemyView ELITE treatment — scale-up + rig bounds stay sane", () => {
  for (const kind of ["normal", "fast", "tank", "ranged"] as const) {
    it(`${kind}: an elite's body draws bigger than a normal mob, both land in-band`, () => {
      const normalView = createEnemyView();
      updateEnemyView(normalView, makeEnemy(kind, false), { dt: 0, events: [], mapId: "asura" });
      const normalBounds = normalView.body.getBounds();
      expectSaneBounds(normalView.getBounds());

      const eliteView = createEnemyView();
      updateEnemyView(eliteView, makeEnemy(kind, true), { dt: 0, events: [], mapId: "asura" });
      const eliteBounds = eliteView.body.getBounds();
      expectSaneBounds(eliteView.getBounds());

      // Elite's silhouette occupies a strictly larger footprint (ELITE_SIZE_SCALE > 1).
      expect(eliteBounds.width * eliteBounds.height).toBeGreaterThan(
        normalBounds.width * normalBounds.height,
      );

      normalView.destroy({ children: true });
      eliteView.destroy({ children: true });
    });
  }
});

describe("enemyView ELITE treatment — aura ring visibility + pulse never degenerates", () => {
  it("stays invisible (zero extra cost) for an ordinary mob", () => {
    const view = createEnemyView();
    updateEnemyView(view, makeEnemy("normal", false), { dt: 1 / 60, events: [] });
    expect(view.eliteRing.visible).toBe(false);
    view.destroy({ children: true });
  });

  it("shows a sane, non-degenerate pulsing ring across a full cycle for an elite", () => {
    const view = createEnemyView();
    const enemy = makeEnemy("tank", true);
    updateEnemyView(view, enemy, { dt: 0, events: [], mapId: "asura" });
    expect(view.eliteRing.visible).toBe(true);

    // Sweep several seconds of real dt — the pulse's sin() must never push
    // alpha/scale negative or the ring's own built-once geometry (safeRadius-
    // clamped in `buildRig`) out of a sane bounds box.
    for (let i = 0; i < 240; i++) {
      updateEnemyView(view, enemy, { dt: 1 / 60, events: [], mapId: "asura" });
      expect(view.eliteRing.alpha).toBeGreaterThanOrEqual(0);
      expect(view.eliteRing.alpha).toBeLessThanOrEqual(1);
      const b = view.eliteRing.getBounds();
      expect(Number.isFinite(b.width)).toBe(true);
      expect(Number.isFinite(b.height)).toBe(true);
      expect(b.width).toBeGreaterThanOrEqual(0);
      expect(b.height).toBeGreaterThanOrEqual(0);
    }
    view.destroy({ children: true });
  });
});

describe("enemyView ELITE treatment — pool sweep (many concurrent elite views)", () => {
  it("builds, animates, and destroys a small pool of elites without throwing", () => {
    const POOL_SIZE = 24; // generous vs the elite cadence's realistic concurrency
    const views = Array.from({ length: POOL_SIZE }, () => createEnemyView());
    const enemies = views.map((_, i) => makeEnemy((["normal", "fast", "tank", "ranged"] as const)[i % 4], true));

    expect(() => {
      for (let frame = 0; frame < 30; frame++) {
        views.forEach((view, i) => {
          updateEnemyView(view, enemies[i], { dt: 1 / 60, events: [], mapId: "asura" });
        });
      }
    }).not.toThrow();

    for (const view of views) {
      expectSaneBounds(view.getBounds());
      view.destroy({ children: true });
    }
  });
});
