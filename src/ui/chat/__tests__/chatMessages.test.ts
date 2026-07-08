import { describe, expect, it } from "vitest";
import {
  CHAT_MAX_MESSAGES,
  CHAT_WINDOW_MS,
  capChatMessages,
  nextUnreadCount,
  parseChatFrame,
  pruneToWindow,
  type ChatMessage,
} from "../chatMessages";

function msg(id: string, t: number, name = "pu"): ChatMessage {
  return { id, name, charId: `c-${id}`, text: "hi", t };
}

describe("parseChatFrame", () => {
  it("parses a single `c` frame into a message result", () => {
    const raw = { t: "c", entry: { name: "pu", charId: "abc", text: "hello", t: 123 } };
    expect(parseChatFrame(raw)).toEqual({
      kind: "message",
      entry: { name: "pu", charId: "abc", text: "hello", t: 123 },
    });
  });

  it("parses a `c-history` frame into an array of entries", () => {
    const raw = {
      t: "c-history",
      entries: [
        { name: "pu", charId: "a", text: "hi", t: 1 },
        { name: "dueng", charId: "b", text: "yo", t: 2 },
      ],
    };
    const parsed = parseChatFrame(raw);
    expect(parsed?.kind).toBe("history");
    expect(parsed && "entries" in parsed ? parsed.entries : []).toHaveLength(2);
  });

  it("parses a `c-rej` frame as a rejection", () => {
    expect(parseChatFrame({ t: "c-rej", reason: "rate" })).toEqual({ kind: "rejected" });
  });

  it("drops a malformed `c` frame (missing entry fields)", () => {
    expect(parseChatFrame({ t: "c", entry: { name: "pu" } })).toBeNull();
    expect(parseChatFrame({ t: "c" })).toBeNull();
  });

  it("drops a `c-history` frame whose entries isn't an array", () => {
    expect(parseChatFrame({ t: "c-history", entries: "nope" })).toBeNull();
  });

  it("filters out malformed entries within an otherwise-valid history array", () => {
    const raw = {
      t: "c-history",
      entries: [{ name: "pu", charId: "a", text: "hi", t: 1 }, { bogus: true }],
    };
    const parsed = parseChatFrame(raw);
    expect(parsed?.kind === "history" ? parsed.entries : []).toHaveLength(1);
  });

  it("returns null for an unknown or malformed frame", () => {
    expect(parseChatFrame({ t: "p", payload: {} })).toBeNull();
    expect(parseChatFrame("not an object")).toBeNull();
    expect(parseChatFrame(null)).toBeNull();
  });

  it("defaults a missing/non-numeric `t` to Date.now() rather than dropping the message", () => {
    const before = Date.now();
    const parsed = parseChatFrame({ t: "c", entry: { name: "pu", charId: "a", text: "hi" } });
    expect(parsed?.kind).toBe("message");
    if (parsed?.kind === "message") expect(parsed.entry.t).toBeGreaterThanOrEqual(before);
  });
});

describe("capChatMessages", () => {
  it("leaves a short array untouched (never mutates input)", () => {
    const input = [msg("1", 1), msg("2", 2)];
    const out = capChatMessages(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it("keeps only the most recent CHAT_MAX_MESSAGES entries", () => {
    const input = Array.from({ length: CHAT_MAX_MESSAGES + 10 }, (_, i) => msg(String(i), i));
    const out = capChatMessages(input);
    expect(out).toHaveLength(CHAT_MAX_MESSAGES);
    expect(out[0].id).toBe("10");
    expect(out[out.length - 1].id).toBe(String(CHAT_MAX_MESSAGES + 9));
  });
});

describe("pruneToWindow", () => {
  it("keeps messages within the 30-minute window and drops older ones", () => {
    const now = 10_000_000;
    const messages = [
      msg("old", now - CHAT_WINDOW_MS - 1),
      msg("edge", now - CHAT_WINDOW_MS),
      msg("recent", now - 1_000),
    ];
    const out = pruneToWindow(messages, now);
    expect(out.map((m) => m.id)).toEqual(["edge", "recent"]);
  });

  it("never mutates the input array", () => {
    const input = [msg("a", 0)];
    pruneToWindow(input, CHAT_WINDOW_MS * 10);
    expect(input).toHaveLength(1);
  });
});

describe("nextUnreadCount", () => {
  it("increments while the panel is closed", () => {
    expect(nextUnreadCount(0, false)).toBe(1);
    expect(nextUnreadCount(3, false)).toBe(4);
  });

  it("resets to 0 while the panel is open", () => {
    expect(nextUnreadCount(7, true)).toBe(0);
  });
});
