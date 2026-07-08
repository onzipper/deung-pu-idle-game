/**
 * M8 Phase 1 "Friends" — wire types for the `/api/friends*` routes. Deliberately
 * REDECLARED here rather than imported from `@/server/friends` (same convention
 * as `ui/gear/types.ts`/`ui/hof/types.ts` — the UI never imports server code).
 */

export interface CurrentCharacterWire {
  name: string;
  class: string;
  level: number;
}

export interface FriendWire {
  userId: string;
  displayName: string | null;
  friendCode: string | null;
  online: boolean;
  currentCharacter: CurrentCharacterWire | null;
  /** "mapId:zoneIdx" composite, or null if the friend has never saved a location. */
  lastZone: string | null;
  lastSeenAt: string | null;
  /** HOF seasonal chosen display title id ("<board>.<rank>"), validated
   *  server-side, or null — see `src/server/hofSeason.ts`'s `titlesForCharacters`
   *  and `ui/hof/titles.ts` for the localizer. */
  title: string | null;
  /** Holds a gold-aura title (rank-1 of level/power/gold — NOT online). */
  champion: boolean;
  /** True iff this friend already belongs to SOME party (mine or another) —
   *  drives the "🤝 already in a party" chip. The invite button stays enabled
   *  regardless (owner-approved informed-manual flow) — see `FriendsPanel.tsx`. */
  inParty: boolean;
}

export interface IncomingRequestWire {
  requestId: string;
  fromDisplayName: string | null;
  fromFriendCode: string | null;
  createdAt: string;
}

export interface EmojiPingWire {
  id: string;
  fromUserId: string;
  fromDisplayName: string | null;
  emoji: string;
  sentAt: string;
}

export interface PartyMemberWire {
  userId: string;
  displayName: string | null;
  online: boolean;
  currentCharacter: CurrentCharacterWire | null;
  lastZone: string | null;
  /** See `FriendWire.title`'s doc. */
  title: string | null;
  champion: boolean;
}

export interface PartyWire {
  partyId: string;
  leaderUserId: string;
  members: PartyMemberWire[];
}

export interface IncomingPartyInviteWire {
  inviteId: string;
  fromDisplayName: string | null;
  createdAt: string;
}

export interface FriendsPanelWire {
  friends: FriendWire[];
  incomingRequests: IncomingRequestWire[];
  emojiPings: EmojiPingWire[];
  /** M8 party (social container): my party or null + pending invites TO me. */
  party: PartyWire | null;
  incomingPartyInvites: IncomingPartyInviteWire[];
}

/** Server allowlist (footgun #4: pre-2020 glyphs only, Windows 10 safe) —
 * mirrored here so the picker never offers a glyph the server would reject. */
export const FRIEND_EMOJI_ALLOWLIST = [
  "\u{1F44D}", // 👍
  "\u{2764}\u{FE0F}", // ❤️
  "\u{1F602}", // 😂
  "\u{1F62E}", // 😮
  "\u{1F622}", // 😢
  "\u{1F621}", // 😡
  "\u{1F389}", // 🎉
  "\u{1F4AA}", // 💪
  "\u{1F64F}", // 🙏
  "\u{1F634}", // 😴
  "\u{1F525}", // 🔥
  "\u{2694}\u{FE0F}", // ⚔️
] as const;

export type FriendRequestErrorCode =
  | "account_required"
  | "not_found"
  | "self"
  | "already_friends"
  | "already_pending"
  | "too_many_pending"
  | "network"
  | "unknown";

export interface FriendCandidateWire {
  characterName: string;
  class: string;
  level: number;
  friendCode: string;
}

export type SendFriendRequestResult =
  | { ok: true; autoAccepted: boolean }
  | { ok: false; code: FriendRequestErrorCode }
  | { ok: false; code: "multiple_matches"; candidates: FriendCandidateWire[] };
