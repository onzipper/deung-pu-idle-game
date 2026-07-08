/**
 * Headless correctness guard for the NINJA `dash` fx (SAVE v18 render wave,
 * `fx/shadowDash.ts`) — same convention as `skillSpectacle.test.ts`: real
 * `pixi.js` Graphics path-building, no canvas/WebGL needed.
 *
 * Guards:
 *  - a chain-dash ultimate firing several `trigger()` calls in ONE frame
 *    (up to 8 hops, `ninja_massacre`) never grows the pool past its cap
 *    (steady display-object budget, same ring-buffer contract as every other
 *    pool in this directory).
 *  - `update()` fully resolves every streak/afterimage back to `visible =
 *    false` — no stuck-visible slot after enough real time passes.
 *  - `destroy()` never throws.
 */

import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { ShadowDashPool } from "@/render/fx/shadowDash";

describe("ShadowDashPool (ninja dash streak + afterimage)", () => {
  it("a chain-dash burst (well past the 10-slot cap) never grows the pool", () => {
    const container = new Container();
    const pool = new ShadowDashPool(container);
    const before = container.children.length;

    for (let i = 0; i < 20; i++) {
      expect(() => pool.trigger(i * 10, 200, i * 10 + 40, 200)).not.toThrow();
    }

    // Fixed-size ring buffers for both the streak layer and the afterimage
    // layer — child count never grows past whatever it started at.
    expect(container.children.length).toBe(before);
  });

  it("a zero-length dash (fromX === toX, e.g. a hop clamped at the field edge) never throws", () => {
    const container = new Container();
    const pool = new ShadowDashPool(container);
    expect(() => pool.trigger(50, 200, 50, 200)).not.toThrow();
    expect(() => pool.update(0.05)).not.toThrow();
  });

  it("every streak + afterimage fully resolves back to invisible after enough real time", () => {
    const container = new Container();
    const pool = new ShadowDashPool(container);
    for (let i = 0; i < 8; i++) pool.trigger(i * 5, 200, i * 5 + 30, 200);

    for (let i = 0; i < 20; i++) pool.update(0.1);

    for (const child of container.children) {
      expect(child.visible).toBe(false);
    }
  });

  it("destroy() never throws and clears the container", () => {
    const container = new Container();
    const pool = new ShadowDashPool(container);
    pool.trigger(0, 200, 40, 200);
    expect(() => pool.destroy()).not.toThrow();
    expect(container.children.length).toBe(0);
  });
});
