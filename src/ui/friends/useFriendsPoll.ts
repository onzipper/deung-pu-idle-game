"use client";

/**
 * M8 Phase 1 "Friends" — owns the ONE friends poll for the whole HUD. Mounted
 * once in `FriendsButton.tsx` (the hub component) and threaded down to the
 * badge/toasts/panel as props, so there is exactly one in-flight poll
 * regardless of how many pieces of UI read friends data.
 *
 * Cadence (task brief): while `open`, refetch every 20s + immediately on
 * open/after any mutating action; while closed (and known-registered), a
 * light 60s poll for the badge count + emoji toasts only; a guest identity
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
import type { FriendsPanelWire, SendFriendRequestResult } from "@/ui/friends/types";

const OPEN_POLL_MS = 20_000;
const CLOSED_POLL_MS = 60_000;
const TOAST_DISPLAY_MS = 4_000;

export type FriendsStatus = "loading" | "guest" | "ready" | "error";

export interface FriendToast {
  id: string;
  fromDisplayName: string | null;
  emoji: string;
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
  const abortRef = useRef<AbortController | null>(null);

  const poll = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const res = await fetchFriendsPanel(controller.signal);
    if (res.kind === "aborted") return;
    if (res.kind === "guest") {
      setStatus("guest");
      setPanel(null);
      return;
    }
    if (res.kind === "error") {
      setStatus((prev) => (prev === "ready" ? prev : "error"));
      return;
    }
    setStatus("ready");
    setPanel(res.data);

    const fresh = res.data.emojiPings.filter((p) => !seenPingIds.current.has(p.id));
    if (fresh.length > 0) {
      for (const p of fresh) seenPingIds.current.add(p.id);
      const newToasts = fresh.map((p) => ({
        id: p.id,
        fromDisplayName: p.fromDisplayName,
        emoji: p.emoji,
      }));
      setToasts((prev) => [...prev, ...newToasts]);
      // Scheduled right here (not in a `toasts`-keyed effect) so adding a
      // second toast can never reset an already-ticking first toast's timer.
      for (const nt of newToasts) {
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== nt.id));
        }, TOAST_DISPLAY_MS);
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

    // eslint-disable-next-line react-hooks/set-state-in-effect -- immediate refetch on open, same one-shot-per-transition idiom as the mount probe above
    if (open && !document.hidden) void poll(); // immediate refetch on open

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

  const invitePartyMember = useCallback(
    async (toUserId: string) => {
      const res = await postPartyInvite(toUserId);
      void poll();
      return res;
    },
    [poll],
  );

  const respondPartyInvite = useCallback(
    async (inviteId: string, accept: boolean) => {
      const res = await postRespondPartyInvite(inviteId, accept);
      void poll();
      return res.ok;
    },
    [poll],
  );

  const leaveParty = useCallback(async () => {
    const res = await postLeaveParty();
    void poll();
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
