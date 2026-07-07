import { describe, it, expect } from "vitest";
import { step, heroAtk, SKILLS, HERO_TYPES, CONFIG } from "@/engine";
import { makeParty, makeStubEnemy } from "./helpers";

/**
 * Deep skill-system regression coverage (M5 "mana + skill framework v2"): the
 * archer's ARROW RAIN ("ฝนลูกธนู"), mage meteor AOE + its range guard, per-SKILL
 * cooldown independence, and full-team auto-cast of the slotted signature skills.
 *
 * Skills now cost mana + keep a per-skill cooldown; casting a specific skill is
 * `castSkills: [{ slot, skillId }]`. The multi-actor combat engine is RETAINED
 * (it becomes the M8 party engine), so these seat a synthetic 3-hero party.
 */

describe("archer arrow-rain skill", () => {
  it("drops arrowRainCount falling arrows centred on the in-range cluster centroid, then starts cooldown", () => {
    const s = makeParty(7);
    const archer = s.heroes[1];
    expect(archer.cls).toBe("archer");
    archer.cd = 999; // suppress the normal volley so only the skill's drops show up

    // A cluster fully within archer rain range; centroid is their mean x. Include a
    // foe OUT of range: it must NOT shift the centroid.
    const inRange = [archer.x + 200, archer.x + 240, archer.x + 280];
    const centroid = inRange.reduce((a, b) => a + b, 0) / inRange.length;
    s.enemies = [
      ...inRange.map((x, i) => makeStubEnemy(i + 1, x)),
      makeStubEnemy(99, archer.x + SKILLS.archer_rain.range + 120), // out of rain range
    ];

    step(s, { castSkills: [{ slot: 1, skillId: "archer_rain" }] });

    const drops = s.projectiles.filter((p) => p.kind === "rainArrow");
    expect(drops.length).toBe(SKILLS.archer_rain.targets);
    expect(drops.every((p) => p.targetId === null)).toBe(true);
    expect(drops.every((p) => p.aoe === SKILLS.archer_rain.radius)).toBe(true);
    const gotTx = drops.map((p) => p.tx).sort((a, b) => a - b);
    const wantTx = CONFIG.arrowRainOffsets.map((o) => centroid + o.dx).sort((a, b) => a - b);
    expect(gotTx).toEqual(wantTx);
    expect(s.heroes[1].skillCds["archer_rain"]).toBe(SKILLS.archer_rain.cd);
  });

  it("the drops FALL and resolve as AoE damage (not stranded mid-air) — the meteor-never-explodes guard, for rain", () => {
    const s = makeParty(7);
    s.spawnPaused = true; // isolate: only the injected wall's hp is summed
    const archer = s.heroes[1];
    archer.cd = 999;
    s.heroes[0].cd = 999; // mute swordsman + mage so only the rain touches enemy hp
    s.heroes[2].cd = 999;

    const centroid = archer.x + 240;
    const wall = [];
    for (let i = 0; i < 13; i++) wall.push(makeStubEnemy(i + 1, centroid - 96 + i * 16, 1_000_000));
    s.enemies = wall;
    const hpBefore = wall.reduce((a, e) => a + e.hp, 0);

    step(s, { castSkills: [{ slot: 1, skillId: "archer_rain" }] });
    expect(s.projectiles.some((p) => p.kind === "rainArrow")).toBe(true);

    let resolved = false;
    for (let i = 0; i < 120 && !resolved; i++) {
      step(s, {});
      resolved = !s.projectiles.some((p) => p.kind === "rainArrow");
    }
    expect(resolved).toBe(true); // every drop reached the ground and exploded

    const hpAfter = s.enemies.reduce((a, e) => a + e.hp, 0);
    const dealt = hpBefore - hpAfter;
    const perDrop = Math.round(heroAtk("archer", s.heroes[1].level) * SKILLS.archer_rain.mult);
    expect(dealt).toBeGreaterThanOrEqual(SKILLS.archer_rain.targets * perDrop);
  });

  it("range guard: never casts (no cooldown, no drops) with nothing within rain range", () => {
    const s = makeParty(7);
    const archer = s.heroes[1];
    s.enemies = [makeStubEnemy(1, archer.x + SKILLS.archer_rain.range + 80)]; // out of range

    step(s, { castSkills: [{ slot: 1, skillId: "archer_rain" }] });

    expect(s.heroes[1].skillCds["archer_rain"] ?? 0).toBe(0); // guard failed -> no cast
    expect(s.projectiles.some((p) => p.kind === "rainArrow")).toBe(false);
  });
});

