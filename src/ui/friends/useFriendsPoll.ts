"use client";

/**
 * M8 Phase 1 "Friends" — owns the ONE friends poll for the whole HUD. Mounted
 * once in `FriendsButton.tsx` (the hub component) and threaded down to the
 * badge/toasts/panel as props, so there is exactly one in-flight poll
 * regardless of how many pieces of UI read friends data.
 *
 * Cadence: while `open`, refetch every 5s + immediately on open/after any
 * mutating action; while closed (and known-registered), a 15s poll for the
 * badge count + toasts (owner realtime pass 2026-07-08 — was 20s/60s, which
 * made invites feel dead until the menu was re-opened); a guest identity
 * (learned from the FIRST probe, which doubles as this) never polls again.
 * Entirely paused while the tab is hidden (`document.hidden`) — resumes with
 * an immediate refetch on return, mirroring the visibility pattern
 * `GameClient.tsx` uses for the save beacon (not touched here, just the same
 * idiom).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchFriendsPanel,
  postFriendRequest,
  postLeaveParty,
  postPartyInvite,
  postRemoveFriend,
  postRespondFriendRequest,
  postRespondPartyInvite,
  postSendEmoji,
} from "@/ui/friends/api";
import { shouldRefreshOnOpen } from "@/ui/friends/quickStart";
import type { FriendsPanelWire, SendFriendRequestResult } from "@/ui/friends/types";
import { useGameStore } from "@/ui/store/gameStore";

const OPEN_POLL_MS = 5_000;
const CLOSED_POLL_MS = 15_000;
const TOAST_DISPLAY_MS = 4_000;
/** Actionable toasts (party invite / friend request) linger longer than a
 * fire-and-forget emoji ping — the player is meant to tap them. */
const ACTIONABLE_TOAST_DISPLAY_MS = 8_000;
/** Win10-safe glyphs (footgun #4) for the actionable-toast icons. */
const PARTY_INVITE_GLYPH = "\u{1F91D}"; // 🤝
const FRIEND_REQUEST_GLYPH = "\u{1F4E8}"; // 📨

export type FriendsStatus = "loading" | "guest" | "ready" | "error";

export interface FriendToast {
  id: string;
  fromDisplayName: string | null;
  emoji: string;
  /** What this toast announces — non-"emoji" kinds are ACTIONABLE (tapping one
   * opens the friends panel; see `FriendsButton.tsx`) and show a label line. */
  kind: "emoji" | "partyInvite" | "friendRequest";
}

export interface UseFriendsPoll {
  status: FriendsStatus;
  panel: FriendsPanelWire | null;
  pendingCount: number;
  toasts: FriendToast[];
  dismissToast: (id: string) => void;
  refresh: () => void;
  sendRequest: (
    input: { friendCode: string } | { characterName: string },
  ) => Promise<SendFriendRequestResult>;
  respond: (requestId: string, accept: boolean) => Promise<boolean>;
  remove: (userId: string) => Promise<boolean>;
  sendEmoji: (toUserId: string, emoji: string) => Promise<{ ok: true } | { ok: false; code: string }>;
  invitePartyMember: (
    toUserId: string,
  ) => Promise<{ ok: true } | { ok: false; code: string }>;
  respondPartyInvite: (inviteId: string, accept: boolean) => Promise<boolean>;
  leaveParty: () => Promise<boolean>;
}

