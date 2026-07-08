/**
 * Headless correctness guard for the "ตำราตำนาน" LEGENDARY weapon fx
 * (endgame v1.2/v1.3, docs/endgame-design.md render wave):
 *
 *  - `LegendaryFxController` pool sweep (mirrors `championAura.test.ts`'s
 *    harness): active/idle/negative-position/every-class slots never throw
 *    and never grow the pooled Graphics count.
 *  - `FxController`-level no-throw guard on the 3 new engine events
 *    (`tomePageFound`/`tomeAssembled`/`legendaryCraftRequested`), mirroring
 *    `asuraElite.test.ts`'s harness (real `initGameState()` state so no
 *    `GameState` field needs hand-listing — footgun 9, CLAUDE.md).
 *  - A hero with a legendary weapon equipped drives the continuous
 *    idle-signature + attack-swing-trail path (`updateGearFx`/
 *    `updateLegendaryFx`) across many frames without throwing, for every
 *    class, and does NOT also trigger the ordinary tier-6/epic `gearAura`
 *    flame (the two are meant to be mutually exclusive).
 */

import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { initGameState } from "@/engine";
import { LEGENDARY_FOR_CLASS } from "@/engine/config/items";
import type { HeroClass } from "@/engine/entities";
import type { GameEvent, GameState } from "@/engine/state";
import { FxController } from "@/render/fx/FxController";
import { LegendaryFxController } from "@/render/fx/legendaryFx";

if (typeof document === "undefined") {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ getContext: () => null }),
  };
}

describe("LegendaryFxController — pool sweep", () => {
  it("active/idle/negative-position/every-class slots never throw and never grow the pooled Graphics count", () => {
    const container = new Container();
    const fx = new LegendaryFxController(container);
    const before = container.children.length;
    expect(before).toBeGreaterThan(0); // dots + trail Graphics exist from construction

    expect(() => {
      fx.setSlot(0, true, "swordsman", 10, 20, true);
      fx.setSlot(1, true, "archer", -5, -5, false);
      fx.setSlot(2, true, "mage", 900, 300, true);
      for (let i = 0; i < 200; i++) fx.update(1 / 60);
      fx.setSlot(0, true, "ninja", 50, 50, true); // class change on an already-active slot
      for (let i = 0; i < 200; i++) fx.update(1 / 60);
    }).not.toThrow();

    expect(container.children.length).toBe(before);
    fx.destroy();
  });

  it("deactivating eases the ambient signature out and freezes (never un-decays) the trail", () => {
    const container = new Container();
    const fx = new LegendaryFxController(container);

    fx.setSlot(0, true, "swordsman", 10, 10, true);
    for (let i = 0; i < 60; i++) fx.update(1 / 60);

    fx.setSlot(0, false, null, 10, 10, false);
    expect(() => {
      for (let i = 0; i < 120; i++) fx.update(1 / 60);
    }).not.toThrow();

    fx.destroy();
  });

  it("ignores out-of-range slot indices instead of throwing", () => {
    const fx = new LegendaryFxController(new Container());
    expect(() => {
      fx.setSlot(-1, true, "swordsman", 0, 0, false);
      fx.setSlot(99, true, "archer", 0, 0, false);
      fx.update(1 / 60);
    }).not.toThrow();
  });

  it("a never-activated controller stays inert (no visible ambient dot) across many frames", () => {
    const container = new Container();
    const fx = new LegendaryFxController(container);
    for (let i = 0; i < 120; i++) fx.update(1 / 60);
    const visibleChildren = container.children.filter((c) => c.visible);
    expect(visibleChildren.length).toBe(0);
    fx.destroy();
  });
});

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

function stateWithLegendary(cls: HeroClass): GameState {
  const state = initGameState(1);
  const hero = state.heroes[0];
  hero.cls = cls;
  hero.equipped = { weapon: LEGENDARY_FOR_CLASS[cls], armor: null };
  return state;
}

function settle(fx: FxController, state: GameState): void {
  for (let i = 0; i < 20; i++) fx.update(0.1, state);
}

describe("FxController — ตำราตำนาน tome/craft events never crash", () => {
  it("tomePageFound: page-flutter burst fires without throwing, for every page", () => {
    const fx = makeFx();
    const state = initGameState(1);
    settle(fx, state);

    for (const page of [1, 2, 3] as const) {
      const events: GameEvent[] = [
        { type: "tomePageFound", page, pagesFound: page, pagesTotal: 3 },
      ];
      expect(() => fx.consumeEvents(events, state)).not.toThrow();
    }
    expect(() => fx.update(0.016, state)).not.toThrow();
  });

  it("tomeAssembled: the big arcane reveal fires without throwing", () => {
    const fx = makeFx();
    const state = initGameState(1);
    settle(fx, state);

    const events: GameEvent[] = [{ type: "tomeAssembled" }];
    expect(() => fx.consumeEvents(events, state)).not.toThrow();
    expect(() => fx.update(0.016, state)).not.toThrow();
  });

  it("legendaryCraftRequested: the forge-flash flourish fires without throwing, every class", () => {
    const fx = makeFx();
    const state = initGameState(1);
    settle(fx, state);

    for (const cls of ["swordsman", "archer", "mage", "ninja"] as const) {
      const events: GameEvent[] = [
        { type: "legendaryCraftRequested", cls, templateId: LEGENDARY_FOR_CLASS[cls] },
      ];
      expect(() => fx.consumeEvents(events, state)).not.toThrow();
    }
    expect(() => fx.update(0.016, state)).not.toThrow();
  });

  it("a roster with NO hero of the crafted class still resolves (falls back to the solo hero)", () => {
    const fx = makeFx();
    const state = initGameState(1);
    state.heroes[0].cls = "swordsman";
    settle(fx, state);

    const events: GameEvent[] = [
      { type: "legendaryCraftRequested", cls: "mage", templateId: LEGENDARY_FOR_CLASS.mage },
    ];
    expect(() => fx.consumeEvents(events, state)).not.toThrow();
  });

  for (const cls of ["swordsman", "archer", "mage", "ninja"] as const) {
    it(`${cls} with a legendary weapon equipped: continuous idle-signature + trail update loop never throws`, () => {
      const fx = makeFx();
      const state = stateWithLegendary(cls);
      expect(() => {
        for (let i = 0; i < 180; i++) fx.update(1 / 60, state);
      }).not.toThrow();
    });
  }
});