describe("mage meteor skill", () => {
  it("resolves as an AOE that hits every enemy inside the blast radius and none outside", () => {
    const s = makeParty(7);
    const mage = s.heroes[2];
    expect(mage.cls).toBe("mage");
    mage.cd = 999; // suppress the normal orb attack
    s.heroes[0].cd = 999;
    s.heroes[1].cd = 999;

    const radius = SKILLS.mage_meteor.radius;
    const tx = mage.x + 40; // nearest enemy's x -> becomes the meteor's impact x
    s.enemies = [
      makeStubEnemy(1, tx, 100),
      makeStubEnemy(2, tx + (radius - 10), 100),
      makeStubEnemy(3, tx - (radius - 5), 100),
      makeStubEnemy(4, tx + (radius + 60), 100), // outside the blast
    ];

    step(s, { castSkills: [{ slot: 2, skillId: "mage_meteor" }] });
    expect(s.heroes[2].skillCds["mage_meteor"]).toBe(SKILLS.mage_meteor.cd);
    const meteor = s.projectiles.find((p) => p.kind === "meteor");
    expect(meteor).toBeDefined();
    expect(meteor!.tx).toBe(tx);
    expect(meteor!.aoe).toBe(radius);

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
    s.enemies = [makeStubEnemy(1, mage.x + HERO_TYPES.mage.range + 50)];

    step(s, { castSkills: [{ slot: 2, skillId: "mage_meteor" }] });

    expect(s.heroes[2].skillCds["mage_meteor"] ?? 0).toBe(0); // guard failed
    expect(s.projectiles.some((p) => p.kind === "meteor")).toBe(false);
  });
});

describe("per-skill cooldowns are independent", () => {
  it("casting the swordsman's skill does not touch the archer's or mage's cooldown", () => {
    const s = makeParty(7);
    const [sword, archer, mage] = s.heroes;
    s.enemies = [makeStubEnemy(1, sword.x + 20)]; // within the swordsman's spin radius

    step(s, { castSkills: [{ slot: 0, skillId: "sword_whirl" }] });

    expect(sword.skillCds["sword_whirl"]).toBe(SKILLS.sword_whirl.cd);
    expect(archer.skillCds["archer_rain"] ?? 0).toBe(0);
    expect(mage.skillCds["mage_meteor"] ?? 0).toBe(0);
  });

  it("casting archer + mage in the same step leaves the swordsman's cooldown untouched", () => {
    const s = makeParty(7);
    const [sword, archer, mage] = s.heroes;
    s.enemies = [makeStubEnemy(1, mage.x + 20)]; // within mage range; archer has field-wide range

    step(s, {
      castSkills: [
        { slot: 1, skillId: "archer_rain" },
        { slot: 2, skillId: "mage_meteor" },
      ],
    });

    expect(archer.skillCds["archer_rain"]).toBe(SKILLS.archer_rain.cd);
    expect(mage.skillCds["mage_meteor"]).toBe(SKILLS.mage_meteor.cd);
    expect(sword.skillCds["sword_whirl"] ?? 0).toBe(0);
  });
});

describe("auto-cast across a full 3-hero team", () => {
  it("casts every hero's SLOTTED signature skill in the same step once each guard passes", () => {
    const s = makeParty(7);
    // M8 party P1b: auto-cast is now PER-HERO config (the global `s.autoCast` only
    // mirrors onto a SOLO hero). A cohort enables it per member (via setHeroConfig in
    // real play); set it directly here. Assertions unchanged.
    for (const h of s.heroes) h.config.autoCast = true;
    const sword = s.heroes[0];
    // One enemy inside the swordsman's spin radius also satisfies the mage
    // (330 range) and the archer (field-wide range) simultaneously.
    s.enemies = [makeStubEnemy(1, sword.x + 20)];

    step(s, {});

    expect(s.heroes[0].skillCds["sword_whirl"]).toBe(SKILLS.sword_whirl.cd);
    expect(s.heroes[1].skillCds["archer_rain"]).toBe(SKILLS.archer_rain.cd);
    expect(s.heroes[2].skillCds["mage_meteor"]).toBe(SKILLS.mage_meteor.cd);
  });

  it("auto-cast guard still holds for the full team: no target -> no casts, no cooldowns", () => {
    const s = makeParty(7);
    for (const h of s.heroes) h.config.autoCast = true; // per-hero (see note above)
    s.enemies = []; // nothing to hit anywhere

    step(s, {});

    expect(s.heroes.every((h) => Object.values(h.skillCds).every((cd) => cd === 0))).toBe(true);
  });
});
