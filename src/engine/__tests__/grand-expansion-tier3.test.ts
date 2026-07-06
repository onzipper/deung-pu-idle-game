import { describe, it, expect } from "vitest";
import {
  CONFIG,
  SKILLS,
  SIGNATURE_SKILL,
  SAVE_VERSION,
  FIXED_DT,
  initGameState,
  step,
  migrate,
  toSaveData,
  canEvolveHero,
  canCastSkill,
  isQuestComplete,
  isClassChangeQuestOffered,
  isEvolutionQuestOffered,
  evolutionQuestFor,
  tier3QuestFor,
  tier3QuestId,
  heroAtk,
  heroMaxMana,
  heroMaxHpOf,
  heroMaxManaOf,
  tierAtkMult,
  tierHpMult,
  unlockedAutoSlotCount,
  autoSlotCapacity,
  type GameState,
  type Hero,
  type HeroClass,
} from "@/engine";
import { soloSave, makeStubEnemy, forceBoss } from "./helpers";

/**
 * M7.9 "Grand Expansion" — tier-3 CLASS ADVANCEMENT (engine).
 *
 * Covers the tier-2 -> tier-3 evolution: the map-scoped tier-3 QUEST (kills in map3 +
 * a REPEAT map2-boss defeat), the SAVE v15 tier-domain widening + migration, the
 * grander skill-4 per class (field-strike / sustained storm / meteor volley — all
 * reusing existing mechanisms, no new ProjectileKind), the tier-3 mana-pool bonus +
 * multiplier spike, and the tier-3-gated 4th auto-cast slot.
 */

/** Build a hero of `cls` at `tier`/`level`, derived stats refreshed, spawns frozen. */
function tierHero(cls: HeroClass, tier: 1 | 2 | 3, level: number): { s: GameState; h: Hero } {
  const s = initGameState(1, soloSave(cls, 12)); // stage 12 => placed in map3
  const h = s.heroes[0];
  h.tier = tier;
  h.level = level;
  while (h.autoSlots.length < autoSlotCapacity(tier)) h.autoSlots.push(null);
  h.maxHp = heroMaxHpOf(h);
  h.hp = h.maxHp;
  h.maxMana = heroMaxManaOf(h);
  h.mana = h.maxMana;
  s.spawnPaused = true;
  return { s, h };
}

describe("M7.9 tier-3 quest — offer / accept", () => {
  it("is offered to a tier-2 L40 hero (NOT the tier-1 class-change offer)", () => {
    const { h } = tierHero("swordsman", 2, CONFIG.evolution.tier3.levelRequired);
    expect(isEvolutionQuestOffered(h)).toBe(true);
    expect(isClassChangeQuestOffered(h)).toBe(false);
    expect(evolutionQuestFor(h.cls, h.tier)!.id).toBe(tier3QuestId("swordsman"));
  });

  it("is NOT offered below the L40 gate, nor once already tier 3", () => {
    const { h } = tierHero("swordsman", 2, CONFIG.evolution.tier3.levelRequired - 1);
    expect(isEvolutionQuestOffered(h)).toBe(false);
    const { h: h3 } = tierHero("swordsman", 3, 90);
    expect(isEvolutionQuestOffered(h3)).toBe(false); // fully evolved — no further quest
  });

  it("a tier-1 L40 hero still gets the CLASS-CHANGE quest, not the tier-3 one", () => {
    const { h } = tierHero("mage", 1, 40);
    expect(isClassChangeQuestOffered(h)).toBe(true);
    expect(evolutionQuestFor(h.cls, h.tier)!.id).not.toBe(tier3QuestId("mage"));
  });

  it("accepting seats the tier-3 quest instance", () => {
    const { s, h } = tierHero("archer", 2, 40);
    step(s, { acceptQuest: 0 });
    expect(h.quest!.id).toBe(tier3QuestId("archer"));
    expect(h.quest!.accepted).toBe(true);
    expect(h.quest!.progress).toEqual([0, 0]);
  });
});

