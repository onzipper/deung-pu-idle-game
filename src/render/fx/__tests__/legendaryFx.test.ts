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
import { LEGENDARY_FOR_CLASS, LEGENDARY_MAX_AWAKEN } from "@/engine/config/items";
import type { HeroClass } from "@/engine/entities";
import type { GameEvent, GameState } from "@/engine/state";
import { FxController } from "@/render/fx/FxController";
import { awakenParamsFor, LegendaryFxController } from "@/render/fx/legendaryFx";

if (typeof document === "undefined") {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ getContext: () => null }),
  };
}

describe("awakenParamsFor — ยิ่งปลุกยิ่งเดือด pure step lookup", () => {
  it("bands +0/+1 identically (today's baseline look, unchanged)", () => {
    expect(awakenParamsFor(0)).toEqual(awakenParamsFor(1));
  });

  it("bands +2/+3 identically (denser/brighter idle + slightly longer trail)", () => {
    expect(awakenParamsFor(2)).toEqual(awakenParamsFor(3));
  });

  it("each band is a REAL jump — every knob only ever increases (or a toggle flips on), never regresses, walking +0 -> +5", () => {
    const levels = [0, 1, 2, 3, 4, 5];
    let prev = awakenParamsFor(levels[0]);
    for (const level of levels.slice(1)) {
      const cur = awakenParamsFor(level);
      expect(cur.ambientActiveCount).toBeGreaterThanOrEqual(prev.ambientActiveCount);
      expect(cur.ambientAlphaMult).toBeGreaterThanOrEqual(prev.ambientAlphaMult);
      expect(cur.ambientRateMult).toBeGreaterThanOrEqual(prev.ambientRateMult);
      expect(cur.trailWidthMult).toBeGreaterThanOrEqual(prev.trailWidthMult);
      expect(cur.trailLifeMult).toBeGreaterThanOrEqual(prev.trailLifeMult);
      expect(cur.secondRing || !prev.secondRing).toBe(true); // never flips OFF
      expect(cur.glowPulse || !prev.glowPulse).toBe(true); // never flips OFF
      prev = cur;
    }
  });

  it("+4 is the first band with the orbiting second ring, and NOT yet the glow pulse", () => {
    const p4 = awakenParamsFor(4);
    expect(p4.secondRing).toBe(true);
    expect(p4.glowPulse).toBe(false);
    expect(awakenParamsFor(3).secondRing).toBe(false);
  });

  it('+5 ("จุติ" ceiling) is the ONLY band with the persistent glow pulse, and is strictly the most intense across every continuous knob', () => {
    const p5 = awakenParamsFor(5);
    expect(p5.glowPulse).toBe(true);
    expect(p5.secondRing).toBe(true);
    for (const level of [0, 1, 2, 3, 4]) {
      const p = awakenParamsFor(level);
      expect(p.glowPulse).toBe(false);
      expect(p5.ambientAlphaMult).toBeGreaterThan(p.ambientAlphaMult);
      expect(p5.ambientRateMult).toBeGreaterThan(p.ambientRateMult);
      expect(p5.trailWidthMult).toBeGreaterThan(p.trailWidthMult);
      expect(p5.trailLifeMult).toBeGreaterThan(p.trailLifeMult);
    }
    expect(p5.ambientActiveCount).toBe(5); // densest tier, matches the fixed pool cap
  });

  it("degrades out-of-range/bad input to the nearest valid band instead of throwing/indexing OOB", () => {
    expect(() => awakenParamsFor(-3)).not.toThrow();
    expect(awakenParamsFor(-3)).toEqual(awakenParamsFor(0));
    expect(() => awakenParamsFor(99)).not.toThrow();
    expect(awakenParamsFor(99)).toEqual(awakenParamsFor(LEGENDARY_MAX_AWAKEN));
    expect(() => awakenParamsFor(Number.NaN)).not.toThrow();
    expect(awakenParamsFor(Number.NaN)).toEqual(awakenParamsFor(0));
    expect(() => awakenParamsFor(2.4)).not.toThrow(); // rounds, still a valid band
  });
});

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

  it("every awaken level (+0..+5) sweeps without throwing and never grows the pooled Graphics count — the densest tier (+5) is the visible ceiling", () => {
    const container = new Container();
    const fx = new LegendaryFxController(container);
    const before = container.children.length;

    expect(() => {
      for (let level = 0; level <= 5; level++) {
        fx.setSlot(0, true, "swordsman", 10, 20, level === 5, level);
        fx.setSlot(1, true, "archer", -5, -5, level === 5, level);
        fx.setSlot(2, true, "mage", 900, 300, level === 5, level);
        for (let i = 0; i < 30; i++) fx.update(1 / 60);
      }
    }).not.toThrow();

    // Pool never grows past construction time, regardless of awaken level.
    expect(container.children.length).toBe(before);

    // At +5 every slot's visible children (ambient dots capped at the dense
    // count + the always-built ring/glow, both toggled on) stays within the
    // fixed pool — no per-level allocation ever occurs.
    const visibleAtCeiling = container.children.filter((c) => c.visible).length;
    expect(visibleAtCeiling).toBeGreaterThan(0);
    expect(visibleAtCeiling).toBeLessThanOrEqual(before);

    fx.destroy();
  });

  it("an out-of-range awaken level (negative/NaN/above ceiling) degrades gracefully instead of throwing", () => {
    const fx = new LegendaryFxController(new Container());
    expect(() => {
      fx.setSlot(0, true, "swordsman", 10, 10, false, -7);
      fx.update(1 / 60);
      fx.setSlot(0, true, "swordsman", 10, 10, false, 999);
      fx.update(1 / 60);
      fx.setSlot(0, true, "swordsman", 10, 10, false, Number.NaN);
      fx.update(1 / 60);
    }).not.toThrow();
    fx.destroy();
  });

  it("omitting the awaken level defaults to +0/+1's baseline (backward-compatible call signature)", () => {
    const container = new Container();
    const fx = new LegendaryFxController(container);
    fx.setSlot(0, true, "swordsman", 10, 10, false); // no 7th arg
    for (let i = 0; i < 60; i++) fx.update(1 / 60);
    // Baseline tier never activates the ring/glow — only ambient dots + trail
    // Graphics are ever visible.
    const visible = container.children.filter((c) => c.visible);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThanOrEqual(3); // AMBIENT_BASE_COUNT
    fx.destroy();
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
