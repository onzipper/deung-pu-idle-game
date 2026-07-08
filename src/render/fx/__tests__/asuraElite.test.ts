/**
 * ดินแดนอสูร (ASURA endgame v1) ELITE lifecycle fx — headless no-throw guard,
 * mirroring `worldBoss.test.ts`'s harness (`document` stub so
 * `ImpactFilterController`'s WebGL probe degrades gracefully in plain Node, a
 * real `initGameState()` state so no `GameState` field needs hand-listing —
 * footgun 9, CLAUDE.md).
 *
 * Covers `eliteSpawned`/`eliteKilled` (the two edge-triggered beats this
 * render wave added to `FxController`) plus a repeated-burst sweep (several
 * elites spawning/dying across a farming session) to catch any pool
 * exhaustion/NaN-radius regression before it ships.
 */

import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { initGameState } from "@/engine";
import type { GameEvent, GameState } from "@/engine/state";
import { FxController } from "@/render/fx/FxController";

if (typeof document === "undefined") {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ getContext: () => null }),
  };
}

function makeFx(): FxController {
  const fxContainer = new Container();
  const world = new Container();
  return new FxController(
    fxContainer,
    world,
    () => null,
    () => null,
  );
}

function asuraState(): GameState {
  const state = initGameState(1);
  state.location = { mapId: "asura", zoneIdx: 0 };
  return state;
}

function settle(fx: FxController, state: GameState): void {
  for (let i = 0; i < 20; i++) fx.update(0.1, state);
}

describe("ASURA elite fx — eliteSpawned/eliteKilled never crash FxController", () => {
  it("eliteSpawned: telegraph ring/burst/callout fire without throwing", () => {
    const fx = makeFx();
    const state = asuraState();
    settle(fx, state);

    const events: GameEvent[] = [{ type: "eliteSpawned", id: 500, kind: "tank", x: 300, y: 190 }];
    expect(() => fx.consumeEvents(events, state)).not.toThrow();
    expect(() => fx.update(0.016, state)).not.toThrow();
  });

  it("eliteKilled: kill-flourish burst/shake/label fire without throwing, essence=0 included", () => {
    const fx = makeFx();
    const state = asuraState();
    settle(fx, state);

    for (const essence of [0, 1, 5]) {
      const events: GameEvent[] = [{ type: "eliteKilled", x: 300, y: 190, essence }];
      expect(() => fx.consumeEvents(events, state)).not.toThrow();
    }
    expect(() => fx.update(0.016, state)).not.toThrow();
  });

  it("asuraZoneStoneEarned: falls through to the no-fx default without throwing", () => {
    const fx = makeFx();
    const state = asuraState();
    settle(fx, state);

    const events: GameEvent[] = [{ type: "asuraZoneStoneEarned", mapId: "asura", zoneIdx: 0 }];
    expect(() => fx.consumeEvents(events, state)).not.toThrow();
  });

  it("repeated elite spawn/kill bursts across a farming session never exhaust a pool", () => {
    const fx = makeFx();
    const state = asuraState();
    settle(fx, state);

    expect(() => {
      for (let i = 0; i < 30; i++) {
        const kind = (["normal", "fast", "tank", "ranged"] as const)[i % 4];
        fx.consumeEvents(
          [{ type: "eliteSpawned", id: 1000 + i, kind, x: (i * 37) % 900, y: 190 }],
          state,
        );
        fx.update(0.05, state);
        fx.consumeEvents(
          [{ type: "eliteKilled", x: (i * 37) % 900, y: 190, essence: 1 }],
          state,
        );
        fx.update(0.05, state);
      }
    }).not.toThrow();
  });
});