describe("M7.9 tier-3 quest — map-scoped objective counting", () => {
  it("counts hunt kills ONLY while in map3", () => {
    const { s, h } = tierHero("swordsman", 2, 40);
    step(s, { acceptQuest: 0 });
    const killIdx = tier3QuestFor("swordsman").objectives.findIndex((o) => o.type === "kill");

    // In map3 (tierHero placed us here): a kill counts.
    s.enemies.push(makeStubEnemy(s.nextId++, 400, 0));
    step(s, {});
    expect(h.quest!.progress[killIdx]).toBe(1);

    // Same kill in map2: does NOT count (objective is map3-scoped).
    s.location = { mapId: "map2", zoneIdx: 1 };
    s.stage = 7;
    s.enemies.push(makeStubEnemy(s.nextId++, 400, 0));
    step(s, {});
    expect(h.quest!.progress[killIdx]).toBe(1); // unchanged
  });

  it("counts a REPEAT map2-boss defeat, but not a map3-boss defeat", () => {
    const { s, h } = tierHero("archer", 2, 40);
    step(s, { acceptQuest: 0 });
    const bossIdx = tier3QuestFor("archer").objectives.findIndex((o) => o.type === "killBoss");

    // A map3 boss defeat does NOT count (objective wants the MAP2 boss).
    s.location = { mapId: "map3", zoneIdx: 5 };
    s.stage = 15;
    forceBoss(s);
    s.boss!.hp = 0;
    step(s, {});
    expect(h.quest!.progress[bossIdx]).toBe(0);

    // Re-fight the map2 boss: THIS counts.
    s.phase = "battle";
    s.location = { mapId: "map2", zoneIdx: 5 };
    s.stage = 10;
    forceBoss(s);
    s.boss!.hp = 0;
    step(s, {});
    expect(h.quest!.progress[bossIdx]).toBe(1);
  });
});

describe("M7.9 tier-3 quest — completion enables the class change", () => {
  it("a completed tier-3 quest evolves the hero to tier 3 at 0 gold", () => {
    const { s, h } = tierHero("mage", 2, 40);
    step(s, { acceptQuest: 0 });
    const def = tier3QuestFor("mage");
    h.quest!.progress = def.objectives.map((o) => o.count); // force-complete
    expect(isQuestComplete(h)).toBe(true);
    expect(canEvolveHero(s, h)).toBe(true);

    const beforeMaxMana = h.maxMana;
    s.gold = 0;
    step(s, { evolveHero: 0 });

    expect(h.tier).toBe(3);
    expect(h.quest).toBeNull();
    expect(s.gold).toBe(0); // no gold sink
    expect(h.autoSlots.length).toBe(4); // 4th slot grown on evolve
    expect(h.maxMana).toBe(heroMaxMana("mage", h.stats.int, 3)); // tier-3 pool bonus
    expect(h.maxMana).toBeGreaterThan(beforeMaxMana);
    expect(s.events.some((e) => e.type === "evolve" && e.tier === 3)).toBe(true);
  });

  it("a tier-3 hero cannot evolve further (no re-trigger)", () => {
    const { s, h } = tierHero("swordsman", 3, 45);
    // Even with an (illegally) seated completed quest, canEvolve stays false at tier 3.
    expect(canEvolveHero(s, h)).toBe(false);
    step(s, { evolveHero: 0 });
    expect(h.tier).toBe(3);
  });
});

describe("M7.9 tier-3 power spike (multipliers)", () => {
  it("tier-3 atk/hp multipliers compound multiplicatively on tier 2", () => {
    const EV = CONFIG.evolution;
    expect(tierAtkMult(3)).toBeCloseTo(EV.atkMult * EV.tier3.atkMult, 6);
    expect(tierHpMult(3)).toBeCloseTo(EV.hpMult * EV.tier3.hpMult, 6);
    expect(tierAtkMult(3)).toBeGreaterThan(tierAtkMult(2));
    expect(tierHpMult(3)).toBeGreaterThan(tierHpMult(2));
  });

  it("heroAtk rises tier1 < tier2 < tier3 at a fixed level", () => {
    for (const cls of ["swordsman", "archer", "mage"] as const) {
      const a1 = heroAtk(cls, 40, 1);
      const a2 = heroAtk(cls, 40, 2);
      const a3 = heroAtk(cls, 40, 3);
      expect(a2).toBeGreaterThan(a1);
      expect(a3).toBeGreaterThan(a2);
    }
  });
});

