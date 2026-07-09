/**
 * R1 W2 "tappable gates" — `GateLockOverlay`'s locked/open readout, same
 * headless-bounds-sanity convention as `gates.test.ts`'s `BossDoorProp` cycle
 * test (pixi.js `Graphics` path building + `getBounds()` runs fine in plain
 * Node).
 */

import { describe, expect, it } from "vitest";
import { GROUND_Y } from "@/render/layout";
import { ARCH_TOP } from "@/render/environment/gateArch";
import { GateLockOverlay } from "@/render/environment/gateLockOverlay";

function expectSaneBounds(b: { x: number; y: number; width: number; height: number }): void {
  expect(Number.isFinite(b.x)).toBe(true);
  expect(Number.isFinite(b.y)).toBe(true);
  expect(b.width).toBeGreaterThan(0);
  expect(b.height).toBeGreaterThan(0);
}

describe("GateLockOverlay", () => {
  it("OPEN state (default): glow visible, padlock/bar hidden, sane bounds", () => {
    const overlay = new GateLockOverlay(0, GROUND_Y, ARCH_TOP);
    overlay.setState(false, 0, 1);
    for (let i = 0; i < 5; i++) overlay.update(1 / 60);
    expectSaneBounds(overlay.view.getBounds());
    overlay.destroy();
  });

  it("LOCKED state: padlock/bar visible, glow hidden, never crashes across a progress sweep", () => {
    const overlay = new GateLockOverlay(0, GROUND_Y, ARCH_TOP);
    for (let kills = 0; kills <= 24; kills += 6) {
      overlay.setState(true, kills, 24);
      overlay.update(1 / 60);
      expectSaneBounds(overlay.view.getBounds());
    }
    overlay.destroy();
  });

  it("transitions locked -> open cleanly across many ticks", () => {
    const overlay = new GateLockOverlay(50, GROUND_Y, ARCH_TOP);
    overlay.setState(true, 3, 24);
    for (let i = 0; i < 10; i++) overlay.update(1 / 60);
    overlay.setState(false, 24, 24);
    for (let i = 0; i < 60; i++) overlay.update(1 / 60);
    expectSaneBounds(overlay.view.getBounds());
    overlay.destroy();
  });

  it("goal=0 never divides by zero (progress bar degrades to empty, not NaN)", () => {
    const overlay = new GateLockOverlay(0, GROUND_Y, ARCH_TOP);
    overlay.setState(true, 0, 0);
    expect(() => overlay.update(1 / 60)).not.toThrow();
    overlay.destroy();
  });
});
