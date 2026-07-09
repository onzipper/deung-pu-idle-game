import { describe, expect, it } from "vitest";
import {
  cameraTransform,
  createCamera,
  punchZoom,
  updateCamera,
  type CameraTarget,
} from "@/lab/worldDepth/camera";
import { WORLD_WIDTH } from "@/render/layout";

/** The experiment's world width (2.75 × WORLD_WIDTH). */
const WORLD_W = 2475;
const DT = 1 / 60;

function run(cam: ReturnType<typeof createCamera>, target: CameraTarget, seconds: number): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) updateCamera(cam, target, DT);
}

describe("worldDepth living camera — experiment ⑨", () => {
  it("converges to a static target with monotonically non-increasing |error| (no overshoot)", () => {
    const cam = createCamera(WORLD_W);
    const target: CameraTarget = { x: 1600, vx: 0 };
    let prevErr = Math.abs(cam.x - target.x);
    for (let i = 0; i < 600; i++) {
      updateCamera(cam, target, DT);
      const err = Math.abs(cam.x - target.x);
      expect(err).toBeLessThanOrEqual(prevErr + 1e-9);
      prevErr = err;
    }
    expect(cam.x).toBeCloseTo(target.x, 4);
  });

  it("lookahead follows sign(vx) and caps at ±60", () => {
    for (const [vx, expected] of [
      [200, 60], // 200 * 0.6 = 120 → capped
      [-200, -60],
      [50, 30], // under the cap: vx * 0.6
    ] as const) {
      const cam = createCamera(WORLD_W);
      const target: CameraTarget = { x: 1200, vx };
      updateCamera(cam, target, DT);
      expect(Math.sign(cam.lookahead)).toBe(Math.sign(vx));
      run(cam, target, 4);
      expect(Math.abs(cam.lookahead)).toBeLessThanOrEqual(60 + 1e-9);
      expect(cam.lookahead).toBeCloseTo(expected, 3);
    }
  });

  it("clamps at the LEFT edge — even zoomed out to the idle 0.92", () => {
    const cam = createCamera(WORLD_W);
    // Static far-left target: idle engages after 2s → zoom eases to 0.92,
    // which WIDENS the half-view, so the clamp must track the live zoom.
    run(cam, { x: -500, vx: 0 }, 12);
    const tf = cameraTransform(cam);
    expect(tf.scale).toBeCloseTo(0.92, 4);
    expect(cam.x).toBeCloseTo(WORLD_WIDTH / (2 * tf.scale), 4);
    // The view's left edge sits exactly on world x=0 — never past it.
    expect(tf.posX).toBeCloseTo(0, 4);
  });

  it("clamps at the RIGHT edge", () => {
    const cam = createCamera(WORLD_W);
    run(cam, { x: WORLD_W + 500, vx: 0 }, 12);
    const tf = cameraTransform(cam);
    expect(cam.x).toBeCloseTo(WORLD_W - WORLD_WIDTH / (2 * tf.scale), 4);
    // The view's right edge sits exactly on world x=worldW.
    expect(tf.posX + WORLD_W * tf.scale).toBeCloseTo(WORLD_WIDTH, 3);
  });

  it("pins to worldW/2 when the world is narrower than the view", () => {
    const cam = createCamera(600);
    run(cam, { x: 0, vx: 0 }, 3);
    expect(cam.x).toBe(300);
    run(cam, { x: 600, vx: 0 }, 3);
    expect(cam.x).toBe(300);
  });

  it("punchZoom kicks scale to 1.22 then decays back to zoomBase within ~3s", () => {
    const cam = createCamera(WORLD_W);
    // Keep the target moving so the idle zoom never engages.
    let x = 1000;
    const vx = 40;
    run(cam, { x, vx }, 1);
    expect(cameraTransform(cam).scale).toBeCloseTo(cam.zoomBase, 6);

    punchZoom(cam);
    expect(cameraTransform(cam).scale).toBeCloseTo(1.22, 6);

    let prevScale = cameraTransform(cam).scale;
    for (let i = 0; i < Math.round(3 / DT); i++) {
      x += vx * DT;
      updateCamera(cam, { x, vx }, DT);
      const s = cameraTransform(cam).scale;
      expect(s).toBeLessThanOrEqual(prevScale + 1e-12); // pure decay, no wobble
      prevScale = s;
    }
    expect(cameraTransform(cam).scale).toBeCloseTo(cam.zoomBase, 2);
  });

  it("punch wins over the idle zoom while active", () => {
    const cam = createCamera(WORLD_W);
    run(cam, { x: 1200, vx: 0 }, 8); // idle: zoom eased to 0.92
    expect(cameraTransform(cam).scale).toBeCloseTo(0.92, 3);
    punchZoom(cam);
    expect(cameraTransform(cam).scale).toBeCloseTo(1.22, 6);
  });

  it("converged transform centers the target on screen", () => {
    const cam = createCamera(WORLD_W);
    const target: CameraTarget = { x: 1500, vx: 0 };
    run(cam, target, 10);
    const tf = cameraTransform(cam);
    expect(cam.x).toBeCloseTo(target.x, 3);
    expect(tf.posX + cam.x * tf.scale).toBeCloseTo(WORLD_WIDTH / 2, 6);
  });
});
