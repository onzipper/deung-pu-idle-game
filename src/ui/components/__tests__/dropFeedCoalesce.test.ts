import { describe, expect, it } from "vitest";
import {
  coalesceDropFeed,
  dismissCoalesced,
  partitionDropFeed,
  DROP_FEED_VISIBLE_CAP,
  EMPTY_COALESCE_STATE,
  type CoalesceIncoming,
} from "@/ui/components/dropFeedCoalesce";
import type { DropFeedEntry } from "@/ui/store/gameStore";

function item(id: string, templateId = "wpn_1"): CoalesceIncoming {
  return { kind: "item", id, templateId, rarity: "common" };
}

function stone(id: string, qty: number): CoalesceIncoming {
  return { kind: "stone", id, qty };
}

describe("coalesceDropFeed", () => {
  it("pushes under the cap without evicting anything", () => {
    let state = EMPTY_COALESCE_STATE;
    state = coalesceDropFeed(state, item("a"));
    state = coalesceDropFeed(state, item("b"));
    expect(state.visible.map((v) => v.id)).toEqual(["a", "b"]);
    expect(state.overflow).toBe(0);
  });

  it("evicts the oldest visible pill once capped and accrues +N overflow", () => {
    let state = EMPTY_COALESCE_STATE;
    state = coalesceDropFeed(state, item("a"));
    state = coalesceDropFeed(state, item("b"));
    state = coalesceDropFeed(state, item("c"));
    expect(state.visible).toHaveLength(DROP_FEED_VISIBLE_CAP);

    state = coalesceDropFeed(state, item("d"));
    expect(state.visible.map((v) => v.id)).toEqual(["b", "c", "d"]);
    expect(state.overflow).toBe(1);

    state = coalesceDropFeed(state, item("e"));
    expect(state.visible.map((v) => v.id)).toEqual(["c", "d", "e"]);
    expect(state.overflow).toBe(2);
  });

  it("merges consecutive stone pickups into one pill with a running qty and a fresh id", () => {
    let state = EMPTY_COALESCE_STATE;
    state = coalesceDropFeed(state, stone("s1", 2));
    state = coalesceDropFeed(state, stone("s2", 3));
    expect(state.visible).toHaveLength(1);
    const pill = state.visible[0];
    expect(pill.kind).toBe("stone");
    expect(pill).toMatchObject({ id: "s2", qty: 5 });
  });

  it("does not merge a stone into a non-stone newest pill", () => {
    let state = EMPTY_COALESCE_STATE;
    state = coalesceDropFeed(state, item("a"));
    state = coalesceDropFeed(state, stone("s1", 2));
    expect(state.visible.map((v) => v.id)).toEqual(["a", "s1"]);
  });

  it("resets overflow to 0 once the stack empties via dismissCoalesced", () => {
    let state = EMPTY_COALESCE_STATE;
    state = coalesceDropFeed(state, item("a"));
    state = coalesceDropFeed(state, item("b"));
    state = coalesceDropFeed(state, item("c"));
    state = coalesceDropFeed(state, item("d")); // evicts "a", overflow -> 1
    expect(state.overflow).toBe(1);

    state = dismissCoalesced(state, "b");
    state = dismissCoalesced(state, "c");
    expect(state.overflow).toBe(1); // still non-empty, overflow persists

    state = dismissCoalesced(state, "d");
    expect(state.visible).toHaveLength(0);
    expect(state.overflow).toBe(0);
  });

  it("starts a fresh overflow count after the stack has gone quiet", () => {
    let state = EMPTY_COALESCE_STATE;
    state = coalesceDropFeed(state, item("a"));
    state = coalesceDropFeed(state, item("b"));
    state = coalesceDropFeed(state, item("c"));
    state = coalesceDropFeed(state, item("d")); // overflow -> 1
    state = dismissCoalesced(state, "b");
    state = dismissCoalesced(state, "c");
    state = dismissCoalesced(state, "d"); // empties out, overflow -> 0

    state = coalesceDropFeed(state, item("e"));
    state = coalesceDropFeed(state, item("f"));
    state = coalesceDropFeed(state, item("g"));
    state = coalesceDropFeed(state, item("h")); // capped again, overflow -> 1
    expect(state.overflow).toBe(1);
  });
});

describe("partitionDropFeed", () => {
  it("keeps epic out of the coalescable subset, uncoalesced", () => {
    const dropFeed: DropFeedEntry[] = [
      { id: "1", templateId: "wpn_1", rarity: "common" },
      { id: "2", templateId: "wpn_2", rarity: "rare" },
      { id: "3", templateId: "wpn_3", rarity: "epic" },
      { id: "4", templateId: "wpn_4", rarity: "epic" },
    ];
    const { epic, coalescable } = partitionDropFeed(dropFeed);
    expect(epic.map((e) => e.id)).toEqual(["3", "4"]);
    expect(coalescable.map((e) => e.id)).toEqual(["1", "2"]);
    expect(coalescable.every((e) => e.rarity !== "epic")).toBe(true);
  });

  it("returns empty subsets for an empty feed", () => {
    const { epic, coalescable } = partitionDropFeed([]);
    expect(epic).toEqual([]);
    expect(coalescable).toEqual([]);
  });
});
