import { describe, it, expect } from "vitest";
import {
  CONFIG,
  FIXED_DT,
  ITEM_TEMPLATES,
  MAX_TIER,
  bossDropTableForStage,
  dropTableForStage,
  frontHeroX,
  initGameState,
  makeBoss,
  refinedStat,
  step,
  tierForStage,
  vendorPriceForTemplate,
  type GameEvent,
  type GameState,
  type HeroClass,
  type ItemTemplate,
} from "@/engine";
import { soloSave, forceBoss } from "./helpers";

/**
 * M7.9 "Grand Expansion" — gear tiers t7-t10 + boss behavior variety (engine).
 *
 * Locks the new gear band structure (drop tables, monotonic prices, refine math at
 * the t10 ceiling) and the three new boss mechanics (charge / summon / hazard),
 * asserting they are deterministic (no RNG) and that s1-15 boss fights are
 * unchanged (only Slam + Enrage, no new event ever fires).
 */

// ---------------------------------------------------------------------------
// Gear tiers t7-t10
// ---------------------------------------------------------------------------

describe("M7.9 gear tiers 7-10", () => {
  it("MAX_TIER is 10 and every tier 7-10 has a catalog", () => {
    expect(MAX_TIER).toBe(10);
    for (let t = 7; t <= 10; t++) {
      const inTier = Object.values(ITEM_TEMPLATES).filter((x) => x.tier === t);
      // per-class weapon (3) + universal armor (1) at minimum.
      expect(inTier.length, `tier ${t} templates`).toBeGreaterThanOrEqual(4);
      const weapons = inTier.filter((x) => x.slot === "weapon");
      const classes = new Set(weapons.map((w) => w.classReq));
      expect(classes).toEqual(new Set(["swordsman", "archer", "mage"]));
      expect(inTier.some((x) => x.slot === "armor" && x.classReq === null)).toBe(true);
    }
  });

  it("tierForStage bands extend to s30 exactly per the spec", () => {
    for (let s = 16; s <= 18; s++) expect(tierForStage(s)).toBe(7);
    for (let s = 19; s <= 22; s++) expect(tierForStage(s)).toBe(8);
    for (let s = 23; s <= 26; s++) expect(tierForStage(s)).toBe(9);
    for (let s = 27; s <= 30; s++) expect(tierForStage(s)).toBe(10);
    // s1-15 bands unchanged.
    expect(tierForStage(15)).toBe(6);
  });

  it("every s16-30 farm drop entry references a real template of the on-curve tier", () => {
    for (let s = 16; s <= 30; s++) {
      const tier = tierForStage(s);
      const table = dropTableForStage(s);
      expect(table.length).toBeGreaterThan(0);
      for (const e of table) {
        const t = ITEM_TEMPLATES[e.templateId];
        expect(t, `${e.templateId}`).toBeDefined();
        expect(t.tier).toBe(tier);
        expect(e.chance).toBeGreaterThan(0);
      }
    }
  });

  it("boss drop pools include the NEXT tier up (capped at 10)", () => {
    // s20 (tier 8) boss seeds tier 9; s30 (tier 10) boss stays tier 10 (ceiling).
    const t20 = new Set(bossDropTableForStage(20).map((e) => ITEM_TEMPLATES[e.templateId].tier));
    expect(t20.has(8)).toBe(true);
    expect(t20.has(9)).toBe(true);
    const t30 = new Set(bossDropTableForStage(30).map((e) => ITEM_TEMPLATES[e.templateId].tier));
    expect(t30).toEqual(new Set([10]));
  });

  it("weapon ATK + armor stats rise every tier; vendor price rises within a rarity", () => {
    const byTier = (slot: "weapon" | "armor", cls: string | null) =>
      [...Array(10)].map((_, i) => {
        const tier = i + 1;
        return Object.values(ITEM_TEMPLATES).find(
          (x) => x.slot === slot && x.tier === tier && x.classReq === cls,
        );
      });
    const swordWeapons = byTier("weapon", "swordsman") as ItemTemplate[];
    for (let i = 1; i < swordWeapons.length; i++) {
      // Raw ATK is strictly monotonic in tier.
      expect(swordWeapons[i].stats.atk!).toBeGreaterThan(swordWeapons[i - 1].stats.atk!);
    }
    // Vendor price = tier² × rarityMult — monotonic in tier for a FIXED rarity (a rare
    // t7 can undercut the epic t6 by design, which is fine), and the epic t10 is the
    // priciest weapon of the class (the endgame ceiling reward).
    const rareWeapons = swordWeapons.filter((w) => w.rarity === "rare");
    for (let i = 1; i < rareWeapons.length; i++) {
      expect(vendorPriceForTemplate(rareWeapons[i].id)).toBeGreaterThan(
        vendorPriceForTemplate(rareWeapons[i - 1].id),
      );
    }
    const maxPrice = Math.max(...swordWeapons.map((w) => vendorPriceForTemplate(w.id)));
    expect(vendorPriceForTemplate(swordWeapons[9].id)).toBe(maxPrice); // t10 is the max
    const uniArmor = byTier("armor", null) as ItemTemplate[];
    for (let i = 1; i < uniArmor.length; i++) {
      expect(uniArmor[i].stats.def!).toBeGreaterThan(uniArmor[i - 1].stats.def!);
      expect(uniArmor[i].stats.hp!).toBeGreaterThan(uniArmor[i - 1].stats.hp!);
    }
  });

  it("refine math holds at the t10 ceiling (base×(1+N×8%))", () => {
    const t10weapon = Object.values(ITEM_TEMPLATES).find(
      (x) => x.slot === "weapon" && x.tier === 10 && x.classReq === "swordsman",
    )!;
    const base = t10weapon.stats.atk!;
    expect(base).toBe(70);
    expect(refinedStat(base, 0)).toBe(70); // +0 unchanged
    expect(refinedStat(base, 10)).toBe(Math.round(70 * 1.8)); // +10 endgame ceiling = 126
    // Strictly increasing per +level.
    for (let n = 1; n <= 10; n++) {
      expect(refinedStat(base, n)).toBeGreaterThan(refinedStat(base, n - 1));
    }
  });
});

