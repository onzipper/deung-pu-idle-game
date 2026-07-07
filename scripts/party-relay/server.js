#!/usr/bin/env node
/**
 * party-relay/server.js  —  M8 party P4a "dumb" lockstep relay.
 *
 * Zero-dependency Node.js HTTP + WebSocket (RFC 6455) relay. It is the ordered
 * fan-out backbone that keeps 2-3 cohort clients' deterministic sims in sync. It
 * deploys as a STANDALONE folder (like scripts/ws-probe) — no npm install, no game
 * imports, no game logic. The ordered message stream IS the determinism contract:
 * the relay never parses, validates, or re-derives a single game field.
 *
 * Responsibilities (and NOTHING else):
 *   1. Membership: rooms keyed by partyId, up to MAX_SLOTS members; the slot index
 *      is taken FROM the signed ticket (server-assigned, stable) — never negotiated.
 *   2. Ordered fan-out: every accepted client game-message ("g", opaque payload) and
 *      every relay-originated CONTROL message gets a room-scoped monotonically
 *      increasing `seq` and is broadcast to ALL live members (echo to sender too) in
 *      one identical order. That single ordered stream is the lockstep backbone.
 *   3. Connection arbiter: a fresh valid join for an occupied slot REPLACES the old
 *      socket (newest wins); a dropped socket past GRACE_MS becomes a shadow.
 *
 * Auth: a join is refused unless it carries a valid HMAC-SHA256 ticket minted by the
 * game server (src/server/partyTicket.ts) under the SHARED `PARTY_RELAY_SECRET`. The
 * relay REFUSES TO START if that secret is absent (fail-loud — no unsigned rooms).
 *
 * Wire protocol + deploy steps: docs/party-relay-protocol.md.
 *
 * Usage:
 *   PARTY_RELAY_SECRET=... PORT=8090 node server.js
 */

"use strict";

const http = require("http");
const crypto = require("crypto");

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// Canonical party cap. MUST match MAX_PARTY_SIZE in src/server/party.ts and the slot
// range the ticket is minted against — kept as a literal here because the relay takes
// ZERO game imports (standalone deploy). If the party cap ever changes, change both.
const MAX_SLOTS = 6; // owner raised the party cap 3 -> 6 (2026-07-08)

// Tunables (env-overridable; createRelay() options win for tests).
const DEFAULTS = {
  graceMs: intEnv("PARTY_RELAY_GRACE_MS", 5000), // dead socket -> shadow after this
  heartbeatMs: intEnv("PARTY_RELAY_HEARTBEAT_MS", 15000), // ws ping cadence
  maxRooms: intEnv("PARTY_RELAY_MAX_ROOMS", 500),
  maxMsgBytes: intEnv("PARTY_RELAY_MAX_MSG_BYTES", 8192), // ~8KB per frame
  maxMsgPerSec: intEnv("PARTY_RELAY_MAX_MSG_PER_SEC", 40), // per-socket flood kill
};

