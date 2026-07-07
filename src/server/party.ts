/**
 * Party domain (M8 Phase 1 — social container, polling, no websockets).
 *
 * A party is a MEMBERSHIP CONTAINER only this wave: max 3 members, free-roam, no
 * gameplay coupling (the lockstep cohort sim is a later wave, docs/party-design-m8.md).
 *
 * Trust boundary (mirrors friends.ts): identity (`userId`) is resolved from the
 * httpOnly cookie by the route handler and passed in here — NEVER from the body.
 * Bodies are strict-zod validated. Pure DB logic so it unit-tests with a mocked Prisma.
 *
 * PRODUCT RULE: party features require a REGISTERED account (`account_required` → 403,
 * same as friends) AND an existing friendship to invite.
 *
 * DB INVARIANTS (see prisma/schema.prisma Party/PartyMember comments):
 *   - PartyMember.userId @unique → a user is in AT MOST one party (DB-enforced).
 *   - <=3 cap re-checked inside the accept tx after an exclusive Party row-lock
 *     (tx.party.update bumps updatedAt) which serializes concurrent accepts.
 */

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isRegistered, areFriends } from "@/server/friends";

// ── Constants ────────────────────────────────────────────────────────────────

/** Hard cap on ACCEPTED party members (leader + up to 2). */
export const MAX_PARTY_SIZE = 3;

/** Soft cap on a single account's OUTSTANDING pending party invites (spam guard). */
export const MAX_PENDING_INVITES = 5;

// ── Input schemas ──────────────────────────────────────────────────────────

export const partyInviteSchema = z.object({ toUserId: z.string().min(1).max(64) }).strict();
export type PartyInviteInput = z.infer<typeof partyInviteSchema>;

export const partyRespondSchema = z
  .object({ inviteId: z.string().min(1).max(64), accept: z.boolean() })
  .strict();
export type PartyRespondInput = z.infer<typeof partyRespondSchema>;

// ── Result types ───────────────────────────────────────────────────────────

export type PartyInviteResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "account_required"
        | "self"
        | "not_friends"
        | "party_full"
        | "already_member"
        | "already_invited"
        | "too_many_pending";
    };

export type PartyRespondResult =
  | { ok: true; accepted: boolean }
  | { ok: false; code: "account_required" | "not_found" | "already_in_party" | "party_full" };

export type PartyLeaveResult =
  | { ok: true; left: boolean; dissolved: boolean; promoted: string | null }
  | { ok: false; code: "account_required" };

/** Raw party rows for the friends poll to weave presence around (friends.ts owns
 *  the presence derivation; this only shapes the graph). `memberUserIds` is ordered
 *  LEADER-FIRST then by joinedAt asc, and INCLUDES the caller. */
export interface PartyStateRaw {
  party: { partyId: string; leaderUserId: string; memberUserIds: string[] } | null;
  incomingInvites: { inviteId: string; fromUserId: string; createdAt: Date }[];
}

// ── 1. Invite a friend into my party ───────────────────────────────────────────

/**
 * Invite `toUserId` (must be a friend) into my party. If I have no party yet, one is
 * created lazily ON ACCEPT (not here) — so this only reserves a pending PartyInvite.
 * Rejects self / non-friend / a full party / an existing same-party member / a
 * duplicate pending invite / an over-cap outgoing-invite count.
 */
export async function invitePartyMember(
  userId: string,
  input: PartyInviteInput,
): Promise<PartyInviteResult> {
  if (!(await isRegistered(userId))) return { ok: false, code: "account_required" };
  const targetId = input.toUserId;
  if (targetId === userId) return { ok: false, code: "self" };
  if (!(await areFriends(userId, targetId))) return { ok: false, code: "not_friends" };

  // If I'm already in a party: it must have room, and the target must not already be
  // in the SAME party (a member of ANOTHER party is fine to invite — accept re-checks).
  const myMembership = await prisma.partyMember.findUnique({
    where: { userId },
    select: { partyId: true },
  });
  if (myMembership) {
    const count = await prisma.partyMember.count({ where: { partyId: myMembership.partyId } });
    if (count >= MAX_PARTY_SIZE) return { ok: false, code: "party_full" };
    const targetMembership = await prisma.partyMember.findUnique({
      where: { userId: targetId },
      select: { partyId: true },
    });
    if (targetMembership?.partyId === myMembership.partyId) {
      return { ok: false, code: "already_member" };
    }
  }

  // Spam guard on my outstanding pending invites.
  const pending = await prisma.partyInvite.count({
    where: { fromUserId: userId, status: "pending" },
  });
  if (pending >= MAX_PENDING_INVITES) return { ok: false, code: "too_many_pending" };

  // Dedupe a same-direction pending invite (no @@unique on PartyInvite — app-level).
  const dupe = await prisma.partyInvite.findFirst({
    where: { fromUserId: userId, toUserId: targetId, status: "pending" },
    select: { id: true },
  });
  if (dupe) return { ok: false, code: "already_invited" };

  await prisma.partyInvite.create({
    data: { fromUserId: userId, toUserId: targetId, status: "pending" },
  });
  return { ok: true };
}

// ── 2. Respond to a party invite ───────────────────────────────────────────────

/**
 * Respond to a pending invite. ONLY the addressee may respond; a missing/foreign/
 * non-pending invite is `not_found` (no existence leak). Decline deletes it.
 *
 * Accept (one tx): I must NOT already be in a party (explicit leave required first →
 * `already_in_party`, NEVER auto-move). The inviter's party is created if none exists
 * (inviter becomes leader + first member); the <=3 cap is re-checked under a Party
 * row-lock; my PartyMember row is added and the invite deleted.
 */
