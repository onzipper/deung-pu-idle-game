import { describe, it, expect } from "vitest";
import {
  initGameState,
  step,
  frontHeroX,
  CONFIG,
  FIXED_DT,
  SLOT_ORDER,
  HERO_TYPES,
} from "@/engine";
import type { GameState, SaveData } from "@/engine";
import { threeHeroSave } from "./helpers";

/**
 * Deep boss-fight regression coverage (Phase C handoff): enrage transition,
 * slam telegraph timing, repeated retreat/re-challenge, and hero-unlock
 * ordering/capping. Builds on phase-b.test.ts, which only smoke-tests one
 * challenge/victory/retreat cycle.
 *
 * These tests skip the kill-grind by setting `bossReady` directly (a public
 * GameState field) instead of running thousands of steps to earn it — the
 * boss-flow *transition* itself is exercised in phase-b.test.ts.
 */

/** Challenge the boss immediately and place it at engage range (skip travel time). */
function engageBoss(s: GameState): void {
  s.bossReady = true;
  step(s, { challengeBoss: true });
  s.boss!.x = frontHeroX(s) + CONFIG.clash + CONFIG.boss.engageExtra;
}

describe("boss enrage transition", () => {
  it("enrages once hp drops below the threshold", () => {
    const s = initGameState(1);
    engageBoss(s);
    const b = s.boss!;
    b.hp = Math.floor(b.maxHp * CONFIG.boss.enrageThreshold) - 1;
    b.cd = 999; // isolate: no normal attack this step
    b.skillCd = 999; // isolate: no slam this step
    expect(b.enraged).toBe(false);

    step(s, {});

    expect(s.boss!.enraged).toBe(true);
  });

  it("does not enrage while at/above the threshold", () => {
    const s = initGameState(1);
    engageBoss(s);
    const b = s.boss!;
    b.hp = b.maxHp;
    b.cd = 999;
    b.skillCd = 999;

    step(s, {});

    expect(s.boss!.enraged).toBe(false);
  });

  it("enraged boss reloads slam faster than normal", () => {
    const s = initGameState(1);
    engageBoss(s);
    const b = s.boss!;
    b.enraged = true;
    b.cd = 999; // isolate: no normal attack this step
    b.telegraph = FIXED_DT / 2; // completes this step

    step(s, {});

    expect(s.boss!.skillCd).toBe(CONFIG.boss.slamCdEnraged);
    expect(CONFIG.boss.slamCdEnraged).toBeLessThan(CONFIG.boss.slamCdNormal);
  });

  it("non-enraged boss reloads slam at the normal (slower) rate", () => {
    const s = initGameState(1);
    engageBoss(s);
    const b = s.boss!;
    b.enraged = false;
    b.cd = 999;
    b.telegraph = FIXED_DT / 2;

    step(s, {});

    expect(s.boss!.skillCd).toBe(CONFIG.boss.slamCdNormal);
  });

  it("enraged boss reloads its normal attack faster", () => {
    const s = initGameState(1);
    engageBoss(s);
    const b = s.boss!;
    b.enraged = true;
    b.skillCd = 999; // isolate: no slam this step
    b.cd = FIXED_DT / 2; // attack lands this step

    step(s, {});

    expect(s.boss!.cd).toBe(CONFIG.boss.attackCdEnraged);
    expect(CONFIG.boss.attackCdEnraged).toBeLessThan(CONFIG.boss.attackCdNormal);
  });

  it("non-enraged boss reloads its normal attack at the normal (slower) rate", () => {
    const s = initGameState(1);
    engageBoss(s);
    const b = s.boss!;
    b.enraged = false;
    b.skillCd = 999;
    b.cd = FIXED_DT / 2;

    step(s, {});

    expect(s.boss!.cd).toBe(CONFIG.boss.attackCdNormal);
  });
});

describe("boss slam telegraph", () => {
  it("damage lands only after the telegraph elapses, and hits every alive hero", () => {
    const s = initGameState(1, threeHeroSave());
    engageBoss(s);
    const b = s.boss!;
    b.enraged = false;
    b.cd = 999; // isolate: no normal attack during this window
    b.skillCd = FIXED_DT / 2; // telegraph starts on the very next step
    const bossAtk = b.atk;

    step(s, {}); // skillCd crosses 0 -> telegraph starts; no damage yet
    expect(s.boss!.telegraph).toBeGreaterThan(0);
    expect(s.heroes.every((h) => h.hp === h.maxHp)).toBe(true);

    let hit = false;
    for (let i = 0; i < 200 && !hit; i++) {
      const before = s.boss!.telegraph;
      step(s, {});
      if (before > 0 && s.boss!.telegraph <= 0) {
        hit = true;
        break;
      }
      // Still winding up: the slam has not landed on anyone yet.
      expect(s.heroes.every((h) => h.hp === h.maxHp)).toBe(true);
    }
    expect(hit).toBe(true);

    const expectedDmg = Math.round(bossAtk * CONFIG.boss.slamMult);
    for (const h of s.heroes) {
      expect(h.hp).toBe(h.maxHp - expectedDmg);
    }
    expect(s.boss!.skillCd).toBe(CONFIG.boss.slamCdNormal);
  });
});

