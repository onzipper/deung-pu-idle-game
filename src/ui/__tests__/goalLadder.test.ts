import { describe, expect, it } from "vitest";
import {
  buildGoalLadder,
  selectCurrentRung,
  selectZoneBossDetail,
  type GoalLadderInput,
} from "@/ui/goalLadder";

function input(overrides: Partial<GoalLadderInput> = {}): GoalLadderInput {
  return {
    hero: { tier: 1, quest: null },
    phase: "battle",
    bossReady: false,
    ...overrides,
  };
}

describe("selectCurrentRung", () => {
  it("a fresh tier-1 hero below the quest gate is on levelUp", () => {
    expect(selectCurrentRung(input())).toBe("levelUp");
  });

  it("a tier-1 hero with an offered-but-incomplete quest is on classQuest", () => {
    expect(
      selectCurrentRung(input({ hero: { tier: 1, quest: { complete: false } } })),
    ).toBe("classQuest");
  });

  it("a tier-1 hero with a COMPLETE quest stays on classQuest (ready to evolve)", () => {
    expect(
      selectCurrentRung(input({ hero: { tier: 1, quest: { complete: true } } })),
    ).toBe("classQuest");
  });

  it("a tier-2 (evolved) hero farming normally (no tier-3 quest yet) is on zoneBoss", () => {
    expect(selectCurrentRung(input({ hero: { tier: 2, quest: null } }))).toBe("zoneBoss");
  });

  it("a tier-2 hero with an offered-but-incomplete tier-3 quest is on classQuest (M7.9)", () => {
    expect(
      selectCurrentRung(input({ hero: { tier: 2, quest: { complete: false } } })),
    ).toBe("classQuest");
  });

  it("a tier-2 hero with a COMPLETE tier-3 quest stays on classQuest (ready to evolve, M7.9)", () => {
    expect(
      selectCurrentRung(input({ hero: { tier: 2, quest: { complete: true } } })),
    ).toBe("classQuest");
  });

  it("a tier-3 (fully evolved) hero is on zoneBoss regardless of quest", () => {
    expect(selectCurrentRung(input({ hero: { tier: 3, quest: null } }))).toBe("zoneBoss");
  });

  it("bossReady ALWAYS forces zoneBoss, even for a fresh tier-1 hero below the quest gate", () => {
    expect(selectCurrentRung(input({ bossReady: true }))).toBe("zoneBoss");
  });

  it("phase victory ALWAYS forces zoneBoss regardless of hero tier/quest", () => {
    expect(
      selectCurrentRung(
        input({ phase: "victory", hero: { tier: 1, quest: { complete: false } } }),
      ),
    ).toBe("zoneBoss");
  });

  it("falls back to zoneBoss when there's no hero at all", () => {
    expect(selectCurrentRung(input({ hero: null }))).toBe("zoneBoss");
  });
});

describe("buildGoalLadder", () => {
  it("marks rungs before the current one done, the current one current, the rest upcoming", () => {
    const { current, rungs } = buildGoalLadder(
      input({ hero: { tier: 1, quest: { complete: false } } }),
    );
    expect(current).toBe("classQuest");
    expect(rungs).toEqual([
      { id: "levelUp", status: "done" },
      { id: "classQuest", status: "current" },
      { id: "zoneBoss", status: "upcoming" },
      { id: "hallOfFame", status: "locked" },
    ]);
  });

  it("hallOfFame is ALWAYS locked, even once zoneBoss is the endless current rung", () => {
    const { rungs } = buildGoalLadder(input({ hero: { tier: 2, quest: null } }));
    const hof = rungs.find((r) => r.id === "hallOfFame");
    expect(hof?.status).toBe("locked");
  });

  it("levelUp is current (not done) for a fresh hero — nothing is done yet", () => {
    const { rungs } = buildGoalLadder(input());
    expect(rungs).toEqual([
      { id: "levelUp", status: "current" },
      { id: "classQuest", status: "upcoming" },
      { id: "zoneBoss", status: "upcoming" },
      { id: "hallOfFame", status: "locked" },
    ]);
  });
});

describe("selectZoneBossDetail", () => {
  it("victory phase wins outright", () => {
    expect(selectZoneBossDetail("victory", true)).toBe("victory");
    expect(selectZoneBossDetail("victory", false)).toBe("victory");
  });

  it("boss phase (actively fighting) shows the fighting state", () => {
    expect(selectZoneBossDetail("boss", true)).toBe("fighting");
  });

  it("battle phase + bossReady shows the challenge CTA", () => {
    expect(selectZoneBossDetail("battle", true)).toBe("ready");
  });

  it("battle phase without bossReady shows the farming/zone-unlock bar", () => {
    expect(selectZoneBossDetail("battle", false)).toBe("farming");
  });
});