function intEnv(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// Close codes (application range 4000-4999).
const CLOSE = {
  BAD_TICKET: 4001, // join ticket missing / expired / bad HMAC / malformed
  PROTOCOL: 4002, // malformed frame / message before join / bad shape
  ROOMS_FULL: 4003, // server at MAX_ROOMS
  TOO_BIG: 4004, // frame over maxMsgBytes
  FLOOD: 4008, // over maxMsgPerSec — killed for abuse
  REPLACED: 4010, // a newer valid join took this slot (arbiter)
  SHUTDOWN: 4011, // relay closing
};

// ---------------------------------------------------------------------------
// Ticket verification (MUST stay byte-identical to src/server/partyTicket.ts)
// ---------------------------------------------------------------------------

/**
 * Verify a `${payloadB64url}.${hmacB64url}` ticket with `secret`. Returns the decoded
 * payload `{ partyId, userId, slot, exp }` when the HMAC matches, it is well-formed,
 * the slot is in range, and it is not expired (`now < exp`); otherwise `null`. HMAC is
 * compared in constant time. This is the ENTIRE trust boundary the relay owns.
 */
function verifyTicket(ticket, secret, now = Date.now()) {
  if (typeof ticket !== "string") return null;
  const dot = ticket.indexOf(".");
  if (dot <= 0 || dot >= ticket.length - 1) return null;
  const body = ticket.slice(0, dot);
  const sig = ticket.slice(dot + 1);
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch (_err) {
    return null;
  }
  if (
    !payload ||
    typeof payload.partyId !== "string" ||
    typeof payload.userId !== "string" ||
    !Number.isInteger(payload.slot) ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  if (payload.slot < 0 || payload.slot >= MAX_SLOTS) return null;
  if (now >= payload.exp) return null;
  return payload;
}

/** Mint a ticket (dev/test helper — production tickets come from partyTicket.ts). */
function signTicket(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

// ---------------------------------------------------------------------------
// Minimal RFC 6455 framing (borrowed verbatim from scripts/ws-probe/server.js)
// ---------------------------------------------------------------------------

const OPCODE = {
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
};

/** Encode a single unmasked server->client frame. */
function encodeFrame(opcode, payload) {
  const payloadBuf = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload || "", "utf8");
  const len = payloadBuf.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payloadBuf]);
}

function sendText(socket, str) {
  if (!socket || socket.destroyed || !socket.writable) return;
  try {
    socket.write(encodeFrame(OPCODE.TEXT, str));
  } catch (_err) {
    /* socket gone; close handler cleans up */
  }
}

function sendClose(socket, code, reason) {
  if (!socket || socket.destroyed || !socket.writable) return;
  const body = Buffer.alloc(2 + Buffer.byteLength(reason || ""));
  body.writeUInt16BE(code || 1000, 0);
  if (reason) body.write(reason, 2, "utf8");
  try {
    socket.write(encodeFrame(OPCODE.CLOSE, body));
  } catch (_err) {
    /* ignore */
  }
}

/**
 * Per-connection frame parser. Buffers across TCP chunks, yields complete frames.
 * `maxBytes` guards against oversized frames — on breach it emits a synthetic
 * `{ oversize: true }` signal so the caller can kill the abusive socket.
 */
function makeFrameParser(onFrame, maxBytes) {
  let buf = Buffer.alloc(0);
  return function feed(chunk) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (buf.length < 2) return;
      const byte0 = buf[0];
      const byte1 = buf[1];
      const opcode = byte0 & 0x0f;
      const masked = (byte1 & 0x80) !== 0;
      let len = byte1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < offset + 2) return;
        len = buf.readUInt16BE(offset);
        offset += 2;
      } else if (len === 127) {
        if (buf.length < offset + 8) return;
        const hi = buf.readUInt32BE(offset);
        const lo = buf.readUInt32BE(offset + 4);
        if (hi !== 0 || lo > maxBytes) {
          onFrame({ oversize: true });
          buf = Buffer.alloc(0);
          return;
        }
        len = lo;
        offset += 8;
      }
      if (len > maxBytes) {
        onFrame({ oversize: true });
        buf = Buffer.alloc(0);
        return;
      }
      let maskKey = null;
      if (masked) {
        if (buf.length < offset + 4) return;
        maskKey = buf.slice(offset, offset + 4);
        offset += 4;
      }
      if (buf.length < offset + len) return; // wait for more data
      let payload = buf.slice(offset, offset + len);
      if (masked && maskKey) {
        const unmasked = Buffer.alloc(len);
        for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ maskKey[i % 4];
        payload = unmasked;
      }
      buf = buf.slice(offset + len);
      onFrame({ opcode, payload });
    }
  };
}

// ---------------------------------------------------------------------------
// Relay factory (exported for in-process tests; auto-starts when run as main)
// ---------------------------------------------------------------------------

/**
 * Build a relay bound to `secret`. Returns { server, stats, close } — the caller
 * calls `server.listen(port, cb)`. Throws if `secret` is falsy (fail-loud: no relay
 * without the shared HMAC secret).
 */
