/**
 * Friends / social-graph domain (M8 Phase 1 — polling, no websockets).
 *
 * Trust boundary (mirrors auth.ts / characters.ts): identity (`userId`) is always
 * resolved from the httpOnly cookie by the route handler and passed in here — never
 * from the request body. Bodies are strict-zod validated. This module is pure DB
 * logic so it stays unit-testable with a mocked Prisma.
 *
 * PRODUCT RULE: friend features require a REGISTERED account (`User.registeredAt`
 * set) — a guest gets `{ ok: false, code: "account_required" }` which the route maps
 * to 403. Emails are NEVER surfaced to another user (only displayName + friendCode).
 *
 * PRESENCE is NOT stored: it derives from MAX(SaveState.lastSeen) per user (a friend
 * is "online" if their most-recent save is within `ONLINE_WINDOW_MS`, the same 300s
 * delta HOF uses) and Character.lastZone (the presence cache stamped by /api/save).
 * The most-recently-saved live character is the one being played.
 *
 * CANONICAL FRIENDSHIP: a pair is stored ONCE with userAId < userBId (lexicographic)
 * — `sortPair` enforces it before every insert/lookup so A<->B and B<->A collapse to
 * one row (the DB @@unique([userAId, userBId]) is the hard guard).
 */

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { loadPartyState } from "@/server/party";
import { titlesForCharacters, type CharTitleInfo } from "@/server/hofSeason";

// ── Constants ────────────────────────────────────────────────────────────────

/** Online iff the friend's most-recent save is within this window (HOF's 300s). */
export const ONLINE_WINDOW_MS = 300_000;

/** Spam guard: an account may hold at most this many OUTGOING pending requests. */
export const MAX_OUTGOING_PENDING = 20;

/** Emoji ping rate limit: at most this many pings per sender per minute. */
export const EMOJI_RATE_LIMIT = 10;
export const EMOJI_RATE_WINDOW_MS = 60_000;

/** How many disambiguation candidates a name collision returns. */
export const MAX_NAME_CANDIDATES = 5;

/**
 * Server-side emoji allowlist. PRE-2020 GLYPHS ONLY (CLAUDE.md footgun #4: Windows 10
 * has no Unicode-13+ emoji font) — an unlisted emoji is rejected, never stored.
 */
export const EMOJI_ALLOWLIST = [
  "👍",
  "❤️",
  "😂",
  "😮",
  "😢",
  "😡",
  "🎉",
  "💪",
  "🙏",
  "😴",
  "🔥",
  "⚔️",
] as const;
const EMOJI_SET = new Set<string>(EMOJI_ALLOWLIST);

/** Canonical pair ordering: ALWAYS [smaller, larger] by string comparison. */
export function sortPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

// ── Input schemas ──────────────────────────────────────────────────────────

/** POST /api/friends/request — EXACTLY ONE of friendCode / characterName. */
export const friendRequestSchema = z
  .object({
    // Friend codes are minted uppercase (auth.ts) — normalize so a lowercase paste matches.
    friendCode: z
      .string()
      .trim()
      .min(1)
      .max(16)
      .transform((s) => s.toUpperCase())
      .optional(),
    characterName: z.string().trim().min(1).max(24).optional(),
  })
  .strict()
  .refine((v) => Number(Boolean(v.friendCode)) + Number(Boolean(v.characterName)) === 1, {
    message: "provide exactly one of friendCode or characterName",
  });
export type FriendRequestInput = z.infer<typeof friendRequestSchema>;

export const respondSchema = z
  .object({ requestId: z.string().min(1).max(64), accept: z.boolean() })
  .strict();
export type RespondInput = z.infer<typeof respondSchema>;

export const removeSchema = z.object({ userId: z.string().min(1).max(64) }).strict();
export type RemoveInput = z.infer<typeof removeSchema>;

export const emojiSchema = z
  .object({ toUserId: z.string().min(1).max(64), emoji: z.string().min(1).max(16) })
  .strict();
export type EmojiInput = z.infer<typeof emojiSchema>;

// ── Result types ───────────────────────────────────────────────────────────

