import { describe, it, expect } from "vitest";
import { initGameState, step, frontHeroX, CONFIG, FIXED_DT, HERO_TYPES } from "@/engine";
import type { GameState } from "@/engine";
import { soloSave, makeParty, forceBoss, worldAutopilot } from "./helpers";

/**
 * Deep boss-fight regression coverage (Phase C handoff): enrage transition,
 * slam telegraph timing, repeated retreat/re-challenge, and (via a synthetic
 * party) ranged boss coverage. Builds on phase-b.test.ts, which only smoke-tests
 * one challenge/victory/retreat cycle.
 *
 * These tests skip the kill-grind by setting `bossReady` directly (a public
 * GameState field) instead of running thousands of steps to earn it — the
 * boss-flow *transition* itself is exercised in phase-b.test.ts.
 */

/** Spawn the boss immediately and place it at engage range (skip travel time). */
function engageBoss(s: GameState): void {
  forceBoss(s); // M6: enter a boss fight at the current stage without the world walk
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
    const s = initGameState(1, soloSave("swordsman", 3));
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

describe("boss wipe -> town respawn -> retry loop (M6)", () => {
  it("a boss-room wipe sends the hero to town, then it revives to retry", () => {
    // M6: a wipe no longer retreats-in-place — the dead hero walks home to town
    // (GDD: death = respawn in town), revives there, then (auto-return on)
    // walks back to the last farm zone. Verify a full wipe/respawn cycle.
    const s = initGameState(1);
    s.autoReturn = true;
    forceBoss(s);
    expect(s.phase).toBe("boss");
    expect(s.boss).not.toBeNull();

    // Force a team wipe to trigger the respawn path deterministically.
    for (const h of s.heroes) {
      h.dead = true;
      h.hp = 0;
    }
    step(s, {}); // resolveDeaths -> respawnToTown

    // The boss is gone and the hero is walking home to town.
    expect(s.boss).toBeNull();
    expect(s.traveling).not.toBeNull();

    // Run out the transit(s): town revive, then auto-return to the last farm zone.
    for (let i = 0; i < 2000; i++) {
      step(s, {});
      if (!s.traveling && !s.heroes[0].dead && s.enemies.length >= 0 && s.phase === "battle") {
        break;
      }
    }
    // Revived at full HP, back on a farmable footing (never permanently locked).
    expect(s.heroes.every((h) => !h.dead && h.hp === h.maxHp)).toBe(true);
    expect(s.traveling).toBeNull();
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
    const s = makeParty(2, 5);
    // Tanky team + tanky boss so the duel lasts long enough to observe positioning
    // (nobody dies), and the boss walks in from spawn naturally (no engage skip).
    for (const h of s.heroes) {
      h.maxHp = 1e9;
      h.hp = 1e9;
    }
    forceBoss(s);
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
      sword.skillCds["sword_whirl"] = 999;
      step(s, {});
    }

    // Structural: both ranged heroes are within their own range of the boss...
    expect(s.boss!.x - archer.x).toBeLessThanOrEqual(HERO_TYPES.archer.range);
    expect(s.boss!.x - mage.x).toBeLessThanOrEqual(HERO_TYPES.mage.range);
    // ...and actually hit it (boss hp dropped with the swordsman muted).
    expect(s.boss!.hp).toBeLessThan(hpBefore);
  });
});

describe("solo character (no hero-unlock progression)", () => {
  it("spawns exactly one hero of the chosen class at any stage", () => {
    const s = initGameState(1, soloSave("archer", 3));
    expect(s.heroes).toHaveLength(1);
    expect(s.heroes[0].cls).toBe("archer");
  });

  it("walking the world keeps the single chosen character (never adds slots)", () => {
    // M6: progression is walking zones, not stage++. Drive the autopilot far
    // enough to cross at least one zone boundary and confirm the party stays solo.
    const s = initGameState(1, soloSave("mage", 1));
    s.autoCast = true;
    s.autoReturn = true;
    const startStage = s.stage;
    for (let i = 0; i < 60_000 && s.stage === startStage; i++) {
      step(s, worldAutopilot(s));
    }
    expect(s.stage).toBeGreaterThan(startStage); // walked into a later zone
    expect(s.heroes).toHaveLength(1);
    expect(s.heroes[0].cls).toBe("mage");
  });
});
