import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Friends / social-graph domain tests (M8 Phase 1). Prisma is mocked (no DB), the
 * same pattern as auth.test.ts / characters.test.ts. These exercise the pure logic:
 * the guest gate, canonical-pair ordering, reverse-pending auto-accept, the emoji
 * allowlist + rate limit, the poll's mark-seen/purge, and either-side removal.
 */

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    character: { findMany: vi.fn() },
    friendship: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    friendRequest: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    emojiPing: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    // M8 party — getFriendsPanel folds party state in via loadPartyState().
    partyMember: { findUnique: vi.fn() },
    party: { findUnique: vi.fn() },
    partyInvite: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import {
  sortPair,
  EMOJI_ALLOWLIST,
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
  getFriendsPanel,
  sendEmoji,
} from "@/server/friends";

const ME = "user_m";

/** Prime the isRegistered() guard's first user.findUnique call. */
function registered() {
  mockPrisma.user.findUnique.mockResolvedValueOnce({ registeredAt: new Date() });
}
function guest() {
  mockPrisma.user.findUnique.mockResolvedValueOnce({ registeredAt: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Interactive transaction: invoke the callback with the mocked client as `tx`.
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => unknown) =>
    fn(mockPrisma),
  );
  // Default M8 party state = "not in a party, no invites" so the existing
  // getFriendsPanel assertions are unaffected by the party fold-in.
  mockPrisma.partyMember.findUnique.mockResolvedValue(null);
  mockPrisma.partyInvite.findMany.mockResolvedValue([]);
});

describe("sortPair", () => {
  it("always returns [smaller, larger] regardless of argument order", () => {
    expect(sortPair("a", "b")).toEqual(["a", "b"]);
    expect(sortPair("b", "a")).toEqual(["a", "b"]);
    expect(sortPair("user_z", "user_a")).toEqual(["user_a", "user_z"]);
  });
});

describe("guest gate (account_required 403 surface)", () => {
  it("blocks every friend action for an unregistered user", async () => {
    guest();
    expect((await sendFriendRequest(ME, { friendCode: "ABCD2345" })).ok).toBe(false);
    guest();
    expect((await respondFriendRequest(ME, { requestId: "r1", accept: true })).ok).toBe(false);
    guest();
    expect((await removeFriend(ME, { userId: "u2" })).ok).toBe(false);
    guest();
    expect((await getFriendsPanel(ME)).ok).toBe(false);
    guest();
    const e = await sendEmoji(ME, { toUserId: "u2", emoji: "👍" });
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.code).toBe("account_required");
  });
});

