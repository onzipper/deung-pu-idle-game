/**
 * Hero rig FACING rule (owner "Option A"): face the COMBAT TARGET while
 * fighting, movement direction only while merely walking.
 *
 * These exercise the REAL `updateHeroView` facing pass (no re-statement of the
 * math). `view.bodyRoot.scale.x` mirrors the internal `anim.facing` (±1), so we
 * read it directly. Two bugs are guarded:
 *  1. Ranged "spin when surrounded" / "shoots backwards while kiting": with a
 *     live `hero.aimX`, facing locks to the target even when the retreat
 *     velocity points the other way, and does NOT strobe when velocity
 *     alternates frame-to-frame.
 *  2. Walk-direction strobe: with NO target, a rapid velocity flip is debounced
 *     by a min flip interval (hysteresis).
 */

import { describe, expect, it } from "vitest";
import type { Hero } from "@/engine/entities";
import { defaultHeroConfig, emptyDailies } from "@/engine/entities";
import { createHeroView, updateHeroView, type HeroFrameContext } from "@/render/views/heroView";

const DT = 1 / 60;

function hero(x: number, aimX: number | null): Hero {
  return {
    id: 1,
    cls: "archer",
    x,
    y: 0,
    hp: 100,
    maxHp: 100,
    cd: 1,
    dead: false,
    reviveTimer: 0,
    skillCds: {},
    mana: 60,
    maxMana: 60,
    atkBuffMult: 1,
    atkBuffTimer: 0,
    level: 1,
    xp: 0,
    tier: 1,
    mainClaimed: [],
    dailies: emptyDailies(),
    statPoints: 0,
    stats: { str: 4, dex: 8, int: 3, vit: 6 },
    autoSlots: ["arrow_multishot", null, null],
    quest: null,
    equipped: { weapon: null, armor: null },
    command: null,
    shadowed: false,
    config: defaultHeroConfig(),
    aimX,
    evadeCd: 0,
    evadeHpMark: 100,
    evadeMarkCd: 0,
  };
}

const ctx = (): HeroFrameContext => ({ dt: DT, slot: 0, events: [], marching: false });

/** Feed one frame at position `x` with aim `aimX`; return the rendered facing. */
function frame(view: ReturnType<typeof createHeroView>, x: number, aimX: number | null): number {
  const h = hero(x, aimX);
  updateHeroView(view, h, ctx());
  return view.bodyRoot.scale.x;
}

describe("hero facing: combat aim vs movement", () => {
  it("locks to the target while RETREATING past it (kite): faces target, not velocity", () => {
    const view = createHeroView();
    frame(view, 100, null); // init frame (establishes lastX = 100)
    // Hero retreats LEFT (100 -> 88) while its target sits to the RIGHT (aimX 140).
    const facing = frame(view, 88, 140);
    expect(facing).toBe(1); // faces RIGHT toward the target, despite moving left
    view.destroy({ children: true });
  });

  it("WITHOUT a target that same retreat would face the movement direction (control)", () => {
    const view = createHeroView();
    frame(view, 100, null);
    const facing = frame(view, 88, null); // moving left, no aim
    expect(facing).toBe(-1); // velocity rule -> faces left
    view.destroy({ children: true });
  });

  it("does NOT strobe when velocity alternates with a live target", () => {
    const view = createHeroView();
    frame(view, 100, null);
    // Target pinned to the RIGHT; hero jitters left/right around it each frame.
    let x = 100;
    for (let i = 0; i < 20; i++) {
      x += i % 2 === 0 ? -12 : 12; // alternating velocity sign
      const facing = frame(view, x, 200); // aim always to the right
      expect(facing).toBe(1); // never flips off the target
    }
    view.destroy({ children: true });
  });

  it("HOLDS the last facing when the target vanishes (aim -> null, hero idle)", () => {
    const view = createHeroView();
    frame(view, 100, null);
    frame(view, 88, 140); // engage a right-side target -> facing right
    // Target dies: aim null, hero holds station (no movement) -> facing HELD.
    const facing = frame(view, 88, null);
    expect(facing).toBe(1);
    view.destroy({ children: true });
  });

  it("walk case: a rapid velocity reversal is debounced (hysteresis), then flips", () => {
    const view = createHeroView();
    frame(view, 100, null);
    // Establish a leftward walk -> facing flips to -1.
    let x = 100;
    x -= 12;
    expect(frame(view, x, null)).toBe(-1);
    // Immediately reverse to a rightward walk on the very next frame: BLOCKED by
    // the min flip interval (only ~1 frame elapsed since the last flip).
    x += 12;
    expect(frame(view, x, null)).toBe(-1); // strobe suppressed
    // Keep walking right; after the interval (~0.35s) elapses the flip lands.
    let flipped = false;
    for (let i = 0; i < 40 && !flipped; i++) {
      x += 12;
      if (frame(view, x, null) === 1) flipped = true;
    }
    expect(flipped).toBe(true);
    view.destroy({ children: true });
  });

  it("deadband: a target sitting right on top of the hero holds facing (no jitter)", () => {
    const view = createHeroView();
    frame(view, 100, null);
    frame(view, 100, 150); // face right
    // Aim now essentially ON the hero (within the deadband): must not flip.
    const facing = frame(view, 100, 103);
    expect(facing).toBe(1);
    view.destroy({ children: true });
  });
});