export interface FriendCandidate {
  characterName: string;
  class: string;
  level: number;
  /** The shareable public friend code — the UI re-issues the request BY this code
   *  (friendCode is a public shareable id, not PII like email). */
  friendCode: string;
}

export type SendRequestResult =
  | { ok: true; autoAccepted: boolean }
  | {
      ok: false;
      code:
        | "account_required"
        | "not_found"
        | "self"
        | "already_friends"
        | "already_pending"
        | "too_many_pending";
    }
  | { ok: false; code: "multiple_matches"; candidates: FriendCandidate[] };

export type RespondResult =
  | { ok: true; accepted: boolean }
  | { ok: false; code: "account_required" | "not_found" };

export type RemoveResult =
  | { ok: true; removed: boolean }
  | { ok: false; code: "account_required" };

export type EmojiResult =
  | { ok: true }
  | { ok: false; code: "account_required" | "bad_emoji" | "not_friends" | "rate_limited" };

export interface CurrentCharacter {
  name: string;
  class: string;
  level: number;
}

/** HOF seasonal title/aura for the shown character — rides THIS poll (no new poll) so
 *  the game client can render OTHER players' chosen title + champion aura. `title` is
 *  the player's chosen display title id, but ONLY when they actually hold it this
 *  season (server-validated); `champion` = holds a gold-aura title (rank-1 of
 *  level/power/gold). See src/server/hofSeason.ts `titlesForCharacters`. */
export interface PresenceTitle {
  title: string | null;
  champion: boolean;
}

export interface FriendView {
  userId: string;
  displayName: string | null;
  friendCode: string | null;
  online: boolean;
  currentCharacter: CurrentCharacter | null;
  lastZone: string | null;
  lastSeenAt: string | null;
  /** Chosen display title id (validated: held this season), or null. */
  title: string | null;
  /** Champion aura (holds rank-1 of level/power/gold this season). */
  champion: boolean;
}

export interface IncomingRequestView {
  requestId: string;
  fromDisplayName: string | null;
  fromFriendCode: string | null;
  createdAt: string;
}

export interface EmojiPingView {
  id: string;
  fromUserId: string;
  fromDisplayName: string | null;
  emoji: string;
  sentAt: string;
}

/** A single party member's presence row (same shape as a friend row, minus the
 *  friendCode/lastSeen the party UI doesn't render). Includes ME. */
export interface PartyMemberView {
  userId: string;
  displayName: string | null;
  online: boolean;
  currentCharacter: CurrentCharacter | null;
  lastZone: string | null;
  /** Chosen display title id (validated: held this season), or null. */
  title: string | null;
  /** Champion aura (holds rank-1 of level/power/gold this season). */
  champion: boolean;
}

export interface PartyView {
  partyId: string;
  leaderUserId: string;
  members: PartyMemberView[];
}

export interface IncomingPartyInviteView {
  inviteId: string;
  fromDisplayName: string | null;
  createdAt: string;
}

export interface FriendsPanel {
  friends: FriendView[];
  incomingRequests: IncomingRequestView[];
  emojiPings: EmojiPingView[];
  /** M8 party (social container): my party or null, plus pending invites TO me.
   *  Folded into this ONE poll so the panel needs no second timer. */
  party: PartyView | null;
  incomingPartyInvites: IncomingPartyInviteView[];
}

// ── Registration guard ───────────────────────────────────────────────────────

/** True iff `userId` names a REGISTERED account (guest → false).
 *  Exported so the party domain (`src/server/party.ts`) reuses the ONE guest gate. */
export async function isRegistered(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { registeredAt: true },
  });
  return Boolean(u?.registeredAt);
}

/** True iff the (canonical) pair are friends. Exported for the party domain
 *  (a party invite requires an existing friendship). */
export async function areFriends(a: string, b: string): Promise<boolean> {
  const [userAId, userBId] = sortPair(a, b);
  const row = await prisma.friendship.findUnique({
    where: { userAId_userBId: { userAId, userBId } },
    select: { id: true },
  });
  return Boolean(row);
}

// ── Character presence helper ────────────────────────────────────────────────

