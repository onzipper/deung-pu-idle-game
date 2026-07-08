import { describe, expect, it } from "vitest";
import { stepAnimatedChips, type AnimatedChip } from "@/ui/buffs/animatedChips";

describe("stepAnimatedChips", () => {
  it("seeds brand-new keys as 'entering'", () => {
    const result = stepAnimatedChips([], [{ key: "a", item: 1 }]);
    expect(result).toEqual([{ key: "a", item: 1, phase: "entering" }]);
  });

  it("keeps a still-present key idle and refreshes its item payload", () => {
    const prev: AnimatedChip<number>[] = [{ key: "a", item: 1, phase: "idle" }];
    const result = stepAnimatedChips(prev, [{ key: "a", item: 2 }]);
    expect(result).toEqual([{ key: "a", item: 2, phase: "idle" }]);
  });

  it("does NOT flip an 'entering' key to idle just because it's still present next step (the caller's rAF does that)", () => {
    const prev: AnimatedChip<number>[] = [{ key: "a", item: 1, phase: "entering" }];
    const result = stepAnimatedChips(prev, [{ key: "a", item: 1 }]);
    expect(result).toEqual([{ key: "a", item: 1, phase: "entering" }]);
  });

  it("moves a key that disappeared from the desired list to 'exiting', keeping its last item", () => {
    const prev: AnimatedChip<number>[] = [{ key: "a", item: 1, phase: "idle" }];
    const result = stepAnimatedChips(prev, []);
    expect(result).toEqual([{ key: "a", item: 1, phase: "exiting" }]);
  });

  it("leaves an already-exiting key untouched even if it reappears in the desired list mid-exit", () => {
    const prev: AnimatedChip<number>[] = [{ key: "a", item: 1, phase: "exiting" }];
    const result = stepAnimatedChips(prev, [{ key: "a", item: 99 }]);
    // Still exiting with the STALE item — a reappearing key waits for its
    // exit to finish (caller removes it) before re-entering fresh.
    expect(result).toEqual([{ key: "a", item: 1, phase: "exiting" }]);
  });

  it("handles a mixed step: one key persists, one exits, one enters, in one call", () => {
    const prev: AnimatedChip<string>[] = [
      { key: "keep", item: "keep-old", phase: "idle" },
      { key: "leave", item: "leave-item", phase: "idle" },
    ];
    const result = stepAnimatedChips(prev, [
      { key: "keep", item: "keep-new" },
      { key: "join", item: "join-item" },
    ]);
    expect(result).toEqual([
      { key: "keep", item: "keep-new", phase: "idle" },
      { key: "leave", item: "leave-item", phase: "exiting" },
      { key: "join", item: "join-item", phase: "entering" },
    ]);
  });

  it("is a no-op shape-wise when called repeatedly with the same steady-state input", () => {
    let list: AnimatedChip<number>[] = [];
    list = stepAnimatedChips(list, [{ key: "a", item: 1 }]);
    list = list.map((c) => ({ ...c, phase: "idle" as const })); // simulate the rAF flip
    const again = stepAnimatedChips(list, [{ key: "a", item: 1 }]);
    expect(again).toEqual([{ key: "a", item: 1, phase: "idle" }]);
  });
});
