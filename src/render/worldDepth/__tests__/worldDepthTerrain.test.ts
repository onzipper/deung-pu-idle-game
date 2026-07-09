import { describe, expect, it } from "vitest";
import {
  createTerrain,
  TERRAIN_MAX_OFFSET,
  TERRAIN_MIN_OFFSET,
  TERRAIN_PRESETS,
} from "@/render/worldDepth/terrain";
import { GROUND_Y } from "@/render/layout";

/** The experiment's world width (2.75 × WORLD_WIDTH). */
const WORLD_W = 2475;

describe("worldDepth terrain — experiment ⑨", () => {
  it("exposes the 4 presets in display order with Thai labels", () => {
    expect(TERRAIN_PRESETS.map((p) => p.id)).toEqual(["flat", "hills", "valley", "plateau"]);
    for (const p of TERRAIN_PRESETS) expect(p.labelTh.length).toBeGreaterThan(0);
  });

  for (const { id } of TERRAIN_PRESETS) {
    describe(`preset "${id}"`, () => {
      const terrain = createTerrain(id, WORLD_W);

      it("is continuous: |Δy| per 1px stays under 1.5 across the full width", () => {
        let prev = terrain.groundY(0);
        for (let x = 1; x <= WORLD_W; x++) {
          const y = terrain.groundY(x);
          expect(Math.abs(y - prev)).toBeLessThan(1.5);
          prev = y;
        }
      });

      it("stays inside the headroom clamp [GROUND_Y-28, GROUND_Y+10]", () => {
        for (let x = 0; x <= WORLD_W; x += 7) {
          const y = terrain.groundY(x);
          expect(y).toBeGreaterThanOrEqual(GROUND_Y + TERRAIN_MIN_OFFSET);
          expect(y).toBeLessThanOrEqual(GROUND_Y + TERRAIN_MAX_OFFSET);
        }
      });

      it("clamps x outside [0, worldW] to the edge values", () => {
        expect(terrain.groundY(-1)).toBe(terrain.groundY(0));
        expect(terrain.groundY(-5000)).toBe(terrain.groundY(0));
        expect(terrain.groundY(WORLD_W + 1)).toBe(terrain.groundY(WORLD_W));
        expect(terrain.groundY(WORLD_W + 99999)).toBe(terrain.groundY(WORLD_W));
      });

      it("polyline(step) covers 0..worldW inclusive and matches groundY", () => {
        for (const step of [24, 225]) {
          const pts = terrain.polyline(step);
          // ceil(w/step) loop points + the exact worldW endpoint.
          expect(pts.length).toBe((Math.ceil(WORLD_W / step) + 1) * 2);
          expect(pts[0]).toBe(0);
          expect(pts[pts.length - 2]).toBe(WORLD_W);
          for (let i = 0; i < pts.length; i += 2) {
            expect(pts[i + 1]).toBe(terrain.groundY(pts[i]));
          }
          // Endpoint appears exactly once (step 225 divides 2475 evenly).
          const endpointCount = pts.filter((v, idx) => idx % 2 === 0 && v === WORLD_W).length;
          expect(endpointCount).toBe(1);
        }
      });
    });
  }

  it('"flat" returns exactly GROUND_Y everywhere (A/B baseline)', () => {
    const flat = createTerrain("flat", WORLD_W);
    for (let x = -10; x <= WORLD_W + 10; x += 0.5) {
      expect(flat.groundY(x)).toBe(GROUND_Y);
    }
    const pts = flat.polyline(50);
    for (let i = 1; i < pts.length; i += 2) expect(pts[i]).toBe(GROUND_Y);
  });

  it("non-flat presets actually rise and dip (not accidental flats)", () => {
    for (const id of ["hills", "valley", "plateau"] as const) {
      const terrain = createTerrain(id, WORLD_W);
      let min = Infinity;
      let max = -Infinity;
      for (let x = 0; x <= WORLD_W; x += 3) {
        const y = terrain.groundY(x);
        if (y < min) min = y;
        if (y > max) max = y;
      }
      expect(min).toBeLessThanOrEqual(GROUND_Y - 10); // real hills
      expect(max).toBeGreaterThan(GROUND_Y); // real dips
    }
  });
});
