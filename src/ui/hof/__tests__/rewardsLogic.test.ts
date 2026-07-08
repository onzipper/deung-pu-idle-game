import { describe, expect, it } from "vitest";
import {
  HOF_SKELETON_ROW_COUNT,
  claimStateAfterResult,
  hasAnyUnclaimedAward,
  isMyEntry,
  isRewardBoard,
  nextSocialBadgeAfterTitlePick,
  rankFromTitleId,
  resolveBoardFetchDecision,
  resolveMyUnclaimedForBoard,
  resolvePodium,
  resolveSkeletonRowCount,
  resolveTitlePickerState,
  titleForCharInBoard,
} from "@/ui/hof/rewardsLogic";
import type { HofChampionRow, HofMyTitle, HofUnclaimedAward } from "@/ui/hof/rewardsTypes";
import type { HofRewardBoard } from "@/ui/hof/titles";

describe("claimStateAfterResult (claim CTA state machine)", () => {
  it("transitions to claimed on an ok result", () => {
    expect(claimStateAfterResult({ ok: true })).toBe("claimed");
  });

  it("transitions to error on an explicit rejection", () => {
    expect(claimStateAfterResult({ ok: false })).toBe("error");
  });

  it("transitions to error on a network/parse failure (null)", () => {
    expect(claimStateAfterResult(null)).toBe("error");
  });
});

describe("isMyEntry", () => {
  it("matches when the ranks are equal", () => {
    expect(isMyEntry(3, 3)).toBe(true);
    expect(isMyEntry(1, 1)).toBe(true);
  });

  it("does not match a different rank", () => {
    expect(isMyEntry(3, 4)).toBe(false);
  });

  it("does not match when I have no rank on this board", () => {
    expect(isMyEntry(null, 1)).toBe(false);
    expect(isMyEntry(undefined, 1)).toBe(false);
  });
});

describe("resolveTitlePickerState (Settings title picker)", () => {
  const oneTitle: HofMyTitle[] = [{ titleId: "level.2", board: "level", rank: 2, charName: "Foo" }];

  it("hides when there is no active character", () => {
    expect(resolveTitlePickerState(null)).toEqual({ kind: "hidden" });
  });

  it("hides when the character holds zero titles this season", () => {
    expect(resolveTitlePickerState({ titles: [], displayTitle: null })).toEqual({ kind: "hidden" });
  });

  it("is ready with the held titles + current pick when at least one title is held", () => {
    expect(resolveTitlePickerState({ titles: oneTitle, displayTitle: "level.2" })).toEqual({
      kind: "ready",
      titles: oneTitle,
      displayTitle: "level.2",
    });
  });

  it("is ready with a null displayTitle when the player chose not to show one", () => {
    expect(resolveTitlePickerState({ titles: oneTitle, displayTitle: null })).toEqual({
      kind: "ready",
      titles: oneTitle,
      displayTitle: null,
    });
  });
});

describe("nextSocialBadgeAfterTitlePick (Settings title picker -> nameplate seam)", () => {
  it("carries over the current champion flag while swapping the title", () => {
    expect(nextSocialBadgeAfterTitlePick({ title: "old", champion: true }, "new")).toEqual({
      title: "new",
      champion: true,
    });
  });

  it("clears the title (picking 'none') without touching champion", () => {
    expect(nextSocialBadgeAfterTitlePick({ title: "old", champion: true }, null)).toEqual({
      title: null,
      champion: true,
    });
  });

  it("defaults champion to false when no badge exists yet", () => {
    expect(nextSocialBadgeAfterTitlePick(null, "new")).toEqual({ title: "new", champion: false });
  });
});

// ── Podium strip (HOF panel redesign) ───────────────────────────────────────

function championRow(rank: number, overrides: Partial<HofChampionRow> = {}): HofChampionRow {
  return { rank, charName: `Champ${rank}`, cls: "swordsman", value: 100, titleId: `level.${rank}`, ...overrides };
}

const FULL_CHAMPIONS: Record<HofRewardBoard, HofChampionRow[]> = {
  level: [championRow(1), championRow(2), championRow(3)],
  power: [],
  gold: [championRow(1, { charName: "GoldChamp", titleId: "gold.1" })],
  online: [championRow(1, { charName: "OnlineChamp", titleId: "online.1" }), championRow(3, { charName: "OnlineThird", titleId: "online.3" })],
};

describe("isRewardBoard", () => {
  it("is true for the 4 seasonal reward boards", () => {
    expect(isRewardBoard("level")).toBe(true);
    expect(isRewardBoard("power")).toBe(true);
    expect(isRewardBoard("gold")).toBe(true);
    expect(isRewardBoard("online")).toBe(true);
  });

  it("is false for boss (no v1 reward)", () => {
    expect(isRewardBoard("boss")).toBe(false);
  });
});

