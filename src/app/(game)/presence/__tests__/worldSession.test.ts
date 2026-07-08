import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorldSession } from "../worldSession";

/** Minimal fake WebSocket (records sends; manual open/message/close triggers). */
const instances: FakeWS[] = [];
class FakeWS {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closedWith: number | null = null;
  constructor(public url: string) {
    instances.push(this);
  }
  send(s: string): void {
    this.sent.push(s);
  }
  close(code?: number): void {
    this.readyState = FakeWS.CLOSED;
    this.closedWith = code ?? null;
  }
  open(): void {
    this.readyState = FakeWS.OPEN;
    this.onopen?.();
  }
  parsed(): Record<string, unknown>[] {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const TICKET = {
  relayUrl: "ws://relay.test",
  ticket: "TICKET",
  charId: "c1",
  displayName: "Aran",
  classId: "mage",
  tier: 1,
  exp: Date.now() + 60_000,
};

beforeEach(() => {
  instances.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => TICKET })),
  );
  vi.stubGlobal("WebSocket", FakeWS);
});
afterEach(() => vi.unstubAllGlobals());

describe("WorldSession — connect + zone switch", () => {
  it("pjoins the current zone on open and emits pleave+pjoin on a zone switch", async () => {
    const ws = new WorldSession({ onGhost: () => {} });
    ws.setZone("map-1", 2);
    ws.connect();
    await flush(); // mintTicket + openSocket
    expect(instances).toHaveLength(1);
    const sock = instances[0];
    sock.open();

    expect(ws.me?.charId).toBe("c1");
    let frames = sock.parsed();
    expect(frames).toEqual([{ t: "pjoin", v: 1, ticket: "TICKET", zone: "map-1:2" }]);

    sock.sent.length = 0;
    ws.setZone("map-1", 3);
    frames = sock.parsed();
    expect(frames).toEqual([
      { t: "pleave", v: 1 },
      { t: "pjoin", v: 1, ticket: "TICKET", zone: "map-1:3" },
    ]);
  });

  it("publish sends a {t:'p',v:1,payload} frame only while connected", async () => {
    const ws = new WorldSession({ onGhost: () => {} });
    ws.publish({ v: 1, cid: "c1" }); // not connected → dropped
    ws.setZone("map-1", 1);
    ws.connect();
    await flush();
    const sock = instances[0];
    sock.open();
    sock.sent.length = 0;
    ws.publish({ v: 1, cid: "c1", x: 5 });
    expect(sock.parsed()).toEqual([{ t: "p", v: 1, payload: { v: 1, cid: "c1", x: 5 } }]);
  });

  it("routes inbound presence to onGhost and chat to onChat ONLY", async () => {
    const ghosts: unknown[] = [];
    const chats: unknown[] = [];
    const ws = new WorldSession({ onGhost: (p) => ghosts.push(p), onChat: (c) => chats.push(c) });
    ws.setZone("map-1", 1);
    ws.connect();
    await flush();
    const sock = instances[0];
    sock.open();

    sock.onmessage?.({ data: JSON.stringify({ t: "p", payload: { v: 1, cid: "peer" } }) });
    sock.onmessage?.({ data: JSON.stringify({ t: "c", entry: { text: "hi" } }) });
    sock.onmessage?.({ data: JSON.stringify({ t: "pong", n: 7 }) }); // ignored
    sock.onmessage?.({ data: "not json" }); // ignored

    expect(ghosts).toEqual([{ v: 1, cid: "peer" }]);
    expect(chats).toEqual([{ t: "c", entry: { text: "hi" } }]);
  });

  it("disconnect sends pleave, closes clean (1000), and clears identity", async () => {
    const ws = new WorldSession({ onGhost: () => {} });
    ws.setZone("map-1", 1);
    ws.connect();
    await flush();
    const sock = instances[0];
    sock.open();
    sock.sent.length = 0;
    ws.disconnect();
    expect(sock.parsed()[0]).toEqual({ t: "pleave", v: 1 });
    expect(sock.closedWith).toBe(1000);
    expect(ws.me).toBeNull();
    expect(ws.connected).toBe(false);
  });
});
