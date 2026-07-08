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
  isZoneUnlocked,
  questGrantsZoneAccess,
  effectiveUnlockedZones,
  tier3FrontierLocked,
  isTier3BossObjectiveActive,
  worldNav,
  zoneAt,
  type GameState,
  type Hero,
  type HeroClass,
  type SaveData,
} from "@/engine";
import { soloSave, makeStubEnemy, runUntil } from "./helpers";

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
  // OWNER RULE 2026-07-07 ("ห้ามข้ามแมพ"): the tundra frontier grant only becomes enterable once
  // map3's boss room is persist-unlocked (map3 count = 6). These access/boss tests assume the
  // hero HAS climbed map3 to the boss door; the gate itself is covered in its own block below.
  s.unlockedZones.map3 = 6;
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

  it("accepting seats the tier-3 quest instance (kill grind + map4 boss)", () => {
    const { s, h } = tierHero("archer", 2, 40);
    step(s, { acceptQuest: 0 });
    expect(h.quest!.id).toBe(tier3QuestId("archer"));
    expect(h.quest!.accepted).toBe(true);
    // M7.9b (owner "fight the MAP4 boss"): TWO objectives now — the map4-frontier kill
    // grind THEN the young-Sovereign boss kill. Order is load-bearing (0=kill, 1=killBoss).
    expect(h.quest!.progress).toEqual([0, 0]);
    const def = tier3QuestFor("archer");
    expect(def.objectives).toHaveLength(2);
    expect(def.objectives[0]).toMatchObject({ type: "kill", mapId: "map4" });
    expect(def.objectives[1]).toMatchObject({ type: "killBoss", mapId: "map4" });
  });
});