describe("M7.9 SAVE v15 migration", () => {
  it("SAVE_VERSION is 15", () => {
    expect(SAVE_VERSION).toBe(15);
  });

  it("migrates a v14 tier-2 save byte-compatibly (tier 2, quest null, 3-slot, idempotent)", () => {
    const v14 = {
      version: 14,
      stage: 10,
      gold: 50,
      hero: {
        cls: "mage" as const,
        level: 40,
        xp: 0,
        tier: 2 as const,
        statPoints: 0,
        stats: { ...CONFIG.stats.base.mage },
        mana: 60,
        autoSlots: [SIGNATURE_SKILL.mage, null, null],
        quest: null,
      },
      lastSeen: 0,
    };
    const out = migrate(v14);
    expect(out.version).toBe(15);
    expect(out.hero.tier).toBe(2);
    expect(out.hero.quest).toBeNull(); // re-offered at L40 on load (derived)
    expect(out.hero.autoSlots).toEqual([SIGNATURE_SKILL.mage, null, null]); // length 3 preserved
    expect(migrate(out)).toEqual(out); // idempotent
  });

  it("migrates an ancient v2 TEAM save through the full chain to v15", () => {
    const v2 = {
      version: 2,
      stage: 4,
      gold: 100,
      unlocked: ["swordsman", "archer"],
      upgrades: { atk: 2, speed: 1, hp: 0 },
      heroes: [
        { level: 3, xp: 7 },
        { level: 5, xp: 1 },
      ],
      lastSeen: 0,
    };
    const out = migrate(v2);
    expect(out.version).toBe(15);
    expect([1, 2, 3]).toContain(out.hero.tier);
    expect(out.hero.autoSlots).toHaveLength(3); // adopted tier-1 hero => 3-slot loadout
    expect(migrate(out)).toEqual(out);
  });

  it("round-trips a tier-3 hero (4-slot loadout + skill-4 + mana bonus)", () => {
    const { s, h } = tierHero("swordsman", 3, 45);
    h.autoSlots[3] = "sword_skyfall";
    const save = toSaveData(s);
    expect(save.version).toBe(15);
    expect(save.hero.tier).toBe(3);
    expect(save.hero.autoSlots).toHaveLength(4);
    expect(save.hero.autoSlots[3]).toBe("sword_skyfall");

    const restored = initGameState(2, save);
    const r = restored.heroes[0];
    expect(r.tier).toBe(3);
    expect(r.autoSlots).toEqual(["sword_whirl", null, null, "sword_skyfall"]);
    expect(r.maxMana).toBe(heroMaxMana("swordsman", CONFIG.stats.base.swordsman.int, 3));
    // migrate is idempotent on a real v15 tier-3 save too.
    expect(migrate(save).hero.tier).toBe(3);
  });

  it("preserves an in-progress tier-3 quest through migrate", () => {
    const id = tier3QuestId("archer");
    const v15 = {
      version: 15,
      stage: 12,
      gold: 0,
      hero: {
        cls: "archer" as const,
        level: 42,
        xp: 0,
        tier: 2 as const,
        statPoints: 0,
        stats: { ...CONFIG.stats.base.archer },
        mana: 60,
        autoSlots: [SIGNATURE_SKILL.archer, null, null],
        quest: { id, accepted: true, progress: [30, 0] },
      },
      lastSeen: 0,
    };
    const out = migrate(v15);
    expect(out.hero.quest).toEqual({ id, accepted: true, progress: [30, 0] });
    expect(migrate(out)).toEqual(out);
  });
});

describe("M7.9 skill-4 definitions", () => {
  it("offset-table lengths equal each rain/volley skill's target count", () => {
    expect(CONFIG.stormOffsets.length).toBe(SKILLS.archer_storm.targets);
    expect(CONFIG.apocalypseOffsets.length).toBe(SKILLS.mage_apocalypse.targets);
    // Sword skyfall is an instant FIELD STRIKE (no drop table).
    expect(SKILLS.sword_skyfall.targets).toBe(0);
    expect(SKILLS.sword_skyfall.kind).toBe("strike");
  });

  it("every skill-4 is a tier-3 / L40 unlock with a heavy (~90-120) mana cost", () => {
    // M7.9 archer-friction pass: archer_storm cost 120 → 90. Unlike the single-nuke
    // skyfall/apocalypse (a lone big cast), storm is a SUSTAINED ~4s barrage meant to be
    // re-cast often as the archer's deep-field crowd-clearer; at cost 120 it starved the
    // dex pool (302 mana-pot/run, boss DPS collapsed → s25/s30 boss wipes). 90 keeps it a
    // real gate (60% of the 150 tier-3 pool; 197 pot/run — mana sink INTACT, gate 5) while
    // letting powershot fire at bosses. sword/mage skill-4 stay 120. See balance-m79.md.
    for (const id of ["sword_skyfall", "archer_storm", "mage_apocalypse"]) {
      expect(SKILLS[id].tier).toBe(3);
      expect(SKILLS[id].unlockLevel).toBe(40);
      expect(SKILLS[id].cost).toBeGreaterThanOrEqual(90);
      expect(SKILLS[id].cost).toBeLessThanOrEqual(120);
    }
    expect(SKILLS.sword_skyfall.cost).toBe(120);
    expect(SKILLS.mage_apocalypse.cost).toBe(120);
    expect(SKILLS.archer_storm.cost).toBe(90);
  });

  it("field-strike skyfall spans ~the 900px field", () => {
    const field = CONFIG.world.maps[0].fieldWidth;
    expect(SKILLS.sword_skyfall.radius * 2).toBeGreaterThanOrEqual(field * 0.9);
  });

  it("the tier-3 mana bonus makes skill-4 castable; tier 2 cannot afford it (str/dex)", () => {
    for (const cls of ["swordsman", "archer"] as const) {
      const baseInt = CONFIG.stats.base[cls].int;
      expect(heroMaxMana(cls, baseInt, 2)).toBeLessThan(120); // flat pool < cost
      expect(heroMaxMana(cls, baseInt, 3)).toBeGreaterThanOrEqual(120); // + bonus => castable
    }
  });

  it("a tier-3 L40 hero can cast its skill-4 with a target in range", () => {
    const skill4 = {
      swordsman: "sword_skyfall",
      archer: "archer_storm",
      mage: "mage_apocalypse",
    } as const;
    for (const cls of ["swordsman", "archer", "mage"] as const) {
      const { h } = tierHero(cls, 3, 40);
      expect(canCastSkill(h, SKILLS[skill4[cls]])).toBe(true);
    }
  });
});

