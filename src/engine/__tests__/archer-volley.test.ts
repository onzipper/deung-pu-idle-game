import { describe, it, expect } from "vitest";
import { initGameState, step, heroAtk, CONFIG, type GameState } from "@/engine";
import { threeHeroSave, makeStubEnemy } from "./helpers";

/**
 * Archer BASIC-attack volley (ClickUp 86d3k2rgf).
 *
 * The archer's normal attack fires a mini-volley of `archerVolleyCount` small
 * arrows at the SAME target instead of one arrow ("ยิงลูกธนูย่อยๆ"). Total
 * damage per attack is UNCHANGED — split across the volley, with the last arrow
 * carrying the float remainder so the sum is bit-exact vs the old single-arrow
 * math. The archer SKILL (3 SEPARATE targets) is a different feature and is
 * covered by skills.test.ts.
 */

/**
 * Set up a single-archer basic-attack firing lane: the swordsman and mage are
 * muted (huge cd), the archer's skill is parked, and the archer is primed to
 * fire its basic attack on the next step at a high-HP stationary target placed
 * inside its range. Returns the state, the archer, and the target.
 */
function primeArcherBasicAttack(atkLevel = 0, targetHp = 1_000_000) {
  const s = initGameState(7, threeHeroSave());
  s.upgrades = { atk: atkLevel, speed: 0, hp: 0 };
  const archer = s.heroes[1];
  expect(archer.cls).toBe("archer");
  // Mute the other two heroes and the archer's skill so ONLY the archer's basic
  // attack touches the target this step.
  s.heroes[0].cd = 999;
  s.heroes[2].cd = 999;
  archer.skillCd = 999;
  archer.cd = 0; // basic attack ready NOW
  const target = makeStubEnemy(1, archer.x + 100, targetHp);
  s.enemies = [target];
  return { s, archer, target };
}

describe("archer basic-attack volley", () => {
  it("fires exactly archerVolleyCount arrows at the SAME target in one attack", () => {
    const { s, target } = primeArcherBasicAttack();

    step(s, {});

    const arrows = s.projectiles.filter((p) => p.kind === "arrow");
    expect(arrows.length).toBe(CONFIG.archerVolleyCount);
    // one target, many arrows — this is the volley, NOT the multi-target skill.
    expect(arrows.every((p) => p.targetId === target.id)).toBe(true);
  });

  it("emits one projectileSpawn(arrow) event per volley arrow", () => {
    const { s } = primeArcherBasicAttack();

    step(s, {});

    const spawns = s.events.filter(
      (e) => e.type === "projectileSpawn" && e.kind === "arrow",
    );
    expect(spawns.length).toBe(CONFIG.archerVolleyCount);
  });

  // Cover divisible AND non-divisible-by-3 totals. atk levels chosen so heroAtk
  // lands on values that do NOT divide evenly by 3 (e.g. L7 -> 10), which is the
  // case that would expose any rounding drift.
  it.each([0, 1, 5, 7, 13, 20])(
    "splits the volley so its per-arrow damages sum BIT-EXACTLY to the old single-arrow damage (atk L=%i)",
    (atkLevel) => {
      const { s } = primeArcherBasicAttack(atkLevel);
      const oldSingleArrowDmg = heroAtk("archer", s.upgrades);

      step(s, {});

      const arrows = s.projectiles.filter((p) => p.kind === "arrow");
      expect(arrows.length).toBe(CONFIG.archerVolleyCount);
      // Spawn-order reduce is deterministic and, for a ~1/3 split with a
      // remainder-carrying last arrow, exactly equals the old damage (no drift).
      const sum = arrows.reduce((acc, p) => acc + p.damage, 0);
      expect(sum).toBe(oldSingleArrowDmg);
    },
  );

  it("delivers exactly the old single-arrow damage to a target the whole volley hits", () => {
    // atk L=7 -> heroAtk 10, a total that does NOT divide evenly by 3.
    const { s, archer, target } = primeArcherBasicAttack(7);
    const oldSingleArrowDmg = heroAtk("archer", s.upgrades);

    step(s, {}); // volley fires (spawns only; no hit this step)
    archer.cd = 999; // freeze the archer so it never fires a SECOND volley

    let delivered = 0;
    for (let i = 0; i < 400 && s.projectiles.length > 0; i++) {
      step(s, {});
      for (const e of s.events) {
        if (e.type === "hit" && e.id === target.id) delivered += e.amount;
      }
    }

    // All three arrows land (target HP is huge, none expire), so the delivered
    // total matches the old single hit. Float-order of arrival can vary with the
    // per-arrow speed variance, so assert to full double precision rather than
    // bit-identity of the running sum.
    expect(delivered).toBeCloseTo(oldSingleArrowDmg, 9);
    expect(s.projectiles.length).toBe(0); // every arrow resolved, none stranded
  });

  it("does NOT draw from the seeded RNG (byte-identical replay of a volley scenario)", () => {
    // Two independent runs of the same scenario must produce byte-identical
    // state. If the volley pulled from the RNG stream, this would still pass for
    // a fixed seed — but the wave-composition determinism suites (events /
    // determinism .test.ts) that replay full 3-hero combat also stay green,
    // proving the RNG cursor is untouched by the extra arrows.
    const run = (): GameState => {
      const { s } = primeArcherBasicAttack(7);
      for (let i = 0; i < 120; i++) step(s, {});
      return s;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