describe("M7.9 tier-3 quest — map4-frontier kill counting (REDESIGN)", () => {
  it("counts hunt kills ONLY while in map4 (the frontier), not map3/map2", () => {
    const { s, h } = tierHero("swordsman", 2, 40);
    step(s, { acceptQuest: 0 });
    const killIdx = tier3QuestFor("swordsman").objectives.findIndex((o) => o.type === "kill");

    // In map3 (tierHero placed us here): a kill does NOT count (objective is map4-scoped).
    s.enemies.push(makeStubEnemy(s.nextId++, 400, 0));
    step(s, {});
    expect(h.quest!.progress[killIdx]).toBe(0);

    // In the map4 frontier (the preview zone): a kill counts.
    s.location = { mapId: "map4", zoneIdx: 0 };
    s.stage = 16;
    s.enemies.push(makeStubEnemy(s.nextId++, 400, 0));
    step(s, {});
    expect(h.quest!.progress[killIdx]).toBe(1);
  });

  it("has a map4 BOSS objective (M7.9b) — but NOT the old map2-boss backtrack", () => {
    const boss = tier3QuestFor("archer").objectives.find((o) => o.type === "killBoss");
    expect(boss).toBeDefined();
    expect(boss!.mapId).toBe("map4"); // the young Sovereign, not a map2 backtrack
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
  it("SAVE_VERSION is at least the M7.9 tier-3 version (15)", () => {
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(15);
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
    expect(out.version).toBe(SAVE_VERSION);
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
    expect(out.version).toBe(SAVE_VERSION);
    expect([1, 2, 3]).toContain(out.hero.tier);
    expect(out.hero.autoSlots).toHaveLength(3); // adopted tier-1 hero => 3-slot loadout
    expect(migrate(out)).toEqual(out);
  });

  it("round-trips a tier-3 hero (4-slot loadout + skill-4 + mana bonus)", () => {
    const { s, h } = tierHero("swordsman", 3, 45);
    h.autoSlots[3] = "sword_skyfall";
    const save = toSaveData(s);
    expect(save.version).toBe(SAVE_VERSION);
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

  it("preserves an in-progress NEW-shape (2-objective) tier-3 quest through migrate", () => {
    const id = tier3QuestId("archer");
    const v16 = {
      version: 16,
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
        // M7.9b NEW 2-objective shape (map4 kills, map4 boss): kills banked, boss pending.
        quest: { id, accepted: true, progress: [90, 0] },
      },
      lastSeen: 0,
    };
    const out = migrate(v16);
    expect(out.hero.quest).toEqual({ id, accepted: true, progress: [90, 0] });
    expect(migrate(out)).toEqual(out);
  });

  it("RESETS an in-flight 1-objective (pre-M7.9b) tier-3 quest to un-accepted", () => {
    // Migration guard (M7.9b, owner "fight the MAP4 boss"): the option-B quest that just
    // landed (commit 3c513b4) was a SINGLE kill objective — an in-flight save carries a
    // length-1 progress [kills]. Adding the boss objective makes the def length 2, so the
    // objective-length guard (state/version.normalizeQuest + state/index.normalizeHeroQuest)
    // RESETS the stale length-1 instance to null (re-offered at L40) rather than mis-map the
    // banked kills onto the wrong objective. Same crash-proof rule as the option-B redesign;
    // no SAVE_VERSION bump (the HeroQuest {id,accepted,progress[]} SHAPE is unchanged).
    const id = tier3QuestId("archer");
    const v16old = {
      version: 16,
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
        quest: { id, accepted: true, progress: [45] }, // OLD 1-objective (option-B) shape
      },
      lastSeen: 0,
    };
    const out = migrate(v16old);
    expect(out.hero.quest).toBeNull(); // reset → re-offered on load (derived, L40)
    expect(migrate(out)).toEqual(out);
    // initGameState's live-load normaliser applies the SAME reset (no crash).
    const live = initGameState(3, out);
    expect(live.heroes[0].quest).toBeNull();
  });
});

describe("M7.9 tier-3 quest — map4-z1 PREVIEW access (REDESIGN)", () => {
  const PREVIEW = { mapId: "map4", zoneIdx: 0 };
  const MAP4_Z2 = { mapId: "map4", zoneIdx: 1 };

  it("grants access to ONLY map4 z1 while the tier-3 quest is accepted", () => {
    const { s, h } = tierHero("mage", 2, 40);
    // Before accepting: no grant, map4 fully locked.
    expect(questGrantsZoneAccess(s, PREVIEW)).toBe(false);
    expect(isZoneUnlocked(s, PREVIEW)).toBe(false);

    step(s, { acceptQuest: 0 });
    expect(h.quest!.accepted).toBe(true);
    // Grant is exactly map4 z1 — zone 2 stays locked (gated behind the s15 boss).
    expect(questGrantsZoneAccess(s, PREVIEW)).toBe(true);
    expect(isZoneUnlocked(s, PREVIEW)).toBe(true);
    expect(questGrantsZoneAccess(s, MAP4_Z2)).toBe(false);
    expect(isZoneUnlocked(s, MAP4_Z2)).toBe(false);
  });

  it("the grant is DERIVED (evaporates when the quest is dropped) — not persisted", () => {
    const { s, h } = tierHero("swordsman", 2, 40);
    step(s, { acceptQuest: 0 });
    expect(isZoneUnlocked(s, PREVIEW)).toBe(true);
    // Dropping the quest (here: simulate a consume) removes access — nothing persisted.
    h.quest = null;
    expect(questGrantsZoneAccess(s, PREVIEW)).toBe(false);
    expect(isZoneUnlocked(s, PREVIEW)).toBe(false);
    expect(s.unlockedZones.map4 ?? 0).toBe(0); // never written to the persisted count
  });

  it("effectiveUnlockedZones folds the grant into the count map (never mutates state)", () => {
    const { s } = tierHero("archer", 2, 40);
    expect(effectiveUnlockedZones(s).map4 ?? 0).toBe(0);
    step(s, { acceptQuest: 0 });
    const eff = effectiveUnlockedZones(s);
    expect(eff.map4).toBe(1); // count bumped to include map4 z1 (idx 0)
    expect(s.unlockedZones.map4 ?? 0).toBe(0); // the real state is untouched
  });

  it("fast travel INTO the preview is allowed; a WALK arrow reflects the grant", () => {
    const { s } = tierHero("mage", 2, 40);
    step(s, { acceptQuest: 0 });
    // Fast-travel from town (guaranteed standoff) starts a channel to the preview.
    s.location = { mapId: CONFIG.world.townMapId, zoneIdx: 0 };
    s.enemies = [];
    step(s, { fastTravel: PREVIEW });
    expect(s.fastTravelCast).not.toBeNull();
    expect(s.fastTravelCast!.targetMapId).toBe("map4");

    // A hero standing at the map3 boss room sees map4 z1 as an unlocked right-neighbour.
    const { s: s2 } = tierHero("mage", 2, 40);
    step(s2, { acceptQuest: 0 });
    s2.unlockedZones.map3 = 6; // boss room reachable
    s2.location = { mapId: "map3", zoneIdx: 5 };
    const nav = worldNav(s2);
    expect(nav.right?.zone.mapId).toBe("map4");
    expect(nav.right?.unlocked).toBe(true);
  });

  it("farming the granted preview to quota does NOT cascade-unlock map4 z2 (invariant)", () => {
    const { s, h } = tierHero("swordsman", 2, 40);
    step(s, { acceptQuest: 0 });
    s.location = { mapId: "map4", zoneIdx: 0 };
    s.stage = 16;
    s.spawnPaused = true;
    // Force the zone quota met — a persist-unlocked zone would unlock its neighbour here.
    s.kills = CONFIG.killGoal(16) + 5;
    step(s, {});
    expect(s.unlockedZones.map4 ?? 0).toBe(0); // preview never cascades a real unlock
    expect(isZoneUnlocked(s, MAP4_Z2)).toBe(false);
    // (h is the quest holder; sanity that the grant is still only z1.)
    expect(isZoneUnlocked(s, PREVIEW)).toBe(true);
    void h;
  });
});

describe("M7.9c tier-3 frontier GATE (owner rule 2026-07-07 ห้ามข้ามแมพ)", () => {
  const PREVIEW = { mapId: "map4", zoneIdx: 0 };
  const BOSS_ROOM = { mapId: "map4", zoneIdx: 5 };

  /** A tier-2 L40 quest holder whose map3 is NOT yet climbed to the boss door. */
  function frontierGated(cls: HeroClass): { s: GameState; h: Hero } {
    const s = initGameState(1, soloSave(cls, 12)); // stage 12 => map3, boss room NOT unlocked
    const h = s.heroes[0];
    h.tier = 2;
    h.level = CONFIG.evolution.tier3.levelRequired;
    h.maxHp = heroMaxHpOf(h);
    h.hp = h.maxHp;
    s.spawnPaused = true;
    step(s, { acceptQuest: 0 });
    return { s, h };
  }

  it("accepting is fine, but the grant is NOT enterable until map3's boss room persist-unlocks", () => {
    const { s, h } = frontierGated("swordsman");
    expect(h.quest!.accepted).toBe(true); // quest ACCEPTED at Lv40 mid-map3 (card says keep climbing)
    expect((s.unlockedZones.map3 ?? 0) < 6).toBe(true); // map3 boss room not yet reached
    expect(tier3FrontierLocked(s)).toBe(true);
    expect(questGrantsZoneAccess(s, PREVIEW)).toBe(false);
    expect(isZoneUnlocked(s, PREVIEW)).toBe(false);
    expect(effectiveUnlockedZones(s).map4 ?? 0).toBe(0);

    // Climb map3 to the boss door (persist-unlock the boss room) -> grant becomes enterable.
    s.unlockedZones.map3 = 6;
    expect(tier3FrontierLocked(s)).toBe(false);
    expect(questGrantsZoneAccess(s, PREVIEW)).toBe(true);
    expect(isZoneUnlocked(s, PREVIEW)).toBe(true);
    expect(effectiveUnlockedZones(s).map4).toBe(1);
  });

  it("the boss-room grant also waits on the gate even with the kill objective banked", () => {
    const { s, h } = frontierGated("archer");
    h.quest!.progress[0] = tier3QuestFor("archer").objectives[0].count; // kills banked
    expect(isTier3BossObjectiveActive(s)).toBe(true);
    // Gate still shut (map3 boss room not reached) -> boss room stays inaccessible.
    expect(questGrantsZoneAccess(s, BOSS_ROOM)).toBe(false);
    expect(isZoneUnlocked(s, BOSS_ROOM)).toBe(false);
    s.unlockedZones.map3 = 6;
    expect(questGrantsZoneAccess(s, BOSS_ROOM)).toBe(true);
  });

  it("tier3FrontierLocked is false with no tier-3 quest held (nothing to gate)", () => {
    const { s } = tierHero("mage", 2, 40); // accepted-less; map3 unlocked in helper
    expect(s.heroes[0].quest).toBeNull();
    expect(tier3FrontierLocked(s)).toBe(false);
  });

  it("boot-time guard RELOCATES a hero stranded in the tundra by the older looser grant", () => {
    // A save written under the OLD grant: hero standing in map4 z0 (frontier) while holding the
    // tier-3 quest, but map3's boss room is NOT persist-unlocked (map3 count 3 < 6). Post-rule
    // that zone is no longer enterable — initGameState must relocate the hero to a reachable
    // farm (here the persisted lastFarmZone) rather than strand them. No SAVE bump.
    const base = soloSave("swordsman", 12);
    const stranded: SaveData = {
      ...base,
      hero: {
        ...base.hero,
        tier: 2,
        level: 40,
        quest: { id: tier3QuestId("swordsman"), accepted: true, progress: [0, 0] },
      },
      location: { mapId: "map4", zoneIdx: 0 },
      lastFarmZone: { mapId: "map3", zoneIdx: 2 },
      unlockedZones: { map1: 7, map2: 6, map3: 3 }, // map3 boss room NOT reached
    };
    const s = initGameState(7, stranded);
    expect(s.location).not.toEqual({ mapId: "map4", zoneIdx: 0 }); // not left in the locked frontier
    expect(isZoneUnlocked(s, s.location)).toBe(true); // wherever it lands IS reachable
    expect(zoneAt(s.location).kind).toBe("farm");
    expect(s.location).toEqual({ mapId: "map3", zoneIdx: 2 }); // the persisted real frontier
    expect(s.stage).toBe(zoneAt(s.location).stage); // stage re-derived from the safe zone
  });

  it("does NOT relocate a hero whose tundra grant IS enterable (map3 cleared)", () => {
    const base = soloSave("archer", 12);
    const ok: SaveData = {
      ...base,
      hero: {
        ...base.hero,
        tier: 2,
        level: 40,
        quest: { id: tier3QuestId("archer"), accepted: true, progress: [0, 0] },
      },
      location: { mapId: "map4", zoneIdx: 0 },
      lastFarmZone: { mapId: "map4", zoneIdx: 0 },
      unlockedZones: { map1: 7, map2: 6, map3: 6 }, // map3 boss room reached -> grant enterable
    };
    const s = initGameState(7, ok);
    expect(s.location).toEqual({ mapId: "map4", zoneIdx: 0 }); // stays in the granted frontier
  });
});

describe("M7.9b tier-3 quest BOSS objective (young Glacial Sovereign)", () => {
  const BOSS_ROOM = { mapId: "map4", zoneIdx: 5 };
  const PREVIEW = { mapId: "map4", zoneIdx: 0 };
  const MAP4_Z2 = { mapId: "map4", zoneIdx: 1 };

  /** A tier-2 quest holder standing in the map4 frontier with the KILL objective banked. */
  function killsBanked(cls: HeroClass): { s: GameState; h: Hero } {
    const { s, h } = tierHero(cls, 2, 40);
    step(s, { acceptQuest: 0 });
    s.location = { mapId: "map4", zoneIdx: 0 };
    s.stage = 16;
    h.quest!.progress[0] = tier3QuestFor(cls).objectives[0].count; // kills banked
    return { s, h };
  }

  it("access grant EXTENDS to the boss room only AFTER the kill objective is banked", () => {
    const { s, h } = tierHero("archer", 2, 40);
    step(s, { acceptQuest: 0 });
    // Kills NOT yet banked: boss room stays locked, only z1 is granted.
    expect(isTier3BossObjectiveActive(s)).toBe(false);
    expect(questGrantsZoneAccess(s, BOSS_ROOM)).toBe(false);
    expect(isZoneUnlocked(s, BOSS_ROOM)).toBe(false);

    // Bank the kill objective → boss-room grant opens; zones 2-5 stay locked.
    h.quest!.progress[0] = tier3QuestFor("archer").objectives[0].count;
    expect(isTier3BossObjectiveActive(s)).toBe(true);
    expect(questGrantsZoneAccess(s, BOSS_ROOM)).toBe(true);
    expect(isZoneUnlocked(s, BOSS_ROOM)).toBe(true);
    expect(isZoneUnlocked(s, MAP4_Z2)).toBe(false); // zone 2 never granted
    expect(isZoneUnlocked(s, PREVIEW)).toBe(true); // z1 still granted

    // Boss-room grant is NOT folded into the count map (can't express z1+boss but not 2-5).
    expect(effectiveUnlockedZones(s).map4).toBe(1);
  });

  it("the boss-room grant REVOKES once the boss objective completes / quest is consumed", () => {
    const { s, h } = killsBanked("swordsman");
    expect(questGrantsZoneAccess(s, BOSS_ROOM)).toBe(true);
    // Complete the boss objective → the "active reason" is gone → grant revokes.
    h.quest!.progress[1] = tier3QuestFor("swordsman").objectives[1].count;
    expect(isTier3BossObjectiveActive(s)).toBe(false);
    expect(questGrantsZoneAccess(s, BOSS_ROOM)).toBe(false);
    expect(isZoneUnlocked(s, BOSS_ROOM)).toBe(false);
  });

  it("challenging from the frontier spawns the QUEST-SCALED Sovereign (charge kept)", () => {
    const { s } = killsBanked("archer");
    // "Challenge" walks DIRECTLY into the map4 boss room (non-adjacent — z2-5 never traversed).
    step(s, { challengeBoss: true });
    expect(s.traveling).not.toBeNull();
    expect(runUntil(s, (st) => st.phase === "boss", 300)).toBe(true);
    expect(s.location).toEqual(BOSS_ROOM);
    expect(s.boss).not.toBeNull();
    // Quest-override scales (softer than the real bossVariety[20] 0.7/0.62), same base curve.
    expect(s.boss!.maxHp).toBe(Math.round(CONFIG.bossHp(20) * CONFIG.quest.tier3.bossHpScale));
    expect(s.boss!.atk).toBe(Math.round(CONFIG.bossAtk(20) * CONFIG.quest.tier3.bossAtkScale));
    // Softer than the REAL s20 Sovereign (proves it's the young version).
    expect(s.boss!.maxHp).toBeLessThan(Math.round(CONFIG.bossHp(20) * CONFIG.bossVariety[20].hpScale));
    // CHARGE mechanic + telegraphs retained (teaches the s20 fight early).
    expect(s.boss!.variety!.behaviors).toContain("charge");
  });

  it("the charge hit at quest scale is SURVIVABLE for the squishiest tier-2 Lv40 (archer)", () => {
    const { s, h } = killsBanked("archer");
    step(s, { challengeBoss: true });
    expect(runUntil(s, (st) => st.phase === "boss", 300)).toBe(true);
    const chargeHit = Math.round(s.boss!.atk * CONFIG.bossBehavior.charge.hitMult);
    // A full-HP archer takes the telegraphed charge and lives with real margin (not a one-shot).
    expect(chargeHit).toBeLessThan(h.maxHp);
    expect(chargeHit).toBeLessThan(h.maxHp * 0.5);
  });

  it("a TIER-3 hero (post-quest) entering the map4 boss room gets the REAL s20 boss", () => {
    const { s } = tierHero("swordsman", 3, 45); // tier 3, no quest (evolved)
    expect(s.heroes[0].quest).toBeNull();
    s.unlockedZones.map4 = 6; // map4 fully unlocked (real progression)
    s.location = { mapId: "map4", zoneIdx: 4 }; // last farm, boss room next door
    s.stage = 20;
    s.kills = CONFIG.killGoal(20);
    s.bossReady = true;
    step(s, { challengeBoss: true });
    expect(runUntil(s, (st) => st.phase === "boss", 300)).toBe(true);
    // REAL bossVariety scale (no quest override) — the full-power Sovereign.
    expect(s.boss!.maxHp).toBe(Math.round(CONFIG.bossHp(20) * CONFIG.bossVariety[20].hpScale));
    expect(s.boss!.atk).toBe(Math.round(CONFIG.bossAtk(20) * CONFIG.bossVariety[20].atkScale));
  });

  it("beating the young Sovereign completes the quest but does NOT unlock map5 / map4", () => {
    const { s, h } = killsBanked("mage");
    step(s, { challengeBoss: true });
    expect(runUntil(s, (st) => st.phase === "boss", 300)).toBe(true);
    s.boss!.hp = 0; // force the kill
    step(s, {}); // resolveDeaths → onBossKilled (quest boss)
    expect(h.quest!.progress[1]).toBe(1); // killBoss objective advanced
    expect(isQuestComplete(h)).toBe(true); // quest done → hero may now evolve
    // M7.95 SOFT-LOCK FIX: the win RETURNS the hero to the frontier field (phase battle),
    // never a dead-end paused "victory" in the now-inaccessible boss room (the boss-room
    // grant revoked the instant the killBoss objective filled above).
    expect(s.phase).toBe("battle");
    expect(s.boss).toBeNull();
    expect(s.location).toEqual({ mapId: "map4", zoneIdx: 0 });
    // The scaled practice boss must NOT progress the world: no map5 unlock, no persisted map4.
    expect(s.unlockedZones.map5 ?? 0).toBe(0);
    expect(s.unlockedZones.map4 ?? 0).toBe(0);
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

  it("every skill-4 is a tier-3 / L40 unlock with a meaningful mana cost", () => {
    // Cost history: archer_storm 120 → 90 (M7.9 archer-friction pass) → 45; sword_skyfall
    // 120 → 80 (mana relief pass, owner 2026-07-08, "ซื้อยามานาจนตังหมด" — sword/archer drained
    // gold on mana potions). skyfall was sword's dominant drain and storm the only tier-3-safe
    // archer cost (barrage/powershot fire from L8/L15 → cutting them would break s1-15
    // byte-identical), so both were softened + the tier3PoolBonus deepened (90 → 170) to roughly
    // HALVE potion burn (sim: sword 198 → 103, archer 210 → 112 /run) — mana stays a real sink
    // (~100+ pot/run), not irrelevant. mage_apocalypse stays 120 (mage burn kept ~as-is).
    // Structural gate below (tier 3 / L40) is the load-bearing invariant; costs are tunables.
    for (const id of ["sword_skyfall", "archer_storm", "mage_apocalypse"]) {
      expect(SKILLS[id].tier).toBe(3);
      expect(SKILLS[id].unlockLevel).toBe(40);
      expect(SKILLS[id].cost).toBeGreaterThanOrEqual(40); // still a real mana cost, never trivial
      expect(SKILLS[id].cost).toBeLessThanOrEqual(120);
    }
    expect(SKILLS.sword_skyfall.cost).toBe(80);
    expect(SKILLS.mage_apocalypse.cost).toBe(120);
    expect(SKILLS.archer_storm.cost).toBe(45);
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

  it("field-wide buff: the volley tiles the ENTIRE spawn band from any centroid", () => {
    // Owner buff 2026-07-08 ("ระเบิดทั่ว map"): contiguous coverage — every gap between
    // sorted impact points must be bridged by the blast radius, and from the worst-case
    // centroids (both edges of the spawn band) the blasts must still reach the far edge.
    const r = SKILLS.mage_apocalypse.radius;
    const dxs = CONFIG.apocalypseOffsets.map((o) => o.dx).sort((a, b) => a - b);
    for (let i = 1; i < dxs.length; i++) {
      expect(dxs[i] - dxs[i - 1]).toBeLessThanOrEqual(2 * r); // no dead gap inside the spread
    }
    const field = CONFIG.world.maps[0].fieldWidth;
    const bandMin = field * CONFIG.hunt.spawnMinXFrac;
    const bandMax = field * CONFIG.hunt.spawnMaxXFrac;
    expect(bandMin + dxs[dxs.length - 1] + r).toBeGreaterThanOrEqual(bandMax); // left-edge centroid reaches right edge
    expect(bandMax + dxs[0] - r).toBeLessThanOrEqual(bandMin); // right-edge centroid reaches left edge
  });

  it("field-wide buff is NOT a boss buff: a lone boss eats exactly 3 of the 8 blasts", () => {
    // The widened table is calibrated so single-target (boss) damage stays where the old
    // ±300/r150 table put it (3 near-center hits). If a retune changes this count, the
    // mage's boss DPS silently shifts — re-adjudicate with the sim before accepting.
    const r = SKILLS.mage_apocalypse.radius;
    const hits = CONFIG.apocalypseOffsets.filter((o) => Math.abs(o.dx) < r).length;
    expect(hits).toBe(3);
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
