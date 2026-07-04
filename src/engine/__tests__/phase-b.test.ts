import { describe, it, expect } from "vitest";
import {
  initGameState,
  step,
  bossHint,
  heroAtk,
  upgradeCost,
  SKILL_TYPES,
  SPEED_UPGRADE_CAP,
  CONFIG,
  type GameState,
  type SaveData,
} from "@/engine";

/**
 * Phase B smoke tests: skills, upgrades, auto systems, boss flow. Deterministic
 * (seeded). Deep regression coverage is the qa-test-engineer's phase.
 */

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

/** Step until `pred` holds; returns whether it was reached within `cap` steps. */
function runUntil(
  s: GameState,
  pred: (s: GameState) => boolean,
  cap: number,
): boolean {
  for (let i = 0; i < cap; i++) {
    if (pred(s)) return true;
    step(s, {});
  }
  return pred(s);
}

const strongSave = (): SaveData => ({
  version: 1,
  stage: 1,
  gold: 0,
  unlocked: ["swordsman"],
  upgrades: { atk: 100, speed: 0, hp: 20 },
  lastSeen: 0,
});

const threeHeroSave = (): SaveData => ({
  version: 1,
  stage: 3,
  gold: 0,
  unlocked: ["swordsman", "archer", "mage"],
  upgrades: { atk: 0, speed: 0, hp: 0 },
  lastSeen: 0,
});

describe("skills", () => {
  it("auto-cast guard: never casts with no target in range", () => {
    const s = initGameState(42);
    s.autoCast = true;
    // Enemies spawn ~0.5s in but at x~860; the sword's spin needs a foe within
    // 95px, which won't happen this early. skillCd must stay 0 (no wasted cast).
    for (let i = 0; i < 60; i++) step(s, {});
    expect(s.enemies.length).toBeGreaterThan(0);
    expect(s.heroes[0].skillCd).toBe(0);
  });

  it("swordsman spin damages an in-range target and starts its cooldown", () => {
    // Default (weak) team so the boss is a stable target that survives the step
    // in both the cast and no-cast branches — isolating the spin's extra damage.
    const s = initGameState(1);
    runUntil(s, (st) => st.bossReady, 30000);
    step(s, { challengeBoss: true });
    const radius = SKILL_TYPES.swordsman.radius;
    runUntil(
      s,
      (st) =>
        st.boss != null &&
        st.heroes[0].skillCd <= 0 &&
        Math.abs(st.boss.x - st.heroes[0].x) < radius,
      3000,
    );
    expect(s.boss).not.toBeNull();

    const cast = clone(s);
    const noCast = clone(s);
    step(cast, { castSkills: [0] });
    step(noCast, {});

    // Cooldown started, and the spin dealt extra damage to the boss this step.
    expect(cast.heroes[0].skillCd).toBe(SKILL_TYPES.swordsman.cd);
    expect(cast.boss!.hp).toBeLessThan(noCast.boss!.hp);
  });

  it("archer spread fires extra projectiles and starts its cooldown", () => {
    const s = initGameState(7, threeHeroSave());
    runUntil(s, (st) => st.enemies.length > 0, 3000);

    const cast = clone(s);
    const noCast = clone(s);
    step(cast, { castSkills: [1] }); // slot 1 = archer
    step(noCast, {});

    expect(cast.heroes[1].skillCd).toBe(SKILL_TYPES.archer.cd);
    expect(cast.projectiles.length).toBeGreaterThan(noCast.projectiles.length);
  });
});

