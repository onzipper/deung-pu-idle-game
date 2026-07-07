/**
 * Headless correctness guard for the two town NPC rigs (ป้าปุ๊/ลุงดึ๋ง),
 * same convention as `rig.test.ts`'s hero/enemy/boss guards: every pivoted
 * container here sets `pivot === position` at a fixed point, and every
 * Graphics path is drawn in ABSOLUTE (GROUND_Y-relative) coordinates — a
 * regression that pre-subtracts the pivot in path data collapses the whole
 * rig toward world y≈0 (CLAUDE.md footgun #1). These assertions check
 * `bodyRoot.getBounds()` (the person figure only — NOT `nameLabel`/
 * `affordanceRing`/the static stall/anvil props, mirroring `rig.test.ts`'s
 * choice to avoid `Text` bounds measurement in headless Node).
 */

import { describe, expect, it } from "vitest";
import { GROUND_Y } from "@/render/layout";
import { createNpcView, updateNpcView } from "@/render/views/npcView";
import { TOWN_NPCS } from "@/render/townNpcs";

const MIN_Y = GROUND_Y - 90;
const MAX_Y = GROUND_Y + 10;

describe("npcView rig transform math (regression guard)", () => {
  for (const anchor of TOWN_NPCS) {
    it(`${anchor.id}: idle rest-pose geometry lands in the GROUND_Y-relative band, not near world y=0`, () => {
      const view = createNpcView(anchor.id);
      updateNpcView(view, { dt: 0, visible: true });
      const b = view.bodyRoot.getBounds();
      expect(b.y).toBeGreaterThan(MIN_Y);
      expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);
      view.destroy({ children: true });
    });

    it(`${anchor.id}: hidden while NOT in town (visible=false) without throwing`, () => {
      const view = createNpcView(anchor.id);
      updateNpcView(view, { dt: 0.016, visible: false });
      expect(view.visible).toBe(false);
      view.destroy({ children: true });
    });

    it(`${anchor.id}: view is anchored at its fixed TOWN_NPCS world-x`, () => {
      const view = createNpcView(anchor.id);
      expect(view.position.x).toBe(anchor.x);
      expect(view.headAnchor.x).toBe(anchor.x);
      view.destroy({ children: true });
    });
  }

  it("ลุงดึ๋ง: mid-hammer-raise pose still lands in the GROUND_Y-relative band", () => {
    const view = createNpcView("npc:lungdueng");
    // A small step first (establishes the animation clocks), then a chunk of
    // real time landing inside the slow-raise window (well under the ~1.43s
    // raise phase of the 2.6s period).
    updateNpcView(view, { dt: 0, visible: true });
    updateNpcView(view, { dt: 0.5, visible: true });
    const b = view.bodyRoot.getBounds();
    expect(b.y).toBeGreaterThan(MIN_Y);
    expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);
    view.destroy({ children: true });
  });

  it("ลุงดึ๋ง: stepping through several hammer cycles fires at least one spark burst, always within bounds", () => {
    // `hammerT`'s starting phase is randomized (de-syncs multiple views —
    // see `createNpcView`), so this steps through several full cycles with a
    // small dt rather than assuming a fixed offset lands inside the strike
    // window: robust to the random start while still exercising every pose
    // (raise / strike / hold) at least once.
    const view = createNpcView("npc:lungdueng");
    let sawActiveSpark = false;
    const HAMMER_PERIOD_APPROX = 2.6;
    const steps = Math.ceil((HAMMER_PERIOD_APPROX * 3) / 0.05);
    for (let i = 0; i < steps; i++) {
      updateNpcView(view, { dt: 0.05, visible: true });
      const b = view.bodyRoot.getBounds();
      expect(b.y).toBeGreaterThan(MIN_Y);
      expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);
      if (view.sparks.some((s) => s.active)) sawActiveSpark = true;
    }
    expect(sawActiveSpark).toBe(true);
    view.destroy({ children: true });
  });

  it("ลุงดึ๋ง: a full multi-cycle run of updates never leaves stray unbounded geometry", () => {
    const view = createNpcView("npc:lungdueng");
    for (let i = 0; i < 200; i++) {
      updateNpcView(view, { dt: 0.05, visible: true });
      const b = view.bodyRoot.getBounds();
      expect(b.y).toBeGreaterThan(MIN_Y);
      expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);
    }
    view.destroy({ children: true });
  });
});
