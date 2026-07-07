import { describe, it, expect } from "vitest";
import {
  CONFIG,
  initGameState,
  step,
  botFarmTarget,
  zoneAt,
  isZoneUnlocked,
  tier3QuestId,
  tier3QuestFor,
  defaultBotSettings,
  heroMaxHpOf,
  canEvolveHero,
  isQuestComplete,
  type GameState,
  type HeroClass,
} from "@/engine";
import { soloSave, runUntil } from "./helpers";

/**
 * M7.95 "QUEST LEADS" (owner "เควสนำมาก่อน", 2026-07-08): while the solo hero holds an
 * evolution quest with an INCOMPLETE map-scoped objective, ALL idle automation (death
 * auto-return, bot town-trip return, and the auto-advance guard) prefers the quest's
 * granted frontier field (`world.botFarmTarget`) over the ordinary `lastFarmZone`, so a
 * "พาไปเลย" guide jump can't be re-routed back to ordinary farming. Plus the folded-in
 * frontier-only auto-advance rule: auto-advance fires ONLY on the fresh locked->unlocked
 * transition, never when parked in an already-cleared zone.
 *
 * The tier-3 quest is the only one with map-scoped objectives (both scoped to map4); the
 * frontier preview zone is map4 zone 0 (`world.tier3PreviewZone`).
 */

const PREVIEW = { mapId: "map4", zoneIdx: 0 };

/** A tier-2 L40 hero with the tier-3 quest ACCEPTED (kill objective still open), spawns
 * frozen so the field never interferes with a routing assertion. */
function questHero(cls: HeroClass = "swordsman"): GameState {
  const s = initGameState(1, soloSave(cls, 12)); // stage 12 => map3
  const h = s.heroes[0];
  h.tier = 2;
  h.level = CONFIG.evolution.tier3.levelRequired;
  h.maxHp = heroMaxHpOf(h);
  h.hp = h.maxHp;
  s.spawnPaused = true;
  s.enemies = [];
  step(s, { acceptQuest: 0 }); // seats the tier-3 quest
  s.spawnPaused = true;
  s.enemies = [];
  return s;
}

/** Bank the kill objective (progress[killIdx] = count) so the quest enters its boss phase. */
function bankKillObjective(s: GameState): void {
  const cls = s.heroes[0].cls;
  const def = tier3QuestFor(cls);
  const killIdx = def.objectives.findIndex((o) => o.type === "kill");
  s.heroes[0].quest!.progress[killIdx] = def.objectives[killIdx].count;
}

describe("botFarmTarget — quest leads", () => {
  it("returns the tier-3 frontier while the kill objective is incomplete", () => {
    const s = questHero("swordsman");
    s.lastFarmZone = { mapId: "map3", zoneIdx: 3 }; // an ordinary parked spot
    expect(botFarmTarget(s)).toEqual(PREVIEW);
    // Sanity: the frontier is actually enterable (grant), so the routing is valid.
    expect(isZoneUnlocked(s, PREVIEW)).toBe(true);
  });

  it("still returns the frontier during the BOSS objective phase (kills banked)", () => {
    const s = questHero("archer");
    s.lastFarmZone = { mapId: "map3", zoneIdx: 3 };
    bankKillObjective(s);
    expect(botFarmTarget(s)).toEqual(PREVIEW);
  });

  it("falls back to lastFarmZone with no quest active", () => {
    const s = initGameState(1, soloSave("archer", 8));
    s.lastFarmZone = { mapId: "map2", zoneIdx: 2 };
    expect(s.heroes[0].quest).toBeNull();
    expect(botFarmTarget(s)).toEqual({ mapId: "map2", zoneIdx: 2 });
  });

  it("falls back to lastFarmZone for the UNSCOPED tier-1 class-change quest", () => {
    const s = initGameState(1, soloSave("mage", 4)); // tier 1
    s.heroes[0].level = CONFIG.evolution.levelRequired;
    s.spawnPaused = true;
    s.enemies = [];
    step(s, { acceptQuest: 0 });
    // A tier-1 quest was accepted, and it is NOT the tier-3 (map-scoped) one.
    expect(s.heroes[0].quest).not.toBeNull();
    expect(s.heroes[0].quest!.id).not.toBe(tier3QuestId("mage"));
    s.lastFarmZone = { mapId: "map1", zoneIdx: 2 };
    expect(botFarmTarget(s)).toEqual({ mapId: "map1", zoneIdx: 2 });
  });

  it("falls back to lastFarmZone once the tier-3 quest is fully complete", () => {
    const s = questHero("mage");
    const def = tier3QuestFor("mage");
    s.heroes[0].quest!.progress = def.objectives.map((o) => o.count); // all objectives met
    s.lastFarmZone = { mapId: "map3", zoneIdx: 4 };
    expect(botFarmTarget(s)).toEqual({ mapId: "map3", zoneIdx: 4 });
  });
});

