import { describe, expect, it } from "vitest";
import {
  isFreshSave,
  isOnboardingComplete,
  ONBOARDING_STEPS,
  resolveNextStepIndex,
  type OnboardingSnapshot,
} from "@/ui/onboarding/steps";

function snapshot(overrides: Partial<OnboardingSnapshot> = {}): OnboardingSnapshot {
  return {
    gold: 0,
    stage: 1,
    kills: 0,
    phase: "battle",
    upgrades: { atk: 0, speed: 0, hp: 0 },
    upgradeCosts: { atk: 100, speed: 100, hp: 100 },
    autoUpgrade: false,
    autoCast: false,
    heroes: [
      { skillCd: 0, dead: false },
      { skillCd: 0, dead: false },
      { skillCd: 0, dead: false },
    ],
    ...overrides,
  };
}

describe("isFreshSave", () => {
  it("is true for an all-zero fresh snapshot", () => {
    expect(isFreshSave(snapshot())).toBe(true);
  });

  it("is false once gold has been earned", () => {
    expect(isFreshSave(snapshot({ gold: 10 }))).toBe(false);
  });

  it("is false for any upgrade level > 0", () => {
    expect(isFreshSave(snapshot({ upgrades: { atk: 1, speed: 0, hp: 0 } }))).toBe(false);
  });

  it("is false for a stage beyond 1 (returning player)", () => {
    expect(isFreshSave(snapshot({ stage: 2 }))).toBe(false);
  });
});

describe("resolveNextStepIndex", () => {
  const idOf = (i: number) => ONBOARDING_STEPS[i]?.id;

  it("welcome (next-kind) only advances on an explicit tap", () => {
    const prev = snapshot();
    const next = snapshot({ kills: 5 }); // unrelated state change
    expect(idOf(0)).toBe("welcome");
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 0, prev, next, false)).toBe(0);
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 0, prev, next, true)).toBe(1);
  });

  it("watchFight (auto-kind) advances the instant kills >= 1, no tap needed", () => {
    expect(idOf(1)).toBe("watchFight");
    const prev = snapshot({ kills: 0 });
    const stillZero = snapshot({ kills: 0 });
    const gotOne = snapshot({ kills: 1 });
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 1, prev, stillZero, false)).toBe(1);
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 1, prev, gotOne, false)).toBe(2);
  });

  it("buyUpgrade (action-kind) advances only when an upgrade level increases", () => {
    expect(idOf(2)).toBe("buyUpgrade");
    const prev = snapshot({ upgrades: { atk: 0, speed: 0, hp: 0 } });
    const noBuy = snapshot({ upgrades: { atk: 0, speed: 0, hp: 0 }, gold: 500 });
    const bought = snapshot({ upgrades: { atk: 1, speed: 0, hp: 0 } });
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 2, prev, noBuy, false)).toBe(2);
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 2, prev, bought, false)).toBe(3);
    // Explicit "next" taps never advance an action-kind step (only the action does).
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 2, prev, noBuy, true)).toBe(2);
  });

  it("castSkill (action-kind) advances on a cooldown jump, ignores natural decay", () => {
    expect(idOf(3)).toBe("castSkill");
    const prev = snapshot({
      heroes: [
        { skillCd: 4, dead: false },
        { skillCd: 0, dead: false },
        { skillCd: 0, dead: false },
      ],
    });
    const decayed = snapshot({
      heroes: [
        { skillCd: 3.9, dead: false },
        { skillCd: 0, dead: false },
        { skillCd: 0, dead: false },
      ],
    });
    const cast = snapshot({
      heroes: [
        { skillCd: 4, dead: false },
        { skillCd: 8, dead: false },
        { skillCd: 0, dead: false },
      ],
    });
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 3, prev, decayed, false)).toBe(3);
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 3, prev, cast, false)).toBe(4);
  });

  it("bossChallenge (action-kind) advances on the battle -> boss phase transition", () => {
    expect(idOf(4)).toBe("bossChallenge");
    const prev = snapshot({ phase: "battle" });
    const stillBattle = snapshot({ phase: "battle" });
    const engaged = snapshot({ phase: "boss" });
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 4, prev, stillBattle, false)).toBe(4);
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 4, prev, engaged, false)).toBe(5);
  });

  it("settingsTour and outro (next-kind) require an explicit tap each", () => {
    expect(idOf(5)).toBe("settingsTour");
    expect(idOf(6)).toBe("outro");
    const s = snapshot();
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 5, s, s, false)).toBe(5);
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 5, s, s, true)).toBe(6);
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 6, s, s, true)).toBe(7);
  });

  it("is a no-op once already complete or before started", () => {
    const s = snapshot();
    expect(resolveNextStepIndex(ONBOARDING_STEPS, -1, s, s, true)).toBe(-1);
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 7, s, s, true)).toBe(7);
  });
});

describe("isOnboardingComplete", () => {
  it("is only true once the index runs past the last step", () => {
    expect(isOnboardingComplete(ONBOARDING_STEPS, 0)).toBe(false);
    expect(isOnboardingComplete(ONBOARDING_STEPS, ONBOARDING_STEPS.length - 1)).toBe(
      false,
    );
    expect(isOnboardingComplete(ONBOARDING_STEPS, ONBOARDING_STEPS.length)).toBe(true);
  });
});
