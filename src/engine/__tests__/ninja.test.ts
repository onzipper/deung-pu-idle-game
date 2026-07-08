import { describe, it, expect } from "vitest";
import {
  CONFIG,
  HERO_TYPES,
  PRIMARY_STAT,
  CLASS_SKILLS,
  SIGNATURE_SKILL,
  SKILLS,
  SAVE_VERSION,
  FIXED_DT,
  makeHero,
  initGameState,
  migrate,
  step,
  toSaveData,
  heroAtkOf,
  isSkillLearned,
  canEvolveHero,
  evolutionQuestFor,
  worldBossLocationFor,
  zoneAt,
} from "@/engine";
import type { GameState, GameEvent, HeroQuest } from "@/engine";
import { dashHeroTo } from "@/engine/systems/dash";
import { makeStubEnemy, soloSave } from "./helpers";

/**
 * NINJA (นินจา, SAVE v18 — docs/ninja-design.md) engine wave. Covers: class creation +
 * the tier chain / evolution, the deterministic `dash` reposition primitive + its event,
 * each of the 4 skills' damage/mana/cooldown behaviour, the dagger double-hit basic attack,
 * the SAVE v17→v18 domain widening (old saves load unchanged; a v18 ninja round-trips), and
 * the world-boss lifetime rider (the despawn clock ticks while the player travels).
 */

const eventTypes = (s: GameState, t: GameEvent["type"]): number =>
  s.events.filter((e) => e.type === t).length;

/** A solo ninja state with the mob field frozen + a controllable hero. */
function ninjaState(level = 1, tier: 1 | 2 | 3 = 1, intAlloc = 0): GameState {
  const s = initGameState(7, soloSave("ninja", 1));
  const h = s.heroes[0];
  h.level = level;
  h.tier = tier;
  h.stats.int += intAlloc; // lift the flat pool so the pricier ultimates are affordable
  s.spawnPaused = true;
  s.spawnBurst = false;
  s.enemies = [];
  return s;
}

/** Cast a specific skill from slot 0 in one step, with the BASIC attack suppressed
 *  (cd parked high) so an hp delta reflects ONLY the skill. Tops the pool up first. */
function castOnly(s: GameState, skillId: string): void {
  const h = s.heroes[0];
  h.cd = 999; // no basic attack this step
  h.mana = h.maxMana = 1e4; // afford any skill (decayHeroTimers re-derives maxMana from int)
  step(s, { castSkills: [{ slot: 0, skillId }] });
}

// ---------------------------------------------------------------------------
// Class identity + tier chain.
// ---------------------------------------------------------------------------