export async function respondPartyInvite(
  userId: string,
  input: PartyRespondInput,
): Promise<PartyRespondResult> {
  if (!(await isRegistered(userId))) return { ok: false, code: "account_required" };

  const invite = await prisma.partyInvite.findUnique({
    where: { id: input.inviteId },
    select: { id: true, fromUserId: true, toUserId: true, status: true },
  });
  if (!invite || invite.toUserId !== userId || invite.status !== "pending") {
    return { ok: false, code: "not_found" };
  }

  if (!input.accept) {
    await prisma.partyInvite.delete({ where: { id: invite.id } });
    return { ok: true, accepted: false };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    // Explicit-leave rule: never move a user out of their current party silently.
    const mine = await tx.partyMember.findUnique({ where: { userId }, select: { partyId: true } });
    if (mine) return { code: "already_in_party" as const };

    // Resolve or lazily create the inviter's party.
    let partyId: string;
    const inviterMembership = await tx.partyMember.findUnique({
      where: { userId: invite.fromUserId },
      select: { partyId: true },
    });
    if (inviterMembership) {
      partyId = inviterMembership.partyId;
      // Exclusive row-lock (bumps updatedAt) to serialize concurrent accepts into
      // this party, THEN re-check the cap against the now-authoritative count.
      await tx.party.update({ where: { id: partyId }, data: {} });
      const count = await tx.partyMember.count({ where: { partyId } });
      if (count >= MAX_PARTY_SIZE) return { code: "party_full" as const };
    } else {
      const party = await tx.party.create({ data: { leaderUserId: invite.fromUserId } });
      partyId = party.id;
      await tx.partyMember.create({ data: { partyId, userId: invite.fromUserId } });
    }

    // Add me. A concurrent join elsewhere collides on userId @unique → treat as
    // already-in-a-party (the DB is the final authority on the one-party rule).
    try {
      await tx.partyMember.create({ data: { partyId, userId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return { code: "already_in_party" as const };
      }
      throw err;
    }
    await tx.partyInvite.delete({ where: { id: invite.id } });
    return { code: null };
  });

  if (outcome.code) return { ok: false, code: outcome.code };
  return { ok: true, accepted: true };
}

// ── 3. Leave my party ──────────────────────────────────────────────────────────

/**
 * Leave my party. Idempotent (not in a party → `left: false`). Deterministic:
 *   - last member leaving DISSOLVES the party (rows deleted).
 *   - the LEADER leaving promotes the OLDEST remaining member (min joinedAt, id tie-break).
 */
export async function leaveParty(userId: string): Promise<PartyLeaveResult> {
  if (!(await isRegistered(userId))) return { ok: false, code: "account_required" };

  return prisma.$transaction(async (tx) => {
    const mine = await tx.partyMember.findUnique({
      where: { userId },
      select: { id: true, partyId: true },
    });
    if (!mine) return { ok: true, left: false, dissolved: false, promoted: null };

    await tx.partyMember.delete({ where: { id: mine.id } });

    const remaining = await tx.partyMember.findMany({
      where: { partyId: mine.partyId },
      orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
      select: { userId: true },
    });
    if (remaining.length === 0) {
      await tx.party.delete({ where: { id: mine.partyId } });
      return { ok: true, left: true, dissolved: true, promoted: null };
    }

    const party = await tx.party.findUnique({
      where: { id: mine.partyId },
      select: { leaderUserId: true },
    });
    let promoted: string | null = null;
    if (party && party.leaderUserId === userId) {
      promoted = remaining[0].userId;
      await tx.party.update({ where: { id: mine.partyId }, data: { leaderUserId: promoted } });
    }
    return { ok: true, left: true, dissolved: false, promoted };
  });
}

// ── 4. Party state for the friends poll ────────────────────────────────────────

/**
 * Raw party graph for `getFriendsPanel` to fold into the ONE friends poll. Returns my
 * party (members ordered LEADER-FIRST then joinedAt asc, INCLUDING me) and the pending
 * invites addressed to me. Presence is derived by the caller (friends.ts) so a member
 * row reads identically to a friend row — no duplicated presence logic here.
 */
export async function loadPartyState(userId: string): Promise<PartyStateRaw> {
  const myMembership = await prisma.partyMember.findUnique({
    where: { userId },
    select: { partyId: true },
  });

  let party: PartyStateRaw["party"] = null;
  if (myMembership) {
    const p = await prisma.party.findUnique({
      where: { id: myMembership.partyId },
      select: {
        id: true,
        leaderUserId: true,
        members: { orderBy: { joinedAt: "asc" }, select: { userId: true } },
      },
    });
    if (p) {
      const rest = p.members.map((m) => m.userId).filter((id) => id !== p.leaderUserId);
      party = { partyId: p.id, leaderUserId: p.leaderUserId, memberUserIds: [p.leaderUserId, ...rest] };
    }
  }

  const invites = await prisma.partyInvite.findMany({
    where: { toUserId: userId, status: "pending" },
    orderBy: { createdAt: "desc" },
    select: { id: true, fromUserId: true, createdAt: true },
  });

  return {
    party,
    incomingInvites: invites.map((i) => ({
      inviteId: i.id,
      fromUserId: i.fromUserId,
      createdAt: i.createdAt,
    })),
  };
}
