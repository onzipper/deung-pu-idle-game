import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Party domain tests (M8 Phase 1). Prisma is mocked (no DB), mirroring
 * friends.test.ts. These exercise the pure logic: the guest gate, the
 * friendship precondition + dedupe on invite, the accept-time cap-3 + one-party
 * rules, and the deterministic leave (promotion + dissolve).
 */

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn() },
    friendship: { findUnique: vi.fn() },
    partyMember: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    party: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    partyInvite: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import {
  invitePartyMember,
  respondPartyInvite,
  leaveParty,
  loadPartyState,
  MAX_PARTY_SIZE,
} from "@/server/party";

const ME = "user_m";

/** Prime the isRegistered() guard (friends.ts) — its first user.findUnique. */
function registered() {
  mockPrisma.user.findUnique.mockResolvedValueOnce({ registeredAt: new Date() });
}
function guest() {
  mockPrisma.user.findUnique.mockResolvedValueOnce({ registeredAt: null });
}
/** Prime areFriends() (friends.ts) — its friendship.findUnique lookup. */
function friends(isFriend: boolean) {
  mockPrisma.friendship.findUnique.mockResolvedValueOnce(isFriend ? { id: "f1" } : null);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => unknown) =>
    fn(mockPrisma),
  );
});

describe("guest gate (account_required)", () => {
  it("blocks every party action for an unregistered user", async () => {
    guest();
    expect((await invitePartyMember(ME, { toUserId: "u2" })).ok).toBe(false);
    guest();
    expect((await respondPartyInvite(ME, { inviteId: "i1", accept: true })).ok).toBe(false);
    guest();
    const l = await leaveParty(ME);
    expect(l.ok).toBe(false);
    if (!l.ok) expect(l.code).toBe("account_required");
  });
});

