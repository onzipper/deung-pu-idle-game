import { describe, it, expect } from "vitest";
import {
  initGameState,
  step,
  bossHint,
  combatPower,
  SKILL_TYPES,
  CONFIG,
  type GameState,
  type SaveData,
} from "@/engine";
import { makeStubEnemy, makeParty, soloSave } from "./helpers";

/**
 * Phase B smoke tests: skills, auto-cast, boss flow, boss hint. Deterministic
 * (seeded). Deep regression coverage is the qa-test-engineer's phase. M5 pivot:
 * the purchasable upgrade lines are gone — power is level + tier now.
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

/** A high-level solo hero that out-damages a stage-1 boss (levels are the power axis). */
const strongSave = (): SaveData => {
  const base = soloSave("swordsman", 1);
  return { ...base, hero: { ...base.hero, level: 45 } };
};

describe("skills", () => {
  it("auto-cast guard: never casts with no target in range", () => {
    const s = initGameState(42);
    s.autoCast = true;
    // Enemies spawn ~0.5s in but at x~860; the sword's spin needs a foe within
    // 95px, which won't happen this early. skillCd must stay 0 (no wasted cast).
    for (let i = 0; i < 60; i++) step(s, {});
    expect(s.enemies.length).toBeGreaterThan(0);
    expect(s.heroes[0].skillCds["sword_whirl"] ?? 0).toBe(0);
  });

  it("swordsman spin damages an in-range target and starts its cooldown", () => {
    const s = initGameState(1);
    runUntil(s, (st) => st.bossReady, 30000);
    step(s, { challengeBoss: true });
    const radius = SKILL_TYPES.swordsman.radius;
    runUntil(
      s,
      (st) =>
        st.boss != null &&
        (st.heroes[0].skillCds["sword_whirl"] ?? 0) <= 0 &&
        Math.abs(st.boss.x - st.heroes[0].x) < radius,
      3000,
    );
    expect(s.boss).not.toBeNull();

    const cast = clone(s);
    const noCast = clone(s);
    step(cast, { castSkills: [{ slot: 0, skillId: "sword_whirl" }] });
    step(noCast, {});

    expect(cast.heroes[0].skillCds["sword_whirl"]).toBe(SKILL_TYPES.swordsman.cd);
    expect(cast.boss!.hp).toBeLessThan(noCast.boss!.hp);
  });

  it("archer arrow rain drops falling arrows and starts its cooldown", () => {
    const s = makeParty(7); // synthetic party: exercises the archer in slot 1
    const archer = s.heroes[1];
    s.enemies = [
      makeStubEnemy(1, archer.x + 220),
      makeStubEnemy(2, archer.x + 260),
    ];

    const cast = clone(s);
    const noCast = clone(s);
    step(cast, { castSkills: [{ slot: 1, skillId: "archer_rain" }] }); // slot 1 = archer
    step(noCast, {});

    expect(cast.heroes[1].skillCds["archer_rain"]).toBe(SKILL_TYPES.archer.cd);
    const drops = cast.projectiles.filter((p) => p.kind === "rainArrow");
    expect(drops.length).toBe(SKILL_TYPES.archer.targets);
    expect(cast.projectiles.length).toBeGreaterThan(noCast.projectiles.length);
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

  it("boss kill -> victory -> advanceStage keeps the single character", () => {
    const s = initGameState(5, strongSave());
    expect(runUntil(s, (st) => st.bossReady, 30000)).toBe(true);
    step(s, { challengeBoss: true });
    // Strong (high-level) hero out-damages the boss well before it can wipe.
    expect(runUntil(s, (st) => st.phase === "victory", 5000)).toBe(true);
    expect(s.gold).toBeGreaterThan(0);

    step(s, { advanceStage: true });
    expect(s.phase).toBe("battle");
    expect(s.stage).toBe(2);
    expect(s.heroes).toHaveLength(1);
    expect(s.heroes[0].cls).toBe("swordsman");
  });

  it("solo hero wipe -> boss retreats back to battle (retry allowed)", () => {
    const s = initGameState(11);
    expect(runUntil(s, (st) => st.bossReady, 30000)).toBe(true);
    step(s, { challengeBoss: true });
    expect(s.phase).toBe("boss");
    // Force the wipe deterministically (a base hero may or may not out-DPS the
    // boss depending on seed — the retreat MECHANIC is what this test pins).
    const h = s.heroes[0];
    h.dead = true;
    h.hp = 0;
    h.reviveTimer = 999;
    step(s, {});
    expect(s.phase).toBe("battle");
    expect(s.boss).toBeNull();
    expect(s.bossReady).toBe(true); // still challengeable
    expect(s.heroes.every((h) => !h.dead)).toBe(true); // revived on retreat
  });
});

describe("boss hint", () => {
  it("reports boss stats and readiness for the UI (solo hero power)", () => {
    const s = initGameState(1, soloSave("swordsman", 1));
    const hint = bossHint(s);
    expect(hint.stage).toBe(1);
    expect(hint.bossHp).toBe(CONFIG.bossHp(1));
    expect(hint.bossAtk).toBe(CONFIG.bossAtk(1));
    expect(hint.recommendedPower).toBe(
      Math.round(CONFIG.bossHp(1) / CONFIG.bossHintPowerDivisor),
    );
    // teamPower now = the single hero's COMBAT POWER (effective DPS + HP), M5.
    expect(hint.teamPower).toBe(combatPower(s.heroes[0]));
    expect(hint.ready).toBe(hint.teamPower >= hint.recommendedPower);
  });
});
