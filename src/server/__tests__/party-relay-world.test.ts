import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import net from "node:net";
import http from "node:http";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";

/**
 * World-layer relay tests (ghost-presence + global chat + ping). Starts the REAL
 * standalone relay on an ephemeral port and drives it with raw RFC6455 clients. The
 * relay's wall-clock is INJECTED (`now: () => clock`) so the 30-min chat ring buffer
 * and the 2s chat throttle are exercised deterministically. Covers: presence
 * last-value cache on pjoin, presence fan (sender-excluded + fan cap), presence conn
 * death cleanup, chat history + 30-min prune, 120-char cap + empty reject + 2s
 * soft-reject, ping point-to-point echo (no seq, no fan), and cross-kind ticket
 * rejection at the join boundary. The party protocol is covered by party-relay.test.ts.
 */

const require = createRequire(import.meta.url);
const relayMod = require("../../../scripts/party-relay/server.js") as {
  createRelay: (opts: {
    secret: string;
    heartbeatMs?: number;
    presenceFan?: number;
    presenceMaxBytes?: number;
    paRateMs?: number;
    chatHistoryMs?: number;
    chatMaxEntries?: number;
    chatTextMax?: number;
    chatRateMs?: number;
    now?: () => number;
  }) => {
    server: import("node:http").Server;
    close: (cb?: () => void) => void;
    presenceRooms: Map<string, { members: Map<unknown, { snapshot: string | null }> }>;
    chatMembers: Set<unknown>;
    chatHistory: { name: string; charId: string; text: string; t: number }[];
  };
  signTicket: (p: { partyId: string; userId: string; slot: number; exp: number }, s: string) => string;
  signPresenceTicket: (
    p: {
      kind: "presence";
      userId: string;
      charId: string;
      displayName: string;
      classId: string;
      tier: number;
      exp: number;
    },
    s: string,
  ) => string;
};

const SECRET = "world-test-secret";
const OP_TEXT = 0x1;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

