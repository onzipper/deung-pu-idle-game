import { describe, it, expect } from "vitest";
import {
  initGameState,
  step,
  migrate,
  toSaveData,
  canEvolveHero,
  classChangeQuestFor,
  heroAtk,
  heroMaxHp,
  CONFIG,
  SAVE_VERSION,
  SIGNATURE_SKILL,
  type GameState,
  type Hero,
} from "@/engine";
import { clone } from "./helpers";

/**
 * M5 "Class advancement / evolution (ปลดคลาสใหม่)" (86d3jv7m3), task-5 gate:
 * the class change is now triggered by COMPLETING the class-change quest (the old
 * gold cost is gone — quest EFFORT replaced it). This suite covers the evolve
 * intent itself; the quest mechanics (offer/accept/counting) live in quests.test.ts.
 */

const EV = CONFIG.evolution;

/** Seat a COMPLETED class-change quest on the hero (all objectives satisfied). */
function completeQuest(hero: Hero): void {
  const def = classChangeQuestFor(hero.cls);
  hero.quest = { id: def.id, accepted: true, progress: def.objectives.map((o) => o.count) };
}

/** Put a hero at the class-change requirement (level gate + completed quest). */
function readyHero(s: GameState, idx = 0): void {
  s.heroes[idx].level = EV.levelRequired;
  completeQuest(s.heroes[idx]);
}

describe("evolution requirements (quest-gated)", () => {
  it("canEvolveHero is false until the class-change quest is complete", () => {
    const s = initGameState(1);
    const h = s.heroes[0];
    // Fresh hero: tier 1, no quest.
    expect(canEvolveHero(s, h)).toBe(false);
    // Level met but no quest yet.
    h.level = EV.levelRequired;
    expect(canEvolveHero(s, h)).toBe(false);
    // Quest accepted but not yet complete.
    const def = classChangeQuestFor(h.cls);
    h.quest = { id: def.id, accepted: true, progress: def.objectives.map(() => 0) };
    expect(canEvolveHero(s, h)).toBe(false);
    // Quest complete -> may evolve.
    completeQuest(h);
    expect(canEvolveHero(s, h)).toBe(true);
  });

  it("does NOT require gold (the old gold gate is removed)", () => {
    const s = initGameState(1);
    readyHero(s);
    s.gold = 0; // no gold at all
    step(s, { evolveHero: 0 });
    expect(s.heroes[0].tier).toBe(2);
    expect(s.gold).toBe(0); // nothing spent
  });
});

describe("evolveHero intent", () => {
  it("applies exactly once per click and flips to tier 2, consuming the quest", () => {
    const s = initGameState(1);
    readyHero(s);
    step(s, { evolveHero: 0 });
    expect(s.heroes[0].tier).toBe(2);
    expect(s.heroes[0].quest).toBeNull(); // consumed by the class change
  });

  it("is a no-op when the quest is incomplete (stays tier 1)", () => {
    const s = initGameState(1);
    const h = s.heroes[0];
    h.level = EV.levelRequired;
    const def = classChangeQuestFor(h.cls);
    h.quest = { id: def.id, accepted: true, progress: def.objectives.map(() => 0) };
    step(s, { evolveHero: 0 });
    expect(h.tier).toBe(1);
    expect(h.quest).not.toBeNull(); // quest untouched
  });

  it("is a no-op for an already-evolved (tier 2) hero — no re-trigger", () => {
    const s = initGameState(1);
    readyHero(s);
    step(s, { evolveHero: 0 });
    expect(s.heroes[0].tier).toBe(2);
    // Even if we (illegally) re-seat a completed quest, a tier-2 hero can't re-evolve.
    completeQuest(s.heroes[0]);
    step(s, { evolveHero: 0 });
    expect(s.heroes[0].tier).toBe(2);
  });

  it("ignores an out-of-range slot index", () => {
    const s = initGameState(1);
    readyHero(s);
    step(s, { evolveHero: 99 });
    expect(s.heroes[0].tier).toBe(1);
  });
});

