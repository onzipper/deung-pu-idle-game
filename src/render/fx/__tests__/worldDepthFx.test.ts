/**
 * W4 "โลกมีมิติ" — FxController ground/depth anchoring guard.
 *
 * Verifies the W4 sweep: the `kill` event's NEW `id` field flows into the shared
 * `WorldFxContext` (depth band keyed on the enemy id) so the death beat anchors
 * on that enemy's terrain+depth FOOT-LINE, and that with the flags OFF (the
 * default context) every anchor collapses back to the flat `GROUND_Y` baseline
 * = pixel-identical to pre-W4.
 *
 * Observable: `FloatingTextPool.spawn()` sets the Text's `position` immediately,
 * so right after `consumeEvents()` (before any `update()` advances the rise) the
 * "+gold" kill-pop Text's `y` IS the anchor y the handler chose. Same headless
 * harness as the sibling fx tests (a `document` stub so `ImpactFilterController`'s
 * WebGL probe degrades to null in plain Node; real `pixi.js` Containers).
 */

import { Container, Text } from "pixi.js";
import { describe, expect, it } from "vitest";
import { initGameState } from "@/engine";
import { ENEMY_TYPES } from "@/engine/config";
import type { GameEvent, GameState } from "@/engine/state";
import { GROUND_Y } from "@/render/layout";
import { FxController } from "@/render/fx/FxController";
import type { WorldFxContext } from "@/render/worldDepth/worldFxContext";

if (typeof document === "undefined") {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ getContext: () => null }),
  };
}

function makeFx(worldFx?: WorldFxContext): { fx: FxController; fxContainer: Container } {
  const fxContainer = new Container();
  const world = new Container();
  const fx = new FxController(
    fxContainer,
    world,
    () => null,
    () => null,
    worldFx ? { worldFx } : undefined,
  );
  return { fx, fxContainer };
}

/** Run enough real-time updates to settle any first-sight party-join beat. */
function settle(fx: FxController, state: GameState): void {
  for (let i = 0; i < 30; i++) fx.update(0.1, state);
}

/** The `y` of the first visible "+gold" kill-pop Text anywhere under `root`
 * (FloatingTextPool sets `position` on spawn, before any rise). */
function goldPopY(root: Container): number | null {
  for (const child of root.children) {
    if (child instanceof Text && child.visible && child.text.startsWith("+")) return child.y;
    if (child instanceof Container) {
      const nested = goldPopY(child);
      if (nested != null) return nested;
    }
  }
  return null;
}

const KILL: Extract<GameEvent, { type: "kill" }> = {
  type: "kill",
  kind: "normal",
  x: 300,
  y: 190,
  goldGained: 5,
  id: 77,
};

describe("W4 โลกมีมิติ — FxController kill-pop ground/depth anchor", () => {
  it("flags OFF (default context): the kill pop sits at the exact flat GROUND_Y baseline", () => {
    const { fx, fxContainer } = makeFx();
    const state = initGameState(1);
    settle(fx, state);

    fx.consumeEvents([{ ...KILL }], state);

    const y = goldPopY(fxContainer);
    // GROUND_Y - 20 - 8*size, no lift — byte-identical to pre-W4.
    expect(y).toBe(GROUND_Y - 20 - 8 * ENEMY_TYPES.normal.size);
  });

  it("flags ON: the pop shifts onto the enemy foot-line by the footY delta, resolved via the kill event's own id", () => {
    const LIFT = 50;
    const calls: Array<{ m: string; a: unknown[] }> = [];
    // A hand-rolled ON context: footY returns GROUND_Y + LIFT for any actor, and
    // records the (kind, id, x) it was asked about so we can prove the wiring.
    const spy: WorldFxContext = {
      setFlags: () => {},
      setZone: () => {},
      groundY: () => GROUND_Y + LIFT,
      depthOf: (kind, id) => {
        calls.push({ m: "depthOf", a: [kind, id] });
        return 0.5;
      },
      footY: (x, d) => {
        calls.push({ m: "footY", a: [x, d] });
        return GROUND_Y + LIFT;
      },
      depthScaleOf: () => 1,
      lift: () => LIFT,
    };

    const off = makeFx();
    const on = makeFx(spy);
    const state = initGameState(1);
    settle(off.fx, state);
    settle(on.fx, state);
    calls.length = 0; // ignore any settle-time spawn portals; assert only the kill

    off.fx.consumeEvents([{ ...KILL }], state);
    on.fx.consumeEvents([{ ...KILL }], state);

    const yOff = goldPopY(off.fxContainer);
    const yOn = goldPopY(on.fxContainer);
    expect(yOff).not.toBeNull();
    expect(yOn).not.toBeNull();

    // The whole death beat dropped onto the foot-line by exactly the footY delta.
    expect(yOn! - yOff!).toBeCloseTo(LIFT);
    // ...and that delta was resolved through the depth band keyed on the NEW
    // kill event id (the whole point of the engine fence change).
    expect(
      calls.some((c) => c.m === "depthOf" && c.a[0] === "enemy" && c.a[1] === KILL.id),
    ).toBe(true);
    expect(calls.some((c) => c.m === "footY" && c.a[0] === KILL.x)).toBe(true);
  });
});
