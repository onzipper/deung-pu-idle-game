/**
 * Headless correctness guard for WORLD BOSS "เสี่ยจ๋อง" (hourly world boss)
 * render-wave fx: the 3 new lifecycle events (`worldBossSpawned`/
 * `worldBossDespawned`/`worldBossDefeated`) must not crash `FxController`, and
 * their SCREEN-level beats (shake) must gate on whether the LOCAL client is
 * actually standing in the boss's zone (`isLocalInWorldBossZone()`) — a
 * zone-wide world event, not a `povHeroIndex` concern (see that helper's doc
 * comment in `FxController.ts`).
 *
 * Constructed the same way `povGating.test.ts` does: a `document` stub so
 * `ImpactFilterController`'s WebGL probe degrades gracefully in plain Node,
 * and a real `initGameState()` state (avoids hand-listing every `GameState`
 * field — footgun 9, CLAUDE.md).
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

/** A fresh solo state, standing wherever `firstFarmLocation()` puts it (map1's
 * first farm zone — the world boss's own `CONFIG.worldBoss.mapId`), with a
 * live world-boss record attached at THAT same location. */
function stateWithWorldBoss(): GameState {
  const state = initGameState(1);
  state.worldBoss = {
    windowId: 1,
    mapId: state.location.mapId,
    zoneIdx: state.location.zoneIdx,
    active: true,
    defeated: false,
    countdown: 900,
    entity: {
      id: 999,
      x: 400,
      y: 190,
      hp: 400_000,
      maxHp: 400_000,
      atk: 350,
      cd: 1,
      skillCd: 1,
      telegraph: 0,
      enraged: false,
    },
  };
  return state;
}

function settle(fx: FxController, state: GameState): void {
  for (let i = 0; i < 40; i++) fx.update(0.1, state);
}

function shakeMagnitude(fx: FxController): number {
  const off = fx.shakeOffset;
  return Math.hypot(off.x, off.y);
}

describe("WORLD BOSS render wave — FxController lifecycle events", () => {
  it("worldBossSpawned: shakes the screen when the local client IS in the boss's zone", () => {
    const fx = makeFx();
    const state = stateWithWorldBoss();
    settle(fx, state);
    expect(shakeMagnitude(fx)).toBe(0);

    const events: GameEvent[] = [{ type: "worldBossSpawned", windowId: 1 }];
    expect(() => fx.consumeEvents(events, state)).not.toThrow();
    expect(shakeMagnitude(fx)).toBeGreaterThan(0);
  });

  it("worldBossSpawned: stays quiet when the local client is NOT in the boss's zone", () => {
    const fx = makeFx();
    const state = stateWithWorldBoss();
    // Move the LOCAL client's own location away from the boss's recorded zone
    // (simulates a cohort member elsewhere, or a stale record) — the dust
    // puff/world-anchored fx may still fire, but the screen-level shake must
    // not, per `isLocalInWorldBossZone()`'s gating contract.
    state.location = { mapId: state.worldBoss!.mapId, zoneIdx: state.worldBoss!.zoneIdx + 1 };
    settle(fx, state);

    const events: GameEvent[] = [{ type: "worldBossSpawned", windowId: 1 }];
    expect(() => fx.consumeEvents(events, state)).not.toThrow();
    expect(shakeMagnitude(fx)).toBe(0);
  });

  it("worldBossDefeated: uses the last-known live position (event carries no x/y) and shakes in-zone", () => {
    const fx = makeFx();
    const state = stateWithWorldBoss();
    settle(fx, state);
    // One live frame so `updateWorldBossTracking()` caches the position BEFORE
    // the engine nulls the entity the same step it emits the event (mirrors
    // real step() ordering — see `systems/worldBoss.ts`'s `retireWorldBoss`).
    fx.update(0.016, state);

    state.worldBoss!.active = false;
    state.worldBoss!.entity = null;
    const events: GameEvent[] = [{ type: "worldBossDefeated", windowId: 1 }];
    expect(() => fx.consumeEvents(events, state)).not.toThrow();
    expect(shakeMagnitude(fx)).toBeGreaterThan(0);
  });

  it("worldBossDespawned: never crashes even with no cached position yet (defensive no-op)", () => {
    const fx = makeFx();
    const state = stateWithWorldBoss();
    state.worldBoss!.active = false;
    state.worldBoss!.entity = null;
    // No prior `fx.update()` call ran while the entity was alive — the
    // last-known-position cache is still null; the handler must no-op, not throw.
    const events: GameEvent[] = [{ type: "worldBossDespawned", windowId: 1 }];
    expect(() => fx.consumeEvents(events, state)).not.toThrow();
  });

  it("a normal stage-boss bossSlamTelegraph frame still processes fine with no world boss active", () => {
    const fx = makeFx();
    const state = initGameState(1);
    state.worldBoss = null;
    const events: GameEvent[] = [{ type: "bossSlamTelegraph", x: 400, y: 190 }];
    expect(() => fx.consumeEvents(events, state)).not.toThrow();
  });
});