describe("boss retreat / re-challenge loop", () => {
  it("can retreat on a team wipe and be re-challenged repeatedly", () => {
    const s = initGameState(1);
    for (let i = 0; i < 3; i++) {
      s.bossReady = true;
      step(s, { challengeBoss: true });
      expect(s.phase).toBe("boss");
      expect(s.boss).not.toBeNull();

      // Force a team wipe to trigger the retreat path deterministically
      // (no need to actually out-tank the boss).
      for (const h of s.heroes) {
        h.dead = true;
        h.hp = 0;
        h.reviveTimer = 999;
      }
      step(s, {});

      expect(s.phase).toBe("battle");
      expect(s.boss).toBeNull();
      expect(s.bossReady).toBe(true); // still challengeable
      expect(s.enemies.length).toBe(0);
      expect(s.waveGap).toBe(CONFIG.bossRetreatWaveGap);
      expect(s.heroes.every((h) => !h.dead && h.hp === h.maxHp)).toBe(true);
    }
  });
});

/**
 * Playtest bug "ตัวตีไกลไม่ตีบอส" (ranged heroes don't attack the boss): the boss
 * engages near the spawn edge (~836), but the shared battleMaxAnchor(510) clamped
 * the formation too shallow — archer(484)+350 and mage(436)+330 both fell just
 * short, so the backline stood idle. The boss-phase anchor cap (CONFIG.boss.maxAnchor)
 * lets the anchor track the boss so the ranged heroes stay in range.
 */
describe("boss-phase ranged coverage (ตัวตีไกลไม่ตีบอส)", () => {
  it("archer and mage close into range of the boss and damage it", () => {
    const s = initGameState(2, threeHeroSave(5));
    // Tanky team + tanky boss so the duel lasts long enough to observe positioning
    // (nobody dies), and the boss walks in from spawn naturally (no engage skip).
    for (const h of s.heroes) {
      h.maxHp = 1e9;
      h.hp = 1e9;
    }
    s.bossReady = true;
    step(s, { challengeBoss: true });
    s.boss!.maxHp = 1e9;
    s.boss!.hp = 1e9;

    const sword = s.heroes[0];
    const archer = s.heroes[1];
    const mage = s.heroes[2];
    expect(archer.cls).toBe("archer");
    expect(mage.cls).toBe("mage");

    const hpBefore = s.boss!.hp;
    for (let i = 0; i < 400; i++) {
      // Mute the swordsman entirely: only the ranged heroes can damage the boss, so
      // any boss-hp loss PROVES the backline reached it.
      sword.cd = 999;
      sword.skillCd = 999;
      step(s, {});
    }

    // Structural: both ranged heroes are within their own range of the boss...
    expect(s.boss!.x - archer.x).toBeLessThanOrEqual(HERO_TYPES.archer.range);
    expect(s.boss!.x - mage.x).toBeLessThanOrEqual(HERO_TYPES.mage.range);
    // ...and actually hit it (boss hp dropped with the swordsman muted).
    expect(s.boss!.hp).toBeLessThan(hpBefore);
  });
});

describe("hero unlock ordering", () => {
  it("a stage-3 save starts with all 3 hero slots unlocked, in SLOT_ORDER", () => {
    const s = initGameState(1, threeHeroSave(3));
    expect(s.heroSlots).toBe(3);
    expect(s.heroes.map((h) => h.cls)).toEqual(SLOT_ORDER);
  });

  it("clamps heroSlots to maxHeroes even if the save reports more unlocked entries", () => {
    const save: SaveData = {
      version: 1,
      stage: 5,
      gold: 0,
      unlocked: ["a", "b", "c", "d", "e"], // bogus extra entries
      upgrades: { atk: 0, speed: 0, hp: 0 },
      lastSeen: 0,
    };
    const s = initGameState(1, save);
    expect(s.heroSlots).toBe(CONFIG.maxHeroes);
    expect(s.heroes.length).toBe(CONFIG.maxHeroes);
    expect(s.heroes.map((h) => h.cls)).toEqual(SLOT_ORDER);
  });

  it("advancing past stage 3 does not add a 4th hero slot (maxHeroes cap)", () => {
    const s = initGameState(1, threeHeroSave(3));
    s.bossReady = true;
    step(s, { challengeBoss: true });
    s.boss!.hp = 0; // force a kill without grinding the fight
    step(s, {}); // resolveDeaths pays out and flips to victory

    expect(s.phase).toBe("victory");
    step(s, { advanceStage: true });

    expect(s.stage).toBe(4);
    expect(s.heroSlots).toBe(3); // already at maxHeroes, unchanged
    expect(s.heroes.length).toBe(3);
    expect(s.heroes.map((h) => h.cls)).toEqual(SLOT_ORDER);
  });
});
