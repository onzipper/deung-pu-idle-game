import { describe, expect, it } from "vitest";
import { ingestAnnouncements } from "../queue";
import type { AnnouncementWire } from "../types";

function wire(over: Partial<AnnouncementWire> = {}): AnnouncementWire {
  return {
    id: "ann_1",
    characterId: "char_other",
    charName: "แต้ม",
    templateId: "w_sword_t3_epic",
    refineLevel: 8,
    at: new Date().toISOString(),
    ...over,
  };
}

describe("ingestAnnouncements", () => {
  it("queues a fresh, not-mine entry and marks it seen", () => {
    const { toQueue, seenIds } = ingestAnnouncements([wire()], new Set(), "char_me");
    expect(toQueue).toEqual([
      { id: "ann_1", charName: "แต้ม", templateId: "w_sword_t3_epic", refineLevel: 8 },
    ]);
    expect(seenIds.has("ann_1")).toBe(true);
  });

  it("excludes the viewer's own characterId from the display queue", () => {
    const { toQueue, seenIds } = ingestAnnouncements(
      [wire({ characterId: "char_me" })],
      new Set(),
      "char_me",
    );
    expect(toQueue).toEqual([]);
    // Still marked seen so a later poll (same 5-min window) doesn't re-scan it.
    expect(seenIds.has("ann_1")).toBe(true);
  });

  it("never re-queues an id already in seenIds (repeat poll of the same window)", () => {
    const { toQueue } = ingestAnnouncements([wire()], new Set(["ann_1"]), "char_me");
    expect(toQueue).toEqual([]);
  });

  it("orders queued entries oldest-first even though the wire feed is newest-first", () => {
    const newest = wire({ id: "ann_2", charName: "b" });
    const oldest = wire({ id: "ann_1", charName: "a" });
    const { toQueue } = ingestAnnouncements([newest, oldest], new Set(), "char_me");
    expect(toQueue.map((e) => e.id)).toEqual(["ann_1", "ann_2"]);
  });

  it("treats a null myCharacterId (pre-boot) as excluding nothing", () => {
    const { toQueue } = ingestAnnouncements([wire({ characterId: "char_x" })], new Set(), null);
    expect(toQueue).toHaveLength(1);
  });

  it("returns an empty toQueue and unchanged seenIds for an empty batch", () => {
    const seen = new Set(["ann_9"]);
    const { toQueue, seenIds } = ingestAnnouncements([], seen, "char_me");
    expect(toQueue).toEqual([]);
    expect(seenIds).toEqual(seen);
  });
});
