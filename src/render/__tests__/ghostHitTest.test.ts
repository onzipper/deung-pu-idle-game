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
 */

import { describe, expect, it } from "vitest";
import { GROUND_Y } from "@/render/layout";
import { canvasToWorld, enemyTapCenterY, worldScale } from "@/render/worldDepth/hitTestMath";
import { createWorldFxContext } from "@/render/worldDepth/worldFxContext";

/** Local mirror of GameRenderer's `touchHalf = 24 / worldScale(base, cam)`. */
function touchHalf(base: { scale: number }, cam: { scale: number }): number {
  return 24 / worldScale(base, cam);
}

/** Mirrors `hitTestGhost`'s per-ghost ellipse test (fixed size 1 — a ghost rig
 * is human-sized, same as a default-size enemy). */
function hitsGhost(
  wx: number,
  wy: number,
  ghostX: number,
  cy: number,
  half: number,
): boolean {
  const rx = Math.max(half, 16);
  const ry = Math.max(half, 22);
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
    const cy = enemyTapCenterY(1, fx.footY(ghostX, d), fx.depthScaleOf(d));
    expect(cy).toBeCloseTo(GROUND_Y - 14, 6); // flags-off identity, size=1

    const canvasX = base.x + (cam.x + ghostX * cam.scale) * base.scale;
    const canvasY = base.y + (cam.y + cy * cam.scale) * base.scale;
    const w = canvasToWorld(canvasX, canvasY, base, cam);
    expect(hitsGhost(w.x, w.y, ghostX, cy, touchHalf(base, cam))).toBe(true);
  });

  it("misses a tap far away from any ghost", () => {
    const ghostX = 300;
    const d = fx.depthOf("ghost", "peer-1");
    const cy = enemyTapCenterY(1, fx.footY(ghostX, d), fx.depthScaleOf(d));
    const farCanvasX = base.x + (cam.x + (ghostX + 500) * cam.scale) * base.scale;
    const farCanvasY = base.y + (cam.y + cy * cam.scale) * base.scale;
    const w = canvasToWorld(farCanvasX, farCanvasY, base, cam);
    expect(hitsGhost(w.x, w.y, ghostX, cy, touchHalf(base, cam))).toBe(false);
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
    const cy = enemyTapCenterY(1, fx.footY(ghostX, d), fx.depthScaleOf(d));
    const canvasX = base.x + (cam.x + ghostX * cam.scale) * base.scale;
    const canvasY = base.y + (cam.y + cy * cam.scale) * base.scale;
    const w = canvasToWorld(canvasX, canvasY, base, cam);
    expect(w.x).toBeCloseTo(ghostX, 4);
    expect(w.y).toBeCloseTo(cy, 4);
    expect(hitsGhost(w.x, w.y, ghostX, cy, touchHalf(base, cam))).toBe(true);
  });
});
