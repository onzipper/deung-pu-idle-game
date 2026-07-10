/**
 * Contact shadow (R4.5 Wave 1, issue #69) — headless geometry guard.
 *
 * Exercises the REAL `entityShadow` primitive + REAL pixi `getBounds()`
 * scene-graph math (no WebGL/Application needed), the same approach as
 * `worldDepthPlacement.test.ts`. THE load-bearing invariants:
 *   1. the shadow ellipse is centered on x=0 and its footprint width tracks the
 *      requested `rx` (so it reads under the actor, not off to one side);
 *   2. inside a GROUND_Y-pivoted actor root placed at `view.y = F`, the shadow's
 *      contact point renders at ~F for ANY root scale AND any own footprint
 *      scale — i.e. it never floats off the feet (the pivot double-subtraction
 *      trap, known-traps #3);
 *   3. a negative/zero footprint clamps to a degenerate (zero-size) shape rather
 *      than throwing (the POC negative-radius crash rule).
 */

import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { GROUND_Y } from "@/render/layout";
import {
  attachContactShadow,
  createEntityShadow,
  ENEMY_SHADOW_RX,
} from "@/render/views/entityShadow";

function centerY(b: { y: number; height: number }): number {
  return b.y + b.height / 2;
}
function centerX(b: { x: number; width: number }): number {
  return b.x + b.width / 2;
}

describe("entityShadow: geometry", () => {
  it("is centered on x=0 and its width tracks the footprint half-width", () => {
    const rx = 20;
    const g = createEntityShadow(rx);
    const b = g.getBounds();
    expect(Math.abs(centerX(b))).toBeLessThan(0.5); // centered under the actor
    expect(b.width).toBeCloseTo(2 * rx, 0); // outer ellipse spans 2·rx
    // Sits right at the contact line (a hair above GROUND_Y).
    expect(Math.abs(centerY(b) - (GROUND_Y - 1))).toBeLessThan(1.5);
    g.destroy();
  });

  it("clamps a non-positive footprint to a degenerate shape (no negative radius)", () => {
    expect(() => createEntityShadow(-5).destroy()).not.toThrow();
    const g = createEntityShadow(0);
    expect(g.getBounds().width).toBeLessThan(0.5);
    g.destroy();
  });
});

describe("entityShadow: stays planted at the foot line inside a pivoted root", () => {
  // Replicates GameRenderer's transform exactly: root pivot GROUND_Y, per-frame
  // view.y = F, root depth scale, plus the enemy footprint scale on the shadow.
  const SCALES = [0.95, 1.0, 1.06] as const;
  const FOOTPRINTS = [1, 1.35] as const; // normal + elite-scaled

  it("contact point holds ~F across root scale × footprint scale", () => {
    const F = GROUND_Y + 25;
    for (const foot of FOOTPRINTS) {
      const root = new Container();
      root.pivot.y = GROUND_Y;
      const withShadow = attachContactShadow(root, ENEMY_SHADOW_RX);
      withShadow.contactShadow.scale.set(foot);
      root.y = F;
      for (const s of SCALES) {
        root.scale.set(s);
        const cy = centerY(withShadow.contactShadow.getBounds());
        // The ellipse center rides the foot line (GROUND_Y − 1 in root-local),
        // so on-screen it sits ~F (within the 1px foot inset × scale).
        expect(Math.abs(cy - F)).toBeLessThan(3);
      }
      root.destroy({ children: true });
    }
  });

  it("is the BACKMOST child (drawn behind the actor body)", () => {
    const root = new Container();
    root.pivot.y = GROUND_Y;
    const dummyBody = new Container();
    root.addChild(dummyBody);
    const withShadow = attachContactShadow(root, ENEMY_SHADOW_RX);
    expect(root.getChildIndex(withShadow.contactShadow)).toBe(0);
    expect(root.getChildIndex(withShadow.contactShadow)).toBeLessThan(
      root.getChildIndex(dummyBody),
    );
    root.destroy({ children: true });
  });
});
