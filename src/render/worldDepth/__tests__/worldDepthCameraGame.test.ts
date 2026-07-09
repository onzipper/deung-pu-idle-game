import { describe, expect, it } from "vitest";
import {
  cameraTransform,
  createCamera,
  punchZoom,
  updateCamera,
  type CameraTarget,
} from "@/render/worldDepth/camera";

const DT = 1 / 60;
/** The real game world width (render/layout WORLD_WIDTH). */
const WORLD_W = 900;
/** Game camera opts: follow tight at 1.06, ease to the FULL view (1.0) when idle. */
const GAME = { zoomBase: 1.06, idleZoom: 1.0 } as const;

function run(cam: ReturnType<typeof createCamera>, target: CameraTarget, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) updateCamera(cam, target, DT);
}

describe("worldDepth living camera — GAME opts (inverted idle zoom)", () => {
  it("stores idleZoom on state; game floor is 1.0 not the lab 0.92", () => {
    const cam = createCamera(WORLD_W, GAME);
    expect(cam.zoomBase).toBe(1.06);
    expect(cam.idleZoom).toBe(1.0);
    expect(cam.zoom).toBe(1.06); // starts AT the follow zoom
  });

  it("sustained walking holds zoomBase 1.06", () => {
    const cam = createCamera(WORLD_W, GAME);
    // |vx| > IDLE_VX_EPS ⇒ never idle. (x fixed; only vx drives the idle beat.)
    run(cam, { x: 450, vx: 40 }, 6);
    expect(cameraTransform(cam).scale).toBeCloseTo(1.06, 3);
  });

  it("long idle eases to exactly 1.0 and NEVER dips below it", () => {
    const cam = createCamera(WORLD_W, GAME);
    const target: CameraTarget = { x: 450, vx: 0 };
    let minScale = Infinity;
    for (let i = 0; i < Math.round(25 / DT); i++) {
      updateCamera(cam, target, DT);
      const s = cameraTransform(cam).scale;
      minScale = Math.min(minScale, s);
      expect(s).toBeGreaterThanOrEqual(1.0 - 1e-9); // full-view floor holds every step
    }
    expect(minScale).toBeGreaterThanOrEqual(1.0 - 1e-9);
    expect(cameraTransform(cam).scale).toBeCloseTo(1.0, 3); // relaxed to the full view
  });

  it("a punch during idle decay stays ≥1.0 the whole way down", () => {
    const cam = createCamera(WORLD_W, GAME);
    run(cam, { x: 450, vx: 0 }, 8); // eased to ~1.0
    punchZoom(cam);
    expect(cameraTransform(cam).scale).toBeCloseTo(1.22, 6); // punch peak
    for (let i = 0; i < Math.round(4 / DT); i++) {
      updateCamera(cam, { x: 450, vx: 0 }, DT);
      expect(cameraTransform(cam).scale).toBeGreaterThanOrEqual(1.0 - 1e-9);
    }
    expect(cameraTransform(cam).scale).toBeCloseTo(1.0, 2);
  });

  it("invariant: scale ≥ 1.0 across walk↔idle transitions AND punches", () => {
    const cam = createCamera(WORLD_W, GAME);
    let x = 450;
    for (let i = 0; i < 5000; i++) {
      // Alternate 1s idle / 1s walking; punch every ~0.7s.
      const walking = Math.floor(i / 60) % 2 === 1;
      const vx = walking ? 60 : 0;
      x += vx * DT;
      if (x > WORLD_W) x = 0;
      if (i % 42 === 0) punchZoom(cam);
      updateCamera(cam, { x, vx }, DT);
      expect(cameraTransform(cam).scale).toBeGreaterThanOrEqual(1.0 - 1e-9);
    }
  });

  it("lab defaults are preserved when no opts are passed", () => {
    const cam = createCamera(2475);
    expect(cam.zoomBase).toBe(1);
    expect(cam.idleZoom).toBe(0.92);
    expect(cam.zoom).toBe(1);
    run(cam, { x: 1200, vx: 0 }, 10);
    expect(cameraTransform(cam).scale).toBeCloseTo(0.92, 3); // lab breathe-out
  });

  it("partial opts default the other field", () => {
    expect(createCamera(WORLD_W, { zoomBase: 1.06 }).idleZoom).toBe(0.92);
    expect(createCamera(WORLD_W, { idleZoom: 1.0 }).zoomBase).toBe(1);
  });
});