interface CharRow {
  id?: string;
  userId: string;
  name: string;
  baseClass: string;
  level: number;
  lastZone: string | null;
  uiConfig?: unknown;
  save: { lastSeen: Date } | null;
}

/** Read a character's chosen-display-title from its uiConfig JSON (raw). */
function chosenTitleOf(uiConfig: unknown): string | null {
  if (uiConfig && typeof uiConfig === "object" && !Array.isArray(uiConfig)) {
    const v = (uiConfig as Record<string, unknown>).displayTitle;
    if (typeof v === "string") return v;
  }
  return null;
}

/** The most-recently-saved character in a group (the one being played), or null. */
function mostRecent(chars: CharRow[]): { char: CharRow; lastSeenMs: number } | null {
  let best: { char: CharRow; lastSeenMs: number } | null = null;
  for (const c of chars) {
    const t = c.save?.lastSeen ? c.save.lastSeen.getTime() : 0;
    if (!best || t > best.lastSeenMs) best = { char: c, lastSeenMs: t };
  }
  return best;
}

// ── 1. Send a friend request ─────────────────────────────────────────────────

/**
 * Resolve the request target. By friendCode → a single registered user (or none).
 * By characterName → an exact CI match on LIVE characters; 0 registered owners =
 * not_found, 1 = that user, >1 distinct owners = a `multiple_matches` candidate list
 * (names CAN collide via a create race — schema has no hard unique).
 */
async function resolveTarget(
  input: FriendRequestInput,
): Promise<
  | { kind: "user"; userId: string }
  | { kind: "none" }
  | { kind: "multiple"; candidates: FriendCandidate[] }
> {
  if (input.friendCode) {
    const u = await prisma.user.findUnique({
      where: { friendCode: input.friendCode },
      select: { id: true, registeredAt: true },
    });
    if (!u || !u.registeredAt) return { kind: "none" };
    return { kind: "user", userId: u.id };
  }

  // characterName path — exact (CI collation) match among live characters.
  const rows = await prisma.character.findMany({
    where: { name: input.characterName, deletedAt: null },
    select: {
      userId: true,
      name: true,
      baseClass: true,
      level: true,
      user: { select: { registeredAt: true, friendCode: true } },
    },
  });
  // Keep only characters whose owner is a REGISTERED account (a friend must have one).
  const registered = rows.filter((r) => r.user?.registeredAt && r.user.friendCode);
  const byUser = new Map<string, (typeof registered)[number]>();
  for (const r of registered) if (!byUser.has(r.userId)) byUser.set(r.userId, r);

  if (byUser.size === 0) return { kind: "none" };
  if (byUser.size === 1) {
    const only = [...byUser.values()][0];
    return { kind: "user", userId: only.userId };
  }
  const candidates: FriendCandidate[] = [...byUser.values()].slice(0, MAX_NAME_CANDIDATES).map((r) => ({
    characterName: r.name,
    class: r.baseClass,
    level: r.level,
    friendCode: r.user!.friendCode!,
  }));
  return { kind: "multiple", candidates };
}

/**
 * Send a friend request from `userId`. Rejects self / already-friends / duplicate
 * pending. If a REVERSE request already exists (target already asked me), the two
 * intents match → AUTO-ACCEPT into a canonical Friendship instead. Caps outgoing
 * pending at `MAX_OUTGOING_PENDING`.
 */
