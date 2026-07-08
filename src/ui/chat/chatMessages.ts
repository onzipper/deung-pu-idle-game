/**
 * M8 party Wave 3 "global chat" (docs/ghost-presence-design.md) — pure parse/prune/
 * unread helpers, kept OUT of `gameStore.ts` and `presence/worldSession.ts` so this
 * math is unit-testable without a store or a real socket (same split as
 * `app/(game)/cohortWallet.ts`/`cohortProgress.ts`). `worldSession.ts`'s `onChat` hands
 * `GameClient.tsx` a RAW, UNVALIDATED relay frame; `parseChatFrame` is the ONE place
 * that trusts its shape — everything downstream (the store, the panel) only ever sees
 * the typed result.
 */

export interface ChatMessage {
  id: string;
  name: string;
  charId: string;
  text: string;
  /** Server-stamped ms epoch (the relay's `t` field — a sender's own clock is never
   *  trusted for ordering/pruning). */
  t: number;
}

/** 30-minute chat history window (design copy: "ข้อความเก็บไว้ 30 นาที"). */
export const CHAT_WINDOW_MS = 30 * 60 * 1000;
/** Hard cap on the STORED array regardless of window, so a burst can't grow the store
 *  unbounded between prunes. */
export const CHAT_MAX_MESSAGES = 100;
/** Server-enforced text cap (`scripts/party-relay/server.js`'s `chatTextMax`), mirrored
 *  here as the client-side input `maxLength`. */
export const CHAT_TEXT_MAX = 120;

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

export type RawChatEntry = Omit<ChatMessage, "id">;

function asChatEntry(v: unknown): RawChatEntry | null {
  const r = asRecord(v);
  if (!r) return null;
  if (typeof r.name !== "string" || typeof r.charId !== "string" || typeof r.text !== "string") {
    return null;
  }
  const t = typeof r.t === "number" ? r.t : Date.now();
  return { name: r.name, charId: r.charId, text: r.text, t };
}

export type ParsedChatFrame =
  | { kind: "history"; entries: RawChatEntry[] }
  | { kind: "message"; entry: RawChatEntry }
  | { kind: "rejected" }
  | null;

/** Parse a raw `WorldSession.onChat` frame. Relay wire shapes (`scripts/party-relay/
 *  server.js`): `{t:"c", entry:{name,charId,text,t}}`, `{t:"c-history", entries:[...]}},
 *  `{t:"c-rej", reason:"rate"}`. Anything else (or malformed) returns `null` — the
 *  caller drops it silently, same defensive posture as `worldSession.ts`'s own parser. */
export function parseChatFrame(raw: unknown): ParsedChatFrame {
  const r = asRecord(raw);
  if (!r) return null;
  switch (r.t) {
    case "c-rej":
      return { kind: "rejected" };
    case "c": {
      const entry = asChatEntry(r.entry);
      return entry ? { kind: "message", entry } : null;
    }
    case "c-history": {
      if (!Array.isArray(r.entries)) return null;
      const entries = r.entries.map(asChatEntry).filter((e): e is RawChatEntry => e !== null);
      return { kind: "history", entries };
    }
    default:
      return null;
  }
}

/** Cap the stored array to the most recent `CHAT_MAX_MESSAGES` (write-time bound —
 *  called on every ingest, never mutates the input). */
export function capChatMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.length > CHAT_MAX_MESSAGES
    ? messages.slice(messages.length - CHAT_MAX_MESSAGES)
    : [...messages];
}

/** Read-time 30-minute window filter — the store itself just holds the last
 *  `CHAT_MAX_MESSAGES`; the panel calls this at render time so history "ages out"
 *  smoothly instead of the store needing a background prune timer. */
export function pruneToWindow(messages: readonly ChatMessage[], nowMs: number): ChatMessage[] {
  const cutoff = nowMs - CHAT_WINDOW_MS;
  return messages.filter((m) => m.t >= cutoff);
}

/** Unread-counter transition: a NEW live message (never a history dump) increments
 *  while the panel is closed; the panel opening clears it. Pure so the increment rule
 *  is testable without touching Zustand. */
export function nextUnreadCount(current: number, chatOpen: boolean): number {
  return chatOpen ? 0 : current + 1;
}