describe("invitePartyMember", () => {
  it("rejects inviting yourself", async () => {
    registered();
    const r = await invitePartyMember(ME, { toUserId: ME });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("self");
  });

  it("requires an existing friendship", async () => {
    registered();
    friends(false);
    const r = await invitePartyMember(ME, { toUserId: "u2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_friends");
    expect(mockPrisma.partyInvite.create).not.toHaveBeenCalled();
  });

  it("rejects when my party is already full", async () => {
    registered();
    friends(true);
    mockPrisma.partyMember.findUnique.mockResolvedValueOnce({ partyId: "p1" }); // my membership
    mockPrisma.partyMember.count.mockResolvedValueOnce(MAX_PARTY_SIZE);
    const r = await invitePartyMember(ME, { toUserId: "u2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("party_full");
  });

  it("rejects a target already in my party", async () => {
    registered();
    friends(true);
    mockPrisma.partyMember.findUnique
      .mockResolvedValueOnce({ partyId: "p1" }) // my membership
      .mockResolvedValueOnce({ partyId: "p1" }); // target's membership (same party)
    mockPrisma.partyMember.count.mockResolvedValueOnce(2);
    const r = await invitePartyMember(ME, { toUserId: "u2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("already_member");
  });

  it("dedupes a same-direction pending invite", async () => {
    registered();
    friends(true);
    mockPrisma.partyMember.findUnique.mockResolvedValueOnce(null); // no party yet
    mockPrisma.partyInvite.count.mockResolvedValueOnce(0);
    mockPrisma.partyInvite.findFirst.mockResolvedValueOnce({ id: "existing" });
    const r = await invitePartyMember(ME, { toUserId: "u2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("already_invited");
    expect(mockPrisma.partyInvite.create).not.toHaveBeenCalled();
  });

  it("caps outstanding pending invites", async () => {
    registered();
    friends(true);
    mockPrisma.partyMember.findUnique.mockResolvedValueOnce(null);
    mockPrisma.partyInvite.count.mockResolvedValueOnce(5);
    const r = await invitePartyMember(ME, { toUserId: "u2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("too_many_pending");
  });

  it("creates a pending invite when there is room and no dupe", async () => {
    registered();
    friends(true);
    mockPrisma.partyMember.findUnique.mockResolvedValueOnce(null);
    mockPrisma.partyInvite.count.mockResolvedValueOnce(0);
    mockPrisma.partyInvite.findFirst.mockResolvedValueOnce(null);
    mockPrisma.partyInvite.create.mockResolvedValue({});
    const r = await invitePartyMember(ME, { toUserId: "u2" });
    expect(r.ok).toBe(true);
    expect(mockPrisma.partyInvite.create).toHaveBeenCalledWith({
      data: { fromUserId: ME, toUserId: "u2", status: "pending" },
    });
  });
});

describe("respondPartyInvite", () => {
  it("404s a missing / foreign / non-pending invite", async () => {
    registered();
    mockPrisma.partyInvite.findUnique.mockResolvedValueOnce({
      id: "i1",
      fromUserId: "u2",
      toUserId: "someone_else", // not me
      status: "pending",
    });
    const r = await respondPartyInvite(ME, { inviteId: "i1", accept: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_found");
  });

  it("declines by deleting the invite (no membership created)", async () => {
    registered();
    mockPrisma.partyInvite.findUnique.mockResolvedValueOnce({
      id: "i1",
      fromUserId: "u2",
      toUserId: ME,
      status: "pending",
    });
    mockPrisma.partyInvite.delete.mockResolvedValue({});
    const r = await respondPartyInvite(ME, { inviteId: "i1", accept: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.accepted).toBe(false);
    expect(mockPrisma.partyMember.create).not.toHaveBeenCalled();
    expect(mockPrisma.partyInvite.delete).toHaveBeenCalledWith({ where: { id: "i1" } });
  });

  it("rejects accepting while already in a party (explicit leave required)", async () => {
    registered();
    mockPrisma.partyInvite.findUnique.mockResolvedValueOnce({
      id: "i1",
      fromUserId: "u2",
      toUserId: ME,
      status: "pending",
    });
    mockPrisma.partyMember.findUnique.mockResolvedValueOnce({ partyId: "other" }); // I'm in a party
    const r = await respondPartyInvite(ME, { inviteId: "i1", accept: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("already_in_party");
    expect(mockPrisma.partyMember.create).not.toHaveBeenCalled();
  });

  it("enforces the MAX_PARTY_SIZE cap at accept-time (race re-check under the party row-lock)", async () => {
    registered();
    mockPrisma.partyInvite.findUnique.mockResolvedValueOnce({
      id: "i1",
      fromUserId: "u2",
      toUserId: ME,
      status: "pending",
    });
    mockPrisma.partyMember.findUnique
      .mockResolvedValueOnce(null) // I'm not in a party
      .mockResolvedValueOnce({ partyId: "p1" }); // inviter's party
    mockPrisma.party.update.mockResolvedValue({}); // acquires the row lock
    mockPrisma.partyMember.count.mockResolvedValueOnce(MAX_PARTY_SIZE); // already full after the lock
    const r = await respondPartyInvite(ME, { inviteId: "i1", accept: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("party_full");
    expect(mockPrisma.party.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: {} });
    expect(mockPrisma.partyMember.create).not.toHaveBeenCalled();
  });

  it("lazily creates the inviter's party when they have none, then joins", async () => {
    registered();
    mockPrisma.partyInvite.findUnique.mockResolvedValueOnce({
      id: "i1",
      fromUserId: "u2",
      toUserId: ME,
      status: "pending",
    });
    mockPrisma.partyMember.findUnique
      .mockResolvedValueOnce(null) // me: no party
      .mockResolvedValueOnce(null); // inviter: no party
    mockPrisma.party.create.mockResolvedValueOnce({ id: "p_new" });
    mockPrisma.partyMember.create.mockResolvedValue({});
    mockPrisma.partyInvite.delete.mockResolvedValue({});
    const r = await respondPartyInvite(ME, { inviteId: "i1", accept: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.accepted).toBe(true);
    expect(mockPrisma.party.create).toHaveBeenCalledWith({ data: { leaderUserId: "u2" } });
    // inviter added first (as leader/member), then me.
    expect(mockPrisma.partyMember.create).toHaveBeenNthCalledWith(1, {
      data: { partyId: "p_new", userId: "u2" },
    });
    expect(mockPrisma.partyMember.create).toHaveBeenNthCalledWith(2, {
      data: { partyId: "p_new", userId: ME },
    });
    expect(mockPrisma.partyInvite.delete).toHaveBeenCalledWith({ where: { id: "i1" } });
  });
});

describe("leaveParty", () => {
  it("is idempotent when I'm not in a party", async () => {
    registered();
    mockPrisma.partyMember.findUnique.mockResolvedValueOnce(null);
    const r = await leaveParty(ME);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.left).toBe(false);
      expect(r.dissolved).toBe(false);
    }
  });

  it("promotes the oldest remaining member when the LEADER leaves", async () => {
    registered();
    mockPrisma.partyMember.findUnique.mockResolvedValueOnce({ id: "m_me", partyId: "p1" });
    mockPrisma.partyMember.delete.mockResolvedValue({});
    mockPrisma.partyMember.findMany.mockResolvedValueOnce([
      { userId: "u2" }, // oldest remaining
      { userId: "u3" },
    ]);
    mockPrisma.party.findUnique.mockResolvedValueOnce({ leaderUserId: ME }); // I was leader
    mockPrisma.party.update.mockResolvedValue({});
    const r = await leaveParty(ME);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dissolved).toBe(false);
      expect(r.promoted).toBe("u2");
    }
    expect(mockPrisma.party.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { leaderUserId: "u2" },
    });
  });

  it("does NOT promote when a non-leader leaves", async () => {
    registered();
    mockPrisma.partyMember.findUnique.mockResolvedValueOnce({ id: "m_me", partyId: "p1" });
    mockPrisma.partyMember.delete.mockResolvedValue({});
    mockPrisma.partyMember.findMany.mockResolvedValueOnce([{ userId: "leader" }]);
    mockPrisma.party.findUnique.mockResolvedValueOnce({ leaderUserId: "leader" });
    const r = await leaveParty(ME);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.promoted).toBe(null);
    expect(mockPrisma.party.update).not.toHaveBeenCalled();
  });

  it("dissolves the party when the last member leaves", async () => {
    registered();
    mockPrisma.partyMember.findUnique.mockResolvedValueOnce({ id: "m_me", partyId: "p1" });
    mockPrisma.partyMember.delete.mockResolvedValue({});
    mockPrisma.partyMember.findMany.mockResolvedValueOnce([]); // none left
    mockPrisma.party.delete.mockResolvedValue({});
    const r = await leaveParty(ME);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dissolved).toBe(true);
    expect(mockPrisma.party.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
  });
});

describe("loadPartyState", () => {
  it("returns null party + no invites when I'm not in a party", async () => {
    mockPrisma.partyMember.findUnique.mockResolvedValueOnce(null);
    mockPrisma.partyInvite.findMany.mockResolvedValueOnce([]);
    const s = await loadPartyState(ME);
    expect(s.party).toBe(null);
    expect(s.incomingInvites).toEqual([]);
  });

  it("orders members leader-first then by joinedAt", async () => {
    mockPrisma.partyMember.findUnique.mockResolvedValueOnce({ partyId: "p1" });
    mockPrisma.party.findUnique.mockResolvedValueOnce({
      id: "p1",
      leaderUserId: "leader",
      members: [{ userId: "u2" }, { userId: "leader" }, { userId: "u3" }], // joinedAt asc
    });
    mockPrisma.partyInvite.findMany.mockResolvedValueOnce([]);
    const s = await loadPartyState(ME);
    expect(s.party?.memberUserIds).toEqual(["leader", "u2", "u3"]);
  });
});
