import { describe, it, expect } from "vitest";
import { initGameState, step, CONFIG } from "@/engine";
import { makeStubEnemy } from "./helpers";

// The swordsman stops `meleeApproachGap` short and his home slot rides ahead, so
// allow generous slack when asserting he "reached" the enemy line.
const HERO_STRIKE_SLACK = 120;

/**
 * Charge behaviour (ClickUp 86d3k2he0 -> 86d3k2nhm): the swordsman must RUN AT and
 * SMASH enemies instead of holding formation and waiting for them to walk in, and
 * the whole team must push forward AT ALL TIMES — never standing around at wave
 * start and never retreating between waves.
 *
 * 86d3k2nhm raised the charge cap (470 -> `chargeCap` 640) because the anchor now
 * follows the swordsman forward (`battleMaxAnchor` 510), so ranged coverage
 * travels with the fight; and widened the seek range past the full field
 * (`chargeSeekRange` 900) so a freshly-spawned enemy is charged instantly.
 */
describe("hero charge", () => {
  it("swordsman sprints DEEP across the field at a distant enemy (past the old 470 cap)", () => {
    const s = initGameState(1);
    const sword = s.heroes[0];
    expect(sword.cls).toBe("swordsman");
    const startX = sword.x; // baseAnchor + offset = 214

    // A fat, stationary enemy far to the right: well past the old midCap (400) /
    // old chargeCap (470) hold, but reachable within the new charge cap so he can
    // actually close to striking distance.
    s.enemies.push(makeStubEnemy(999, 700, 100000));

    for (let i = 0; i < 240; i++) step(s, {}); // ~4s

    // He ran a long way forward...
    expect(sword.x).toBeGreaterThan(startX + 200);
    // ...past where the OLD (470) charge cap could ever place him — proving the
    // deeper charge now that the anchor follows...
    expect(sword.x).toBeGreaterThan(470);
    // ...but respected the new charge cap (never sprints into the spawn edge)...
    expect(sword.x).toBeLessThanOrEqual(CONFIG.chargeCap);
    // ...and closed on the enemy (within melee striking distance).
    expect(700 - sword.x).toBeLessThan(HERO_STRIKE_SLACK);
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

  it("advances PROMPTLY when a wave spawns — no idle window at wave start", () => {
    const s = initGameState(1);
    const sword = s.heroes[0];
    const startX = sword.x;

    // A freshly-spawned enemy at the spawn edge (spawnX 860). With the whole-field
    // seek range it is charged instantly — the swordsman must NOT stand and wait
    // for it to walk into a tight range first.
    s.enemies.push(makeStubEnemy(999, CONFIG.spawnX, 100000));

    for (let i = 0; i < 30; i++) step(s, {}); // ~0.5s only

    // Within half a second he has already surged a long way forward (0.5s of
    // chargeSpeed 265 is ~132px; assert a clear, immediate advance).
    expect(sword.x).toBeGreaterThan(startX + 80);
  });

  it("does NOT retreat between waves — the team holds its forward line during a waveGap", () => {
    const s = initGameState(1);

    // Push the formation forward with an enemy on the field.
    s.enemies.push(makeStubEnemy(999, 600, 100000));
    for (let i = 0; i < 180; i++) step(s, {}); // ~3s: anchor rides up to its forward line
    const forwardAnchor = s.anchorX;
    expect(forwardAnchor).toBeGreaterThan(CONFIG.baseAnchor + 100); // genuinely pushed up

    // Wave cleared: no enemies, but still mid-stage (phase "battle") and no new
    // wave for a long time. The anchor must HOLD, not ease back toward base.
    s.enemies = [];
    s.waveGap = 100000;
    expect(s.phase).toBe("battle");
    for (let i = 0; i < 180; i++) step(s, {}); // ~3s of waveGap

    // No retreat: the forward line is held (allow a hair of float slack).
    expect(s.anchorX).toBeGreaterThanOrEqual(forwardAnchor - 1e-6);
  });

  it("with no enemy in charge range the swordsman holds near his home slot", () => {
    const s = initGameState(1);
    const sword = s.heroes[0];
    // Hold the wave system off so the field stays empty: no charge target ->
    // the anchor holds its (base) line and the swordsman holds his slot.
    s.waveGap = 100000;
    for (let i = 0; i < 240; i++) step(s, {});
    // Stays within the tight hold band (never runs off toward the spawn edge).
    expect(sword.x).toBeLessThanOrEqual(CONFIG.midCap);
  });
});