export function useFriendsPoll(open: boolean): UseFriendsPoll {
  const [status, setStatus] = useState<FriendsStatus>("loading");
  const [panel, setPanel] = useState<FriendsPanelWire | null>(null);
  const [toasts, setToasts] = useState<FriendToast[]>([]);
  // Emoji-ping ids already toasted THIS session — belt-and-suspenders against
  // ever re-showing one across overlapping in-flight polls (the server itself
  // already guarantees exactly-once via seenAt, this just guards re-renders).
  const seenPingIds = useRef(new Set<string>());
  // Party-invite / friend-request ids already toasted THIS session. Unlike emoji
  // pings these PERSIST server-side until acted on, so each one toasts exactly
  // once per session (including once at boot for an invite that arrived while
  // offline — that's the "realtime" ask: the player must not need to open the
  // menu to learn someone invited them; the badge alone was too easy to miss).
  const seenInviteIds = useRef(new Set<string>());
  const seenRequestIds = useRef(new Set<string>());
  const abortRef = useRef<AbortController | null>(null);
  // Party quick-start (`ui/friends/quickStart.ts`): epoch ms of the last
  // COMPLETED (non-aborted) fetch, feeding the open-effect's staleness gate
  // below so re-opening the panel right after a mutation's own immediate
  // refetch doesn't fire a redundant second GET.
  const lastFetchAtRef = useRef<number | null>(null);

  const poll = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const res = await fetchFriendsPanel(controller.signal);
    if (res.kind === "aborted") return;
    lastFetchAtRef.current = Date.now();
    if (res.kind === "guest") {
      setStatus("guest");
      setPanel(null);
      // M8 party P4b: a guest is never in a party — keep `PartySession` dormant.
      useGameStore.getState().setParty(null);
      return;
    }
    if (res.kind === "error") {
      setStatus((prev) => (prev === "ready" ? prev : "error"));
      return;
    }
    setStatus("ready");
    setPanel(res.data);
    // M8 party P4b: push my party membership into the store — `GameClient.tsx`'s
    // `PartySession` subscribes to this (same "push, subscribe" idiom the
    // `updateReloadRequested` banner button already uses). This poll is the ONLY
    // place `party` changes, so it's the single source of truth for the relay's
    // dormant/active gate.
    useGameStore.getState().setParty(res.data.party);

    const fresh = res.data.emojiPings.filter((p) => !seenPingIds.current.has(p.id));
    for (const p of fresh) seenPingIds.current.add(p.id);
    const freshInvites = res.data.incomingPartyInvites.filter(
      (i) => !seenInviteIds.current.has(i.inviteId),
    );
    for (const i of freshInvites) seenInviteIds.current.add(i.inviteId);
    const freshRequests = res.data.incomingRequests.filter(
      (r) => !seenRequestIds.current.has(r.requestId),
    );
    for (const r of freshRequests) seenRequestIds.current.add(r.requestId);

    const newToasts: Array<FriendToast & { displayMs: number }> = [
      ...fresh.map((p) => ({
        id: p.id,
        fromDisplayName: p.fromDisplayName,
        emoji: p.emoji,
        kind: "emoji" as const,
        displayMs: TOAST_DISPLAY_MS,
      })),
      ...freshInvites.map((i) => ({
        id: `pi:${i.inviteId}`,
        fromDisplayName: i.fromDisplayName,
        emoji: PARTY_INVITE_GLYPH,
        kind: "partyInvite" as const,
        displayMs: ACTIONABLE_TOAST_DISPLAY_MS,
      })),
      ...freshRequests.map((r) => ({
        id: `fr:${r.requestId}`,
        fromDisplayName: r.fromDisplayName,
        emoji: FRIEND_REQUEST_GLYPH,
        kind: "friendRequest" as const,
        displayMs: ACTIONABLE_TOAST_DISPLAY_MS,
      })),
    ];
    if (newToasts.length > 0) {
      setToasts((prev) => [
        ...prev,
        ...newToasts.map((nt) => ({
          id: nt.id,
          fromDisplayName: nt.fromDisplayName,
          emoji: nt.emoji,
          kind: nt.kind,
        })),
      ]);
      // Scheduled right here (not in a `toasts`-keyed effect) so adding a
      // second toast can never reset an already-ticking first toast's timer.
      for (const nt of newToasts) {
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== nt.id));
        }, nt.displayMs);
      }
    }
  }, []);

  const refresh = useCallback(() => {
    void poll();
  }, [poll]);

  // One-shot mount probe — this is ALSO how we learn guest vs. registered.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount probe, see above
    void poll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount probe, `poll` is stable
  }, []);

  // Cadence: interval keyed by open/closed; never scheduled for a guest.
  useEffect(() => {
    if (status === "guest" || status === "loading") return;

    // Party quick-start: opening the panel refetches immediately UNLESS a
    // mutation's own immediate refetch (see `invitePartyMember`/
    // `respondPartyInvite`/`leaveParty` below) already landed within the
    // staleness window — avoids a redundant GET right after e.g. accepting an
    // invite closes and reopens the panel in the same beat.
    if (open && !document.hidden && shouldRefreshOnOpen(lastFetchAtRef.current, Date.now())) {
      void poll();
    }

    const ms = open ? OPEN_POLL_MS : CLOSED_POLL_MS;
    const id = window.setInterval(() => {
      if (!document.hidden) void poll();
    }, ms);
    return () => window.clearInterval(id);
  }, [open, status, poll]);

  // Resume immediately on tab return; no fetches at all while hidden.
  useEffect(() => {
    if (status === "guest") return;
    function onVisibility(): void {
      if (!document.hidden) void poll();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [status, poll]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const sendRequest = useCallback(
    async (input: { friendCode: string } | { characterName: string }) => {
      const res = await postFriendRequest(input);
      if (res.ok || res.code !== "multiple_matches") void poll();
      return res;
    },
    [poll],
  );

  const respond = useCallback(
    async (requestId: string, accept: boolean) => {
      const res = await postRespondFriendRequest(requestId, accept);
      void poll();
      return res.ok;
    },
    [poll],
  );

  const remove = useCallback(
    async (userId: string) => {
      const res = await postRemoveFriend(userId);
      void poll();
      return res.ok;
    },
    [poll],
  );

  const sendEmoji = useCallback((toUserId: string, emoji: string) => postSendEmoji(toUserId, emoji), []);

  // Party quick-start (owner ask): `/api/party/invite|respond|leave` return only
  // `{ ok }` (no party snapshot — see `src/app/api/party/*`), so the fastest
  // correct way to learn the resulting party state is ONE immediate refetch
  // right here rather than waiting for the next 5s/15s interval tick. `poll()`
  // pushes into `setParty` (`useGameStore`), which `GameClient.tsx` subscribes
  // to directly and reacts to synchronously — so `PartySession.connect()`
  // starts within a single `/api/friends` round trip of the tap (typically
  // well under 1s), not the next scheduled poll.
  const invitePartyMember = useCallback(
    async (toUserId: string) => {
      const res = await postPartyInvite(toUserId);
      void poll(); // party quick-start: see comment above
      return res;
    },
    [poll],
  );

  const respondPartyInvite = useCallback(
    async (inviteId: string, accept: boolean) => {
      const res = await postRespondPartyInvite(inviteId, accept);
      void poll(); // party quick-start: see comment above
      return res.ok;
    },
    [poll],
  );

  const leaveParty = useCallback(async () => {
    const res = await postLeaveParty();
    void poll(); // party quick-start: see comment above
    return res.ok;
  }, [poll]);

  return {
    status,
    panel,
    // Badge reflects everything actionable: friend requests + party invites.
    pendingCount: (panel?.incomingRequests.length ?? 0) + (panel?.incomingPartyInvites.length ?? 0),
    toasts,
    dismissToast,
    refresh,
    sendRequest,
    respond,
    remove,
    sendEmoji,
    invitePartyMember,
    respondPartyInvite,
    leaveParty,
  };
}
