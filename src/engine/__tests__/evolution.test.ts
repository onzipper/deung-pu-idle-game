import { describe, it, expect } from "vitest";
import {
  initGameState,
  step,
  migrate,
  toSaveData,
  canEvolveHero,
  evolutionCost,
  heroAtk,
  heroMaxHp,
  CONFIG,
  SAVE_VERSION,
  type GameState,
} from "@/engine";
import { clone } from "./helpers";

/**
 * M5 "Class advancement / evolution (ปลดคลาสใหม่)" (86d3jv7m3).
 *
 * Player-triggered per-hero tier upgrade: level + gold gate, one-shot flip to
 * tier 2, permanent atk/hp multiplier that compounds with upgrades + levels, an
 * `evolve` event, and a v2->v3 save migration. All deterministic (no RNG).
 */

const EV = CONFIG.evolution;

/** Put a hero at/above the evolution level+gold requirement. */
function readyHero(s: GameState, idx = 0): void {
  s.heroes[idx].level = EV.levelRequired;
  s.gold = evolutionCost(s.heroes[idx].cls) + 1;
}

describe("evolution requirements", () => {
  it("canEvolveHero is false until BOTH level and gold gates are met", () => {
    const s = initGameState(1);
    const h = s.heroes[0];
    // Fresh hero: level 1, no gold.
    expect(canEvolveHero(s, h)).toBe(false);
    // Level met, gold short.
    h.level = EV.levelRequired;
    s.gold = evolutionCost(h.cls) - 1;
    expect(canEvolveHero(s, h)).toBe(false);
    // Gold met, level short.
    h.level = EV.levelRequired - 1;
    s.gold = evolutionCost(h.cls);
    expect(canEvolveHero(s, h)).toBe(false);
    // Both met.
    h.level = EV.levelRequired;
    expect(canEvolveHero(s, h)).toBe(true);
  });

  it("cost scales by class unlock index", () => {
    expect(evolutionCost("archer")).toBeGreaterThan(evolutionCost("swordsman"));
    expect(evolutionCost("mage")).toBeGreaterThan(evolutionCost("archer"));
  });
});

describe("evolveHero intent", () => {
  it("applies exactly once per click and spends the cost, flipping to tier 2", () => {
    const s = initGameState(1);
    readyHero(s);
    const cost = evolutionCost(s.heroes[0].cls);
    const goldBefore = s.gold;

    step(s, { evolveHero: 0 });
    expect(s.heroes[0].tier).toBe(2);
    expect(s.gold).toBe(goldBefore - cost);
  });

  it("is a no-op when requirements are unmet (no gold spent, stays tier 1)", () => {
    const s = initGameState(1);
    // Level met but gold short.
    s.heroes[0].level = EV.levelRequired;
    s.gold = evolutionCost(s.heroes[0].cls) - 1;
    const goldBefore = s.gold;
    step(s, { evolveHero: 0 });
    expect(s.heroes[0].tier).toBe(1);
    expect(s.gold).toBe(goldBefore);
  });

  it("is a no-op for an already-evolved (tier 2) hero — no double spend", () => {
    const s = initGameState(1);
    readyHero(s);
    step(s, { evolveHero: 0 });
    const goldAfterFirst = s.gold;
    // Refund enough that a second evolve WOULD be affordable if it were allowed.
    s.gold = evolutionCost(s.heroes[0].cls) + 100;
    step(s, { evolveHero: 0 });
    expect(s.heroes[0].tier).toBe(2);
    expect(s.gold).toBe(evolutionCost(s.heroes[0].cls) + 100); // untouched
    expect(goldAfterFirst).toBeGreaterThanOrEqual(0);
  });

  it("ignores an out-of-range slot index", () => {
    const s = initGameState(1);
    readyHero(s);
    const goldBefore = s.gold;
    step(s, { evolveHero: 99 });
    expect(s.gold).toBe(goldBefore);
    expect(s.heroes[0].tier).toBe(1);
  });
});