// ---------------------------------------------------------------------------
// Boss behavior variety — shared setup
// ---------------------------------------------------------------------------

/** Force a boss fight at `stage` with the boss placed at engage range + tanky. */
function engageAt(stage: number, seed = 1, cls: HeroClass = "swordsman"): GameState {
  const s = initGameState(seed, soloSave(cls, stage));
  forceBoss(s);
  s.boss!.x = frontHeroX(s) + CONFIG.clash + CONFIG.boss.engageExtra;
  s.boss!.maxHp = 1e9;
  s.boss!.hp = 1e9;
  // Tanky, muted heroes so the fight doesn't end and hero offense doesn't perturb
  // add/boss counts. HP is huge so incidental hazard/charge damage never wipes.
  for (const h of s.heroes) {
    h.maxHp = 1e9;
    h.hp = 1e9;
  }
  return s;
}

/** Mute the solo hero's offense this step (basic + skills) so counts stay exact. */
function muteHero(s: GameState): void {
  s.heroes[0].cd = 999;
  s.heroes[0].mana = 0;
}

const varietyEvents = (s: GameState): GameEvent["type"][] =>
  s.events
    .map((e) => e.type)
    .filter((t) => t.startsWith("bossCharge") || t.startsWith("bossSummon") || t.startsWith("bossHazard"));

// ---------------------------------------------------------------------------
// CHARGE (map4 s20)
// ---------------------------------------------------------------------------

describe("M7.9 boss CHARGE (map4 s20)", () => {
  it("telegraphs, dashes toward the hero, and lands a heavy hit", () => {
    // Use a MAGE: a ranged hero holds a standoff (doesn't close to melee), so the
    // charge dash is a real long lunge across the arena (a melee hero would already
    // be adjacent, making the dash degenerate — a valid but untestable case).
    const s = engageAt(20, 1, "mage");
    const b = s.boss!;
    b.skillCd = 1e9; // isolate: no slam
    b.cd = 1e9; // isolate: no normal attack
    b.variety!.chargeCd = FIXED_DT / 2; // launch a charge immediately
    const startX = b.x;
    const hero = s.heroes[0];

    let sawTelegraph = false;
    let sawHit = false;
    let minBossX = startX;
    for (let i = 0; i < 200 && !sawHit; i++) {
      muteHero(s);
      const hpBefore = hero.hp;
      step(s, {});
      minBossX = Math.min(minBossX, s.boss!.x);
      for (const e of s.events) {
        if (e.type === "bossChargeTelegraph") {
          sawTelegraph = true;
          expect(e.targetX).toBeLessThan(startX); // rush toward the hero (lower x)
        }
        if (e.type === "bossChargeHit") {
          sawHit = true;
          expect(e.connected).toBe(true);
          expect(hero.hp).toBeLessThan(hpBefore); // heavy hit landed
        }
      }
    }
    expect(sawTelegraph).toBe(true);
    expect(sawHit).toBe(true);
    // The boss lunged toward the hero (the left-anchored arena keeps the absolute
    // distance modest, but it is a real forward dash, not a stationary hit).
    expect(minBossX).toBeLessThan(startX - 20);
  });

  it("is deterministic across seeds (no RNG in the boss phase)", () => {
    const run = (seed: number): GameEvent["type"][] => {
      const s = engageAt(20, seed);
      s.boss!.skillCd = 1e9;
      s.boss!.cd = 1e9;
      s.boss!.variety!.chargeCd = FIXED_DT / 2;
      const stream: GameEvent["type"][] = [];
      for (let i = 0; i < 240; i++) {
        muteHero(s);
        step(s, {});
        stream.push(...varietyEvents(s));
      }
      return stream;
    };
    expect(run(1)).toEqual(run(9999));
  });
});

// ---------------------------------------------------------------------------
// SUMMON (map5 s25)
// ---------------------------------------------------------------------------

