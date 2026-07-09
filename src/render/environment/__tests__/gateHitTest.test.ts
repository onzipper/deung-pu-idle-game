/**
 * R1 W2 "tappable gates" — pure hit-test coverage:
 *  - `gateTapSide()` alone (zone-kind edge cases: town skips the left side,
 *    boss rooms have no gates at all, generous ≥48-world-unit-wide rect).
 *  - the EXACT composition `GameRenderer.hitTestGate()` uses
 *    (`canvasToWorld` → `gateTapSide`), round-tripped with the camera off
 *    (today's tap math) and on (two-transform inverse, zoomed) — same style
 *    as `worldDepthPlacement.test.ts`'s "Hit-test integration" block.
 */

import { describe, expect, it } from "vitest";
import { GROUND_Y } from "@/render/layout";
import { canvasToWorld } from "@/render/worldDepth/hitTestMath";
import {
  DEFAULT_GATE_TAP_HALF_W,
  gateTapSide,
  gateX,
} from "@/render/environment/zoneGates";

describe("gateTapSide — pure geometry", () => {
  it("hits left at the left gate x, right at the right gate x, for a farm zone", () => {
    const lx = gateX("map1", "left");
    const rx = gateX("map1", "right");
    expect(gateTapSide(lx, GROUND_Y, GROUND_Y, "map1", "farm")).toBe("left");
    expect(gateTapSide(rx, GROUND_Y, GROUND_Y, "map1", "farm")).toBe("right");
  });

  it("town: the left side never hits (no archway is built there)", () => {
    const lx = gateX("map1", "left");
    const rx = gateX("map1", "right");
    expect(gateTapSide(lx, GROUND_Y, GROUND_Y, "map1", "town")).toBeNull();
    expect(gateTapSide(rx, GROUND_Y, GROUND_Y, "map1", "town")).toBe("right");
  });

  it("boss room: no gates at all (bossArena.ts frames it instead)", () => {
    const rx = gateX("map1", "right");
    expect(gateTapSide(rx, GROUND_Y, GROUND_Y, "map1", "boss")).toBeNull();
  });

  it("rect is generous: at least ±24 world units (≥48px wide) around each gate x", () => {
    expect(DEFAULT_GATE_TAP_HALF_W).toBeGreaterThanOrEqual(24);
    const rx = gateX("map1", "right");
    expect(gateTapSide(rx + DEFAULT_GATE_TAP_HALF_W - 1, GROUND_Y, GROUND_Y, "map1", "farm")).toBe(
      "right",
    );
  });

  it("full arch height: hits well above ground, misses far above/below the rect", () => {
    const rx = gateX("map1", "right");
    expect(gateTapSide(rx, GROUND_Y - 100, GROUND_Y, "map1", "farm")).toBe("right");
    expect(gateTapSide(rx, GROUND_Y - 400, GROUND_Y, "map1", "farm")).toBeNull();
    expect(gateTapSide(rx, GROUND_Y + 200, GROUND_Y, "map1", "farm")).toBeNull();
  });

  it("misses far away on x", () => {
    const rx = gateX("map1", "right");
    expect(gateTapSide(rx + 200, GROUND_Y, GROUND_Y, "map1", "farm")).toBeNull();
  });
});

describe("hitTestGate composition (canvasToWorld → gateTapSide), camera off/on", () => {
  const base = { x: 100, y: 50, scale: 2 };

  it("camera OFF: a screen tap forward-projected from the right gate resolves to 'right'", () => {
    const cam = { x: 0, y: 0, scale: 1 };
    const rx = gateX("map1", "right");
    const canvasX = base.x + (cam.x + rx * cam.scale) * base.scale;
    const canvasY = base.y + (cam.y + GROUND_Y * cam.scale) * base.scale;
    const w = canvasToWorld(canvasX, canvasY, base, cam);
    expect(gateTapSide(w.x, w.y, GROUND_Y, "map1", "farm")).toBe("right");
  });

  it("camera ON (zoomed): the two-transform inverse still resolves the correct gate", () => {
    const cam = { x: 40, y: -18, scale: 1.06 };
    const lx = gateX("map1", "left");
    const canvasX = base.x + (cam.x + lx * cam.scale) * base.scale;
    const canvasY = base.y + (cam.y + GROUND_Y * cam.scale) * base.scale;
    const w = canvasToWorld(canvasX, canvasY, base, cam);
    expect(w.x).toBeCloseTo(lx, 4);
    expect(gateTapSide(w.x, w.y, GROUND_Y, "map1", "farm")).toBe("left");
  });
});