export async function sendFriendRequest(
  userId: string,
  input: FriendRequestInput,
): Promise<SendRequestResult> {
  if (!(await isRegistered(userId))) return { ok: false, code: "account_required" };

  const target = await resolveTarget(input);
  if (target.kind === "none") return { ok: false, code: "not_found" };
  if (target.kind === "multiple") return { ok: false, code: "multiple_matches", candidates: target.candidates };

  const targetId = target.userId;
  if (targetId === userId) return { ok: false, code: "self" };
  if (await areFriends(userId, targetId)) return { ok: false, code: "already_friends" };

  // Reverse pending (target -> me)? Both sides want it → auto-accept.
  const reverse = await prisma.friendRequest.findUnique({
    where: { fromUserId_toUserId: { fromUserId: targetId, toUserId: userId } },
    select: { id: true },
  });
  if (reverse) {
    const [userAId, userBId] = sortPair(userId, targetId);
    await prisma.$transaction(async (tx) => {
      // Clear BOTH directions defensively, then create the canonical friendship.
      await tx.friendRequest.deleteMany({
        where: {
          OR: [
            { fromUserId: targetId, toUserId: userId },
            { fromUserId: userId, toUserId: targetId },
          ],
        },
      });
      try {
        await tx.friendship.create({ data: { userAId, userBId } });
      } catch (err) {
        // A concurrent accept already created it — fine, treat as friends.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      }
    });
    return { ok: true, autoAccepted: true };
  }

  // Forward pending (me -> target) already exists?
  const forward = await prisma.friendRequest.findUnique({
    where: { fromUserId_toUserId: { fromUserId: userId, toUserId: targetId } },
    select: { id: true },
  });
  if (forward) return { ok: false, code: "already_pending" };

  // Spam guard on outgoing pending.
  const outgoing = await prisma.friendRequest.count({ where: { fromUserId: userId } });
  if (outgoing >= MAX_OUTGOING_PENDING) return { ok: false, code: "too_many_pending" };

  try {
    await prisma.friendRequest.create({ data: { fromUserId: userId, toUserId: targetId } });
  } catch (err) {
    // Race: a duplicate landed between the check and here → treat as already pending.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, code: "already_pending" };
    }
    throw err;
  }
  return { ok: true, autoAccepted: false };
}

// ── 2. Respond to a request ──────────────────────────────────────────────────

/**
 * Respond to an incoming request. ONLY the addressee (`toUserId`) may respond.
 * accept → create the canonical Friendship + delete the request in ONE tx.
 * decline → delete the request.
 */