function createRelay(opts = {}) {
  const secret = opts.secret || process.env.PARTY_RELAY_SECRET;
  if (!secret) {
    throw new Error("PARTY_RELAY_SECRET is required — relay refuses to start without it");
  }
  const cfg = { ...DEFAULTS, ...opts };

  /** partyId -> Room. Room.slots[i] = { status, socket, userId, graceTimer }. */
  const rooms = new Map();
  /** All open (upgraded) connections — heartbeat + shutdown iterate this. */
  const conns = new Set();
  const startedAt = Date.now();

  function emptySlot() {
    return { status: "empty", socket: null, userId: null, graceTimer: null };
  }

  function createRoom(partyId) {
    const room = {
      partyId,
      seq: 0,
      slots: Array.from({ length: MAX_SLOTS }, emptySlot),
    };
    rooms.set(partyId, room);
    return room;
  }

  /** Assign the next room seq to `obj` and broadcast it to every LIVE socket. */
  function fan(room, obj) {
    const seq = room.seq++;
    const framed = JSON.stringify({ ...obj, seq });
    for (const s of room.slots) {
      if (s.status === "live" && s.socket) sendText(s.socket, framed);
    }
    return seq;
  }

  /** Live sockets currently connected in `room` (grace-pending slots have no socket). */
  function liveSocketCount(room) {
    let n = 0;
    for (const s of room.slots) if (s.status === "live" && s.socket) n++;
    return n;
  }

  function destroyRoom(room) {
    for (const s of room.slots) {
      if (s.graceTimer) clearTimeout(s.graceTimer);
      s.graceTimer = null;
    }
    rooms.delete(room.partyId);
  }

  /** Tear the room down once no live socket remains (last member gone; shadows die). */
  function maybeDestroy(room) {
    if (liveSocketCount(room) === 0) destroyRoom(room);
  }

  /** Point-to-point membership snapshot for a (re)joiner. Consumes NO seq. */
  function sendSnapshot(conn, room) {
    const slots = room.slots.map((s, i) =>
      s.status === "empty" ? null : { slot: i, userId: s.userId, status: s.status },
    );
    sendText(
      conn.socket,
      JSON.stringify({
        t: "welcome",
        slot: conn.slot,
        partyId: room.partyId,
        seq: room.seq,
        slots,
      }),
    );
  }

  function handleJoin(conn, msg) {
    const payload = verifyTicket(msg.ticket, secret);
    if (!payload) return closeConn(conn, CLOSE.BAD_TICKET, "bad ticket");

    let room = rooms.get(payload.partyId);
    if (!room) {
      if (rooms.size >= cfg.maxRooms)
        return closeConn(conn, CLOSE.ROOMS_FULL, "rooms full");
      room = createRoom(payload.partyId);
    }

    const slot = payload.slot;
    const s = room.slots[slot];
    const wasShadowed = s.status === "shadowed";

    // Arbiter: a newer valid join evicts the socket squatting on this slot.
    if (s.socket && s.socket !== conn.socket) {
      const old = s.socket;
      s.socket = null; // detach first so the eviction close doesn't re-enter slot logic
      closeConn(findConn(old), CLOSE.REPLACED, "replaced");
    }
    if (s.graceTimer) {
      clearTimeout(s.graceTimer);
      s.graceTimer = null;
    }

    conn.room = room;
    conn.slot = slot;
    conn.userId = payload.userId;
    conn.joined = true;
    s.status = "live";
    s.socket = conn.socket;
    s.userId = payload.userId;

    // Snapshot FIRST (current seq = where the live stream resumes), THEN the seq'd
    // control so the joiner sees its own (un)join as the first streamed message.
    sendSnapshot(conn, room);
    if (wasShadowed) fan(room, { t: "member-unshadowed", slot });
    else fan(room, { t: "member-joined", slot, userId: payload.userId });
  }

  function handleGame(conn, msg) {
    if (!conn.joined || !conn.room) return closeConn(conn, CLOSE.PROTOCOL, "not joined");
    if (!("payload" in msg)) return closeConn(conn, CLOSE.PROTOCOL, "no payload");
    fan(conn.room, { t: "g", slot: conn.slot, payload: msg.payload });
  }

  function handleLeave(conn) {
    const room = conn.room;
    if (room) freeSlot(room, conn.slot, "left");
    closeConn(conn, 1000, "left");
  }

  /** Clean leave: fan member-left, blank the slot, maybe destroy the room. */
  function freeSlot(room, slot, reason) {
    const s = room.slots[slot];
    if (s.status === "empty") return;
    if (s.graceTimer) {
      clearTimeout(s.graceTimer);
      s.graceTimer = null;
    }
    s.status = "empty";
    s.socket = null;
    s.userId = null;
    fan(room, { t: "member-left", slot, reason });
    maybeDestroy(room);
  }

  /** A joined socket died (close/error/heartbeat miss/flood). Start the grace->shadow
   *  timer if peers remain; tear the room down if this was the last live socket. */
  function onSocketDead(conn) {
    const room = conn.room;
    if (!room || conn.slot == null) return;
    const s = room.slots[conn.slot];
    if (!s || s.socket !== conn.socket) return; // already replaced by a newer join
    s.socket = null; // grace-pending: slot still "live" but socketless

    if (liveSocketCount(room) === 0) {
      destroyRoom(room);
      return;
    }
    s.graceTimer = setTimeout(() => {
      s.graceTimer = null;
      if (s.socket) return; // rejoined within grace
      s.status = "shadowed";
      fan(room, { t: "member-shadowed", slot: conn.slot });
    }, cfg.graceMs);
    if (s.graceTimer.unref) s.graceTimer.unref();
  }

  // --- connection lifecycle ---

  function findConn(socket) {
    for (const c of conns) if (c.socket === socket) return c;
    return null;
  }

  function closeConn(conn, code, reason) {
    if (!conn || conn.closed) return;
    conn.closed = true;
    sendClose(conn.socket, code, reason);
    try {
      conn.socket.end();
    } catch (_err) {
      /* ignore */
    }
    // A protocol-level kill of a JOINED socket still routes through onSocketDead via
    // the socket 'close' event, so a killed-for-abuse member correctly shadows.
    conns.delete(conn);
  }

  function handleMessage(conn, msg) {
    if (!msg || typeof msg.t !== "string")
      return closeConn(conn, CLOSE.PROTOCOL, "bad msg");
    switch (msg.t) {
      case "join":
        if (conn.joined) return; // already joined; ignore duplicate joins
        return handleJoin(conn, msg);
      case "g":
        return handleGame(conn, msg);
      case "leave":
        return handleLeave(conn);
      default:
        return; // unknown types ignored (forward-compat)
    }
  }

  /** Trailing-1s message-rate guard. Returns true if the socket must be killed. */
  function rateExceeded(conn) {
    const now = Date.now();
    conn.msgTimes.push(now);
    const cutoff = now - 1000;
    while (conn.msgTimes.length && conn.msgTimes[0] < cutoff) conn.msgTimes.shift();
    return conn.msgTimes.length > cfg.maxMsgPerSec;
  }

  const server = http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    if (url === "/health") {
      // The game page pre-wakes a sleeping instance with a cross-origin GET here
      // (protocol §10). Health is public read-only info, so a wildcard ACAO is
      // safe — without it the browser hides the 200 and the client can't read it.
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
        });
        res.end();
        return;
      }
      let sockets = 0;
      for (const room of rooms.values()) sockets += liveSocketCount(room);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(
        JSON.stringify({
          status: "ok",
          rooms: rooms.size,
          sockets,
          uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        }),
      );
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("party-relay: POST a websocket upgrade with a join ticket. See /health.");
  });

  server.on("upgrade", (req, socket, head) => {
    const key = req.headers["sec-websocket-key"];
    if (!key || (req.headers["upgrade"] || "").toLowerCase() !== "websocket") {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash("sha1")
      .update(key + WS_GUID)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        "\r\n",
    );
    socket.setNoDelay(true);
    socket.setTimeout(0);

    const conn = {
      socket,
      room: null,
      slot: null,
      userId: null,
      joined: false,
      closed: false,
      awaitingPong: false,
      msgTimes: [],
    };
    conns.add(conn);

    const feed = makeFrameParser((frame) => {
      if (frame.oversize) return closeConn(conn, CLOSE.TOO_BIG, "frame too large");
      switch (frame.opcode) {
        case OPCODE.TEXT: {
          if (rateExceeded(conn)) return closeConn(conn, CLOSE.FLOOD, "rate limit");
          let msg;
          try {
            msg = JSON.parse(frame.payload.toString("utf8"));
          } catch (_err) {
            return closeConn(conn, CLOSE.PROTOCOL, "bad json");
          }
          handleMessage(conn, msg);
          break;
        }
        case OPCODE.PING:
          try {
            socket.write(encodeFrame(OPCODE.PONG, frame.payload));
          } catch (_err) {
            /* ignore */
          }
          break;
        case OPCODE.PONG:
          conn.awaitingPong = false;
          break;
        case OPCODE.CLOSE:
          closeConn(conn, 1000, "");
          break;
        default:
          break;
      }
    }, cfg.maxMsgBytes);

    if (head && head.length) process.nextTick(() => feed(head));
    socket.on("data", feed);
    // A member vanishing is detected via TCP FIN ('end'), reset ('close'/'error'), or
    // — for a silently-dropped path with neither — the heartbeat pong timeout below.
    const onDead = () => {
      conns.delete(conn);
      onSocketDead(conn);
      // Upgrade sockets can linger half-open on a bare FIN ('end'); fully tear the
      // socket down so it never keeps the process / server.close() waiting.
      if (!socket.destroyed) socket.destroy();
    };
    socket.on("end", onDead);
    socket.on("close", onDead);
    socket.on("error", onDead);
  });

  // Heartbeat: ping every live socket; a socket that missed the previous ping's pong
  // is treated as dead (drops → grace → shadow).
  const heartbeat = setInterval(() => {
    for (const conn of conns) {
      if (conn.closed) continue;
      if (conn.awaitingPong) {
        closeConn(conn, 1001, "heartbeat timeout");
        continue;
      }
      conn.awaitingPong = true;
      try {
        conn.socket.write(encodeFrame(OPCODE.PING, ""));
      } catch (_err) {
        /* ignore */
      }
    }
  }, cfg.heartbeatMs);
  if (heartbeat.unref) heartbeat.unref();

  function stats() {
    let sockets = 0;
    for (const room of rooms.values()) sockets += liveSocketCount(room);
    return { rooms: rooms.size, sockets };
  }

  function close(cb) {
    clearInterval(heartbeat);
    for (const conn of conns) closeConn(conn, CLOSE.SHUTDOWN, "shutdown");
    for (const room of rooms.values()) destroyRoom(room);
    server.close(cb);
  }

  return { server, stats, close, rooms, CLOSE };
}

// ---------------------------------------------------------------------------
// Main entrypoint (fail-loud on missing secret)
// ---------------------------------------------------------------------------

if (require.main === module) {
  const PORT = parseInt(process.env.PORT, 10) || 8090;
  let relay;
  try {
    relay = createRelay();
  } catch (err) {
    console.error(`[party-relay] ${err.message}`);
    process.exit(1);
  }
  relay.server.listen(PORT, () => {
    console.log(`[party-relay] listening on port ${PORT} (grace=${DEFAULTS.graceMs}ms)`);
    console.log("[party-relay] GET /health for room/socket counts");
  });
  const shutdown = () => relay.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

module.exports = { createRelay, verifyTicket, signTicket, OPCODE, MAX_SLOTS, CLOSE };
