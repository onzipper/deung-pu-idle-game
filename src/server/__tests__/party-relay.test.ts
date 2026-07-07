import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import net from "node:net";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";

/**
 * Party relay integration tests (M8 P4a). Starts the REAL standalone relay on an
 * ephemeral port and drives it with raw RFC6455 clients over TCP sockets (masked
 * client frames, per spec). Covers: ticket-gated join, snapshot + control stream,
 * interleaved ordered fan-out (identical seq order on all clients), member-left on
 * clean leave, member-shadowed after a socket dies past a short grace, rejoin
 * snapshot + member-unshadowed, oversized-frame reject, and rate-limit kill.
 */

const require = createRequire(import.meta.url);
const relayMod = require("../../../scripts/party-relay/server.js") as {
  createRelay: (opts: {
    secret: string;
    graceMs?: number;
    heartbeatMs?: number;
    maxMsgBytes?: number;
    maxMsgPerSec?: number;
  }) => {
    server: import("node:http").Server;
    stats: () => { rooms: number; sockets: number };
    close: (cb?: () => void) => void;
  };
  signTicket: (
    p: { partyId: string; userId: string; slot: number; exp: number },
    s: string,
  ) => string;
};

const SECRET = "relay-test-secret";

// --- raw WS client (masked frames client->server; parse unmasked server frames) ---

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
  destroy: () => void;
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
      destroy: () => socket.destroy(),
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
        } else if (opcode === OP_PONG) {
          /* ignore */
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

function ticketFor(partyId: string, userId: string, slot: number, ttl = 60_000): string {
  return relayMod.signTicket({ partyId, userId, slot, exp: Date.now() + ttl }, SECRET);
}

// --- suite ---

let relay: ReturnType<typeof relayMod.createRelay>;
let port: number;

beforeEach(async () => {
  relay = relayMod.createRelay({ secret: SECRET, graceMs: 120, heartbeatMs: 60_000 });
  await new Promise<void>((res) => relay.server.listen(0, "127.0.0.1", res));
  port = (relay.server.address() as AddressInfo).port;
});
afterEach(async () => {
  await new Promise<void>((res) => relay.close(() => res()));
});

describe("party-relay", () => {
  it("gates join on a valid ticket (bad ticket -> close 4001)", async () => {
    const c = await connect(port);
    c.send({ t: "join", ticket: "garbage.sig" });
    await c.waitFor(() => c.closeCode !== null);
    expect(c.closeCode).toBe(4001);
  });

  it("sends a welcome snapshot then a seq'd member-joined on join", async () => {
    const a = await connect(port);
    a.send({ t: "join", ticket: ticketFor("pX", "uA", 0) });
    await a.waitFor(() => a.msgs.length >= 2);
    const welcome = a.msgs[0];
    expect(welcome.t).toBe("welcome");
    expect(welcome.slot).toBe(0);
    expect(welcome.seq).toBe(0);
    const joined = a.msgs[1];
    expect(joined).toMatchObject({ t: "member-joined", slot: 0, userId: "uA", seq: 0 });
  });

  it("fans interleaved game messages to all members in one identical seq order", async () => {
    const a = await connect(port);
    const b = await connect(port);
    a.send({ t: "join", ticket: ticketFor("pO", "uA", 0) });
    await a.waitFor(() => a.msgs.some((m) => m.t === "member-joined" && m.slot === 0));
    b.send({ t: "join", ticket: ticketFor("pO", "uB", 1) });
    // Wait until A sees B's join so both are live before the interleave.
    await a.waitFor(() => a.msgs.some((m) => m.t === "member-joined" && m.slot === 1));
    await b.waitFor(() => b.msgs.some((m) => m.t === "member-joined" && m.slot === 1));

    // Interleaved sends from both clients.
    a.send({ t: "g", payload: { n: 1 } });
    b.send({ t: "g", payload: { n: 2 } });
    a.send({ t: "g", payload: { n: 3 } });
    b.send({ t: "g", payload: { n: 4 } });

    const gameSeqA = () => a.msgs.filter((m) => m.t === "g");
    const gameSeqB = () => b.msgs.filter((m) => m.t === "g");
    await a.waitFor(() => gameSeqA().length >= 4);
    await b.waitFor(() => gameSeqB().length >= 4);

    // Both observers see the SAME ordered stream of (seq, payload).
    const seqOf = (arr: Record<string, unknown>[]) =>
      arr.map((m) => [m.seq, (m.payload as { n: number }).n]);
    expect(seqOf(gameSeqA())).toEqual(seqOf(gameSeqB()));
    // seqs are strictly increasing and contiguous within the game stream.
    const seqs = gameSeqA().map((m) => m.seq as number);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("emits member-left to peers on a clean leave", async () => {
    const a = await connect(port);
    const b = await connect(port);
    a.send({ t: "join", ticket: ticketFor("pL", "uA", 0) });
    b.send({ t: "join", ticket: ticketFor("pL", "uB", 1) });
    await b.waitFor(() => b.msgs.some((m) => m.t === "member-joined" && m.slot === 1));
    b.send({ t: "leave" });
    await a.waitFor(() => a.msgs.some((m) => m.t === "member-left"));
    const left = a.msgs.find((m) => m.t === "member-left");
    expect(left).toMatchObject({ slot: 1, reason: "left" });
  });

  it("shadows a slot after its socket dies past grace, then unshadows on rejoin", async () => {
    const a = await connect(port);
    const b = await connect(port);
    a.send({ t: "join", ticket: ticketFor("pS", "uA", 0) });
    b.send({ t: "join", ticket: ticketFor("pS", "uB", 1) });
    await a.waitFor(() => a.msgs.some((m) => m.t === "member-joined" && m.slot === 1));

    // Drop B's socket (FIN, no clean "leave" message) — A should see member-shadowed
    // after grace elapses. (A vanished network path with no FIN is caught by heartbeat.)
    b.end();
    await a.waitFor(() => a.msgs.some((m) => m.t === "member-shadowed"));
    const shadowed = a.msgs.find((m) => m.t === "member-shadowed");
    expect(shadowed).toMatchObject({ slot: 1 });

    // B rejoins the same slot -> A sees member-unshadowed; B's snapshot shows slot 0 live.
    const b2 = await connect(port);
    b2.send({ t: "join", ticket: ticketFor("pS", "uB", 1) });
    await a.waitFor(() =>
      a.msgs.some((m) => m.t === "member-unshadowed" && m.slot === 1),
    );
    await b2.waitFor(() => b2.msgs.some((m) => m.t === "welcome"));
    const welcome = b2.msgs.find((m) => m.t === "welcome") as {
      slots: ({ slot: number; status: string } | null)[];
    };
    expect(welcome.slots[0]).toMatchObject({ slot: 0, status: "live" });
    b2.end();
  });

  it("rejects an oversized frame (close 4004)", async () => {
    const small = relayMod.createRelay({
      secret: SECRET,
      maxMsgBytes: 64,
      heartbeatMs: 60_000,
    });
    await new Promise<void>((res) => small.server.listen(0, "127.0.0.1", res));
    const p = (small.server.address() as AddressInfo).port;
    try {
      const c = await connect(p);
      c.send({ t: "g", payload: "x".repeat(200) });
      await c.waitFor(() => c.closeCode !== null);
      expect(c.closeCode).toBe(4004);
    } finally {
      await new Promise<void>((res) => small.close(() => res()));
    }
  });

  it("kills a flooding socket (close 4008)", async () => {
    const strict = relayMod.createRelay({
      secret: SECRET,
      maxMsgPerSec: 5,
      heartbeatMs: 60_000,
    });
    await new Promise<void>((res) => strict.server.listen(0, "127.0.0.1", res));
    const p = (strict.server.address() as AddressInfo).port;
    try {
      const c = await connect(p);
      c.send({ t: "join", ticket: ticketFor("pF", "uA", 0) });
      for (let i = 0; i < 30; i++) c.send({ t: "g", payload: { i } });
      await c.waitFor(() => c.closeCode !== null);
      expect(c.closeCode).toBe(4008);
    } finally {
      await new Promise<void>((res) => strict.close(() => res()));
    }
  });

  it("reports room + socket counts on GET /health", async () => {
    const a = await connect(port);
    a.send({ t: "join", ticket: ticketFor("pH", "uA", 0) });
    await a.waitFor(() => a.msgs.some((m) => m.t === "member-joined"));
    const body = await new Promise<string>((res, rej) => {
      const req = net.connect(port, "127.0.0.1", () => {
        req.write("GET /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      });
      let data = "";
      req.on("data", (d) => (data += d.toString()));
      req.on("end", () => res(data));
      req.on("error", rej);
    });
    const json = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1));
    expect(json.status).toBe("ok");
    expect(json.rooms).toBe(1);
    expect(json.sockets).toBe(1);
    // The game page pre-wakes cross-origin — without a wildcard ACAO the browser
    // hides the 200 from the client (real incident: deung-pu.softrock.space vs
    // the Render relay origin).
    expect(body.toLowerCase()).toContain("access-control-allow-origin: *");
  });
});
