import { describe, it, expect } from "vitest";
import { initGameState, step, CONFIG } from "@/engine";
import { makeStubEnemy } from "./helpers";

// The swordsman stops `meleeApproachGap` short and his home slot rides ahead, so
// allow generous slack when asserting he "reached" the enemy line.
const HERO_STRIKE_SLACK = 120;

/**
 * Charge behaviour (ClickUp 86d3k2he0): the swordsman must RUN AT and SMASH
 * enemies instead of holding formation and waiting for them to walk in.
 *
 * The old hold-formation code capped the swordsman at `midCap` (400): his home
 * slot rode the anchor (max 300) + offset (34) = 334, plus the tight
 * `meleeLeash` (90) but clamped to midCap. So "x > midCap" is a clean, config-
 * anchored proof that he genuinely charged past where the old behaviour let him
 * stand.
 */
describe("hero charge", () => {
  it("swordsman sprints across the field at a distant enemy (past the old midCap hold)", () => {
    const s = initGameState(1);
    const sword = s.heroes[0];
    expect(sword.cls).toBe("swordsman");
    const startX = sword.x; // baseAnchor + offset = 214

    // A fat, stationary enemy to the right: inside chargeSeekRange (560) and past
    // the old meleeSeekRange (260) / midCap (400) hold, but reachable within the
    // charge cap so he can actually close to striking distance.
    s.enemies.push(makeStubEnemy(999, 520, 100000));

    for (let i = 0; i < 240; i++) step(s, {}); // ~4s

    // He ran a long way forward...
    expect(sword.x).toBeGreaterThan(startX + 200);
    // ...past where the old hold-formation code could ever place him...
    expect(sword.x).toBeGreaterThan(CONFIG.midCap);
    // ...but respected the charge cap (never sprints into the spawn edge).
    expect(sword.x).toBeLessThanOrEqual(CONFIG.chargeCap);
    // ...and closed on the enemy (within melee striking distance).
    expect(520 - sword.x).toBeLessThan(HERO_STRIKE_SLACK);
  });

  it("charge is fast: the swordsman covers most of the gap within ~1.5s", () => {
    const s = initGameState(1);
    const sword = s.heroes[0];
    const startX = sword.x;
    s.enemies.push(makeStubEnemy(999, 520, 100000));

    for (let i = 0; i < 90; i++) step(s, {}); // ~1.5s

    // chargeSpeed (265) > heroMove (150): in 1.5s a pure sprint covers ~397px.
    // Even net of the approach easing he should have crossed well past midCap fast.
    expect(sword.x).toBeGreaterThan(startX + 150);
  });

  it("with no enemy in charge range the swordsman holds near his home slot", () => {
    const s = initGameState(1);
    const sword = s.heroes[0];
    // Hold the wave system off so the field stays empty: no charge target ->
    // the anchor eases home and the swordsman holds his slot.
    s.waveGap = 100000;
    for (let i = 0; i < 240; i++) step(s, {});
    // Stays within the tight hold band (never runs off toward the spawn edge).
    expect(sword.x).toBeLessThanOrEqual(CONFIG.midCap);
  });
});