describe("ninja class identity", () => {
  it("creates a DEX-primary short-range melee bruiser with the ninja base block", () => {
    const h = makeHero(1, "ninja");
    expect(h.cls).toBe("ninja");
    expect(PRIMARY_STAT.ninja).toBe("dex");
    expect(h.stats).toEqual({ str: 5, dex: 8, int: 3, vit: 4 });
    const t = HERO_TYPES.ninja;
    expect(t.attack).toBe("melee");
    // Shortest reach in the game (below the sword's 96).
    expect(t.range).toBeLessThan(HERO_TYPES.swordsman.range);
    // Fastest base cadence.
    expect(t.atkSpeed).toBeLessThan(HERO_TYPES.swordsman.atkSpeed);
    expect(t.multiHit).toBe(2);
  });

  it("has a 4-skill kit with the dash-strike signature", () => {
    expect(SIGNATURE_SKILL.ninja).toBe("ninja_dashstrike");
    expect(CLASS_SKILLS.ninja).toEqual([
      "ninja_dashstrike",
      "ninja_twinfang",
      "ninja_massacre",
      "ninja_eternal",
    ]);
    // Kinds reuse the dash primitive / melee mechanics — no new ProjectileKind.
    expect(SKILLS.ninja_dashstrike.kind).toBe("dash");
    expect(SKILLS.ninja_massacre.kind).toBe("chaindash");
    expect(SKILLS.ninja_eternal.tier).toBe(3);
    expect(SKILLS.ninja_eternal.unlockLevel).toBe(40);
  });

  it("wires the ninja evolution tier chain นินจา → จอมนินจา → ราชันเงา", () => {
    expect(evolutionQuestFor("ninja", 1)?.id).toBe("classchange_ninja");
    expect(evolutionQuestFor("ninja", 2)?.id).toBe("tier3_ninja");
    expect(evolutionQuestFor("ninja", 3)).toBeNull();
  });

  it("evolves tier 1 → 2 → 3 once each tier's quest is complete", () => {
    const s = ninjaState(40, 1);
    const h = s.heroes[0];
    // Tier-1 class-change quest complete → evolve to จอมนินจา.
    const q1 = evolutionQuestFor("ninja", 1)!;
    h.quest = { id: q1.id, accepted: true, progress: q1.objectives.map((o) => o.count) } as HeroQuest;
    expect(canEvolveHero(s, h)).toBe(true);
    step(s, { evolveHero: 0 });
    expect(h.tier).toBe(2);
    expect(h.quest).toBeNull();
    // Tier-2 tier-3 quest complete → evolve to ราชันเงา + a 4th auto-slot.
    const q2 = evolutionQuestFor("ninja", 2)!;
    h.quest = { id: q2.id, accepted: true, progress: q2.objectives.map((o) => o.count) } as HeroQuest;
    step(s, { evolveHero: 0 });
    expect(h.tier).toBe(3);
    expect(h.autoSlots.length).toBe(4);
    // Skill 4 is now learned; slot 3 (tier-3-gated) can hold it.
    expect(isSkillLearned(h, SKILLS.ninja_eternal)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dash primitive — deterministic reposition + event.
// ---------------------------------------------------------------------------

describe("dash primitive", () => {
  it("blinks THROUGH a target (far side) and emits heroDashed {heroId, fromX, toX}", () => {
    const s = ninjaState();
    const h = s.heroes[0];
    h.x = 200;
    s.events.length = 0;
    const to = dashHeroTo(s, h, 400);
    expect(to).toBe(400 + CONFIG.ninja.dashLandGap); // approached from the left → land past it
    expect(h.x).toBe(to);
    expect(s.events).toContainEqual({ type: "heroDashed", heroId: h.id, fromX: 200, toX: to });
  });

  it("lands on the near side when approaching from the right", () => {
    const s = ninjaState();
    const h = s.heroes[0];
    h.x = 500;
    expect(dashHeroTo(s, h, 300)).toBe(300 - CONFIG.ninja.dashLandGap);
  });

  it("caps the hop distance at maxReach (short blink)", () => {
    const s = ninjaState();
    const h = s.heroes[0];
    h.x = 100;
    expect(dashHeroTo(s, h, 800, 300)).toBe(400); // hop clamped to +300
  });

  it("clamps the landing to the walkable field (never off-screen)", () => {
    const s = ninjaState();
    const h = s.heroes[0];
    h.x = 800;
    const maxX = 900 - CONFIG.hunt.fieldRightMargin;
    expect(dashHeroTo(s, h, 900)).toBe(maxX);
  });

  it("is deterministic (no RNG draw): identical states → identical landing", () => {
    const a = ninjaState();
    const b = ninjaState();
    a.heroes[0].x = b.heroes[0].x = 250;
    const rng0 = a.rngState;
    const ra = dashHeroTo(a, a.heroes[0], 500);
    const rb = dashHeroTo(b, b.heroes[0], 500);
    expect(ra).toBe(rb);
    expect(a.rngState).toBe(rng0); // the dash never touches the seeded stream
  });
});

// ---------------------------------------------------------------------------
// Skills — damage / mana / cooldown.
// ---------------------------------------------------------------------------

describe("ninja skills", () => {
  it("เงาพริบ (dash-strike): blinks to + strikes one target for ×mult, spends mana, arms cd", () => {
    const s = ninjaState();
    const h = s.heroes[0];
    const def = SKILLS.ninja_dashstrike;
    const e = makeStubEnemy(1, h.x + 100); // within cast range (260)
    s.enemies = [e];
    const expected = Math.round(heroAtkOf(h) * def.mult);
    castOnly(s, def.id);
    expect(e.maxHp - e.hp).toBe(expected);
    expect(eventTypes(s, "heroDashed")).toBe(1);
    expect(h.skillCds[def.id]).toBeCloseTo(def.cd, 5);
    // Mana spent = cost (net of one step's regen, which decayHeroTimers adds first).
    expect(h.mana).toBeLessThanOrEqual(h.maxMana - def.cost + 1);
  });

  it("คมเงาคู่ (twin fang): N hits on the primary + a half-strength r80 splash", () => {
    const s = ninjaState(6); // Lv6 unlock
    const h = s.heroes[0];
    const def = SKILLS.ninja_twinfang;
    const primary = makeStubEnemy(1, h.x + 90); // within range (110)
    const neighbor = makeStubEnemy(2, primary.x + 40); // within the r80 splash
    const faraway = makeStubEnemy(3, h.x + 700); // out of splash + range
    s.enemies = [primary, neighbor, faraway];
    const per = Math.round(heroAtkOf(h) * def.mult);
    castOnly(s, def.id);
    expect(primary.maxHp - primary.hp).toBe(per * def.targets); // 5 rapid hits
    expect(neighbor.maxHp - neighbor.hp).toBe(Math.round(per * CONFIG.ninja.twinSplashFrac));
    expect(faraway.hp).toBe(faraway.maxHp); // untouched
  });

  it("เงาสังหาร (chain-dash ultimate): blinks to + strikes up to `targets` distinct foes", () => {
    const s = ninjaState(15, 2, 20); // tier-2 Lv15, +INT so the pool affords the massacre cost
    const h = s.heroes[0];
    const def = SKILLS.ninja_massacre;
    h.x = 210;
    const foes = [
      makeStubEnemy(1, 250),
      makeStubEnemy(2, 400),
      makeStubEnemy(3, 550),
    ];
    s.enemies = foes;
    const perHit = Math.round(heroAtkOf(h) * def.mult);
    castOnly(s, def.id);
    for (const e of foes) expect(e.maxHp - e.hp).toBe(perHit);
    // One dash per chain hop (3 reachable foes here, ≤ the `targets` cap).
    expect(eventTypes(s, "heroDashed")).toBe(foes.length);
  });

  it("พันเงานิรันดร์ (skill-4): strikes EVERY field target ×mult (no spectacle event)", () => {
    const s = ninjaState(40, 3); // tier-3 Lv40; pool 60+tier3Bonus affords the eternal cost
    const h = s.heroes[0];
    const def = SKILLS.ninja_eternal;
    const foes = [
      makeStubEnemy(1, h.x + 60),
      makeStubEnemy(2, h.x + 300),
      makeStubEnemy(3, h.x + 560),
    ];
    s.enemies = foes;
    const dmg = Math.round(heroAtkOf(h) * def.mult);
    castOnly(s, def.id);
    for (const e of foes) expect(e.maxHp - e.hp).toBe(dmg);
    expect(eventTypes(s, "skillCast")).toBe(1);
    expect(eventTypes(s, "heroDashed")).toBe(1); // blink to the centroid
    expect(h.skillCds[def.id]).toBeCloseTo(def.cd, 5);
  });

  it("guards a cast with no target in range (no mana spent, no cooldown)", () => {
    const s = ninjaState();
    const h = s.heroes[0];
    s.enemies = [makeStubEnemy(1, h.x + 2000)]; // far out of range
    const mana0 = (h.mana = h.maxMana);
    step(s, { castSkills: [{ slot: 0, skillId: "ninja_dashstrike" }] });
    expect(h.skillCds["ninja_dashstrike"] ?? 0).toBe(0);
    expect(h.mana).toBeGreaterThanOrEqual(mana0 - 0.001); // only regen moved it
  });
});

// ---------------------------------------------------------------------------
// Dagger double-hit basic attack.
// ---------------------------------------------------------------------------

describe("ninja double-hit basic attack", () => {
  it("lands 2 strikes per swing at ~55% ATK each (2 hit events)", () => {
    const s = ninjaState();
    const h = s.heroes[0];
    h.cd = 0; // ready to swing
    h.config.autoCast = false;
    const e = makeStubEnemy(1, h.x + 50); // within the dagger reach (70)
    s.enemies = [e];
    const per = Math.round(heroAtkOf(h) * (HERO_TYPES.ninja.multiHitMult ?? 1));
    step(s, {}); // no skills — a pure basic attack
    expect(e.maxHp - e.hp).toBe(per * 2);
    const hits = s.events.filter(
      (ev) => ev.type === "hit" && ev.id === e.id && ev.source === "attack",
    );
    expect(hits.length).toBe(2);
  });

  it("the swordsman's single-strike melee is unchanged (byte-identical path)", () => {
    const s = initGameState(7, soloSave("swordsman", 1));
    const h = s.heroes[0];
    h.cd = 0;
    h.config.autoCast = false;
    s.spawnPaused = true;
    s.spawnBurst = false;
    const e = makeStubEnemy(1, h.x + 50);
    s.enemies = [e];
    const dmg = heroAtkOf(h);
    step(s, {});
    expect(e.maxHp - e.hp).toBe(dmg); // one full-damage strike
    const hits = s.events.filter((ev) => ev.type === "hit" && ev.id === e.id);
    expect(hits.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SAVE v17 → v18 domain widening.
// ---------------------------------------------------------------------------

describe("SAVE v18 ninja migration", () => {
  it("bumps to 18 and loads an old v17 (non-ninja) save unchanged", () => {
    const m = migrate({
      version: 17,
      stage: 8,
      gold: 4200,
      hero: { cls: "archer", level: 22, xp: 5, tier: 2 },
      lastSeen: 0,
    });
    expect(m.version).toBe(18);
    expect(m.hero.cls).toBe("archer"); // domain widening — the old class is untouched
    expect(m.hero.level).toBe(22);
    expect(m.hero.tier).toBe(2);
  });

  it("preserves a genuine ninja class (never coerces it to swordsman)", () => {
    const save = soloSave("ninja", 4);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.hero.cls).toBe("ninja");
    // A v18 ninja save round-trips through migrate() unchanged.
    const again = migrate(save);
    expect(again.hero.cls).toBe("ninja");
    // …and through a live-state round-trip (initGameState → toSaveData).
    const st = initGameState(9, save);
    expect(st.heroes[0].cls).toBe("ninja");
    expect(toSaveData(st).hero.cls).toBe("ninja");
  });
});

// ---------------------------------------------------------------------------
// World-boss lifetime rider — the despawn clock ticks while traveling.
// ---------------------------------------------------------------------------

describe("world boss lifetime while traveling", () => {
  const seatBoss = (s: GameState, wid: number, remainingSeconds: number): void => {
    const loc = worldBossLocationFor(wid)!;
    s.location = { mapId: loc.mapId, zoneIdx: loc.zoneIdx };
    s.stage = zoneAt(loc).stage;
    s.phase = "battle";
    s.unlockedZones = { ...s.unlockedZones, map1: 6 };
    s.spawnPaused = true;
    s.spawnBurst = false;
    s.enemies = [];
    step(s, { spawnWorldBoss: { windowId: wid, remainingSeconds } });
  };
  const adjacentZone = (zoneIdx: number): { mapId: string; zoneIdx: number } => ({
    mapId: "map1",
    zoneIdx: zoneIdx > 0 ? zoneIdx - 1 : zoneIdx + 1,
  });

  it("keeps ticking the lifetime countdown down mid-transit", () => {
    const wid = 21;
    const s = initGameState(3, soloSave("swordsman", 1));
    seatBoss(s, wid, 900);
    expect(s.worldBoss?.active).toBe(true);
    const c0 = s.worldBoss!.countdown;
    // Start a walk to an adjacent zone (a long-ish transit), then idle-step while traveling.
    step(s, { walkToZone: adjacentZone(s.location.zoneIdx) });
    step(s, {});
    step(s, {});
    expect(s.traveling).not.toBeNull(); // still mid-walk
    expect(s.worldBoss?.active).toBe(true);
    // Previously the transit early-return SKIPPED updateWorldBossAI, freezing the clock.
    expect(s.worldBoss!.countdown).toBeCloseTo(c0 - 3 * FIXED_DT, 5);
  });

  it("despawns mid-travel when the lifetime expires (not paused by travel)", () => {
    const wid = 22;
    const s = initGameState(4, soloSave("swordsman", 1));
    seatBoss(s, wid, 0.05); // ~3 steps of lifetime
    step(s, { walkToZone: adjacentZone(s.location.zoneIdx) }); // begin a ~0.6s transit
    let despawnedWhileTraveling = false;
    for (let i = 0; i < 6; i++) {
      step(s, {});
      if (s.traveling && eventTypes(s, "worldBossDespawned")) despawnedWhileTraveling = true;
    }
    expect(despawnedWhileTraveling).toBe(true);
    expect(s.worldBoss?.active).toBe(false);
    expect(s.worldBoss?.defeated).toBe(false);
  });
});

describe("dagger drop gating — end-to-end through step()'s kill path", () => {
  /** Force `n` one-shot stub kills and collect every itemDrop templateId. */
  const farmDrops = (cls: "ninja" | "swordsman", n: number): string[] => {
    const s = initGameState(4242, soloSave(cls, 3));
    s.spawnPaused = true;
    const ids: string[] = [];
    for (let k = 0; k < n; k++) {
      s.enemies = [makeStubEnemy(5000 + k, s.heroes[0].x + 5, 1)];
      s.heroes[0].cd = 0;
      step(s, {});
      for (const e of s.events) if (e.type === "itemDrop") ids.push(e.templateId);
    }
    return ids;
  };

  it("a solo ninja actually ROLLS daggers via rollEnemyDrop (roll sites pass the roster class)", () => {
    const ids = farmDrops("ninja", 800);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((id) => id.startsWith("w_dagger_"))).toBe(true);
  });

  it("a solo non-ninja NEVER rolls a dagger through the same path", () => {
    const ids = farmDrops("swordsman", 800);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((id) => id.startsWith("w_dagger_"))).toBe(false);
  });
});