function encodeClientFrame(opcode: number, payloadStr: string): Buffer {
  const payload = Buffer.from(payloadStr, "utf8");
  const len = payload.length;
  const mask = crypto.randomBytes(4);
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  header[0] = 0x80 | opcode;
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

interface Client {
  msgs: Record<string, unknown>[];
  closeCode: number | null;
  send: (obj: unknown) => void;
  end: () => void;
  waitFor: (pred: () => boolean, timeoutMs?: number) => Promise<void>;
}

function connect(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    const key = crypto.randomBytes(16).toString("base64");
    let handshakeDone = false;
    let buf = Buffer.alloc(0);
    const client: Client = {
      msgs: [],
      closeCode: null,
      send: (obj) => socket.write(encodeClientFrame(OP_TEXT, JSON.stringify(obj))),
      end: () => socket.end(),
      waitFor: (pred, timeoutMs = 2000) =>
        new Promise<void>((res, rej) => {
          const t0 = Date.now();
          const tick = () => {
            if (pred()) return res();
            if (Date.now() - t0 > timeoutMs) return rej(new Error("waitFor timeout"));
            setTimeout(tick, 5);
          };
          tick();
        }),
    };

    function parseFrames() {
      for (;;) {
        if (buf.length < 2) return;
        const opcode = buf[0] & 0x0f;
        let len = buf[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = buf.readUInt32BE(6);
          offset = 10;
        }
        if (buf.length < offset + len) return;
        const payload = buf.slice(offset, offset + len);
        buf = buf.slice(offset + len);
        if (opcode === OP_TEXT) {
          client.msgs.push(JSON.parse(payload.toString("utf8")));
        } else if (opcode === OP_CLOSE) {
          client.closeCode = len >= 2 ? payload.readUInt16BE(0) : 1005;
        } else if (opcode === OP_PING) {
          socket.write(encodeClientFrame(OP_PONG, payload.toString("utf8")));
        }
      }
    }

    socket.on("data", (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      if (!handshakeDone) {
        const idx = buf.indexOf("\r\n\r\n");
        if (idx === -1) return;
        handshakeDone = true;
        buf = buf.slice(idx + 4);
        resolve(client);
      }
      parseFrames();
    });
    socket.on("error", reject);
    socket.on("close", () => {
      if (client.closeCode === null) client.closeCode = 1006;
    });

    socket.write(
      `GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\n` +
        `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );
  });
}

function presenceTicket(userId: string, charId: string, name: string, ttl = 60_000): string {
  return relayMod.signPresenceTicket(
    { kind: "presence", userId, charId, displayName: name, classId: "ninja", tier: 3, exp: Date.now() + ttl },
    SECRET,
  );
}
function partyTicket(partyId: string, userId: string, slot: number, ttl = 60_000): string {
  return relayMod.signTicket({ partyId, userId, slot, exp: Date.now() + ttl }, SECRET);
}

const only = (msgs: Record<string, unknown>[], t: string) => msgs.filter((m) => m.t === t);

/** Plain HTTP GET against the relay's public routes (e.g. /presence/counts). */
function httpGet(p: number, path: string): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: p, path, method: "GET" }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null, headers: res.headers }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

// --- suite ---

let relay: ReturnType<typeof relayMod.createRelay>;
let port: number;
let clock: number;

function boot(extra: Parameters<typeof relayMod.createRelay>[0] extends infer O ? Partial<O> : never = {}) {
  relay = relayMod.createRelay({ secret: SECRET, heartbeatMs: 60_000, now: () => clock, ...extra });
}

beforeEach(async () => {
  clock = 1_000_000;
  boot();
  await new Promise<void>((res) => relay.server.listen(0, "127.0.0.1", res));
  port = (relay.server.address() as AddressInfo).port;
});
afterEach(async () => {
  await new Promise<void>((res) => relay.close(() => res()));
});

describe("relay world layer — presence", () => {
  it("delivers each existing member's cached snapshot to a joiner (last-value cache)", async () => {
    const a = await connect(port);
    a.send({ t: "pjoin", v: 1, ticket: presenceTicket("uA", "cA", "A"), zone: "z1" });
    a.send({ t: "p", v: 1, payload: { cid: "cA", x: 42 } });
    // Give the relay a tick to cache A's snapshot before B joins.
    await a.waitFor(() => relay.presenceRooms.get("z1")?.members.size === 1);

    const b = await connect(port);
    b.send({ t: "pjoin", v: 1, ticket: presenceTicket("uB", "cB", "B"), zone: "z1" });
    await b.waitFor(() => only(b.msgs, "p").length >= 1);
    const p = only(b.msgs, "p")[0] as { payload: { cid: string; x: number } };
    expect(p.payload).toEqual({ cid: "cA", x: 42 });
  });

  it("fans a snapshot to OTHER members only (never echoes to the sender)", async () => {
    const a = await connect(port);
    const b = await connect(port);
    a.send({ t: "pjoin", v: 1, ticket: presenceTicket("uA", "cA", "A"), zone: "z2" });
    b.send({ t: "pjoin", v: 1, ticket: presenceTicket("uB", "cB", "B"), zone: "z2" });
    await a.waitFor(() => relay.presenceRooms.get("z2")?.members.size === 2);

    a.send({ t: "p", v: 1, payload: { cid: "cA", x: 7 } });
    await b.waitFor(() => only(b.msgs, "p").length >= 1);
    // B received A's snapshot; A never receives its own.
    expect(only(b.msgs, "p")).toHaveLength(1);
    expect(only(a.msgs, "p")).toHaveLength(0);
  });

  it("respects the presence fan cap (only the first N others receive a snapshot)", async () => {
    await new Promise<void>((res) => relay.close(() => res()));
    clock = 1_000_000;
    boot({ presenceFan: 2 });
    await new Promise<void>((res) => relay.server.listen(0, "127.0.0.1", res));
    port = (relay.server.address() as AddressInfo).port;

    const a = await connect(port);
    const b = await connect(port);
    const c = await connect(port);
    const d = await connect(port);
    a.send({ t: "pjoin", v: 1, ticket: presenceTicket("uA", "cA", "A"), zone: "z3" });
    b.send({ t: "pjoin", v: 1, ticket: presenceTicket("uB", "cB", "B"), zone: "z3" });
    c.send({ t: "pjoin", v: 1, ticket: presenceTicket("uC", "cC", "C"), zone: "z3" });
    d.send({ t: "pjoin", v: 1, ticket: presenceTicket("uD", "cD", "D"), zone: "z3" });
    await a.waitFor(() => relay.presenceRooms.get("z3")?.members.size === 4);

    a.send({ t: "p", v: 1, payload: { cid: "cA" } });
    await b.waitFor(() => only(b.msgs, "p").length >= 1);
    await c.waitFor(() => only(c.msgs, "p").length >= 1);
    // Fan cap of 2 → the two earliest-joined others (B,C) get it, D does not.
    expect(only(b.msgs, "p")).toHaveLength(1);
    expect(only(c.msgs, "p")).toHaveLength(1);
    expect(only(d.msgs, "p")).toHaveLength(0);
  });

  it("cleans presence membership when a socket dies (room emptied → dropped)", async () => {
    const a = await connect(port);
    const b = await connect(port);
    a.send({ t: "pjoin", v: 1, ticket: presenceTicket("uA", "cA", "A"), zone: "z4" });
    b.send({ t: "pjoin", v: 1, ticket: presenceTicket("uB", "cB", "B"), zone: "z4" });
    await a.waitFor(() => relay.presenceRooms.get("z4")?.members.size === 2);

    b.end();
    await a.waitFor(() => relay.presenceRooms.get("z4")?.members.size === 1);
    a.send({ t: "pleave", v: 1 });
    await a.waitFor(() => !relay.presenceRooms.has("z4"));
    expect(relay.presenceRooms.has("z4")).toBe(false);
  });

  it("drops a presence message with an unknown version silently (no close)", async () => {
    const a = await connect(port);
    a.send({ t: "pjoin", v: 2, ticket: presenceTicket("uA", "cA", "A"), zone: "z5" });
    // v!==1 → dropped: no room created, no close frame.
    await new Promise((r) => setTimeout(r, 60));
    expect(relay.presenceRooms.has("z5")).toBe(false);
    expect(a.closeCode).toBe(null);
  });

  it("kills an oversized presence payload (close 4004)", async () => {
    await new Promise<void>((res) => relay.close(() => res()));
    clock = 1_000_000;
    boot({ presenceMaxBytes: 32 });
    await new Promise<void>((res) => relay.server.listen(0, "127.0.0.1", res));
    port = (relay.server.address() as AddressInfo).port;

    const a = await connect(port);
    a.send({ t: "pjoin", v: 1, ticket: presenceTicket("uA", "cA", "A"), zone: "z6" });
    a.send({ t: "p", v: 1, payload: { blob: "x".repeat(200) } });
    await a.waitFor(() => a.closeCode !== null);
    expect(a.closeCode).toBe(4004);
  });
});

describe("relay world layer — presence action stream (pa)", () => {
  it("fans a pa frame verbatim to joined zone peers (sender excluded)", async () => {
    const a = await connect(port);
    const b = await connect(port);
    a.send({ t: "pjoin", v: 1, ticket: presenceTicket("uA", "cA", "A"), zone: "pa1" });
    b.send({ t: "pjoin", v: 1, ticket: presenceTicket("uB", "cB", "B"), zone: "pa1" });
    await a.waitFor(() => relay.presenceRooms.get("pa1")?.members.size === 2);

    const payload = { cid: "cA", x: 10, y: 4, f: 1, a: "walk", at: 1, t: 2 };
    a.send({ t: "pa", v: 1, payload });
    await b.waitFor(() => only(b.msgs, "pa").length >= 1);
    expect((only(b.msgs, "pa")[0] as { payload: unknown }).payload).toEqual(payload);
    expect(only(a.msgs, "pa")).toHaveLength(0); // never echoed to the sender
  });

  it("never delivers pa across zones", async () => {
    const a = await connect(port);
    const c = await connect(port);
    a.send({ t: "pjoin", v: 1, ticket: presenceTicket("uA", "cA", "A"), zone: "paZoneA" });
    c.send({ t: "pjoin", v: 1, ticket: presenceTicket("uC", "cC", "C"), zone: "paZoneB" });
    await a.waitFor(() => relay.presenceRooms.get("paZoneA")?.members.size === 1);
    await c.waitFor(() => relay.presenceRooms.get("paZoneB")?.members.size === 1);

    a.send({ t: "pa", v: 1, payload: { cid: "cA", x: 1, f: 1, a: "dash", at: 0, t: 0 } });
    await new Promise((r) => setTimeout(r, 60));
    expect(only(c.msgs, "pa")).toHaveLength(0); // different zone room
  });

  it("drops a pa sent before pjoin silently (no close, unlike p)", async () => {
    const a = await connect(port);
    a.send({ t: "pa", v: 1, payload: { cid: "cA", x: 1, f: 1, a: "idle", at: 0, t: 0 } });
    await new Promise((r) => setTimeout(r, 60));
    // Additive lossy stream: an unjoined pa is silently ignored, socket stays open.
    expect(a.closeCode).toBe(null);
    expect(relay.presenceRooms.size).toBe(0);
  });

  it("does NOT appear in a late joiner's snapshot (pa is never cached)", async () => {
    const a = await connect(port);
    a.send({ t: "pjoin", v: 1, ticket: presenceTicket("uA", "cA", "A"), zone: "pa4" });
    await a.waitFor(() => relay.presenceRooms.get("pa4")?.members.size === 1);
    a.send({ t: "pa", v: 1, payload: { cid: "cA", x: 9, f: 1, a: "walk", at: 0, t: 0 } });
    await new Promise((r) => setTimeout(r, 60)); // let the relay process the pa

    const b = await connect(port);
    b.send({ t: "pjoin", v: 1, ticket: presenceTicket("uB", "cB", "B"), zone: "pa4" });
    await b.waitFor(() => relay.presenceRooms.get("pa4")?.members.size === 2);
    await new Promise((r) => setTimeout(r, 60));
    // A never sent a `p` snapshot, so the joiner gets neither a cached p nor any pa.
    expect(only(b.msgs, "pa")).toHaveLength(0);
    expect(only(b.msgs, "p")).toHaveLength(0);
  });

  it("does not refresh liveness / the last-value cache (pa never writes snapshot)", async () => {
    const a = await connect(port);
    a.send({ t: "pjoin", v: 1, ticket: presenceTicket("uA", "cA", "A"), zone: "pa5" });
    await a.waitFor(() => relay.presenceRooms.get("pa5")?.members.size === 1);
    const member = () => [...relay.presenceRooms.get("pa5")!.members.values()][0];

    // Spam pa (advance the clock so the ~8Hz rate guard passes each one).
    for (let i = 0; i < 5; i++) {
      clock = 1_000_000 + i * 200;
      a.send({ t: "pa", v: 1, payload: { cid: "cA", x: i, f: 1, a: "walk", at: 0, t: 0 } });
      await new Promise((r) => setTimeout(r, 15));
    }
    // The member's cached snapshot (the liveness/despawn signal) is untouched by pa —
    // `p` is the sole source, so a pa-only peer still despawns on `p` silence.
    expect(member().snapshot).toBe(null);

    // A real `p` DOES populate the cache — proving pa and p are cleanly separated.
    a.send({ t: "p", v: 1, payload: { cid: "cA", x: 99 } });
    await a.waitFor(() => member().snapshot != null);
    expect(member().snapshot).toContain('"t":"p"');
  });

  it("drops a pa with an unknown version silently", async () => {
    const a = await connect(port);
    const b = await connect(port);
    a.send({ t: "pjoin", v: 1, ticket: presenceTicket("uA", "cA", "A"), zone: "pa6" });
    b.send({ t: "pjoin", v: 1, ticket: presenceTicket("uB", "cB", "B"), zone: "pa6" });
    await a.waitFor(() => relay.presenceRooms.get("pa6")?.members.size === 2);

    a.send({ t: "pa", v: 2, payload: { cid: "cA", x: 1, f: 1, a: "walk", at: 0, t: 0 } });
    await new Promise((r) => setTimeout(r, 60));
    expect(only(b.msgs, "pa")).toHaveLength(0);
    expect(a.closeCode).toBe(null); // deploy-skew safe: no close
  });

  it("drops an oversized pa silently (no close, unlike p's 4004)", async () => {
    const a = await connect(port);
    const b = await connect(port);
    a.send({ t: "pjoin", v: 1, ticket: presenceTicket("uA", "cA", "A"), zone: "pa7" });
    b.send({ t: "pjoin", v: 1, ticket: presenceTicket("uB", "cB", "B"), zone: "pa7" });
    await a.waitFor(() => relay.presenceRooms.get("pa7")?.members.size === 2);

    // > presenceMaxBytes (256) — dropped silently for pa (p would CLOSE 4004 here).
    a.send({ t: "pa", v: 1, payload: { cid: "cA", blob: "x".repeat(300) } });
    await new Promise((r) => setTimeout(r, 60));
    expect(only(b.msgs, "pa")).toHaveLength(0);
    expect(a.closeCode).toBe(null);
  });

  it("enforces a ~8Hz per-conn min interval (a too-fast 2nd pa is dropped, no kill)", async () => {
    const a = await connect(port);
    const b = await connect(port);
    a.send({ t: "pjoin", v: 1, ticket: presenceTicket("uA", "cA", "A"), zone: "pa8" });
    b.send({ t: "pjoin", v: 1, ticket: presenceTicket("uB", "cB", "B"), zone: "pa8" });
    await a.waitFor(() => relay.presenceRooms.get("pa8")?.members.size === 2);

    clock = 5_000_000;
    a.send({ t: "pa", v: 1, payload: { cid: "cA", x: 1, f: 1, a: "walk", at: 0, t: 0 } });
    await b.waitFor(() => only(b.msgs, "pa").length >= 1);
    clock = 5_000_050; // +50ms < 100ms guard → dropped
    a.send({ t: "pa", v: 1, payload: { cid: "cA", x: 2, f: 1, a: "walk", at: 0, t: 0 } });
    await new Promise((r) => setTimeout(r, 60));
    expect(only(b.msgs, "pa")).toHaveLength(1); // 2nd throttled, not fanned
    expect(a.closeCode).toBe(null); // never a kill

    clock = 5_000_200; // past the window → accepted again
    a.send({ t: "pa", v: 1, payload: { cid: "cA", x: 3, f: 1, a: "walk", at: 0, t: 0 } });
    await b.waitFor(() => only(b.msgs, "pa").length >= 2);
    expect(only(b.msgs, "pa")).toHaveLength(2);
  });
});

describe("relay world layer — global chat", () => {
  it("sends the joiner the 30-min history and prunes older entries", async () => {
    const a = await connect(port);
    a.send({ t: "cjoin", v: 1, ticket: presenceTicket("uA", "cA", "A") });
    await a.waitFor(() => only(a.msgs, "c-history").length >= 1);

    clock = 1_000_000;
    a.send({ t: "c", v: 1, text: "old" });
    await a.waitFor(() => only(a.msgs, "c").length >= 1);
    // Jump 31 minutes: the "old" entry is now outside the 30-min window.
    clock = 1_000_000 + 31 * 60_000;
    a.send({ t: "c", v: 1, text: "fresh" });
    await a.waitFor(() => only(a.msgs, "c").length >= 2);

    const b = await connect(port);
    b.send({ t: "cjoin", v: 1, ticket: presenceTicket("uB", "cB", "B") });
    await b.waitFor(() => only(b.msgs, "c-history").length >= 1);
    const hist = only(b.msgs, "c-history")[0] as { entries: { text: string }[] };
    expect(hist.entries.map((e) => e.text)).toEqual(["fresh"]);
  });

  it("truncates to the 120-char cap and stamps the ticket's verified name", async () => {
    const a = await connect(port);
    a.send({ t: "cjoin", v: 1, ticket: presenceTicket("uA", "cA", "Nina") });
    await a.waitFor(() => only(a.msgs, "c-history").length >= 1);
    a.send({ t: "c", v: 1, text: "x".repeat(200) });
    await a.waitFor(() => only(a.msgs, "c").length >= 1);
    const entry = (only(a.msgs, "c")[0] as { entry: { text: string; name: string; charId: string } }).entry;
    expect(entry.text).toHaveLength(120);
    expect(entry.name).toBe("Nina"); // from the signed ticket, not client-claimed
    expect(entry.charId).toBe("cA");
  });

  it("drops an empty/whitespace message without consuming the rate window", async () => {
    const a = await connect(port);
    const b = await connect(port);
    a.send({ t: "cjoin", v: 1, ticket: presenceTicket("uA", "cA", "A") });
    b.send({ t: "cjoin", v: 1, ticket: presenceTicket("uB", "cB", "B") });
    await b.waitFor(() => only(b.msgs, "c-history").length >= 1);

    a.send({ t: "c", v: 1, text: "   " }); // trimmed empty → dropped
    a.send({ t: "c", v: 1, text: "hello" }); // same clock: rate window NOT consumed by empty
    await b.waitFor(() => only(b.msgs, "c").length >= 1);
    const cs = only(b.msgs, "c") as { entry: { text: string } }[];
    expect(cs).toHaveLength(1);
    expect(cs[0].entry.text).toBe("hello");
  });

  it("soft-rejects a 2nd message within 2s to the sender only (no kill, no fan)", async () => {
    const a = await connect(port);
    const b = await connect(port);
    a.send({ t: "cjoin", v: 1, ticket: presenceTicket("uA", "cA", "A") });
    b.send({ t: "cjoin", v: 1, ticket: presenceTicket("uB", "cB", "B") });
    await b.waitFor(() => only(b.msgs, "c-history").length >= 1);

    clock = 2_000_000;
    a.send({ t: "c", v: 1, text: "one" });
    await b.waitFor(() => only(b.msgs, "c").length >= 1);
    clock = 2_000_500; // +500ms < 2s → throttled
    a.send({ t: "c", v: 1, text: "two" });
    await a.waitFor(() => only(a.msgs, "c-rej").length >= 1);

    // Sender got a soft c-rej; the socket is alive; "two" never fanned.
    expect((only(a.msgs, "c-rej")[0] as { reason: string }).reason).toBe("rate");
    expect(a.closeCode).toBe(null);
    expect(only(b.msgs, "c")).toHaveLength(1);

    // After the window, the next message is accepted again.
    clock = 2_003_000;
    a.send({ t: "c", v: 1, text: "three" });
    await b.waitFor(() => only(b.msgs, "c").length >= 2);
    expect((only(b.msgs, "c")[1] as { entry: { text: string } }).entry.text).toBe("three");
  });
});

describe("relay world layer — ping + cross-kind", () => {
  it("echoes ping->pong point-to-point (no seq, no fan, before any join)", async () => {
    const a = await connect(port);
    const b = await connect(port);
    a.send({ t: "ping", n: 99 });
    await a.waitFor(() => only(a.msgs, "pong").length >= 1);
    const pong = only(a.msgs, "pong")[0] as Record<string, unknown>;
    expect(pong.n).toBe(99);
    expect("seq" in pong).toBe(false); // ping/pong never touches the ordered stream
    // Point-to-point: B never sees A's pong.
    await new Promise((r) => setTimeout(r, 60));
    expect(only(b.msgs, "pong")).toHaveLength(0);
  });

  it("rejects a presence ticket used for a party join (close 4001)", async () => {
    const a = await connect(port);
    a.send({ t: "join", ticket: presenceTicket("uA", "cA", "A") });
    await a.waitFor(() => a.closeCode !== null);
    expect(a.closeCode).toBe(4001);
  });

  it("rejects a party ticket used for a presence join (close 4001)", async () => {
    const a = await connect(port);
    a.send({ t: "pjoin", v: 1, ticket: partyTicket("pX", "uA", 0), zone: "z9" });
    await a.waitFor(() => a.closeCode !== null);
    expect(a.closeCode).toBe(4001);
  });
});

describe("relay world layer — GET /presence/counts", () => {
  it("reports joined-member counts per zoneKey; empty rooms omitted", async () => {
    const a = await connect(port);
    const b = await connect(port);
    const c = await connect(port);
    a.send({ t: "pjoin", v: 1, ticket: presenceTicket("uA", "cA", "A"), zone: "map1:3" });
    b.send({ t: "pjoin", v: 1, ticket: presenceTicket("uB", "cB", "B"), zone: "map1:3" });
    c.send({ t: "pjoin", v: 1, ticket: presenceTicket("uC", "cC", "C"), zone: "map2:0" });
    await a.waitFor(() => relay.presenceRooms.get("map1:3")?.members.size === 2);
    await c.waitFor(() => relay.presenceRooms.get("map2:0")?.members.size === 1);

    const res = await httpGet(port, "/presence/counts");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.body).toEqual({ v: 1, counts: { "map1:3": 2, "map2:0": 1 } });
  });

  it("does not count a socket that connected but never pjoined", async () => {
    const a = await connect(port);
    await connect(port); // connected, never pjoins → in no room
    a.send({ t: "pjoin", v: 1, ticket: presenceTicket("uA", "cA", "A"), zone: "map1:5" });
    await a.waitFor(() => relay.presenceRooms.get("map1:5")?.members.size === 1);

    const res = await httpGet(port, "/presence/counts");
    expect(res.body).toEqual({ v: 1, counts: { "map1:5": 1 } });
  });

  it("decrements on pleave and omits the room once empty", async () => {
    const a = await connect(port);
    const b = await connect(port);
    a.send({ t: "pjoin", v: 1, ticket: presenceTicket("uA", "cA", "A"), zone: "map3:2" });
    b.send({ t: "pjoin", v: 1, ticket: presenceTicket("uB", "cB", "B"), zone: "map3:2" });
    await a.waitFor(() => relay.presenceRooms.get("map3:2")?.members.size === 2);
    expect((await httpGet(port, "/presence/counts")).body).toEqual({ v: 1, counts: { "map3:2": 2 } });

    b.send({ t: "pleave", v: 1 });
    await a.waitFor(() => relay.presenceRooms.get("map3:2")?.members.size === 1);
    expect((await httpGet(port, "/presence/counts")).body).toEqual({ v: 1, counts: { "map3:2": 1 } });

    a.end();
    await a.waitFor(() => !relay.presenceRooms.has("map3:2"));
    expect((await httpGet(port, "/presence/counts")).body).toEqual({ v: 1, counts: {} });
  });

  it("answers a CORS preflight with 204 + wildcard ACAO", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/presence/counts", method: "OPTIONS" },
        (res) => {
          expect(res.headers["access-control-allow-origin"]).toBe("*");
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(204);
  });
});

describe("client relayUrl cache seam", () => {
  it("returns null until set, then last-write-wins", async () => {
    const mod = await import("../../app/(game)/presence/relayUrlCache");
    // Fresh module state may be shared across the suite; assert relative behavior.
    mod.setCachedRelayUrl(null);
    expect(mod.getCachedRelayUrl()).toBe(null);
    mod.setCachedRelayUrl("wss://relay.example/ws");
    expect(mod.getCachedRelayUrl()).toBe("wss://relay.example/ws");
    mod.setCachedRelayUrl("wss://relay2.example/ws");
    expect(mod.getCachedRelayUrl()).toBe("wss://relay2.example/ws");
    mod.setCachedRelayUrl(null);
    expect(mod.getCachedRelayUrl()).toBe(null);
  });
});
