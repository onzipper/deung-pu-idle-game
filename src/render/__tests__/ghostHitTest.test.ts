/**
 * R3 "tap profile" (issue #50 Wave 5) — pure hit-test coverage for
 * `GameRenderer.hitTestGhost()`. Same convention as
 * `environment/__tests__/gateHitTest.test.ts` / `worldDepthPlacement.test.ts`'s
 * "Hit-test integration" block: GameRenderer itself needs a live Pixi
 * Application (headless-unfriendly), so this exercises the EXACT composition
 * `hitTestGhost()` uses — `canvasToWorld` → `enemyTapCenterY` ellipse math,
 * fed with the same `WorldFxContext` flags-off identity (`footY≡GROUND_Y`,
 * `depthScaleOf≡1`) `hitTestGhost` reads off `this.worldFx` — round-tripped
 * with the camera both off (today's tap math) and on.
 *
 * Owner eye-test (PR #62): the ghost rig (`HeroView`, `HEAD_Y = GROUND_Y -
 * 48`) is much taller than the generic monster ellipse assumed, so the old
 * "size=1" ellipse hugged the ankles and missed most of the visible body —
 * `GameRenderer`'s dedicated `GHOST_TAP_RX/RY/CENTER_SIZE` knobs fix that.
 * This file mirrors those constants locally (same convention as the old
 * `touchHalf`/`hitsGhost` mirrors below) so a future constant tweak in
 * `GameRenderer.ts` is forced to keep this test file in sync.
 */

import { describe, expect, it } from "vitest";
import { GROUND_Y } from "@/render/layout";
import { canvasToWorld, enemyTapCenterY, worldScale } from "@/render/worldDepth/hitTestMath";
import { createWorldFxContext } from "@/render/worldDepth/worldFxContext";

/** Local mirror of GameRenderer's `touchHalf = 24 / worldScale(base, cam)`. */
function touchHalf(base: { scale: number }, cam: { scale: number }): number {
  return 24 / worldScale(base, cam);
}

/** Local mirrors of GameRenderer's dedicated ghost tap-target constants
 * (`GHOST_TAP_RX` / `GHOST_TAP_RY` / `GHOST_TAP_CENTER_SIZE`) — deliberately
 * NOT imported (those are private to `GameRenderer.ts`); a drift here means a
 * constant changed in the renderer without this test being re-tuned. */
const GHOST_TAP_RX = 18;
const GHOST_TAP_RY = 42;
const GHOST_TAP_CENTER_SIZE = 2;

/** Mirrors `hitTestGhost`'s per-ghost ellipse test — taller than wide
 * (`ry > rx`) to match the tall human rig, unlike the generic enemy
 * ellipse. */
