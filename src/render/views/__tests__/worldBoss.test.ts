/**
 * Headless correctness guard for `worldBossView.ts` (WORLD BOSS "เสี่ยจ๋อง",
 * hourly world boss, render wave) — mirrors `rig.test.ts`'s bossView band-bounds
 * convention (pixi.js scene-graph math runs fine in plain Node; no canvas/WebGL
 * needed for `getBounds()`).
 *
 * Guards the SAME footgun class documented in `rig.test.ts`'s module doc
 * comment (`bodyRoot.pivot === bodyRoot`'s position at `(0, GROUND_Y)` —
 * pre-subtracting the pivot in path data collapses the whole rig toward world
 * y≈0) at this view's much bigger ~2.5x scale, plus a sanity check that its
 * event-driven attack poses (lunge/slam-crush/enrage-shudder) don't blow up
 * bounds either.
 */

import { describe, expect, it } from "vitest";
import type { Boss } from "@/engine/entities";
import { GROUND_Y } from "@/render/layout";
import {
  createWorldBossView,
  updateWorldBossView,
  WORLD_BOSS_CORE_R,
  WORLD_BOSS_CY,
} from "@/render/views/worldBossView";

function makeWorldBoss(): Boss {
  return {
    id: 1,
    x: 400,
    y: 190,
    hp: 400_000,
    maxHp: 400_000,
    atk: 350,
    cd: 1,
    skillCd: 1,
    telegraph: 0,
    enraged: false,
  };
}

// Generous band: the rig is ~2.5x a stage boss's CORE_R (34 -> 84) and the
// telegraph ring can grow to `R + 14 + 70` past the body — well past the
// hero/enemy/stage-boss bands, but nowhere close to the world-y≈0 collapse a
// pivot-subtraction regression would produce.
const MIN_Y = GROUND_Y - 260;
const MAX_Y = GROUND_Y + 100;

describe("worldBossView rig transform math (regression guard)", () => {
  it("rest-pose geometry lands in the GROUND_Y-relative band, not near world y=0", () => {
    const view = createWorldBossView();
    updateWorldBossView(view, makeWorldBoss(), { elapsedMs: 0, dt: 0, events: [] });
    const b = view.bodyRoot.getBounds();
    expect(b.y).toBeGreaterThan(MIN_Y);
    expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);
    view.destroy({ children: true });
  });

  it("enraged + mid-telegraph geometry stays bounded too", () => {
    const view = createWorldBossView();
    const boss = makeWorldBoss();
    boss.enraged = true;
    boss.telegraph = 0.5;
    updateWorldBossView(view, boss, { elapsedMs: 100, dt: 0.016, events: [] });
    const b = view.bodyRoot.getBounds();
    expect(b.y).toBeGreaterThan(MIN_Y);
    expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);
    view.destroy({ children: true });
  });

  it("the basic-attack lunge / bossSlamLand crush poses stay bounded", () => {
    const view = createWorldBossView();
    const boss = makeWorldBoss();
    // Establish a baseline frame first (mirrors bossView's own attack-tell
    // convention — the anim state initializes on the first update() call).
    updateWorldBossView(view, boss, { elapsedMs: 0, dt: 0, events: [] });
    updateWorldBossView(view, boss, {
      elapsedMs: 16,
      dt: 0.016,
      events: [{ type: "hit", target: "hero", id: 2, x: 100, y: 200, amount: 10, source: "attack" }],
    });
    updateWorldBossView(view, boss, {
      elapsedMs: 32,
      dt: 0.08,
      events: [{ type: "bossSlamLand", x: boss.x, y: boss.y }],
    });
    const b = view.bodyRoot.getBounds();
    expect(b.y).toBeGreaterThan(MIN_Y);
    expect(b.y + b.height).toBeLessThanOrEqual(MAX_Y);
    view.destroy({ children: true });
  });

  it("builds a sane scale (~2.5x a stage boss's CORE_R=34) and CY sits above the stage boss's own", () => {
    // Owner spec: "รูปทรง...ดูแล้วรู้ว่า world boss" — a scale check keeps this
    // constant from silently drifting back toward a stage-boss-sized rig.
    expect(WORLD_BOSS_CORE_R).toBeGreaterThanOrEqual(34 * 2);
    expect(WORLD_BOSS_CY).toBeLessThan(GROUND_Y - 30); // taller than bossView's CY
  });

  it("idle coin-glint dots are a fixed pooled set, never grown per-frame", () => {
    const view = createWorldBossView();
    const boss = makeWorldBoss();
    const countBefore = view.glintDots.length;
    for (let i = 0; i < 5; i++) {
      updateWorldBossView(view, boss, { elapsedMs: i * 16, dt: 0.016, events: [] });
    }
    expect(view.glintDots.length).toBe(countBefore);
    view.destroy({ children: true });
  });
});
