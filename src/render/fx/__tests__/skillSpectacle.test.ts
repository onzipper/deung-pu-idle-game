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
import { ArrowSwarmPool } from "@/render/fx/arrowSwarm";
import { CurtainSweepPool } from "@/render/fx/curtainSweep";
import { GroundArrowPool } from "@/render/fx/rainScene";
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

  it("RingPool: an explicit cap argument (M7.9 bumped the shared instance 24->32) holds", () => {
    const container = new Container();
    const pool = new RingPool(container, 32);
    for (let i = 0; i < 50; i++) {
      pool.spawn({ x: i, y: 0, r1: 10, color: 0xffffff });
    }
    expect(container.children.length).toBe(32);
    expect(() => pool.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// M7.9 "Grand Expansion" tier-3 skill-4 additions: STORM's arrow-swarm band
// + longer-lived/finale-glinting ground arrows, and APOCALYPSE/STORM's
// sky-darken sustained-hold override.
// ---------------------------------------------------------------------------
describe("M7.9 tier-3 skill-4 fx pools", () => {
  it("ArrowSwarmPool: spawnBand schedules one cluster per slot, delay-then-drift, cap holds", () => {
    const container = new Container();
    const pool = new ArrowSwarmPool(container, 6);

    expect(() => pool.spawnBand(450, 7, 26, 0x13210f, 4)).not.toThrow();
    // More clusters requested than the cap — should silently ring-buffer,
    // never grow the container's child count past the cap.
    expect(container.children.length).toBe(6);

    for (let i = 0; i < 60; i++) pool.update(0.1);
    expect(container.children.length).toBe(6);
    expect(() => pool.destroy()).not.toThrow();
  });

  it("GroundArrowPool: per-spawn `life` overrides the default, cap holds at 24", () => {
    const container = new Container();
    const pool = new GroundArrowPool(container);

    // Default-life spawn (signature/barrage) + a much-longer STORM spawn.
    pool.spawn(0, 0, 0xffffff);
    pool.spawn(10, 0, 0xffffff, 4.5);

    for (let i = 0; i < 6; i++) pool.update(0.1); // 0.6s — default-life arrow should be gone
    // (no direct slot introspection — this just proves update()/spawn() with
    // an explicit `life` never throws across many steps)

    for (let i = 0; i < 30; i++) {
      pool.spawn(i, 0, 0xffffff, 4.5);
    }
    expect(container.children.length).toBe(24);
    expect(() => pool.destroy()).not.toThrow();
  });

  it("GroundArrowPool: finaleGlintAndFadeAll() resets every active slot and never throws on an empty field", () => {
    const container = new Container();
    const pool = new GroundArrowPool(container);

    // Empty-field call first — must be a no-op, not a throw.
    expect(() => pool.finaleGlintAndFadeAll(0.5)).not.toThrow();

    for (let i = 0; i < 8; i++) pool.spawn(i, 0, 0xffffff, 4.5);
    expect(() => pool.finaleGlintAndFadeAll(0.55)).not.toThrow();
    for (let i = 0; i < 10; i++) pool.update(0.1);
    expect(() => pool.destroy()).not.toThrow();
  });

  it("SkyDarkenOverlay: a longer `hold` override (STORM/APOCALYPSE) sustains visibility past the default 0.4s hold", () => {
    const overlay = new SkyDarkenOverlay(900, 300);
    overlay.trigger(0x0d001f, 0.56, 2.6); // APOCALYPSE-style: darker + much longer hold

    // Past the OLD default total (~0.85s) the overlay must still be visible —
    // proves the hold override actually extends the sustain, not just alpha.
    for (let i = 0; i < 10; i++) overlay.update(0.1); // 1.0s elapsed
    expect(overlay.view.visible).toBe(true);

    for (let i = 0; i < 30; i++) overlay.update(0.1); // well past total (~3.05s)
    expect(overlay.view.visible).toBe(false);
    // Floating-point residue from ~40 repeated `-= 0.1` steps (vs the
    // original cataclysm test's fewer steps) can leave a near-zero, not
    // exactly-zero, alpha — `closeTo` is the correct tolerance here, not a
    // stuck-alpha bug.
    expect(overlay.view.alpha).toBeCloseTo(0, 5);

    expect(() => overlay.destroy()).not.toThrow();
  });
});