describe("M7.9 archer STORM lands over a ~4s window", () => {
  it("all 20 drops land, staggered across ~4 seconds of real time", () => {
    const { s, h } = tierHero("archer", 3, 40);
    s.enemies = [makeStubEnemy(9000, h.x + 120, 1e9)]; // in-range, indestructible guard
    step(s, { castSkills: [{ slot: 0, skillId: "archer_storm" }] });

    const rain = (): number => s.projectiles.filter((p) => p.kind === "rainArrow").length;
    expect(rain()).toBe(20);

    let firstLand = -1;
    let lastLand = -1;
    let prev = rain();
    let i = 0;
    const cap = 60 * 12;
    while (rain() > 0 && i < cap) {
      step(s, {});
      i++;
      const now = rain();
      if (now < prev && firstLand < 0) firstLand = i;
      if (now === 0 && lastLand < 0) lastLand = i;
      prev = now;
    }
    expect(firstLand).toBeGreaterThan(0);
    expect(lastLand).toBeGreaterThan(firstLand); // landings are SPREAD, not simultaneous
    const windowSec = (lastLand - firstLand) * FIXED_DT;
    expect(windowSec).toBeGreaterThanOrEqual(3.0);
    expect(windowSec).toBeLessThanOrEqual(5.5);
  });
});

describe("M7.9 mage APOCALYPSE meteor volley", () => {
  it("spawns 8 staggered meteors on one cast (reusing the meteor kind)", () => {
    const { s, h } = tierHero("mage", 3, 40);
    s.enemies = [makeStubEnemy(9000, h.x + 80, 1e9)];
    step(s, { castSkills: [{ slot: 0, skillId: "mage_apocalypse" }] });

    const meteors = s.projectiles.filter((p) => p.kind === "meteor");
    expect(meteors.length).toBe(8);
    // Staggered spawn heights => the volley lands across a window (not one lump).
    expect(new Set(meteors.map((p) => p.y)).size).toBe(8);
  });
});

describe("M7.9 auto-cast slot 4 (tier-3 gated)", () => {
  it("autoSlotCapacity is 3 for tiers 1-2 and 4 for tier 3", () => {
    expect(autoSlotCapacity(1)).toBe(3);
    expect(autoSlotCapacity(2)).toBe(3);
    expect(autoSlotCapacity(3)).toBe(4);
  });

  it("the 4th auto-slot needs BOTH level 40 AND tier 3", () => {
    expect(unlockedAutoSlotCount(40, 1)).toBe(3); // tier gate blocks slot 4
    expect(unlockedAutoSlotCount(40, 2)).toBe(3);
    expect(unlockedAutoSlotCount(39, 3)).toBe(3); // level gate blocks slot 4
    expect(unlockedAutoSlotCount(40, 3)).toBe(4);
    // Default (tier omitted) stays the historical 3-slot read (UI back-compat).
    expect(unlockedAutoSlotCount(40)).toBe(3);
  });

  it("a tier-3 L40 hero can slot skill-4 into slot 3; a tier-2 hero cannot", () => {
    const { s, h } = tierHero("archer", 3, 40);
    step(s, { setAutoSlots: [{ slot: 3, skillId: "archer_storm" }] });
    expect(h.autoSlots[3]).toBe("archer_storm");

    const { s: s2, h: h2 } = tierHero("archer", 2, 40);
    step(s2, { setAutoSlots: [{ slot: 3, skillId: "archer_barrage" }] });
    expect(h2.autoSlots[3]).toBeUndefined(); // slot 3 not unlocked at tier 2
  });
});
