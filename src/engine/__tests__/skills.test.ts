import { describe, it, expect } from "vitest";
import { initGameState, step, heroAtk, SKILL_TYPES, HERO_TYPES } from "@/engine";
import { threeHeroSave, makeStubEnemy } from "./helpers";

/**
 * Deep skill-system regression coverage (Phase C handoff): archer's specific
 * nearest-3 selection, mage meteor AOE + its range guard, per-class cooldown
 * independence, and full-team auto-cast. Builds on phase-b.test.ts, which
 * only smoke-tests the swordsman spin and a generic archer cast.
 */

describe("archer spread skill", () => {
  it("hits exactly the nearest 3 targets by distance, not just the first 3", () => {
    const s = initGameState(7, threeHeroSave());
    const archer = s.heroes[1];
    expect(archer.cls).toBe("archer");
    archer.cd = 999; // suppress the normal attack so only the skill's arrows show up
    archer.skillCd = 0;

    // Distances from the archer: id1=40, id2=30, id3=80, id4=200, id5=500.
    // Nearest 3 by |dx| are id2 (30), id1 (40), id3 (80) — deliberately NOT
    // the first 3 in array order, so this catches a "slice(0,3)" bug.
    s.enemies = [
      makeStubEnemy(1, archer.x + 40),
      makeStubEnemy(2, archer.x - 30),
      makeStubEnemy(3, archer.x + 80),
      makeStubEnemy(4, archer.x + 200),
      makeStubEnemy(5, archer.x + 500),
    ];

    step(s, { castSkills: [1] });

    const skillDmg = Math.round(
      heroAtk("archer", s.upgrades) * SKILL_TYPES.archer.mult,
    );
    const skillArrows = s.projectiles.filter(
      (p) => p.kind === "arrow" && p.damage === skillDmg,
    );
    expect(skillArrows.length).toBe(3);
    expect(
      skillArrows.map((p) => p.targetId).sort((a, b) => (a ?? 0) - (b ?? 0)),
    ).toEqual([1, 2, 3]);
    expect(archer.skillCd).toBe(SKILL_TYPES.archer.cd);
  });
});

describe("mage meteor skill", () => {
  it("resolves as an AOE that hits every enemy inside the blast radius and none outside", () => {
    const s = initGameState(7, threeHeroSave());
    const mage = s.heroes[2];
    expect(mage.cls).toBe("mage");
    mage.cd = 999; // suppress the normal orb attack
    mage.skillCd = 0;
    s.heroes[0].cd = 999; // suppress swordsman/archer normal attacks so only
    s.heroes[1].cd = 999; // the meteor changes enemy hp

    const radius = SKILL_TYPES.mage.radius;
    const tx = mage.x + 40; // nearest enemy's x -> becomes the meteor's impact x
    s.enemies = [
      makeStubEnemy(1, tx, 100), // nearest -> the impact point itself
      makeStubEnemy(2, tx + (radius - 10), 100), // inside the blast
      makeStubEnemy(3, tx - (radius - 5), 100), // inside the blast, farther from the mage than id1
      makeStubEnemy(4, tx + (radius + 60), 100), // outside the blast
    ];

    step(s, { castSkills: [2] });
    expect(mage.skillCd).toBe(SKILL_TYPES.mage.cd);
    const meteor = s.projectiles.find((p) => p.kind === "meteor");
    expect(meteor).toBeDefined();
    expect(meteor!.tx).toBe(tx);
    expect(meteor!.aoe).toBe(radius);

    // Run the meteor down to impact (it falls from a fixed spawn y).
    let resolved = false;
    for (let i = 0; i < 120 && !resolved; i++) {
      step(s, {});
      resolved = !s.projectiles.some((p) => p.kind === "meteor");
    }
    expect(resolved).toBe(true); // the POC's "meteor never explodes" bug, guarded

    expect(s.enemies.find((e) => e.id === 1)!.hp).toBeLessThan(100);
    expect(s.enemies.find((e) => e.id === 2)!.hp).toBeLessThan(100);
    expect(s.enemies.find((e) => e.id === 3)!.hp).toBeLessThan(100);
    expect(s.enemies.find((e) => e.id === 4)!.hp).toBe(100); // outside the blast: untouched
  });

  it("range guard: never casts (no cooldown, no meteor) with nothing within mage range", () => {
    const s = initGameState(7, threeHeroSave());
    const mage = s.heroes[2];
    mage.skillCd = 0;
    s.enemies = [makeStubEnemy(1, mage.x + HERO_TYPES.mage.range + 50)];

    step(s, { castSkills: [2] });

    expect(mage.skillCd).toBe(0); // guard failed -> no cast, no wasted cooldown
    expect(s.projectiles.some((p) => p.kind === "meteor")).toBe(false);
  });
});

describe("per-class skill cooldowns are independent", () => {
  it("casting the swordsman's skill does not touch the archer's or mage's cooldown", () => {
    const s = initGameState(7, threeHeroSave());
    const [sword, archer, mage] = s.heroes;
    s.enemies = [makeStubEnemy(1, sword.x + 20)]; // within the swordsman's spin radius

    step(s, { castSkills: [0] });

    expect(sword.skillCd).toBe(SKILL_TYPES.swordsman.cd);
    expect(archer.skillCd).toBe(0);
    expect(mage.skillCd).toBe(0);
  });

  it("casting archer + mage in the same step leaves the swordsman's cooldown untouched", () => {
    const s = initGameState(7, threeHeroSave());
    const [sword, archer, mage] = s.heroes;
    s.enemies = [makeStubEnemy(1, mage.x + 20)]; // within mage range; archer has no range guard

    step(s, { castSkills: [1, 2] });

    expect(archer.skillCd).toBe(SKILL_TYPES.archer.cd);
    expect(mage.skillCd).toBe(SKILL_TYPES.mage.cd);
    expect(sword.skillCd).toBe(0);
  });
});

describe("auto-cast across a full 3-hero team", () => {
  it("casts every hero's skill in the same step once each guard passes", () => {
    const s = initGameState(7, threeHeroSave());
    s.autoCast = true;
    const sword = s.heroes[0];
    // One enemy inside the swordsman's spin radius also satisfies the mage
    // (330 range) and the archer (no range guard at all) simultaneously.
    s.enemies = [makeStubEnemy(1, sword.x + 20)];

    step(s, {});

    expect(s.heroes[0].skillCd).toBe(SKILL_TYPES.swordsman.cd);
    expect(s.heroes[1].skillCd).toBe(SKILL_TYPES.archer.cd);
    expect(s.heroes[2].skillCd).toBe(SKILL_TYPES.mage.cd);
  });

  it("auto-cast guard still holds for the full team: no target -> no casts, no cooldowns", () => {
    const s = initGameState(7, threeHeroSave());
    s.autoCast = true;
    s.enemies = []; // nothing to hit anywhere

    step(s, {});

    expect(s.heroes.every((h) => h.skillCd === 0)).toBe(true);
  });
});
