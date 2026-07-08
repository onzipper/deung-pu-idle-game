/**
 * Headless correctness guard for "ตำราตำนาน" LEGENDARY tome/craft ONE-SHOT
 * event flourishes (endgame v1.2/v1.3, docs/endgame-design.md render wave) —
 * split out of the old `legendaryFx.test.ts` (deleted with `fx/legendaryFx.ts`
 * in the M9 pixel-fx weapon port; these three event handlers
 * — `onTomePageFound`/`onTomeAssembled`/`onLegendaryCraftRequested` — are a
 * SEPARATE, unrelated FxController concern that survives that retirement
 * untouched, so their coverage is preserved here rather than lost with the
 * module). Mirrors `asuraElite.test.ts`'s harness (real `initGameState()`
 * state so no `GameState` field needs hand-listing — footgun 9, CLAUDE.md).
 *
 * The last describe block below exercises a hero with a LEGENDARY weapon
 * equipped driving `FxController.update()` across many frames without
 * throwing — since the M9 port, this now rides the same `updateWeaponFx()`/
 * pixel-fx recipe path every OTHER weapon does (`resolveRefineFxRecipe(...,
 * true)`), not a dedicated `LegendaryFxController`.
 */

import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { initGameState } from "@/engine";
import { LEGENDARY_FOR_CLASS } from "@/engine/config/items";
import type { HeroClass } from "@/engine/entities";
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
    it(`${cls} with a legendary weapon equipped: continuous pixel-fx weapon update loop never throws`, () => {
      const fx = makeFx();
      const state = stateWithLegendary(cls);
      expect(() => {
        for (let i = 0; i < 180; i++) fx.update(1 / 60, state);
      }).not.toThrow();
    });
  }
});
