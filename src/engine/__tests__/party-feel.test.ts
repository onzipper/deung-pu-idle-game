import { describe, it, expect } from "vitest";
import {
  CONFIG,
  initGameState,
  makeHero,
  makeBoss,
  classChangeQuestId,
  tier3QuestId,
  isQuestBossFight,
  isClassChangeBossFight,
} from "@/engine";
import type { GameState, HeroClass } from "@/engine";
import { updateHeroes } from "@/engine/systems/combat";
import { startBossFight } from "@/engine/systems/boss";
import { makeStubEnemy, soloSave } from "./helpers";

/**
 * M8 "party feel pack" (owner 2026-07-08) — the three cohort flags closed:
 *  1. auto-hunt TARGET-SPREAD (each hero prefers the nearest UNCLAIMED farm mob) + the
 *     owner boss rule "แต่มีบอส ทุกคนต้องรุม" (a boss = whole-party dog-pile, exempt from spread).
 *  2. QUEST-boss HP headcount scaling (evolution exams don't melt to a party; STAGE bosses do).
 *  3. the +10%-per-additional-member xp buff formula.
 */

/** N heroes of `cls` at the given x positions, in a fresh battle-phase solo state. */
function heroesAt(cls: HeroClass, xs: number[], seed = 3): GameState {
  const s = initGameState(seed, soloSave(cls, 3));
  s.heroes = xs.map((x, i) => {
    const h = makeHero(i + 1, cls);
    h.x = x;
    return h;
  });
  s.nextId = xs.length + 1;
  return s;
}

// ---------------------------------------------------------------------------
// 1) TARGET SPREAD
// ---------------------------------------------------------------------------
describe("party feel — auto-hunt target spread (farm mobs)", () => {
  it("3 heroes over 4 mobs → each approaches a DISTINCT mob (no dog-pile)", () => {
    // Three melee heroes stacked at one x; mobs strung out FORWARD, all past melee reach
    // (range 96) so atkTgt is null and h.aimX reflects the APPROACH (hunt) target.
    const s = heroesAt("swordsman", [100, 100, 100]);
    s.spawnPaused = true;
    s.enemies = [
      makeStubEnemy(11, 300),
      makeStubEnemy(12, 380),
      makeStubEnemy(13, 460),
      makeStubEnemy(14, 540),
    ];
    updateHeroes(s);
    const aims = s.heroes.map((h) => h.aimX);
    expect(aims.every((a) => a !== null)).toBe(true);
    expect(new Set(aims).size).toBe(3); // three distinct claimed targets
    // Lower-index heroes claim the nearer mobs (deterministic slot order).
    expect(aims).toEqual([300, 380, 460]);
  });

  it("fewer mobs than heroes → the surplus hero SHARES (fallback to nearest)", () => {
    const s = heroesAt("swordsman", [100, 100, 100]);
    s.spawnPaused = true;
    s.enemies = [makeStubEnemy(11, 300), makeStubEnemy(12, 400)];
    updateHeroes(s);
    const aims = s.heroes.map((h) => h.aimX);
    expect(aims[0]).toBe(300);
    expect(aims[1]).toBe(400);
    expect(aims[2]).toBe(300); // no unclaimed mob left → shares the nearest
    expect(new Set(aims).size).toBe(2);
  });

  it("SOLO is byte-identical (no spread machinery runs for one hero)", () => {
    const solo = heroesAt("swordsman", [100]);
    solo.spawnPaused = true;
    solo.enemies = [makeStubEnemy(11, 300), makeStubEnemy(12, 380)];
    updateHeroes(solo);
    expect(solo.heroes[0].aimX).toBe(300); // nearest — unchanged from pre-spread behaviour
  });
});

// ---------------------------------------------------------------------------
// 1b) BOSS DOG-PILE ("แต่มีบอส ทุกคนต้องรุม")
// ---------------------------------------------------------------------------
describe("party feel — a boss pulls the WHOLE party (spread exempts bosses)", () => {
  it("engaged WORLD BOSS → every auto hero targets it, none peel off to farm mobs", () => {
    const s = heroesAt("swordsman", [200, 240, 280]);
    s.spawnPaused = true;
    // Farm mobs on BOTH flanks that spread would otherwise fan the party across.
    s.enemies = [makeStubEnemy(11, 150), makeStubEnemy(12, 600)];
    s.worldBoss = {
      windowId: 0,
      mapId: s.location.mapId,
      zoneIdx: s.location.zoneIdx,
      active: true,
      defeated: false,
      countdown: 0,
      // hp < maxHp = ENGAGED (passive-until-hit world boss).
      entity: { id: 999, x: 400, y: 200, hp: 5000, maxHp: 10000, atk: 0, cd: 999, skillCd: 999, telegraph: 0, enraged: false },
    };
    updateHeroes(s);
    const bx = s.worldBoss.entity!.x;
    for (const h of s.heroes) expect(h.aimX).toBe(bx); // all converge on the boss
  });

  it("QUEST/stage boss phase → all heroes target the boss", () => {
    const s = heroesAt("mage", [200, 250, 300]);
    s.phase = "boss";
    s.enemies = [];
    s.boss = makeBoss(999, 5);
    updateHeroes(s);
    const bx = s.boss.x;
    for (const h of s.heroes) expect(h.aimX).toBe(bx);
  });
});