export async function respondFriendRequest(
  userId: string,
  input: RespondInput,
): Promise<RespondResult> {
  if (!(await isRegistered(userId))) return { ok: false, code: "account_required" };

  const req = await prisma.friendRequest.findUnique({
    where: { id: input.requestId },
    select: { id: true, fromUserId: true, toUserId: true },
  });
  // Only the addressee may respond; a missing/foreign request is not_found (no leak).
  if (!req || req.toUserId !== userId) return { ok: false, code: "not_found" };

  if (!input.accept) {
    await prisma.friendRequest.delete({ where: { id: req.id } });
    return { ok: true, accepted: false };
  }

  const [userAId, userBId] = sortPair(req.fromUserId, req.toUserId);
  await prisma.$transaction(async (tx) => {
    await tx.friendRequest.delete({ where: { id: req.id } });
    try {
      await tx.friendship.create({ data: { userAId, userBId } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  });
  return { ok: true, accepted: true };
}

// ── 3. Remove a friend ───────────────────────────────────────────────────────

/** Remove a friendship (EITHER side may). Idempotent — removing a non-friend is ok. */
export async function removeFriend(userId: string, input: RemoveInput): Promise<RemoveResult> {
  if (!(await isRegistered(userId))) return { ok: false, code: "account_required" };
  const [userAId, userBId] = sortPair(userId, input.userId);
  const res = await prisma.friendship.deleteMany({ where: { userAId, userBId } });
  return { ok: true, removed: res.count > 0 };
}

// ── 4. The one poll endpoint ─────────────────────────────────────────────────

/**
 * Everything the friends panel needs in ONE call. Presence is derived from
 * MAX(SaveState.lastSeen) per friend; unseen emoji pings are returned then marked
 * seen (same tx), and previously-seen rows are purged opportunistically. Batched IN
 * queries — no per-friend N+1.
 */
export async function getFriendsPanel(
  userId: string,
  now: Date = new Date(),
): Promise<{ ok: true; panel: FriendsPanel } | { ok: false; code: "account_required" }> {
  if (!(await isRegistered(userId))) return { ok: false, code: "account_required" };

  // Emoji pings: read unseen → mark seen → purge older (already-seen) rows, in one tx.
  const pings = await prisma.$transaction(async (tx) => {
    const unseen = await tx.emojiPing.findMany({
      where: { toUserId: userId, seenAt: null },
      orderBy: { sentAt: "asc" },
      select: { id: true, fromUserId: true, emoji: true, sentAt: true },
    });
    if (unseen.length) {
      await tx.emojiPing.updateMany({
        where: { id: { in: unseen.map((p) => p.id) } },
        data: { seenAt: now },
      });
    }
    // Purge rows seen on a PRIOR poll (seenAt strictly before this run's stamp).
    await tx.emojiPing.deleteMany({ where: { toUserId: userId, seenAt: { lt: now } } });
    return unseen;
  });

  // Friendships → the set of my friends' user ids.
  const friendships = await prisma.friendship.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { userAId: true, userBId: true },
  });
  const friendIds = friendships.map((f) => (f.userAId === userId ? f.userBId : f.userAId));

  // Incoming pending requests (newest first).
  const requests = await prisma.friendRequest.findMany({
    where: { toUserId: userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, fromUserId: true, createdAt: true },
  });
  const requesterIds = requests.map((r) => r.fromUserId);

  // M8 party state (my party incl. me + pending invites TO me) — folded into this
  // same poll. Its member/inviter ids join the batched presence fetch below.
  const { party: partyRaw, incomingInvites } = await loadPartyState(userId);

  // One batched fetch of every "other" user + their characters (friends, requesters,
  // ping senders, party members incl. ME, party inviters) — no N+1.
  const otherIds = [
    ...new Set([
      ...friendIds,
      ...requesterIds,
      ...pings.map((p) => p.fromUserId),
      ...(partyRaw?.memberUserIds ?? []),
      ...incomingInvites.map((i) => i.fromUserId),
    ]),
  ];

  const [users, chars] = await Promise.all([
    otherIds.length
      ? prisma.user.findMany({
          where: { id: { in: otherIds } },
          // NEVER select `email` — it must never leak to another user.
          select: { id: true, displayName: true, friendCode: true },
        })
      : Promise.resolve([]),
    otherIds.length
      ? prisma.character.findMany({
          where: { userId: { in: otherIds }, deletedAt: null },
          select: {
            id: true,
            userId: true,
            name: true,
            baseClass: true,
            level: true,
            lastZone: true,
            uiConfig: true,
            save: { select: { lastSeen: true } },
          },
        })
      : Promise.resolve([] as CharRow[]),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const charsByUser = new Map<string, CharRow[]>();
  for (const c of chars as CharRow[]) {
    const arr = charsByUser.get(c.userId);
    if (arr) arr.push(c);
    else charsByUser.set(c.userId, [c]);
  }

  /** displayName fallback = the name of their most-recent character. */
  const displayNameFor = (uid: string): string | null => {
    const u = userMap.get(uid);
    if (u?.displayName) return u.displayName;
    const mr = mostRecent(charsByUser.get(uid) ?? []);
    return mr?.char.name ?? null;
  };

  // HOF seasonal titles for the SHOWN character of each other user — folded into THIS
  // poll (no new poll) so the client can render other players' title + champion aura.
  // Best-effort: a HOF lookup failure must never break the friends/party poll.
  const shownCharIds = otherIds
    .map((uid) => mostRecent(charsByUser.get(uid) ?? [])?.char.id)
    .filter((id): id is string => typeof id === "string");
  let titleMap = new Map<string, CharTitleInfo>();
  try {
    titleMap = await titlesForCharacters(shownCharIds);
  } catch (err) {
    console.warn("[friends] HOF title lookup failed (non-fatal):", err);
  }
  /** The chosen (validated) title + aura for a user's most-recent character. */
  const presenceTitleFor = (uid: string): { title: string | null; champion: boolean } => {
    const mr = mostRecent(charsByUser.get(uid) ?? []);
    const cid = mr?.char.id;
    const info = cid ? titleMap.get(cid) : undefined;
    if (!info) return { title: null, champion: false };
    // Chosen display title only shows when the character actually holds it.
    const chosen = chosenTitleOf(mr?.char.uiConfig);
    const title = chosen && info.titleIds.includes(chosen) ? chosen : null;
    return { title, champion: info.champion };
  };

  const nowMs = now.getTime();
  const friends: FriendView[] = friendIds.map((fid) => {
    const u = userMap.get(fid);
    const mr = mostRecent(charsByUser.get(fid) ?? []);
    const lastSeenMs = mr?.lastSeenMs ?? 0;
    const online = lastSeenMs > 0 && nowMs - lastSeenMs < ONLINE_WINDOW_MS;
    const pt = presenceTitleFor(fid);
    return {
      userId: fid,
      displayName: displayNameFor(fid),
      friendCode: u?.friendCode ?? null,
      online,
      currentCharacter: mr
        ? { name: mr.char.name, class: mr.char.baseClass, level: mr.char.level }
        : null,
      lastZone: mr?.char.lastZone ?? null,
      lastSeenAt: lastSeenMs > 0 ? new Date(lastSeenMs).toISOString() : null,
      title: pt.title,
      champion: pt.champion,
    };
  });

  const incomingRequests: IncomingRequestView[] = requests.map((r) => ({
    requestId: r.id,
    fromDisplayName: displayNameFor(r.fromUserId),
    fromFriendCode: userMap.get(r.fromUserId)?.friendCode ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

  const emojiPings: EmojiPingView[] = pings.map((p) => ({
    id: p.id,
    fromUserId: p.fromUserId,
    fromDisplayName: displayNameFor(p.fromUserId),
    emoji: p.emoji,
    sentAt: p.sentAt.toISOString(),
  }));

  // Party member presence reuses the exact same helpers as a friend row.
  const memberView = (uid: string): PartyMemberView => {
    const mr = mostRecent(charsByUser.get(uid) ?? []);
    const lastSeenMs = mr?.lastSeenMs ?? 0;
    const pt = presenceTitleFor(uid);
    return {
      userId: uid,
      displayName: displayNameFor(uid),
      online: lastSeenMs > 0 && nowMs - lastSeenMs < ONLINE_WINDOW_MS,
      currentCharacter: mr
        ? { name: mr.char.name, class: mr.char.baseClass, level: mr.char.level }
        : null,
      lastZone: mr?.char.lastZone ?? null,
      title: pt.title,
      champion: pt.champion,
    };
  };

  const party: PartyView | null = partyRaw
    ? {
        partyId: partyRaw.partyId,
        leaderUserId: partyRaw.leaderUserId,
        members: partyRaw.memberUserIds.map(memberView),
      }
    : null;

  const incomingPartyInvites: IncomingPartyInviteView[] = incomingInvites.map((i) => ({
    inviteId: i.inviteId,
    fromDisplayName: displayNameFor(i.fromUserId),
    createdAt: i.createdAt.toISOString(),
  }));

  return {
    ok: true,
    panel: { friends, incomingRequests, emojiPings, party, incomingPartyInvites },
  };
}

// ── 5. Send an emoji ping ────────────────────────────────────────────────────

/**
 * Send an emoji ping to a friend. Emoji must be in the allowlist; sender + recipient
 * must be friends; the sender is rate-limited to `EMOJI_RATE_LIMIT` per minute.
 */
export async function sendEmoji(
  userId: string,
  input: EmojiInput,
  now: Date = new Date(),
): Promise<EmojiResult> {
  if (!(await isRegistered(userId))) return { ok: false, code: "account_required" };
  if (!EMOJI_SET.has(input.emoji)) return { ok: false, code: "bad_emoji" };
  if (input.toUserId === userId || !(await areFriends(userId, input.toUserId))) {
    return { ok: false, code: "not_friends" };
  }

  const since = new Date(now.getTime() - EMOJI_RATE_WINDOW_MS);
  const recent = await prisma.emojiPing.count({
    where: { fromUserId: userId, sentAt: { gte: since } },
  });
  if (recent >= EMOJI_RATE_LIMIT) return { ok: false, code: "rate_limited" };

  await prisma.emojiPing.create({
    data: { fromUserId: userId, toUserId: input.toUserId, emoji: input.emoji },
  });
  return { ok: true };
}
