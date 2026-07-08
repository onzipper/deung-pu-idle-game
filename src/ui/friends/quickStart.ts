/**
 * Party quick-start (owner ask: "เชื่อมต่อนานกว่าจะเห็นตัวเพื่อน" — relay sleep is
 * solved externally via UptimeRobot now; the remaining lag was the FRIENDS-POLL
 * WAIT). Pure decision helpers, no React/DOM — same "logic here, hook owns the
 * side effects" split as `ui/worldBoss/schedule.ts`.
 *
 * The actual "start the party session fast" mechanism is: every party MUTATION
 * (`respondPartyInvite`/`invitePartyMember`/`leaveParty` in `useFriendsPoll.ts`)
 * already fires an immediate `poll()` right after the mutation resolves — the
 * mutation endpoints themselves return only `{ ok }` (no party snapshot, see
 * `src/app/api/party/*`), so "ONE immediate refetch" is the correct shape, not
 * a response-body shortcut. That refetch pushes into the SAME `setParty` store
 * path the interval poll uses (`useGameStore.getState().setParty(...)`), which
 * `GameClient.tsx` subscribes to directly — so `PartySession.connect()` starts
 * within one `/api/friends` round trip of the tap, not the next 5s/15s tick.
 *
 * The one piece of genuinely NEW decision logic this wave adds is below: should
 * *opening* the Friends panel also trigger an immediate refresh, or is the data
 * already fresh enough (e.g. a user rapid-toggling the panel open/closed)? Kept
 * pure + parameterized so `useFriendsPoll.ts`'s open-effect doesn't need its own
 * ad hoc staleness math.
 */

/** Below this age, the already-held friends/party snapshot counts as "fresh
 * enough" — opening the panel skips a redundant GET. Above it, opening always
 * refetches immediately (same "don't make the player wait for the next
 * interval tick" goal as the mutation-triggered refetches). */
export const FRIENDS_OPEN_STALE_MS = 2_000;

/**
 * `lastFetchAt`: epoch ms of the last completed (non-aborted) `/api/friends`
 * fetch, or `null` before the very first one resolves (always stale — nothing
 * to show yet, so opening must fetch). `now`/`staleMs` are parameters (not
 * read internally) so this is testable without faking the clock.
 */
export function shouldRefreshOnOpen(
  lastFetchAt: number | null,
  now: number,
  staleMs: number = FRIENDS_OPEN_STALE_MS,
): boolean {
  if (lastFetchAt === null) return true;
  return now - lastFetchAt >= staleMs;
}