describe("M7.9 boss SUMMON (map5 s25)", () => {
  it("spawns fixed add waves at HP thresholds and they flow through the enemy list", () => {
    const s = engageAt(25);
    const b = s.boss!;
    b.skillCd = 1e9;
    b.cd = 1e9;
    const S = CONFIG.bossBehavior.summon;
    expect(s.enemies.length).toBe(0);

    // Drop below the FIRST threshold -> one wave spawns.
    b.hp = b.maxHp * (S.thresholds[0] - 0.01);
    muteHero(s);
    step(s, {});
    expect(s.enemies.length).toBe(S.addKinds.length);
    expect(s.events.some((e) => e.type === "bossSummon")).toBe(true);
    expect(b.variety!.summonsFired).toBe(1);
    // Adds are engaged-on-spawn (immediately hunt the hero).
    expect(s.enemies.every((e) => e.engaged)).toBe(true);

    // M7.9 s16-30 rebalance (docs/balance-m79.md): summon is now a SINGLE mid-fight wave
    // (thresholds trimmed [0.6,0.3] → [0.45], addKinds ["fast","normal"] → ["normal"]) so
    // the squishy single-target archer isn't overwhelmed during its long s25 kill. Assert
    // that dropping further does NOT fire a second wave (only one threshold exists).
    expect(S.thresholds.length).toBe(1);
    b.hp = b.maxHp * 0.05;
    muteHero(s);
    step(s, {});
    expect(s.enemies.length).toBe(S.addKinds.length);
    expect(b.variety!.summonsFired).toBe(1);
  });

  it("summoned adds despawn when killed (reaped in the boss phase) and on boss death", () => {
    const s = engageAt(25);
    const b = s.boss!;
    b.skillCd = 1e9;
    b.cd = 1e9;
    b.hp = b.maxHp * 0.1; // below every threshold -> all waves fire over steps
    muteHero(s);
    step(s, {});
    const spawned = s.enemies.length;
    expect(spawned).toBeGreaterThan(0);

    // Kill one add -> resolveDeaths reaps it during the boss phase (+ a kill event).
    s.enemies[0].hp = 0;
    muteHero(s);
    step(s, {});
    expect(s.enemies.length).toBe(spawned - 1);
    expect(s.events.some((e) => e.type === "kill")).toBe(true);

    // Kill the boss -> victory clears any surviving adds (render frees the views).
    s.boss!.hp = 0;
    muteHero(s);
    step(s, {});
    expect(s.boss).toBeNull();
    expect(s.enemies.length).toBe(0);
    expect(s.phase).toBe("victory");
  });
});

// ---------------------------------------------------------------------------
// FIELD HAZARD (map6 s30)
// ---------------------------------------------------------------------------

describe("M7.9 boss FIELD HAZARD (map6 s30)", () => {
  it("telegraphs an arena-wide window then ticks damage to every alive hero", () => {
    const s = engageAt(30);
    const b = s.boss!;
    b.skillCd = 1e9; // isolate: no slam
    b.cd = 1e9; // isolate: no normal attack
    b.variety!.hazardCd = FIXED_DT / 2; // channel a hazard immediately
    const hero = s.heroes[0];

    let sawWarn = false;
    let sawStrike = false;
    for (let i = 0; i < 200 && !sawStrike; i++) {
      muteHero(s);
      const hpBefore = hero.hp;
      step(s, {});
      for (const e of s.events) {
        if (e.type === "bossHazardWarn") sawWarn = true;
        if (e.type === "bossHazardStrike") {
          sawStrike = true;
          expect(sawWarn).toBe(true); // warn always precedes the strike
          expect(hero.hp).toBeLessThan(hpBefore); // arena-wide tick hit the hero
        }
      }
    }
    expect(sawWarn).toBe(true);
    expect(sawStrike).toBe(true);
  });

  it("is deterministic across seeds", () => {
    const run = (seed: number): GameEvent["type"][] => {
      const s = engageAt(30, seed);
      s.boss!.skillCd = 1e9;
      s.boss!.cd = 1e9;
      s.boss!.variety!.hazardCd = FIXED_DT / 2;
      const stream: GameEvent["type"][] = [];
      for (let i = 0; i < 200; i++) {
        muteHero(s);
        step(s, {});
        stream.push(...varietyEvents(s));
      }
      return stream;
    };
    expect(run(2)).toEqual(run(4242));
  });
});

// ---------------------------------------------------------------------------
// s1-15 old-boss regression
// ---------------------------------------------------------------------------

describe("M7.9 does not touch the old bosses (s5/s10/s15)", () => {
  for (const stage of [5, 10, 15]) {
    it(`s${stage} boss carries only slam+enrage and never fires a new mechanic`, () => {
      const boss = makeBoss(1, stage);
      expect(boss.variety?.behaviors).toEqual(["slam", "enrage"]);

      const s = engageAt(stage);
      // Let the fight run naturally (heroes NOT muted here — this exercises the real
      // classic path); the boss stays alive (1e9 hp). No new-mechanic event may fire.
      let sawNew = false;
      for (let i = 0; i < 600; i++) {
        step(s, {});
        if (varietyEvents(s).length) sawNew = true;
        // Classic bosses never summon adds during the fight.
        expect(s.enemies.length).toBe(0);
      }
      expect(sawNew).toBe(false);
    });
  }
});