describe("quest leads — death auto-return", () => {
  it("returns to the quest frontier after a death, NOT lastFarmZone", () => {
    const s = questHero("swordsman");
    s.autoReturn = true;
    s.unlockedZones.map3 = 6; // make the ordinary lastFarmZone a valid unlocked farm
    s.lastFarmZone = { mapId: "map3", zoneIdx: 3 };
    s.location = { mapId: "map4", zoneIdx: 0 };
    s.stage = 16;
    // Kill the solo hero -> resolveDeaths -> respawnToTown (death transit).
    s.heroes[0].hp = 0;
    s.heroes[0].dead = true;

    // The AUTO-RETURN transit (reason "walk") targets the quest frontier, not map3.
    const reached = runUntil(
      s,
      (st) => st.traveling?.reason === "walk" && st.traveling.targetMapId === "map4",
      3000,
    );
    expect(reached).toBe(true);
    expect(s.traveling?.targetZoneIdx).toBe(0);
  });
});

describe("quest leads — bot town-trip return", () => {
  it("a restock trip walks home to the quest frontier, NOT lastFarmZone", () => {
    const s = questHero("swordsman");
    s.location = { mapId: "map3", zoneIdx: 3 }; // farming an ordinary zone
    s.stage = zoneAt(s.location).stage;
    s.lastFarmZone = { mapId: "map3", zoneIdx: 3 };
    s.unlockedZones.map3 = 6;
    s.gold = 100_000;
    s.bot = { ...defaultBotSettings(), enabled: true, hpPotionTarget: 15 };
    s.consumables.hpPotion = 0; // empty -> restock trip is due
    s.consumables.returnScroll = 1; // instant warp trip (0-timer)

    const returning = runUntil(
      s,
      (st) => st.traveling?.reason === "walk" && st.traveling.targetMapId === "map4",
      3000,
    );
    expect(returning).toBe(true);
    expect(s.traveling?.targetZoneIdx).toBe(0);
  });
});

describe("quest leads — auto-advance suppression", () => {
  it("stays put in the quest frontier with the toggle on and quota met", () => {
    const s = questHero("swordsman");
    s.autoAdvance = true;
    s.location = { mapId: "map4", zoneIdx: 0 };
    s.stage = 16;
    s.kills = CONFIG.killGoal(16);
    for (let i = 0; i < 30; i++) step(s, {});
    expect(s.traveling).toBeNull();
    expect(s.location).toEqual(PREVIEW);
  });

  it("suppresses even when the frontier neighbour FRESHLY unlocks (real map4 mid-quest)", () => {
    const s = questHero("swordsman");
    s.autoAdvance = true;
    s.location = { mapId: "map4", zoneIdx: 0 };
    s.stage = 16;
    s.unlockedZones.map4 = 1; // z0 really persist-unlocked, z1 still locked
    s.kills = CONFIG.killGoal(16);
    step(s, {});
    // checkZoneUnlock DID fire the fresh transition (z1 opened)...
    expect(s.unlockedZones.map4).toBe(2);
    // ...but the quest pin suppressed the auto-advance walk.
    expect(s.traveling).toBeNull();
  });
});

