/**
 * Headless correctness guard for M8 party P6's POV skill-fx gating — a live-
 * test complaint that a FRIEND's ultimate hijacked the local screen (sky
 * darkened, camera shook/punched) because `FxController` fired SCREEN-level
 * beats for every `skillCast` regardless of who cast it. Design decision:
 * world-anchored fx (particles/rings/decals/sky overlays anchored at the
 * caster's own position) keep firing for EVERY cohort member's cast — co-op
 * spectacle is intended — but SCREEN-level beats (camera shake/punch, the
 * full-viewport sky-darken overlay, impact filters) only fire when the
 * casting hero (`skillCast.slot`) is the LOCAL point-of-view hero
 * (`FxController.setPovHeroIndex()`).
 *
 * `archer_storm` is the vehicle: `onArcherStormCast()` fires its
 * shake/punch/skyDarken trigger SYNCHRONOUSLY inside `consumeEvents()` (no
 * pendingMeteor/rain-arrow-landing indirection needed to observe the
 * immediate gating), while its bow-flash/volley-launch/arrow-swarm-band fx
 * are unconditional world-level beats — exactly the split under test.
 *
 * Constructed the same way `heroParty.test.ts` builds fixtures: real
 * `pixi.js` Container/Graphics path-building runs fine in plain Node, and a
 * real `initGameState()` hero avoids hand-listing every `Hero` field (which
 * would drift as the type grows — footgun 9 in CLAUDE.md).
 */

import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { initGameState } from "@/engine";
import type { Hero } from "@/engine/entities";
import type { GameEvent, GameState } from "@/engine/state";
import { FxController } from "@/render/fx/FxController";

// `FxController`'s constructor eagerly builds an `ImpactFilterController`,
// which constructs a real `pixi-filters` `ShockwaveFilter` — its `GlProgram`
// probes for a WebGL test context via `document.createElement("canvas")`
// (`pixi.js`'s `BrowserAdapter`). This vitest project runs in a plain Node
// environment (no DOM — see `vitest.config.ts`'s own doc comment on why
// `engine/` tests stay headless), so `document` is undefined outright. A
// minimal stub — `createElement` returning an object whose `getContext()`
// resolves to `null` — is enough: pixi's `getMaxFragmentPrecision()` treats a
// null context as "no WebGL available" and falls back to `"mediump"` with no
// side effects, so this never fakes an actual rendering capability, it just
// lets the constructor's probe fail gracefully instead of throwing.
if (typeof document === "undefined") {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ getContext: () => null }),
  };
}

function countVisibleDescendants(container: Container): number {
  let n = 0;
  for (const child of container.children) {
    if (child.visible) n++;
    if (child instanceof Container) n += countVisibleDescendants(child);
  }
  return n;
}

function makeFx(): { fx: FxController; fxContainer: Container } {
  const fxContainer = new Container();
  const world = new Container();
  const fx = new FxController(
    fxContainer,
    world,
    () => null,
    () => null,
  );
  return { fx, fxContainer };
}

/** `FxController`'s constructor appends its 6 pooled sub-layers first, THEN
 * `bossEcho`/`meteorSky`/`skyDarken`/`hazardBand`/`flash`'s own views (see
 * `FxController`'s constructor) — index 8 is `skyDarken.view`, the
 * full-viewport overlay `onArcherStormCast()` triggers. */
const SKY_DARKEN_INDEX = 8;

/** A 2-hero cohort: slot 0 (the "local" hero) + slot 1 (a "friend" hero,
 * cloned off a real `initGameState()` hero rather than hand-listing every
 * `Hero` field — same drift-avoidance convention `heroParty.test.ts` uses). */
function twoHeroState(): GameState {
  const state = initGameState(1, undefined, "archer");
  const friend: Hero = { ...state.heroes[0], id: state.heroes[0].id + 1, x: 200 };
  return { ...state, heroes: [state.heroes[0], friend] };
}

function stormCastEvent(slot: number): GameEvent {
  return { type: "skillCast", heroClass: "archer", slot, skillId: "archer_storm" };
}

/** Runs enough real-time `update()` steps to fully settle any in-flight fx
 * (the M8 party-join ring/burst that fires the first time `updatePartyMembership()`
 * sees each hero, in particular) back to a clean, all-invisible baseline
 * before the actual event-under-test fires. */
function settle(fx: FxController, state: GameState): void {
  for (let i = 0; i < 40; i++) fx.update(0.1, state);
}

describe("M8 party P6 — FxController POV skill-fx gating", () => {
  it("a friend's (non-POV) ultimate fires world-level fx but leaves shake/punch/sky idle", () => {
    const { fx, fxContainer } = makeFx();
    const state = twoHeroState();
    settle(fx, state);

    expect(fx.shakeOffset).toEqual({ x: 0, y: 0 });
    expect(fx.punchScale).toBe(1);
    expect(fxContainer.children[SKY_DARKEN_INDEX].visible).toBe(false);
    const beforeVisible = countVisibleDescendants(fxContainer);

    // Default `povHeroIndex` is 0 — slot 1 (the friend) is NOT the POV hero.
    fx.consumeEvents([stormCastEvent(1)], state);
    fx.update(1 / 60, state);

    // SCREEN-level beats stay idle.
    expect(fx.shakeOffset).toEqual({ x: 0, y: 0 });
    expect(fx.punchScale).toBe(1);
    expect(fx.punchOffset).toEqual({ x: 0, y: 0 });
    expect(fxContainer.children[SKY_DARKEN_INDEX].visible).toBe(false);

    // World-anchored spectacle (bow flash / volley-launch streaks / arrow-
    // swarm band) still plays for everyone, POV or not.
    expect(countVisibleDescendants(fxContainer)).toBeGreaterThan(beforeVisible);

    fx.destroy();
  });

  it("the SAME cast, by the POV hero (slot === povHeroIndex), triggers the screen beat", () => {
    const { fx, fxContainer } = makeFx();
    const state = twoHeroState();
    fx.setPovHeroIndex(1); // this client's own hero is slot 1
    settle(fx, state);

    fx.consumeEvents([stormCastEvent(1)], state);
    fx.update(1 / 60, state);

    expect(fx.shakeOffset).not.toEqual({ x: 0, y: 0 });
    expect(fx.punchScale).toBeGreaterThan(1);
    expect(fxContainer.children[SKY_DARKEN_INDEX].visible).toBe(true);

    fx.destroy();
  });

  it("solo guard: default povHeroIndex 0 + a slot-0 event behaves exactly as before", () => {
    const { fx, fxContainer } = makeFx();
    const state = initGameState(1, undefined, "archer"); // single hero, always slot 0
    settle(fx, state);

    fx.consumeEvents([stormCastEvent(0)], state);
    fx.update(1 / 60, state);

    expect(fx.shakeOffset).not.toEqual({ x: 0, y: 0 });
    expect(fx.punchScale).toBeGreaterThan(1);
    expect(fxContainer.children[SKY_DARKEN_INDEX].visible).toBe(true);

    fx.destroy();
  });
});
