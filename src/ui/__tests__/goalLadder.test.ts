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

  it("a tier-1 hero with an accepted-but-incomplete quest is on classQuest", () => {
    expect(
      selectCurrentRung(
        input({ hero: { tier: 1, quest: { accepted: true, complete: false } } }),
      ),
    ).toBe("classQuest");
  });

  it("a tier-1 hero with a COMPLETE quest stays on classQuest (ready to evolve)", () => {
    expect(
      selectCurrentRung(
        input({ hero: { tier: 1, quest: { accepted: true, complete: true } } }),
      ),
    ).toBe("classQuest");
  });

  it("a tier-2 (evolved) hero farming normally (no tier-3 quest yet) is on zoneBoss", () => {
    expect(selectCurrentRung(input({ hero: { tier: 2, quest: null } }))).toBe("zoneBoss");
  });

  it("a tier-2 hero with an accepted-but-incomplete tier-3 quest is on classQuest (M7.9)", () => {
    expect(
      selectCurrentRung(
        input({ hero: { tier: 2, quest: { accepted: true, complete: false } } }),
      ),
    ).toBe("classQuest");
  });

  it("a tier-2 hero with a COMPLETE tier-3 quest stays on classQuest (ready to evolve, M7.9)", () => {
    expect(
      selectCurrentRung(
        input({ hero: { tier: 2, quest: { accepted: true, complete: true } } }),
      ),
    ).toBe("classQuest");
  });

  it("a tier-3 (fully evolved) hero is on zoneBoss regardless of quest", () => {
    expect(selectCurrentRung(input({ hero: { tier: 3, quest: null } }))).toBe("zoneBoss");
  });

  it("bossReady ALWAYS forces zoneBoss when there's no active quest, even for a fresh tier-1 hero below the quest gate", () => {
    expect(selectCurrentRung(input({ bossReady: true }))).toBe("zoneBoss");
  });

  it("phase victory ALWAYS forces zoneBoss regardless of hero tier/quest", () => {
    expect(
      selectCurrentRung(
        input({
          phase: "victory",
          hero: { tier: 1, quest: { accepted: true, complete: false } },
        }),
      ),
    ).toBe("zoneBoss");
  });

  it("falls back to zoneBoss when there's no hero at all", () => {
    expect(selectCurrentRung(input({ hero: null }))).toBe("zoneBoss");
  });

  // 2026-07-07 owner report fix: an ACCEPTED evolution quest is priority #1,
  // outranking the zoneBoss "ready" state (an unrelated map's boss door
  // being open must not bury quest guidance).
  it("an ACCEPTED in-progress quest outranks bossReady (owner report fix)", () => {
    expect(
      selectCurrentRung(
        input({ bossReady: true, hero: { tier: 1, quest: { accepted: true, complete: false } } }),
      ),
    ).toBe("classQuest");
  });

  it("a COMPLETE-but-not-yet-evolved quest (accepted) also outranks bossReady", () => {
    expect(
      selectCurrentRung(
        input({ bossReady: true, hero: { tier: 1, quest: { accepted: true, complete: true } } }),
      ),
    ).toBe("classQuest");
  });

  it("same fix applies to the tier-2 -> tier-3 quest (M7.9)", () => {
    expect(
      selectCurrentRung(
        input({ bossReady: true, hero: { tier: 2, quest: { accepted: true, complete: true } } }),
      ),
    ).toBe("classQuest");
  });

  // Care point (1): an OFFERED-but-not-yet-accepted quest deliberately keeps
  // the PRE-EXISTING precedence — bossReady still wins. Players who haven't
  // engaged the offer yet shouldn't lose boss guidance.
  it("an OFFERED-but-not-accepted quest does NOT outrank bossReady (preserves old behavior)", () => {
    expect(
      selectCurrentRung(
        input({
          bossReady: true,
          hero: { tier: 1, quest: { accepted: false, complete: false } },
        }),
      ),
    ).toBe("zoneBoss");
  });

  // Care point (2): actually fighting a boss must still win, even with an
  // accepted quest active — the hero mid-fight needs fight feedback.
  it("phase 'boss' (actively fighting) still wins over an accepted quest", () => {
    expect(
      selectCurrentRung(
        input({
          phase: "boss",
          bossReady: true,
          hero: { tier: 1, quest: { accepted: true, complete: true } },
        }),
      ),
    ).toBe("zoneBoss");
  });

  // Post-quest (evolved to the next tier, quest cleared): ordering returns
  // to normal — bossReady/farming rules apply exactly as before.
  it("post-quest (evolved, quest null) ordering is back to normal", () => {
    expect(
      selectCurrentRung(input({ bossReady: true, hero: { tier: 2, quest: null } })),
    ).toBe("zoneBoss");
    expect(selectCurrentRung(input({ hero: { tier: 2, quest: null } }))).toBe("zoneBoss");
  });
});

describe("buildGoalLadder", () => {
  it("marks rungs before the current one done, the current one current, the rest upcoming", () => {
    const { current, rungs } = buildGoalLadder(
      input({ hero: { tier: 1, quest: { accepted: true, complete: false } } }),
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

  it("an accepted quest + bossReady still shows classQuest as current in the breadcrumb (owner report fix)", () => {
    const { current } = buildGoalLadder(
      input({ bossReady: true, hero: { tier: 1, quest: { accepted: true, complete: false } } }),
    );
    expect(current).toBe("classQuest");
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
