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
    autoCast: false,
    autoAllocate: false,
    autoHunt: true,
    heroes: [
      {
        skillCd: 0,
        dead: false,
        tier: 1,
        statsSum: 0,
        statPoints: 0,
        unlockedSlots: 1,
        autoSlotsFilled: 0,
        questOffered: false,
        questComplete: false,
      },
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

  it("is false once any kill has happened", () => {
    expect(isFreshSave(snapshot({ kills: 1 }))).toBe(false);
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

  it("allocateStats (action-kind) advances the instant a stat point is spent", () => {
    expect(idOf(2)).toBe("allocateStats");
    const prev = snapshot({ heroes: [{ ...snapshot().heroes[0], statsSum: 5 }] });
    const untouched = snapshot({ heroes: [{ ...snapshot().heroes[0], statsSum: 5 }] });
    const spent = snapshot({ heroes: [{ ...snapshot().heroes[0], statsSum: 6 }] });
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 2, prev, untouched, false)).toBe(2);
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 2, prev, spent, false)).toBe(3);
  });

  it("castSkill (action-kind) advances on a cooldown jump, ignores natural decay", () => {
    expect(idOf(3)).toBe("castSkill");
    const prev = snapshot({ heroes: [{ ...snapshot().heroes[0], skillCd: 4 }] });
    const decayed = snapshot({ heroes: [{ ...snapshot().heroes[0], skillCd: 3.9 }] });
    const cast = snapshot({ heroes: [{ ...snapshot().heroes[0], skillCd: 8 }] });
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 3, prev, decayed, false)).toBe(3);
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 3, prev, cast, false)).toBe(4);
  });

  it("slotAutoSkill (action-kind) advances the instant a skill fills an auto slot", () => {
    expect(idOf(4)).toBe("slotAutoSkill");
    const prev = snapshot({ heroes: [{ ...snapshot().heroes[0], autoSlotsFilled: 1 }] });
    const unchanged = snapshot({
      heroes: [{ ...snapshot().heroes[0], autoSlotsFilled: 1 }],
    });
    const slotted = snapshot({
      heroes: [{ ...snapshot().heroes[0], autoSlotsFilled: 2 }],
    });
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 4, prev, unchanged, false)).toBe(4);
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 4, prev, slotted, false)).toBe(5);
  });

  it("bossChallenge (action-kind) advances on the battle -> boss phase transition", () => {
    expect(idOf(5)).toBe("bossChallenge");
    const prev = snapshot({ phase: "battle" });
    const stillBattle = snapshot({ phase: "battle" });
    const engaged = snapshot({ phase: "boss" });
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 5, prev, stillBattle, false)).toBe(5);
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 5, prev, engaged, false)).toBe(6);
  });

  it("settingsTour and outro (next-kind) require an explicit tap each", () => {
    expect(idOf(6)).toBe("settingsTour");
    expect(idOf(7)).toBe("outro");
    const s = snapshot();
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 6, s, s, false)).toBe(6);
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 6, s, s, true)).toBe(7);
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 7, s, s, true)).toBe(8);
  });

  it("is a no-op once already complete or before started", () => {
    const s = snapshot();
    expect(resolveNextStepIndex(ONBOARDING_STEPS, -1, s, s, true)).toBe(-1);
    expect(resolveNextStepIndex(ONBOARDING_STEPS, 8, s, s, true)).toBe(8);
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
