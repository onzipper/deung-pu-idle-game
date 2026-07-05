import { describe, it, expect } from "vitest";
import { step, heroAtk, SKILL_TYPES, HERO_TYPES, CONFIG } from "@/engine";
import { makeParty, makeStubEnemy } from "./helpers";

/**
 * Deep skill-system regression coverage (Phase C handoff): the archer's ARROW
 * RAIN ("ฝนลูกธนู", 86d3k2t18), mage meteor AOE + its range guard, per-class
 * cooldown independence, and full-team auto-cast.
 *
 * M5 solo pivot: gameplay spawns ONE hero, but the multi-actor combat engine is
 * RETAINED (it becomes the M8 party engine). These tests seat a synthetic 3-hero
 * party (`makeParty`) to keep exercising per-hero skill independence / auto-cast
 * — i.e. they also guard that the party engine still works, ready for M8.
 */

describe("archer arrow-rain skill", () => {
  it("drops arrowRainCount falling arrows centred on the in-range cluster centroid, then starts cooldown", () => {
    const s = makeParty(7);
    const archer = s.heroes[1];
    expect(archer.cls).toBe("archer");
    archer.cd = 999; // suppress the normal volley so only the skill's drops show up
    archer.skillCd = 0;

    // A cluster fully within archer range; centroid is their mean x. Include a foe
    // OUT of range (well past archer.x + range): it must NOT shift the centroid.
    const inRange = [archer.x + 200, archer.x + 240, archer.x + 280];
    const centroid = inRange.reduce((a, b) => a + b, 0) / inRange.length;
    s.enemies = [
      ...inRange.map((x, i) => makeStubEnemy(i + 1, x)),
      makeStubEnemy(99, archer.x + CONFIG.skills.arrowRainRange + 120), // out of rain range
    ];

    step(s, { castSkills: [1] });

    const drops = s.projectiles.filter((p) => p.kind === "rainArrow");
    expect(drops.length).toBe(SKILL_TYPES.archer.targets);
    // Point-target falling projectiles (like the meteor): no homing id, small AoE.
    expect(drops.every((p) => p.targetId === null)).toBe(true);
    expect(drops.every((p) => p.aoe === SKILL_TYPES.archer.radius)).toBe(true);
    // Landing xs = centroid + the FIXED offset table (deterministic, no RNG).
    const gotTx = drops.map((p) => p.tx).sort((a, b) => a - b);
    const wantTx = CONFIG.arrowRainOffsets
      .map((o) => centroid + o.dx)
      .sort((a, b) => a - b);
    expect(gotTx).toEqual(wantTx);
    expect(archer.skillCd).toBe(SKILL_TYPES.archer.cd);
  });

  it("the drops FALL and resolve as AoE damage (not stranded mid-air) — the meteor-never-explodes guard, for rain", () => {
    const s = makeParty(7);
    const archer = s.heroes[1];
    archer.cd = 999;
    archer.skillCd = 0;
    s.heroes[0].cd = 999; // mute swordsman + mage so only the rain touches enemy hp
    s.heroes[2].cd = 999;

    // A wide wall of enemies blanketing the whole rain zone so every drop lands on
    // someone. HP huge so none die mid-fall (which would let a drop expire early).
    const centroid = archer.x + 240;
    const wall = [];
    for (let i = 0; i < 13; i++) wall.push(makeStubEnemy(i + 1, centroid - 96 + i * 16, 1_000_000));
    s.enemies = wall;
    const hpBefore = wall.reduce((a, e) => a + e.hp, 0);

    step(s, { castSkills: [1] }); // drops spawn (up in the air, no hit yet)
    expect(s.projectiles.some((p) => p.kind === "rainArrow")).toBe(true);

    let resolved = false;
    for (let i = 0; i < 120 && !resolved; i++) {
      step(s, {});
      resolved = !s.projectiles.some((p) => p.kind === "rainArrow");
    }
    expect(resolved).toBe(true); // every drop reached the ground and exploded

    const hpAfter = s.enemies.reduce((a, e) => a + e.hp, 0);
    const dealt = hpBefore - hpAfter;
    // Total potential ≈ count * per-drop (each of the `targets` drops splashes at
    // least one enemy in the packed wall); matches the design total heroAtk.
    const perDrop = Math.round(heroAtk("archer", s.heroes[1].level) * SKILL_TYPES.archer.mult);
    expect(dealt).toBeGreaterThanOrEqual(SKILL_TYPES.archer.targets * perDrop);
  });

  it("range guard: never casts (no cooldown, no drops) with nothing within rain range", () => {
    const s = makeParty(7);
    const archer = s.heroes[1];
    archer.skillCd = 0;
    s.enemies = [makeStubEnemy(1, archer.x + CONFIG.skills.arrowRainRange + 80)]; // out of rain range

    step(s, { castSkills: [1] });

    expect(archer.skillCd).toBe(0); // guard failed -> no cast, no wasted cooldown
    expect(s.projectiles.some((p) => p.kind === "rainArrow")).toBe(false);
  });
});

describe("mage meteor skill", () => {
  it("resolves as an AOE that hits every enemy inside the blast radius and none outside", () => {
    const s = makeParty(7);
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
    const s = makeParty(7);
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
    const s = makeParty(7);
    const [sword, archer, mage] = s.heroes;
    s.enemies = [makeStubEnemy(1, sword.x + 20)]; // within the swordsman's spin radius

    step(s, { castSkills: [0] });

    expect(sword.skillCd).toBe(SKILL_TYPES.swordsman.cd);
    expect(archer.skillCd).toBe(0);
    expect(mage.skillCd).toBe(0);
  });

  it("casting archer + mage in the same step leaves the swordsman's cooldown untouched", () => {
    const s = makeParty(7);
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
    const s = makeParty(7);
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
    const s = makeParty(7);
    s.autoCast = true;
    s.enemies = []; // nothing to hit anywhere

    step(s, {});

    expect(s.heroes.every((h) => h.skillCd === 0)).toBe(true);
  });
});