describe("frontier-only auto-advance (non-quest)", () => {
  it("advances once when the next zone FRESHLY unlocks from farming here", () => {
    const s = initGameState(1, soloSave("swordsman", 1));
    s.autoAdvance = true;
    s.spawnPaused = true;
    s.enemies = [];
    s.location = { mapId: "map1", zoneIdx: 1 };
    s.stage = 1;
    s.unlockedZones = { map1: 2 }; // town(0)+z1 unlocked, z2 still locked
    s.kills = CONFIG.killGoal(1);
    step(s, {});
    expect(s.traveling).not.toBeNull();
    expect(s.traveling?.targetMapId).toBe("map1");
    expect(s.traveling?.targetZoneIdx).toBe(2);
  });

  it("NEVER auto-advances when parked in an already-cleared zone", () => {
    const s = initGameState(1, soloSave("swordsman", 1));
    s.autoAdvance = true;
    s.spawnPaused = true;
    s.enemies = [];
    s.location = { mapId: "map1", zoneIdx: 1 };
    s.stage = 1;
    s.unlockedZones = { map1: 7 }; // whole map already cleared -> z2 unlocked on arrival
    s.kills = CONFIG.killGoal(1); // quota already met (persisted), no fresh transition
    for (let i = 0; i < 30; i++) step(s, {});
    expect(s.traveling).toBeNull();
    expect(s.location).toEqual({ mapId: "map1", zoneIdx: 1 });
  });
});

describe("no override of an in-flight guide travel", () => {
  it("a bot trip never hijacks a channeling guide fast-travel", () => {
    const s = questHero("swordsman");
    s.location = { mapId: "map3", zoneIdx: 3 };
    s.stage = zoneAt(s.location).stage;
    s.lastFarmZone = { mapId: "map3", zoneIdx: 3 };
    s.unlockedZones.map3 = 6;
    s.spawnPaused = true;
    s.enemies = []; // no aggro -> fast-travel is allowed
    s.gold = 100_000;
    s.bot = { ...defaultBotSettings(), enabled: true, hpPotionTarget: 15 };
    s.consumables.hpPotion = 0; // a restock trip WOULD be due
    s.consumables.returnScroll = 5; // ...and would warp instantly

    // Guide -> fast-travel toward the quest frontier.
    step(s, { fastTravel: { mapId: "map4", zoneIdx: 0 } });
    expect(s.fastTravelCast).not.toBeNull();
    expect(s.botPending).toBeNull(); // the bot did NOT start a competing trip
    expect(s.traveling).toBeNull(); // and no walk transit was queued over it

    // The channel completes to the intended frontier — never re-routed.
    const done = runUntil(s, (st) => st.fastTravelCast === null, 2000);
    expect(done).toBe(true);
    expect(s.location).toEqual(PREVIEW);
  });
});

describe("tier-3 quest boss resolution (M7.95 soft-lock fix)", () => {
  /** Drive a tier-2 hero (kill objective banked) into the young-Sovereign boss fight. */
  function intoQuestBossFight(cls: HeroClass = "swordsman"): GameState {
    const s = questHero(cls);
    bankKillObjective(s);
    s.location = { mapId: "map4", zoneIdx: 0 };
    s.stage = 16;
    s.autoReturn = true;
    step(s, { challengeBoss: true }); // walk directly into the map4 boss room
    const inFight = runUntil(s, (st) => st.phase === "boss" && st.boss !== null, 3000);
    expect(inFight).toBe(true);
    return s;
  }

  it("WIN lands the hero back on the frontier (phase battle), never stranded, evolve offerable", () => {
    const s = intoQuestBossFight("swordsman");
    s.heroes[0].hp = s.heroes[0].maxHp;
    s.boss!.hp = 0; // finish the young Sovereign
    step(s, {});
    expect(s.boss).toBeNull();
    expect(s.phase).toBe("battle"); // NOT a dead-end paused "victory"
    expect(s.traveling).toBeNull(); // not stranded mid-transit
    expect(s.location).toEqual(PREVIEW); // returned to the frontier field
    expect(isQuestComplete(s.heroes[0])).toBe(true);
    expect(canEvolveHero(s, s.heroes[0])).toBe(true); // "เปลี่ยนคลาส!" reachable
  });

  it("LOSS resolves to a normal town respawn -> back to the frontier, quest still open", () => {
    const s = intoQuestBossFight("mage");
    s.heroes[0].hp = 0;
    s.heroes[0].dead = true; // wiped by the boss
    step(s, {}); // resolveDeaths -> respawnToTown (death transit), boss cleared
    expect(s.boss).toBeNull();
    const home = runUntil(
      s,
      (st) =>
        !st.traveling &&
        st.phase === "battle" &&
        !st.heroes[0].dead &&
        st.location.mapId === "map4" &&
        st.location.zoneIdx === 0,
      4000,
    );
    expect(home).toBe(true);
    expect(isQuestComplete(s.heroes[0])).toBe(false); // boss objective still pending
  });
});