describe("evolution stat multipliers", () => {
  it("tier 2 raises atk and maxHp by the configured multipliers, compounding with level", () => {
    const s = initGameState(1);
    const h = s.heroes[0];
    h.level = EV.levelRequired;
    h.maxHp = heroMaxHp(h.cls, h.level, 1);
    const atkBefore = heroAtk(h.cls, h.level, 1);
    const maxHpBefore = heroMaxHp(h.cls, h.level, 1);

    completeQuest(h);
    step(s, { evolveHero: 0 });

    const atkAfter = heroAtk(h.cls, h.level, h.tier);
    expect(atkAfter).toBe(heroAtk(h.cls, h.level, 2));
    expect(atkAfter).toBeGreaterThan(atkBefore);
    expect(atkAfter / atkBefore).toBeCloseTo(EV.atkMult, 1);
    expect(h.maxHp).toBe(heroMaxHp(h.cls, h.level, 2));
    expect(h.maxHp).toBeGreaterThan(maxHpBefore);
    expect(h.maxHp / maxHpBefore).toBeCloseTo(EV.hpMult, 2);
  });

  it("heals by the added HP headroom on evolve", () => {
    const s = initGameState(1);
    const h = s.heroes[0];
    h.level = EV.levelRequired;
    h.hp = h.maxHp; // full before
    const maxBefore = h.maxHp;
    completeQuest(h);
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
    step(s, { evolveHero: 0 }); // fresh hero, no quest
    expect(s.events.some((e) => e.type === "evolve")).toBe(false);
  });
});

describe("evolution persistence", () => {
  it("round-trips tier through toSaveData -> initGameState with restored maxHp + null quest", () => {
    const s = initGameState(1);
    readyHero(s);
    step(s, { evolveHero: 0 });
    expect(s.heroes[0].tier).toBe(2);

    const save = toSaveData(s);
    expect(save.hero.tier).toBe(2);
    expect(save.hero.quest).toBeNull();

    const restored = initGameState(42, save);
    expect(restored.heroes[0].tier).toBe(2);
    expect(restored.heroes[0].quest).toBeNull();
    expect(restored.heroes[0].maxHp).toBe(
      heroMaxHp(restored.heroes[0].cls, restored.heroes[0].level, 2),
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

describe("migrate pre-v4 tier handling", () => {
  it("carries the adopted hero's tier through the v2-team -> v7 collapse (quest null)", () => {
    const v2 = {
      version: 2,
      stage: 4,
      gold: 100,
      unlocked: ["swordsman", "archer"],
      upgrades: { atk: 2, speed: 1, hp: 0 },
      heroes: [
        { level: 3, xp: 7 }, // no tier -> defaults to 1
        { level: 5, xp: 1 }, // highest level -> adopted
      ],
      lastSeen: 0,
    };
    const v7 = migrate(v2);
    expect(v7.version).toBe(SAVE_VERSION);
    expect(v7.hero).toEqual({
      cls: "archer",
      level: 5,
      xp: 1,
      tier: 1,
      statPoints: 5 * CONFIG.stats.pointsPerLevel,
      stats: { ...CONFIG.stats.base.archer },
      mana: CONFIG.mana.base,
      autoSlots: [SIGNATURE_SKILL.archer, null, null],
      quest: null,
      mainClaimed: [],
      dailies: { serverDay: 0, quests: [] },
    });
  });

  it("preserves an existing tier 2 on the adopted hero (quest null)", () => {
    const v3 = {
      version: 3,
      unlocked: ["swordsman"],
      heroes: [{ level: 9, xp: 2, tier: 2 as const }],
    };
    const v7 = migrate(v3);
    expect(v7.hero).toEqual({
      cls: "swordsman",
      level: 9,
      xp: 2,
      tier: 2,
      statPoints: 9 * CONFIG.stats.pointsPerLevel,
      stats: { ...CONFIG.stats.base.swordsman },
      mana: CONFIG.mana.base,
      autoSlots: [SIGNATURE_SKILL.swordsman, null, null],
      quest: null,
      mainClaimed: [],
      dailies: { serverDay: 0, quests: [] },
    });
    expect(migrate(v7)).toEqual(v7);
  });
});

describe("determinism with evolution in the run", () => {
  it("a byte-identical clone advances identically when evolution fires", () => {
    const a = initGameState(777);
    a.heroes[0].level = EV.levelRequired;
    completeQuest(a.heroes[0]);
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