describe("evolution stat multipliers", () => {
  it("tier 2 raises atk and maxHp by the configured multipliers, compounding with level/upgrades", () => {
    const s = initGameState(1);
    s.upgrades = { atk: 8, speed: 0, hp: 8 };
    const h = s.heroes[0];
    h.level = EV.levelRequired;
    h.maxHp = heroMaxHp(s.upgrades, h.level, 1);
    const atkBefore = heroAtk(h.cls, s.upgrades, h.level, 1);
    const maxHpBefore = heroMaxHp(s.upgrades, h.level, 1);

    s.gold = evolutionCost(h.cls);
    step(s, { evolveHero: 0 });

    const atkAfter = heroAtk(h.cls, s.upgrades, h.level, h.tier);
    expect(atkAfter).toBe(Math.round(atkBefore * EV.atkMult));
    expect(h.maxHp).toBe(Math.round(maxHpBefore * EV.hpMult));
    // maxHp actually grew (hpMult > 1) and the hero was healed by the headroom.
    expect(h.maxHp).toBeGreaterThan(maxHpBefore);
  });

  it("heals by the added HP headroom on evolve", () => {
    const s = initGameState(1);
    const h = s.heroes[0];
    h.level = EV.levelRequired;
    h.hp = h.maxHp; // full before
    const maxBefore = h.maxHp;
    s.gold = evolutionCost(h.cls);
    step(s, { evolveHero: 0 });
    const gained = h.maxHp - maxBefore;
    expect(gained).toBeGreaterThan(0);
    expect(h.hp).toBe(maxBefore + gained); // healed by exactly the headroom
  });
});

describe("evolve event", () => {
  it("emits a single evolve event carrying id/cls/tier", () => {
    const s = initGameState(1);
    readyHero(s);
    step(s, { evolveHero: 0 });
    const evts = s.events.filter((e) => e.type === "evolve");
    expect(evts.length).toBe(1);
    const e = evts[0];
    if (e.type !== "evolve") throw new Error("unreachable");
    expect(e.id).toBe(s.heroes[0].id);
    expect(e.cls).toBe(s.heroes[0].cls);
    expect(e.tier).toBe(2);
  });

  it("emits nothing on a rejected evolve", () => {
    const s = initGameState(1);
    step(s, { evolveHero: 0 }); // fresh hero, unmet
    expect(s.events.some((e) => e.type === "evolve")).toBe(false);
  });
});

describe("evolution persistence", () => {
  it("round-trips tier through toSaveData -> initGameState with restored maxHp", () => {
    const s = initGameState(1);
    readyHero(s);
    step(s, { evolveHero: 0 });
    expect(s.heroes[0].tier).toBe(2);

    const save = toSaveData(s);
    expect(save.heroes[0].tier).toBe(2);

    const restored = initGameState(42, save);
    expect(restored.heroes[0].tier).toBe(2);
    expect(restored.heroes[0].maxHp).toBe(
      heroMaxHp(restored.upgrades, restored.heroes[0].level, 2),
    );
  });

  it("preserves tier across a stage reset (nextStage rebuild)", () => {
    const s = initGameState(1);
    readyHero(s);
    step(s, { evolveHero: 0 });
    s.phase = "victory";
    step(s, { advanceStage: true });
    expect(s.heroes[0].tier).toBe(2);
  });
});

describe("migrate v2 -> v3", () => {
  it("defaults tier 1 for a v2 save that has heroes but no tier", () => {
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
    const v3 = migrate(v2);
    expect(v3.version).toBe(SAVE_VERSION);
    expect(v3.heroes).toEqual([
      { level: 3, xp: 7, tier: 1 },
      { level: 5, xp: 1, tier: 1 },
    ]);
  });

  it("preserves an existing tier 2 (idempotent for v3)", () => {
    const heroes = [{ level: 9, xp: 2, tier: 2 as const }];
    const once = migrate({ version: SAVE_VERSION, unlocked: ["swordsman"], heroes });
    expect(once.heroes).toEqual(heroes);
    expect(migrate(once)).toEqual(once);
  });
});

describe("determinism with evolution in the run", () => {
  it("a byte-identical clone advances identically when evolution fires", () => {
    const a = initGameState(777);
    // Bring the swordsman to the gate and evolve mid-run.
    a.heroes[0].level = EV.levelRequired;
    a.gold = evolutionCost(a.heroes[0].cls) + 50;
    step(a, { evolveHero: 0 });
    expect(a.heroes[0].tier).toBe(2);

    const b = clone(a);
    for (let i = 0; i < 3000; i++) {
      step(a, {});
      step(b, {});
    }
    expect(a.heroes.map((h) => [h.level, h.xp, h.tier])).toEqual(
      b.heroes.map((h) => [h.level, h.xp, h.tier]),
    );
    expect(a.gold).toBe(b.gold);
    expect(a.rngState).toBe(b.rngState);
  });
});
