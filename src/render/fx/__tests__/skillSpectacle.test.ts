/**
 * Headless correctness guard for the M7.7 "Skill Spectacle" fx additions —
 * `pixi.js` Graphics path-building runs fine in plain Node (same convention
 * as `views/__tests__/rig.test.ts`), so this exercises the REAL pool code
 * (build-once shapes, safeRadius clamping, ring-buffer/delay-slot caps)
 * rather than a hand-derived re-statement of the same math.
 *
 * Guards:
 *  - `GroundCrackPool`/`CurtainSweepPool`/`SkyDarkenOverlay` never throw on a
 *    zero/negative radius (the POC's `IndexSizeError` crash class).
 *  - Spawning well past a pool's cap never grows its child count (steady
 *    display-object budget — the M7.7 caps this task bumped: rain-arrow
 *    tracking, ring pool, scorch pool).
 */

import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { CurtainSweepPool } from "@/render/fx/curtainSweep";
import { GroundCrackPool } from "@/render/fx/groundCrack";
import { RingPool } from "@/render/fx/rings";
import { SkyDarkenOverlay } from "@/render/fx/skyDarken";

describe("M7.7 skill-spectacle fx pools", () => {
  it("GroundCrackPool: zero/negative radius spawns don't throw, cap holds", () => {
    const container = new Container();
    const pool = new GroundCrackPool(container, 4);

    expect(() =>
      pool.spawn({ x: 0, y: 0, radius: 0, darkColor: 0x000000, glowColor: 0xffffff }),
    ).not.toThrow();
    expect(() =>
      pool.spawn({ x: 0, y: 0, radius: -50, darkColor: 0x000000, glowColor: 0xffffff }),
    ).not.toThrow();

    for (let i = 0; i < 20; i++) {
      pool.spawn({ x: i, y: 0, radius: 40, darkColor: 0x000000, glowColor: 0xffffff });
    }
    expect(container.children.length).toBe(4);

    pool.update(1);
    expect(() => pool.destroy()).not.toThrow();
  });

  it("CurtainSweepPool: spawnField schedules one streak per offset, delay-then-active", () => {
    const container = new Container();
    const pool = new CurtainSweepPool(container, 24);
    const offsets = [{ dx: -420 }, { dx: -210 }, { dx: 0 }, { dx: 210 }, { dx: 420 }];

    expect(() =>
      pool.spawnField(450, offsets, {
        topY: -60,
        bottomY: 216,
        color: 0x2ecc71,
        sweepSpan: 0.4,
      }),
    ).not.toThrow();

    // Nothing should be visible before any delay elapses (the first entry's
    // delay is 0, so it IS active immediately — the rest wait).
    const activeCount = container.children.filter((c) => c.visible).length;
    expect(activeCount).toBeGreaterThanOrEqual(1);
    expect(activeCount).toBeLessThan(offsets.length);

    // Advance well past the whole sweep span — everything should resolve
    // (become active then fade back out) without throwing or growing pool size.
    for (let i = 0; i < 20; i++) pool.update(0.1);
    expect(container.children.length).toBe(24);

    expect(() => pool.destroy()).not.toThrow();
  });

  it("SkyDarkenOverlay: fade-in -> hold -> fade-out never leaves a stuck alpha", () => {
    const overlay = new SkyDarkenOverlay(900, 300);
    overlay.trigger(0x140026, 0.42);
    expect(overlay.view.visible).toBe(true);

    for (let i = 0; i < 20; i++) overlay.update(0.1);
    expect(overlay.view.visible).toBe(false);
    expect(overlay.view.alpha).toBe(0);

    expect(() => overlay.destroy()).not.toThrow();
  });

  it("RingPool: an explicit cap argument (M7.7 bumped the shared instance 12->24) holds", () => {
    const container = new Container();
    const pool = new RingPool(container, 24);
    for (let i = 0; i < 40; i++) {
      pool.spawn({ x: i, y: 0, r1: 10, color: 0xffffff });
    }
    expect(container.children.length).toBe(24);
    expect(() => pool.destroy()).not.toThrow();
  });
});
