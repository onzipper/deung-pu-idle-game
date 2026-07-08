/**
 * NEVER-SILENT error-code → translation-key mapping for every friends/party
 * mutation (owner-approved informed-manual party-invite UX, 2026-07-08). Pure
 * (no next-intl/React) so it's directly unit-testable — components call
 * `t(friendErrorKey(code))` / `t(partyErrorKey(code))`, never render a raw
 * server code or swallow a non-ok response silently.
 *
 * `partyErrorKey` OVERRIDES a couple of codes vs. the shared friend-request
 * map: a party invite's `not_found` means "this invite is no longer valid"
 * (expired / withdrawn / the invite's party dissolved before you answered) —
 * a different situation from "no player found" (the friend-request meaning of
 * the same code), so it gets its own copy rather than reusing `errorNotFound`.
 */

/** Shared base: every code the friends/party domain can return, MINUS the
 * ones `partyErrorKey` overrides below. Kept exported so `FriendsPanel.tsx`
 * uses the exact same dictionary instance for friend-request-side errors. */
export const FRIEND_ERROR_KEY_BY_CODE: Record<string, string> = {
  account_required: "errorAccountRequired",
  not_found: "errorNotFound",
  self: "errorSelf",
  already_friends: "errorAlreadyFriends",
  already_pending: "errorAlreadyPending",
  too_many_pending: "errorTooManyPending",
  bad_emoji: "errorBadEmoji",
  not_friends: "errorNotFriends",
  rate_limited: "errorRateLimited",
  party_full: "errorPartyFull",
  already_member: "errorAlreadyMember",
  already_invited: "errorAlreadyInvited",
  already_in_party: "errorAlreadyInParty",
};

/** Party-invite-response-specific overrides layered on top of the shared map. */
const PARTY_ERROR_OVERRIDES: Record<string, string> = {
  not_found: "errorPartyInviteExpired",
};

export const GENERIC_ERROR_KEY = "errorGeneric";

/** Translation key for a friend-request-side error code (send/respond/remove/emoji). */
export function friendErrorKey(code: string): string {
  return FRIEND_ERROR_KEY_BY_CODE[code] ?? GENERIC_ERROR_KEY;
}

/** Translation key for a party-mutation error code (invite/respond/leave) —
 * same dictionary as `friendErrorKey`, with the party-specific overrides above. */
export function partyErrorKey(code: string): string {
  return PARTY_ERROR_OVERRIDES[code] ?? FRIEND_ERROR_KEY_BY_CODE[code] ?? GENERIC_ERROR_KEY;
}
