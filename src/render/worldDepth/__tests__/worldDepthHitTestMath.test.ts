import { describe, expect, it } from "vitest";
import {
  canvasToWorld,
  enemyTapCenterY,
  worldBossTapCenterY,
  worldScale,
  TAP_CENTER_RISE_PER_SIZE,
  type CamView,
} from "@/render/worldDepth/hitTestMath";
import { GROUND_Y } from "@/render/layout";

interface Base {
  x: number;
  y: number;
  scale: number;
}

/** Forward projection (world → canvas) used to close the round-trip loop. */
function worldToCanvas(wx: number, wy: number, base: Base, cam: CamView): { x: number; y: number } {
  return {
    x: base.x + (cam.x + wx * cam.scale) * base.scale,
    y: base.y + (cam.y + wy * cam.scale) * base.scale,
  };
}

const SAMPLES: [number, number][] = [
  [0, 0],
  [450, 190],
  [900, 300],
  [123.4, 55.5],
];

describe("worldDepth hit-test math", () => {
  it("round-trips world→canvas→world under camera IDENTITY", () => {
    const base: Base = { x: 37, y: 12, scale: 1.5 };
    const cam: CamView = { x: 0, y: 0, scale: 1 };
    for (const [wx, wy] of SAMPLES) {
      const c = worldToCanvas(wx, wy, base, cam);
      const w = canvasToWorld(c.x, c.y, base, cam);
      expect(w.x).toBeCloseTo(wx, 6);
      expect(w.y).toBeCloseTo(wy, 6);
    }
  });

  it("round-trips under camera pan + zoom", () => {
    const base: Base = { x: 37, y: 12, scale: 1.5 };
    const cam: CamView = { x: -120, y: 8, scale: 1.06 };
    for (const [wx, wy] of SAMPLES) {
      const c = worldToCanvas(wx, wy, base, cam);
      const w = canvasToWorld(c.x, c.y, base, cam);
      expect(w.x).toBeCloseTo(wx, 6);
      expect(w.y).toBeCloseTo(wy, 6);
    }
  });

  it("camera-identity un-project reduces to today's (canvas − base)/scale", () => {
    const base: Base = { x: 20, y: 5, scale: 2 };
    const cam: CamView = { x: 0, y: 0, scale: 1 };
    const w = canvasToWorld(220, 105, base, cam);
    expect(w.x).toBeCloseTo((220 - 20) / 2, 9);
    expect(w.y).toBeCloseTo((105 - 5) / 2, 9);
  });

  it("worldScale multiplies both transforms", () => {
    expect(worldScale({ scale: 1.5 }, { scale: 1.06 })).toBeCloseTo(1.59, 9);
    expect(worldScale({ scale: 2 }, { scale: 1 })).toBe(2);
  });

  it("out-param is mutated and returned (zero alloc in the pointer handler)", () => {
    const out = { x: 0, y: 0 };
    const r = canvasToWorld(200, 100, { x: 0, y: 0, scale: 1 }, { x: 0, y: 0, scale: 1 }, out);
    expect(r).toBe(out);
  });

  it("enemyTapCenterY reproduces GROUND_Y − 14·size when world layers are OFF", () => {
    expect(TAP_CENTER_RISE_PER_SIZE).toBe(14);
    for (const size of [0.8, 1, 1.4]) {
      expect(enemyTapCenterY(size, GROUND_Y, 1)).toBe(GROUND_Y - 14 * size);
    }
  });

  it("enemyTapCenterY rides the lifted foot and depth scale when ON", () => {
    const footY = GROUND_Y - 8; // terrain raised the foot
    const depthScl = 1.1; // near-row scale
    expect(enemyTapCenterY(1, footY, depthScl)).toBeCloseTo(footY - 14 * depthScl, 9);
  });

  it("worldBossTapCenterY adds the terrain lift", () => {
    expect(worldBossTapCenterY(100, 0)).toBe(100);
    expect(worldBossTapCenterY(100, -6)).toBe(94);
  });
});
