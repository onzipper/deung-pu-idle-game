/**
 * R2.5 "Game Screen" W1 — fullscreen (any-aspect-ratio) canvas fit. Pure math
 * only (no Pixi needed): `computeFullscreenTransform`/`computeVisibleWorldRect`
 * (`layout.ts`) and the living-camera's `viewW` generalization (`camera.ts`).
 */

import { describe, expect, it } from "vitest";
import {
  BAND_BIAS,
  BLEED_X,
  computeFullscreenTransform,
  computeVisibleWorldRect,
  computeWorldTransform,
  GROUND_BLEED,
  SKY_BLEED,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "@/render/layout";
import { createCamera, setViewW, updateCamera, type CameraTarget } from "@/render/worldDepth/camera";

/** A representative spread of real-world screen aspects. */
const ASPECTS: Record<string, { w: number; h: number }> = {
  "16:9 landscape": { w: 1920, h: 1080 },
  "9:16 portrait": { w: 1080, h: 1920 },
  "3:1 (world's own aspect)": { w: 1800, h: 600 },
  "ultrawide 21:9": { w: 2560, h: 1080 },
};

describe("computeFullscreenTransform — knobs", () => {
  it("BAND_BIAS is 0.58 (owner reference: band anchored slightly below center)", () => {
    expect(BAND_BIAS).toBe(0.58);
  });

  it("bleed knobs are all 900 world px", () => {
    expect(SKY_BLEED).toBe(900);
    expect(GROUND_BLEED).toBe(900);
    expect(BLEED_X).toBe(900);
  });
});

describe.each(Object.entries(ASPECTS))("computeFullscreenTransform — %s", (_label, { w, h }) => {
  it("the 900x300 playfield band stays fully visible (headroom/footroom/viewWorldW never negative)", () => {
    const t = computeFullscreenTransform(w, h);
    expect(t.headroom).toBeGreaterThanOrEqual(-1e-6);
    expect(t.footroom).toBeGreaterThanOrEqual(-1e-6);
    expect(t.viewWorldW).toBeGreaterThanOrEqual(WORLD_WIDTH - 1e-6);
  });

  it("headroom + footroom + WORLD_HEIGHT === h/scale", () => {
    const t = computeFullscreenTransform(w, h);
    expect(t.headroom + t.footroom + WORLD_HEIGHT).toBeCloseTo(h / t.scale, 6);
  });

  it("viewWorldW >= WORLD_WIDTH", () => {
    const t = computeFullscreenTransform(w, h);
    expect(t.viewWorldW).toBeGreaterThanOrEqual(WORLD_WIDTH);
  });

  it("BAND_BIAS math: y === (h - WORLD_HEIGHT*scale) * BAND_BIAS, headroom === y/scale", () => {
    const t = computeFullscreenTransform(w, h);
    expect(t.y).toBeCloseTo((h - WORLD_HEIGHT * t.scale) * BAND_BIAS, 6);
    expect(t.headroom).toBeCloseTo(t.y / t.scale, 6);
  });

  it("x/scale match computeWorldTransform exactly (world's own local space is untouched)", () => {
    const t = computeFullscreenTransform(w, h);
    const legacy = computeWorldTransform(w, h);
    expect(t.scale).toBe(legacy.scale);
    expect(t.x).toBe(legacy.x);
  });
});

describe("computeFullscreenTransform — exactly 3:1 (the world's own aspect)", () => {
  it("equals today's computeWorldTransform exactly (headroom=footroom=0, viewWorldW=WORLD_WIDTH)", () => {
    const w = 1800;
    const h = 600; // 1800/600 = 3 = WORLD_WIDTH/WORLD_HEIGHT
    const t = computeFullscreenTransform(w, h);
    const legacy = computeWorldTransform(w, h);
    expect(t.scale).toBe(legacy.scale);
    expect(t.x).toBe(legacy.x);
    expect(t.y).toBeCloseTo(legacy.y, 6);
    expect(t.headroom).toBeCloseTo(0, 6);
    expect(t.footroom).toBeCloseTo(0, 6);
    expect(t.viewWorldW).toBeCloseTo(WORLD_WIDTH, 6);
  });

  it("a narrower-than-3:1 (letterboxed-today) screen still has zero headroom/footroom", () => {
    // width-bound already fits height exactly at 3:1; anything with MORE
    // relative height (taller/narrower) is the portrait case covered above —
    // this checks the boundary itself is stable under floating point.
    const t = computeFullscreenTransform(900, 300);
    expect(t.headroom).toBeCloseTo(0, 6);
    expect(t.footroom).toBeCloseTo(0, 6);
  });
});

describe("computeVisibleWorldRect — mask/filterArea extents", () => {
  it.each(Object.entries(ASPECTS))("%s: rect fully covers the playfield + viewWorldW + bleed", (_label, { w, h }) => {
    const rect = computeVisibleWorldRect(w, h);
    const t = computeFullscreenTransform(w, h);

    // The 900x300 playfield sits fully inside the rect.
    expect(rect.x).toBeLessThanOrEqual(0);
    expect(rect.x + rect.width).toBeGreaterThanOrEqual(WORLD_WIDTH);
    expect(rect.y).toBeLessThanOrEqual(0);
    expect(rect.y + rect.height).toBeGreaterThanOrEqual(WORLD_HEIGHT);

    // Covers the full live viewWorldW (symmetric around the playfield center).
    const viewLeft = WORLD_WIDTH / 2 - t.viewWorldW / 2;
    const viewRight = WORLD_WIDTH / 2 + t.viewWorldW / 2;
    expect(rect.x).toBeLessThanOrEqual(viewLeft + 1e-6);
    expect(rect.x + rect.width).toBeGreaterThanOrEqual(viewRight - 1e-6);

    // Covers the full live vertical extent (headroom/footroom).
    expect(rect.y).toBeLessThanOrEqual(-t.headroom + 1e-6);
    expect(rect.y + rect.height).toBeGreaterThanOrEqual(WORLD_HEIGHT + t.footroom - 1e-6);

    // At least the fixed BLEED_X decorative margin on each side.
    expect(rect.x).toBeLessThanOrEqual(-BLEED_X + 1e-6);
    expect(rect.x + rect.width).toBeGreaterThanOrEqual(WORLD_WIDTH + BLEED_X - 1e-6);

    // Sane, positive-size rect (safeRadius()-able downstream).
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });

  it("at exactly 3:1 the rect collapses to the fixed BLEED_X/SKY_BLEED/GROUND_BLEED box", () => {
    const rect = computeVisibleWorldRect(1800, 600);
    expect(rect.x).toBeCloseTo(-BLEED_X, 6);
    expect(rect.width).toBeCloseTo(WORLD_WIDTH + BLEED_X * 2, 6);
    expect(rect.y).toBeCloseTo(0, 6);
    expect(rect.height).toBeCloseTo(WORLD_HEIGHT, 6);
  });
});

describe("living camera — viewW generalization (R2.5 W1)", () => {
  const DT = 1 / 60;
  function run(cam: ReturnType<typeof createCamera>, target: CameraTarget, seconds: number): void {
    for (let i = 0; i < Math.round(seconds / DT); i++) updateCamera(cam, target, DT);
  }

  it("default viewW is WORLD_WIDTH (byte-identical to before this param existed)", () => {
    const cam = createCamera(WORLD_WIDTH);
    expect(cam.viewW).toBe(WORLD_WIDTH);
  });

  it("setViewW never lets the clamped x itself drift past the world's [0, worldW] edges", () => {
    // NOTE: once viewW > worldW the camera legitimately shows PAST the
    // world's edges on both sides (there's nothing else to show — the
    // pre-existing "pins to worldW/2 when the world is narrower than the
    // view" behavior, `worldDepthCamera.test.ts`). The invariant that must
    // hold at every viewW is narrower: the tracked/clamped CENTER `cam.x`
    // itself never drifts outside `[0, worldW]` (never NaN/runaway either).
    const cam = createCamera(WORLD_WIDTH, { zoomBase: 1.06, idleZoom: 1.0 });
    for (const viewW of [900, 1200, 2000, 3500]) {
      setViewW(cam, viewW);
      run(cam, { x: -5000, vx: 0 }, 6); // drive hard toward the left edge
      expect(Number.isFinite(cam.x)).toBe(true);
      expect(cam.x).toBeGreaterThanOrEqual(-1e-6);
      expect(cam.x).toBeLessThanOrEqual(WORLD_WIDTH + 1e-6);

      run(cam, { x: 5000, vx: 0 }, 6); // and hard toward the right edge
      expect(Number.isFinite(cam.x)).toBe(true);
      expect(cam.x).toBeGreaterThanOrEqual(-1e-6);
      expect(cam.x).toBeLessThanOrEqual(WORLD_WIDTH + 1e-6);
    }
  });

  it("a wide viewW (whole 900-wide world already fits) pins dead-center — no panning", () => {
    const cam = createCamera(WORLD_WIDTH, { zoomBase: 1.06, idleZoom: 1.0 });
    setViewW(cam, 3000); // way more than 900 world-units visible at once
    run(cam, { x: 10, vx: 0 }, 6);
    expect(cam.x).toBeCloseTo(WORLD_WIDTH / 2, 3);
    run(cam, { x: 890, vx: 0 }, 6);
    expect(cam.x).toBeCloseTo(WORLD_WIDTH / 2, 3);
  });

  it("setViewW re-clamps immediately (not just on the next updateCamera)", () => {
    const cam = createCamera(WORLD_WIDTH, { zoomBase: 1.06, idleZoom: 1.0 });
    run(cam, { x: -5000, vx: 0 }, 6); // pinned near the left edge at viewW=900
    const beforeX = cam.x;
    expect(beforeX).toBeLessThan(WORLD_WIDTH / 2);
    setViewW(cam, 3000); // whole world now fits — must re-clamp to dead-center NOW
    expect(cam.x).toBeCloseTo(WORLD_WIDTH / 2, 6);
  });
});
