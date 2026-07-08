import { describe, expect, it } from "vitest";
import {
  claimStateAfterResult,
  isMyEntry,
  resolveTitlePickerState,
} from "@/ui/hof/rewardsLogic";
import type { HofMyTitle } from "@/ui/hof/rewardsTypes";

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
