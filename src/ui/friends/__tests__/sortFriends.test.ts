import { describe, expect, it } from "vitest";
import { sortFriendsByPresence } from "@/ui/friends/sortFriends";
import type { FriendWire } from "@/ui/friends/types";

function friend(overrides: Partial<FriendWire> & Pick<FriendWire, "userId">): FriendWire {
  return {
    displayName: overrides.userId,
    friendCode: null,
    online: false,
    currentCharacter: null,
    lastZone: null,
    lastSeenAt: null,
    title: null,
    champion: false,
    ...overrides,
  };
}

describe("sortFriendsByPresence", () => {
  it("puts every online friend before every offline friend", () => {
    const a = friend({ userId: "offline-a", online: false, lastSeenAt: "2026-07-08T00:00:00.000Z" });
    const b = friend({ userId: "online-b", online: true });
    const c = friend({ userId: "offline-c", online: false, lastSeenAt: "2026-07-07T00:00:00.000Z" });
    const sorted = sortFriendsByPresence([a, b, c]);
    expect(sorted.map((f) => f.userId)).toEqual(["online-b", "offline-a", "offline-c"]);
  });

  it("sorts offline friends MOST-recently-seen first, longest-offline last", () => {
    const recent = friend({ userId: "recent", online: false, lastSeenAt: "2026-07-08T12:00:00.000Z" });
    const stale = friend({ userId: "stale", online: false, lastSeenAt: "2026-07-01T00:00:00.000Z" });
    const middling = friend({ userId: "middling", online: false, lastSeenAt: "2026-07-05T00:00:00.000Z" });
    const sorted = sortFriendsByPresence([stale, recent, middling]);
    expect(sorted.map((f) => f.userId)).toEqual(["recent", "middling", "stale"]);
  });

  it("puts a never-seen (null lastSeenAt) friend at the very bottom of offline", () => {
    const neverSeen = friend({ userId: "never", online: false, lastSeenAt: null });
    const seenLongAgo = friend({ userId: "long-ago", online: false, lastSeenAt: "2020-01-01T00:00:00.000Z" });
    const sorted = sortFriendsByPresence([neverSeen, seenLongAgo]);
    expect(sorted.map((f) => f.userId)).toEqual(["long-ago", "never"]);
  });

  it("does not mutate the input array", () => {
    const list = [friend({ userId: "x", online: false }), friend({ userId: "y", online: true })];
    const copy = [...list];
    sortFriendsByPresence(list);
    expect(list).toEqual(copy);
  });
});