// ---------------------------------------------------------------------------
// 2) QUEST-BOSS HP HEADCOUNT SCALING
// ---------------------------------------------------------------------------
describe("party feel — quest-boss HP scales with cohort size (exam ≠ melt)", () => {
  const P = CONFIG.party;

  it("questBossHpScale: solo ×1.0, +0.8 per extra member", () => {
    expect(P.questBossHpScale(1)).toBe(1);
    expect(P.questBossHpScale(2)).toBeCloseTo(1 + P.questBossHpPerMember, 12);
    expect(P.questBossHpScale(3)).toBeCloseTo(1 + 2 * P.questBossHpPerMember, 12);
    expect(P.questBossHpScale(6)).toBeCloseTo(1 + 5 * P.questBossHpPerMember, 12);
  });

  /** A solo/party state whose only tier-1 hero holds a pending class-change EXAM. */
  function examParty(size: number): GameState {
    const s = initGameState(1, soloSave("swordsman", 5));
    s.heroes = [];
    for (let i = 0; i < size; i++) {
      const h = makeHero(i + 1, "swordsman");
      h.quest = { id: classChangeQuestId("swordsman"), accepted: true, progress: [0, 0] };
      s.heroes.push(h);
    }
    s.nextId = size + 1;
    s.bossReady = true;
    return s;
  }

  it("detects a pending class-change killBoss as a QUEST-boss fight", () => {
    const s = examParty(1);
    expect(isClassChangeBossFight(s)).toBe(true);
    expect(isQuestBossFight(s)).toBe(true);
    // No quest → a plain stage boss (melty by design).
    s.heroes[0].quest = null;
    expect(isQuestBossFight(s)).toBe(false);
  });

  it("SOLO class-change exam boss == the plain stage boss HP (byte-identical, ×1.0)", () => {
    const exam = examParty(1);
    startBossFight(exam);
    expect(exam.boss!.hp).toBe(makeBoss(0, 5).hp); // mult 1 → unchanged
  });

  it("3p class-change exam boss HP == base × questBossHpScale(3)", () => {
    const p3 = examParty(3);
    startBossFight(p3);
    expect(p3.boss!.hp).toBe(makeBoss(0, 5, undefined, P.questBossHpScale(3)).hp);
    // ...and strictly MORE than solo (the exam does not melt).
    expect(p3.boss!.hp).toBeGreaterThan(makeBoss(0, 5).hp);
    // atk is NOT headcount-scaled (fight lasts longer, doesn't hit harder).
    expect(p3.boss!.atk).toBe(makeBoss(0, 5).atk);
  });

  it("tier-3 young-Sovereign scaling composes with the quest override", () => {
    // A tier-2 hero mid tier-3 quest with the kill banked, boss pending, standing in map4.
    const mk = (size: number): GameState => {
      const s = initGameState(2, soloSave("archer", 20));
      s.location = { ...s.location, mapId: CONFIG.quest.tier3.killMapId };
      s.heroes = [];
      for (let i = 0; i < size; i++) {
        const h = makeHero(i + 1, "archer");
        h.tier = 2;
        h.quest = { id: tier3QuestId("archer"), accepted: true, progress: [CONFIG.quest.tier3.kills, 0] };
        s.heroes.push(h);
      }
      s.nextId = size + 1;
      s.bossReady = true;
      return s;
    };
    const solo = mk(1);
    startBossFight(solo);
    const ov = { hpScale: CONFIG.quest.tier3.bossHpScale, atkScale: CONFIG.quest.tier3.bossAtkScale };
    expect(solo.boss!.hp).toBe(makeBoss(0, 20, ov).hp); // solo unchanged
    const p2 = mk(2);
    startBossFight(p2);
    expect(p2.boss!.hp).toBe(makeBoss(0, 20, ov, P.questBossHpScale(2)).hp);
    expect(p2.boss!.hp).toBeGreaterThan(solo.boss!.hp);
  });
});

// ---------------------------------------------------------------------------
// 3) XP BUFF RESHAPE — +10% per ADDITIONAL member (owner spec)
// ---------------------------------------------------------------------------
describe("party feel — xp buff = +10% per additional cohort member", () => {
  const P = CONFIG.party;
  it("expBuffPerMember is 0.10 and the formula is per-ADDITIONAL-member", () => {
    expect(P.expBuffPerMember).toBeCloseTo(0.1, 12);
    expect(P.expBuff(1)).toBe(1); // solo — identity
    expect(P.expBuff(2)).toBeCloseTo(1.1, 12);
    expect(P.expBuff(3)).toBeCloseTo(1.2, 12);
    expect(P.expBuff(6)).toBeCloseTo(1.5, 12);
  });
});
