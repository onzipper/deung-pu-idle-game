/**
 * Pure friends-list ordering (owner ask 2026-07-08): presence first — online
 * friends (server's own "online-<300s" rule, already baked into
 * `FriendWire.online`) before offline — then, within the offline bucket,
 * MOST-recently-seen first, longest-offline LAST (`lastSeenAt` desc). A
 * friend with no `lastSeenAt` on record (never seen) sorts to the very
 * bottom, below every real timestamp. Online friends keep their existing
 * relative order (no secondary tie-break requested).
 *
 * Party members render through a SEPARATE section (`PartySection` in
 * `FriendsPanel.tsx`) and keep their own order — this helper is only ever
 * applied to the top-level `panel.friends` list.
 */

import type { FriendWire } from "@/ui/friends/types";

function lastSeenRank(lastSeenAt: string | null): number {
  if (!lastSeenAt) return -Infinity; // never-seen sorts last among offline
  const ms = new Date(lastSeenAt).getTime();
  return Number.isFinite(ms) ? ms : -Infinity;
}

/** Total-order comparator: online before offline; offline sub-ordered by
 * most-recently-seen first. `Array.prototype.sort` is stable (ES2019+), so
 * online friends keep their input-order relative to each other. */
export function compareFriendsByPresence(a: FriendWire, b: FriendWire): number {
  if (a.online !== b.online) return a.online ? -1 : 1;
  if (a.online) return 0;
  return lastSeenRank(b.lastSeenAt) - lastSeenRank(a.lastSeenAt);
}

/** Returns a NEW sorted array (never mutates the input, matching every other
 * pure-derive helper in `ui/gear`/`ui/hof`). */
export function sortFriendsByPresence(friends: readonly FriendWire[]): FriendWire[] {
  return [...friends].sort(compareFriendsByPresence);
}