function hitsGhost(
  wx: number,
  wy: number,
  ghostX: number,
  cy: number,
  half: number,
): boolean {
  const rx = Math.max(half, GHOST_TAP_RX);
  const ry = Math.max(half, GHOST_TAP_RY);
  const dx = (wx - ghostX) / rx;
  const dy = (wy - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

describe("hitTestGhost math — camera OFF (today's tap math)", () => {
  const base = { x: 100, y: 50, scale: 2 };
  const cam = { x: 0, y: 0, scale: 1 };
  const fx = createWorldFxContext(); // both flags default OFF
  fx.setZone(null);

  it("hits a ghost at its own screen position", () => {
    const ghostX = 300;
    const d = fx.depthOf("ghost", "peer-1");
    const cy = enemyTapCenterY(GHOST_TAP_CENTER_SIZE, fx.footY(ghostX, d), fx.depthScaleOf(d));
    // flags-off identity, size=GHOST_TAP_CENTER_SIZE → rise = 14 · size.
    expect(cy).toBeCloseTo(GROUND_Y - 28, 6);

    const canvasX = base.x + (cam.x + ghostX * cam.scale) * base.scale;
    const canvasY = base.y + (cam.y + cy * cam.scale) * base.scale;
    const w = canvasToWorld(canvasX, canvasY, base, cam);
    expect(hitsGhost(w.x, w.y, ghostX, cy, touchHalf(base, cam))).toBe(true);
  });

  it("hits a tap at head-height, well above the ankle-height center (proves the taller box)", () => {
    const ghostX = 300;
    const d = fx.depthOf("ghost", "peer-1");
    const cy = enemyTapCenterY(GHOST_TAP_CENTER_SIZE, fx.footY(ghostX, d), fx.depthScaleOf(d));
    // Rig's HEAD_Y = GROUND_Y - 48 (heroView.ts) — squarely inside the new
    // ellipse (top extent = cy - GHOST_TAP_RY = GROUND_Y - 70) but WAY
    // outside the old size=1 ellipse (top extent used to be GROUND_Y - 36).
    const headY = GROUND_Y - 48;
    const canvasX = base.x + (cam.x + ghostX * cam.scale) * base.scale;
    const canvasY = base.y + (cam.y + headY * cam.scale) * base.scale;
    const w = canvasToWorld(canvasX, canvasY, base, cam);
    expect(hitsGhost(w.x, w.y, ghostX, cy, touchHalf(base, cam))).toBe(true);
  });

  it("hits a tap slightly below the feet (forgiving margin, not a hard cutoff at the foot line)", () => {
    const ghostX = 300;
    const d = fx.depthOf("ghost", "peer-1");
    const cy = enemyTapCenterY(GHOST_TAP_CENTER_SIZE, fx.footY(ghostX, d), fx.depthScaleOf(d));
    const belowFeetY = GROUND_Y + 10; // 10 world units below the foot line
    const canvasX = base.x + (cam.x + ghostX * cam.scale) * base.scale;
    const canvasY = base.y + (cam.y + belowFeetY * cam.scale) * base.scale;
    const w = canvasToWorld(canvasX, canvasY, base, cam);
    expect(hitsGhost(w.x, w.y, ghostX, cy, touchHalf(base, cam))).toBe(true);
  });

  it("misses a tap far away from any ghost", () => {
    const ghostX = 300;
    const d = fx.depthOf("ghost", "peer-1");
    const cy = enemyTapCenterY(GHOST_TAP_CENTER_SIZE, fx.footY(ghostX, d), fx.depthScaleOf(d));
    const farCanvasX = base.x + (cam.x + (ghostX + 500) * cam.scale) * base.scale;
    const farCanvasY = base.y + (cam.y + cy * cam.scale) * base.scale;
    const w = canvasToWorld(farCanvasX, farCanvasY, base, cam);
    expect(hitsGhost(w.x, w.y, ghostX, cy, touchHalf(base, cam))).toBe(false);
  });

  it("misses a tap well off to the side even though rx is modest by design", () => {
    const ghostX = 300;
    const d = fx.depthOf("ghost", "peer-1");
    const cy = enemyTapCenterY(GHOST_TAP_CENTER_SIZE, fx.footY(ghostX, d), fx.depthScaleOf(d));
    // Just past the horizontal extent (GHOST_TAP_RX=18, touchHalf floor at
    // this base/cam is 12 world units) — proves rx stays modest, unlike ry.
    const sideX = ghostX + 25;
    const canvasX = base.x + (cam.x + sideX * cam.scale) * base.scale;
    const canvasY = base.y + (cam.y + cy * cam.scale) * base.scale;
    const w = canvasToWorld(canvasX, canvasY, base, cam);
    expect(hitsGhost(w.x, w.y, ghostX, cy, touchHalf(base, cam))).toBe(false);
  });

  it("effective on-screen size meets the ≥36-44px minimum touch target at default zoom", () => {
    const scl = worldScale(base, cam); // canvas-px per world unit
    const rxPx = Math.max(touchHalf(base, cam), GHOST_TAP_RX) * scl;
    const ryPx = Math.max(touchHalf(base, cam), GHOST_TAP_RY) * scl;
    expect(rxPx * 2).toBeGreaterThanOrEqual(36);
    expect(ryPx * 2).toBeGreaterThanOrEqual(36);
    // Taller than wide, matching the tall rig — not a generic circle.
    expect(ryPx).toBeGreaterThan(rxPx);
  });
});

describe("hitTestGhost math — camera ON (two-transform inverse)", () => {
  const base = { x: 100, y: 50, scale: 2 };
  const cam = { x: 40, y: -18, scale: 1.06 };
  const fx = createWorldFxContext();
  fx.setZone(null);

  it("still hits a ghost at its own (zoomed/panned) screen position", () => {
    const ghostX = 512;
    const d = fx.depthOf("ghost", "peer-2");
    const cy = enemyTapCenterY(GHOST_TAP_CENTER_SIZE, fx.footY(ghostX, d), fx.depthScaleOf(d));
    const canvasX = base.x + (cam.x + ghostX * cam.scale) * base.scale;
    const canvasY = base.y + (cam.y + cy * cam.scale) * base.scale;
    const w = canvasToWorld(canvasX, canvasY, base, cam);
    expect(w.x).toBeCloseTo(ghostX, 4);
    expect(w.y).toBeCloseTo(cy, 4);
    expect(hitsGhost(w.x, w.y, ghostX, cy, touchHalf(base, cam))).toBe(true);
  });

  it("still hits a head-height tap through the camera transform", () => {
    const ghostX = 512;
    const d = fx.depthOf("ghost", "peer-2");
    const cy = enemyTapCenterY(GHOST_TAP_CENTER_SIZE, fx.footY(ghostX, d), fx.depthScaleOf(d));
    const headY = GROUND_Y - 48;
    const canvasX = base.x + (cam.x + ghostX * cam.scale) * base.scale;
    const canvasY = base.y + (cam.y + headY * cam.scale) * base.scale;
    const w = canvasToWorld(canvasX, canvasY, base, cam);
    expect(hitsGhost(w.x, w.y, ghostX, cy, touchHalf(base, cam))).toBe(true);
  });
});
