/**
 * M8 Phase 1 "Friends" — thin `fetch` wrappers over `/api/friends*` (server
 * zone, read-only from here). Same tier as `ui/gear/api.ts`/`ui/hof/api.ts`.
 */

import type {
  EmojiPingWire,
  FriendCandidateWire,
  FriendsPanelWire,
  SendFriendRequestResult,
} from "@/ui/friends/types";

export type FriendsPanelFetchResult =
  | { kind: "ok"; data: FriendsPanelWire }
  | { kind: "guest" }
  | { kind: "aborted" }
  | { kind: "error" };

/** GET /api/friends — the one poll endpoint (friends + incoming requests +
 * unseen emoji pings, marked seen server-side on this very read). A 403
 * `account_required` is a normal expected state for a guest, not an error. */
export async function fetchFriendsPanel(signal?: AbortSignal): Promise<FriendsPanelFetchResult> {
  try {
    const res = await fetch("/api/friends", { signal });
    if (res.status === 403) return { kind: "guest" };
    if (!res.ok) return { kind: "error" };
    const data = (await res.json()) as FriendsPanelWire;
    return { kind: "ok", data };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return { kind: "aborted" };
    return { kind: "error" };
  }
}

/** POST /api/friends/request — exactly one of friendCode/characterName. */
export async function postFriendRequest(
  input: { friendCode: string } | { characterName: string },
): Promise<SendFriendRequestResult> {
  try {
    const res = await fetch("/api/friends/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json: unknown = await res.json().catch(() => null);
    if (res.ok && json && typeof json === "object" && "ok" in json && json.ok) {
      const autoAccepted = "autoAccepted" in json && Boolean(json.autoAccepted);
      return { ok: true, autoAccepted };
    }
    if (res.status === 300 && json && typeof json === "object" && "candidates" in json) {
      const candidates = (json as { candidates: FriendCandidateWire[] }).candidates;
      return { ok: false, code: "multiple_matches", candidates };
    }
    const code =
      json && typeof json === "object" && "code" in json && typeof json.code === "string"
        ? json.code
        : "unknown";
    return {
      ok: false,
      code: code as Exclude<SendFriendRequestResult, { ok: true } | { code: "multiple_matches" }>["code"],
    };
  } catch {
    return { ok: false, code: "network" };
  }
}

export type FriendActionResult = { ok: true } | { ok: false; code: string };

/** POST /api/friends/respond — accept/decline an incoming request. */
export async function postRespondFriendRequest(
  requestId: string,
  accept: boolean,
): Promise<FriendActionResult> {
  try {
    const res = await fetch("/api/friends/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, accept }),
    });
    const json: unknown = await res.json().catch(() => null);
    if (res.ok) return { ok: true };
    const code =
      json && typeof json === "object" && "code" in json && typeof json.code === "string"
        ? json.code
        : "unknown";
    return { ok: false, code };
  } catch {
    return { ok: false, code: "network" };
  }
}

/** POST /api/friends/remove — idempotent, either side may remove. */
export async function postRemoveFriend(userId: string): Promise<FriendActionResult> {
  try {
    const res = await fetch("/api/friends/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const json: unknown = await res.json().catch(() => null);
    if (res.ok) return { ok: true };
    const code =
      json && typeof json === "object" && "code" in json && typeof json.code === "string"
        ? json.code
        : "unknown";
    return { ok: false, code };
  } catch {
    return { ok: false, code: "network" };
  }
}

/** POST /api/friends/emoji — send an emoji ping (400 bad_emoji, 403 not_friends,
 * 429 rate_limited). */
export async function postSendEmoji(toUserId: string, emoji: string): Promise<FriendActionResult> {
  try {
    const res = await fetch("/api/friends/emoji", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toUserId, emoji }),
    });
    const json: unknown = await res.json().catch(() => null);
    if (res.ok) return { ok: true };
    const code =
      json && typeof json === "object" && "code" in json && typeof json.code === "string"
        ? json.code
        : "unknown";
    return { ok: false, code };
  } catch {
    return { ok: false, code: "network" };
  }
}

/** Type-only re-export so components don't need a second import path. */
export type { EmojiPingWire };