describe("sendFriendRequest", () => {
  it("rejects friending yourself", async () => {
    registered();
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: ME, registeredAt: new Date() });
    const r = await sendFriendRequest(ME, { friendCode: "SELF2345" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("self");
  });

  it("404s an unknown friend code", async () => {
    registered();
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    const r = await sendFriendRequest(ME, { friendCode: "NOPE2345" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_found");
  });

  it("rejects when already friends", async () => {
    registered();
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "user_t", registeredAt: new Date() });
    mockPrisma.friendship.findUnique.mockResolvedValueOnce({ id: "f1" });
    const r = await sendFriendRequest(ME, { friendCode: "FRND2345" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("already_friends");
  });

  it("auto-accepts when a reverse request already exists (canonical pair)", async () => {
    registered();
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "user_a", registeredAt: new Date() });
    mockPrisma.friendship.findUnique.mockResolvedValueOnce(null); // not friends yet
    mockPrisma.friendRequest.findUnique.mockResolvedValueOnce({ id: "req_rev" }); // reverse pending
    mockPrisma.friendRequest.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.friendship.create.mockResolvedValue({});

    const r = await sendFriendRequest(ME, { friendCode: "AAAA2345" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.autoAccepted).toBe(true);
    // Canonical: sortPair(ME="user_m", "user_a") = [user_a, user_m].
    expect(mockPrisma.friendship.create).toHaveBeenCalledWith({
      data: { userAId: "user_a", userBId: ME },
    });
    expect(mockPrisma.friendRequest.create).not.toHaveBeenCalled();
  });

  it("creates a fresh request when there is no reverse pending", async () => {
    registered();
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "user_t", registeredAt: new Date() });
    mockPrisma.friendship.findUnique.mockResolvedValueOnce(null);
    mockPrisma.friendRequest.findUnique
      .mockResolvedValueOnce(null) // reverse
      .mockResolvedValueOnce(null); // forward
    mockPrisma.friendRequest.count.mockResolvedValueOnce(3);
    mockPrisma.friendRequest.create.mockResolvedValue({});
    const r = await sendFriendRequest(ME, { friendCode: "TTTT2345" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.autoAccepted).toBe(false);
    expect(mockPrisma.friendRequest.create).toHaveBeenCalledWith({
      data: { fromUserId: ME, toUserId: "user_t" },
    });
  });

  it("caps outgoing pending at 20", async () => {
    registered();
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "user_t", registeredAt: new Date() });
    mockPrisma.friendship.findUnique.mockResolvedValueOnce(null);
    mockPrisma.friendRequest.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    mockPrisma.friendRequest.count.mockResolvedValueOnce(20);
    const r = await sendFriendRequest(ME, { friendCode: "TTTT2345" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("too_many_pending");
    expect(mockPrisma.friendRequest.create).not.toHaveBeenCalled();
  });

  it("returns candidates when a character name matches multiple registered users", async () => {
    registered();
    mockPrisma.character.findMany.mockResolvedValueOnce([
      {
        userId: "user_a",
        name: "Nong",
        baseClass: "mage",
        level: 12,
        user: { registeredAt: new Date(), friendCode: "AAAA2345" },
      },
      {
        userId: "user_b",
        name: "Nong",
        baseClass: "archer",
        level: 40,
        user: { registeredAt: new Date(), friendCode: "BBBB2345" },
      },
    ]);
    const r = await sendFriendRequest(ME, { characterName: "Nong" });
    expect(r.ok).toBe(false);
    if (!r.ok && r.code === "multiple_matches") {
      expect(r.candidates).toHaveLength(2);
      expect(r.candidates[0]).toMatchObject({ characterName: "Nong", friendCode: "AAAA2345" });
    } else {
      throw new Error("expected multiple_matches");
    }
  });

  it("ignores unregistered owners on a name lookup (not_found)", async () => {
    registered();
    mockPrisma.character.findMany.mockResolvedValueOnce([
      { userId: "guest_x", name: "Solo", baseClass: "mage", level: 5, user: { registeredAt: null, friendCode: null } },
    ]);
    const r = await sendFriendRequest(ME, { characterName: "Solo" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_found");
  });
});

describe("respondFriendRequest", () => {
  it("accepts only for the addressee and creates a canonical friendship", async () => {
    registered();
    mockPrisma.friendRequest.findUnique.mockResolvedValueOnce({
      id: "req1",
      fromUserId: "user_x",
      toUserId: ME,
    });
    mockPrisma.friendRequest.delete.mockResolvedValue({});
    mockPrisma.friendship.create.mockResolvedValue({});
    const r = await respondFriendRequest(ME, { requestId: "req1", accept: true });
    expect(r.ok).toBe(true);
    // sortPair("user_x", ME="user_m") = [user_m, user_x].
    expect(mockPrisma.friendship.create).toHaveBeenCalledWith({
      data: { userAId: ME, userBId: "user_x" },
    });
    expect(mockPrisma.friendRequest.delete).toHaveBeenCalledWith({ where: { id: "req1" } });
  });

  it("declines by deleting the request (no friendship)", async () => {
    registered();
    mockPrisma.friendRequest.findUnique.mockResolvedValueOnce({
      id: "req1",
      fromUserId: "user_x",
      toUserId: ME,
    });
    mockPrisma.friendRequest.delete.mockResolvedValue({});
    const r = await respondFriendRequest(ME, { requestId: "req1", accept: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.accepted).toBe(false);
    expect(mockPrisma.friendship.create).not.toHaveBeenCalled();
  });

  it("404s when the responder is not the addressee", async () => {
    registered();
    mockPrisma.friendRequest.findUnique.mockResolvedValueOnce({
      id: "req1",
      fromUserId: "user_x",
      toUserId: "someone_else",
    });
    const r = await respondFriendRequest(ME, { requestId: "req1", accept: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_found");
  });
});

describe("removeFriend", () => {
  it("removes from EITHER side with the same canonical where clause", async () => {
    registered();
    mockPrisma.friendship.deleteMany.mockResolvedValueOnce({ count: 1 });
    await removeFriend("user_z", { userId: "user_a" });
    registered();
    mockPrisma.friendship.deleteMany.mockResolvedValueOnce({ count: 1 });
    await removeFriend("user_a", { userId: "user_z" });
    const [first, second] = mockPrisma.friendship.deleteMany.mock.calls;
    expect(first[0]).toEqual({ where: { userAId: "user_a", userBId: "user_z" } });
    expect(second[0]).toEqual({ where: { userAId: "user_a", userBId: "user_z" } });
  });
});

describe("getFriendsPanel", () => {
  it("marks unseen pings seen, purges older, and derives presence", async () => {
    registered();
    const now = new Date("2026-07-07T12:00:00Z");
    mockPrisma.emojiPing.findMany.mockResolvedValueOnce([
      { id: "p1", fromUserId: "user_f", emoji: "👍", sentAt: new Date("2026-07-07T11:59:00Z") },
    ]);
    mockPrisma.emojiPing.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.emojiPing.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.friendship.findMany.mockResolvedValueOnce([{ userAId: "user_f", userBId: ME }]);
    mockPrisma.friendRequest.findMany.mockResolvedValueOnce([]);
    mockPrisma.user.findMany.mockResolvedValueOnce([
      { id: "user_f", displayName: "Fren", friendCode: "FFFF2345" },
    ]);
    mockPrisma.character.findMany.mockResolvedValueOnce([
      {
        userId: "user_f",
        name: "FrenChar",
        baseClass: "mage",
        level: 22,
        lastZone: "map2:3",
        save: { lastSeen: new Date("2026-07-07T11:59:30Z") }, // 30s ago → online
      },
    ]);

    const res = await getFriendsPanel(ME, now);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(mockPrisma.emojiPing.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] } },
      data: { seenAt: now },
    });
    expect(res.panel.emojiPings).toHaveLength(1);
    expect(res.panel.emojiPings[0]).toMatchObject({ emoji: "👍", fromDisplayName: "Fren" });
    expect(res.panel.friends).toHaveLength(1);
    const f = res.panel.friends[0];
    expect(f).toMatchObject({
      userId: "user_f",
      displayName: "Fren",
      online: true,
      lastZone: "map2:3",
    });
    expect(f.currentCharacter).toEqual({ name: "FrenChar", class: "mage", level: 22 });
  });

  it("marks a friend offline when the last save is beyond the window", async () => {
    registered();
    const now = new Date("2026-07-07T12:00:00Z");
    mockPrisma.emojiPing.findMany.mockResolvedValueOnce([]);
    mockPrisma.emojiPing.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.friendship.findMany.mockResolvedValueOnce([{ userAId: ME, userBId: "user_g" }]);
    mockPrisma.friendRequest.findMany.mockResolvedValueOnce([]);
    mockPrisma.user.findMany.mockResolvedValueOnce([
      { id: "user_g", displayName: null, friendCode: "GGGG2345" },
    ]);
    mockPrisma.character.findMany.mockResolvedValueOnce([
      {
        userId: "user_g",
        name: "GoneChar",
        baseClass: "archer",
        level: 8,
        lastZone: "map1:0",
        save: { lastSeen: new Date("2026-07-07T11:50:00Z") }, // 10 min ago → offline
      },
    ]);
    const res = await getFriendsPanel(ME, now);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const f = res.panel.friends[0];
    expect(f.online).toBe(false);
    // displayName falls back to the most-recent character's name.
    expect(f.displayName).toBe("GoneChar");
  });
});

describe("sendEmoji", () => {
  it("rejects an emoji outside the allowlist", async () => {
    registered();
    const r = await sendEmoji(ME, { toUserId: "user_f", emoji: "💩" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("bad_emoji");
    expect(mockPrisma.emojiPing.create).not.toHaveBeenCalled();
  });

  it("rejects a ping to a non-friend", async () => {
    registered();
    mockPrisma.friendship.findUnique.mockResolvedValueOnce(null);
    const r = await sendEmoji(ME, { toUserId: "user_x", emoji: "👍" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_friends");
  });

  it("rate-limits at 10 pings per minute", async () => {
    registered();
    mockPrisma.friendship.findUnique.mockResolvedValueOnce({ id: "f1" });
    mockPrisma.emojiPing.count.mockResolvedValueOnce(10);
    const r = await sendEmoji(ME, { toUserId: "user_f", emoji: "🔥" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("rate_limited");
    expect(mockPrisma.emojiPing.create).not.toHaveBeenCalled();
  });

  it("sends a valid ping to a friend under the limit", async () => {
    registered();
    mockPrisma.friendship.findUnique.mockResolvedValueOnce({ id: "f1" });
    mockPrisma.emojiPing.count.mockResolvedValueOnce(2);
    mockPrisma.emojiPing.create.mockResolvedValue({});
    const r = await sendEmoji(ME, { toUserId: "user_f", emoji: "⚔️" });
    expect(r.ok).toBe(true);
    expect(mockPrisma.emojiPing.create).toHaveBeenCalledWith({
      data: { fromUserId: ME, toUserId: "user_f", emoji: "⚔️" },
    });
  });

  it("keeps the allowlist to the 12 pre-2020 glyphs", () => {
    expect(EMOJI_ALLOWLIST).toHaveLength(12);
    expect(new Set(EMOJI_ALLOWLIST).size).toBe(12);
  });
});