describe("upgrades", () => {
  it("buying atk spends gold and raises derived attack", () => {
    const s = initGameState(3);
    s.gold = 1000;
    const atkBefore = heroAtk("swordsman", s.upgrades);
    const cost = upgradeCost("atk", 0);
    step(s, { buyUpgrade: "atk" });
    expect(s.upgrades.atk).toBe(1);
    expect(s.gold).toBe(1000 - cost); // no kills happen this early
    expect(heroAtk("swordsman", s.upgrades)).toBeGreaterThan(atkBefore);
  });

  it("buying hp raises maxHp and heals by the delta", () => {
    const s = initGameState(3);
    s.gold = 1000;
    const maxBefore = s.heroes[0].maxHp;
    const hpBefore = s.heroes[0].hp;
    step(s, { buyUpgrade: "hp" });
    expect(s.heroes[0].maxHp).toBeGreaterThan(maxBefore);
    expect(s.heroes[0].hp).toBe(hpBefore + (s.heroes[0].maxHp - maxBefore));
  });

  it("speed line respects its cap", () => {
    const s = initGameState(3);
    s.gold = 1_000_000;
    s.upgrades.speed = SPEED_UPGRADE_CAP;
    step(s, { buyUpgrade: "speed" });
    expect(s.upgrades.speed).toBe(SPEED_UPGRADE_CAP);
    expect(s.gold).toBe(1_000_000); // capped => no spend
  });

  it("auto-upgrade buys the cheapest affordable line on its cadence", () => {
    const s = initGameState(3);
    s.autoUpgrade = true;
    s.gold = 1000;
    // hp is the cheapest base (22 < atk 25 < speed 32) -> bought first.
    for (let i = 0; i < 20; i++) step(s, {});
    expect(s.gold).toBeLessThan(1000);
    expect(s.upgrades.hp).toBeGreaterThanOrEqual(1);
  });
});

describe("boss flow", () => {
  it("challenge enters the boss phase and clears the field", () => {
    const s = initGameState(99);
    expect(runUntil(s, (st) => st.bossReady, 30000)).toBe(true);
    expect(s.phase).toBe("battle");
    step(s, { challengeBoss: true });
    expect(s.phase).toBe("boss");
    expect(s.boss).not.toBeNull();
    expect(s.enemies.length).toBe(0);
  });

  it("boss kill -> victory -> advanceStage unlocks the second hero", () => {
    const s = initGameState(5, strongSave());
    expect(runUntil(s, (st) => st.bossReady, 30000)).toBe(true);
    step(s, { challengeBoss: true });
    // Strong team out-damages the boss well before it can wipe them.
    expect(runUntil(s, (st) => st.phase === "victory", 5000)).toBe(true);
    expect(s.gold).toBeGreaterThan(0);

    step(s, { advanceStage: true });
    expect(s.phase).toBe("battle");
    expect(s.stage).toBe(2);
    expect(s.heroSlots).toBe(2);
    expect(s.heroes.length).toBe(2);
    expect(s.heroes[1].cls).toBe("archer");
  });

  it("team wipe -> boss retreats back to battle (retry allowed)", () => {
    const s = initGameState(11); // default (weak) team
    expect(runUntil(s, (st) => st.bossReady, 30000)).toBe(true);
    step(s, { challengeBoss: true });
    expect(s.phase).toBe("boss");
    // A single base swordsman cannot out-damage the stage boss -> retreat.
    expect(runUntil(s, (st) => st.phase !== "boss", 6000)).toBe(true);
    expect(s.phase).toBe("battle");
    expect(s.boss).toBeNull();
    expect(s.bossReady).toBe(true); // still challengeable
    expect(s.heroes.every((h) => !h.dead)).toBe(true); // revived on retreat
  });
});

describe("boss hint", () => {
  it("reports boss stats and team readiness for the UI", () => {
    const s = initGameState(1);
    const hint = bossHint(s);
    expect(hint.stage).toBe(1);
    expect(hint.bossHp).toBe(CONFIG.bossHp(1));
    expect(hint.bossAtk).toBe(CONFIG.bossAtk(1));
    expect(hint.recommendedPower).toBe(
      Math.round(CONFIG.bossHp(1) / CONFIG.bossHintPowerDivisor),
    );
    expect(hint.teamPower).toBe(heroAtk("swordsman", s.upgrades));
    expect(hint.ready).toBe(hint.teamPower >= hint.recommendedPower);
  });
});