describe("resolvePodium (keyed by the currently selected board)", () => {
  it("renders no podium at all for boss — not even a loading/empty shell", () => {
    expect(resolvePodium({ season: "2026-07", champions: FULL_CHAMPIONS }, "boss")).toEqual({ kind: "none" });
  });

  it("renders none when rewards data hasn't loaded yet", () => {
    expect(resolvePodium(null, "level")).toEqual({ kind: "none" });
  });

  it("renders noSeason when no season has closed yet", () => {
    expect(resolvePodium({ season: null, champions: FULL_CHAMPIONS }, "level")).toEqual({ kind: "noSeason" });
  });

  it("renders empty for a reward board with zero champion rows", () => {
    expect(resolvePodium({ season: "2026-07", champions: FULL_CHAMPIONS }, "power")).toEqual({ kind: "empty" });
  });

  it("re-keys to the selected board's 3 fixed slots (podium stage)", () => {
    expect(resolvePodium({ season: "2026-07", champions: FULL_CHAMPIONS }, "level")).toEqual({
      kind: "ready",
      rank1: championRow(1),
      rank2: championRow(2),
      rank3: championRow(3),
    });
  });

  it("nulls the missing slots when only rank-1 exists (short board)", () => {
    expect(resolvePodium({ season: "2026-07", champions: FULL_CHAMPIONS }, "gold")).toEqual({
      kind: "ready",
      rank1: championRow(1, { charName: "GoldChamp", titleId: "gold.1" }),
      rank2: null,
      rank3: null,
    });
  });

  it("slots rows by EXACT rank number, not by list position — a pathological rank1+rank3 (no rank2) board leaves rank2 null instead of misplacing rank3 into that seat", () => {
    expect(resolvePodium({ season: "2026-07", champions: FULL_CHAMPIONS }, "online")).toEqual({
      kind: "ready",
      rank1: championRow(1, { charName: "OnlineChamp", titleId: "online.1" }),
      rank2: null,
      rank3: championRow(3, { charName: "OnlineThird", titleId: "online.3" }),
    });
  });
});

describe("rankFromTitleId (podium claim-CTA slot placement)", () => {
  it("parses the trailing rank number off a structural title id", () => {
    expect(rankFromTitleId("level.1")).toBe(1);
    expect(rankFromTitleId("gold.2")).toBe(2);
    expect(rankFromTitleId("online.3")).toBe(3);
  });

  it("is null for an unparseable id", () => {
    expect(rankFromTitleId("level")).toBeNull();
    expect(rankFromTitleId("level.abc")).toBeNull();
    expect(rankFromTitleId("")).toBeNull();
  });
});

describe("resolveMyUnclaimedForBoard / hasAnyUnclaimedAward", () => {
  const awards: HofUnclaimedAward[] = [
    { awardId: "a1", board: "level", titleId: "level.1" },
    { awardId: "a2", board: "gold", titleId: "gold.2" },
  ];

  it("finds the award matching the given board", () => {
    expect(resolveMyUnclaimedForBoard(awards, "level")).toEqual(awards[0]);
    expect(resolveMyUnclaimedForBoard(awards, "gold")).toEqual(awards[1]);
  });

  it("is null when I hold no award on that board", () => {
    expect(resolveMyUnclaimedForBoard(awards, "power")).toBeNull();
    expect(resolveMyUnclaimedForBoard(awards, "boss")).toBeNull();
  });

  it("is null with no awards at all", () => {
    expect(resolveMyUnclaimedForBoard(null, "level")).toBeNull();
    expect(resolveMyUnclaimedForBoard(undefined, "level")).toBeNull();
    expect(resolveMyUnclaimedForBoard([], "level")).toBeNull();
  });

  it("hasAnyUnclaimedAward is true whenever the list is non-empty (any board)", () => {
    expect(hasAnyUnclaimedAward({ unclaimedAwards: awards })).toBe(true);
    expect(hasAnyUnclaimedAward({ unclaimedAwards: [] })).toBe(false);
    expect(hasAnyUnclaimedAward(null)).toBe(false);
    expect(hasAnyUnclaimedAward(undefined)).toBe(false);
  });
});

describe("titleForCharInBoard", () => {
  it("finds the title when the live-list name matches a champion on the same reward board", () => {
    expect(titleForCharInBoard({ champions: FULL_CHAMPIONS }, "level", "Champ2")).toBe("level.2");
  });

  it("is null on a no-match, an unranked board (boss), or absent rewards data", () => {
    expect(titleForCharInBoard({ champions: FULL_CHAMPIONS }, "level", "Nobody")).toBeNull();
    expect(titleForCharInBoard({ champions: FULL_CHAMPIONS }, "boss", "Champ1")).toBeNull();
    expect(titleForCharInBoard(null, "level", "Champ1")).toBeNull();
  });
});

// ── Loading stability (tab-switch skeleton/cache) ───────────────────────────

describe("resolveSkeletonRowCount", () => {
  it("returns the fixed HOF_SKELETON_ROW_COUNT (top-10-per-board cap)", () => {
    expect(resolveSkeletonRowCount()).toBe(HOF_SKELETON_ROW_COUNT);
    expect(resolveSkeletonRowCount()).toBe(10);
  });
});

describe("resolveBoardFetchDecision (session cache: cache hit never shows a skeleton)", () => {
  it("is instant with the cached data on a cache hit — no visible refetch/skeleton", () => {
    const cached = { top: [], me: null };
    expect(resolveBoardFetchDecision(cached, 10)).toEqual({ kind: "instant", data: cached });
  });

  it("is a skeleton with the given row count on a cache miss", () => {
    expect(resolveBoardFetchDecision(undefined, 10)).toEqual({ kind: "skeleton", rowCount: 10 });
  });

  it("treats an empty cached array as a real cache hit (falsy-but-defined data still short-circuits)", () => {
    const cached: unknown[] = [];
    expect(resolveBoardFetchDecision(cached, 5)).toEqual({ kind: "instant", data: cached });
  });
});
