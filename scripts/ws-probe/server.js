#!/usr/bin/env node
/**
 * ws-probe/server.js
 *
 * Zero-dependency Node.js HTTP + WebSocket (RFC 6455) probe server.
 * Purpose: find out whether a given host (Hostinger shared/premium plan,
 * a VPS, or a local machine) can hold open a persistent, bidirectional
 * WebSocket connection long enough (and with stable enough latency) to
 * support the game's future lockstep party feature (M8).
 *
 * No npm dependencies on purpose — this file must be uploadable and
 * runnable on the cheapest possible Node.js hosting slot with nothing
 * else installed.
 *
 * Usage:
 *   PORT=8080 node server.js
 *
 * Endpoints:
 *   GET  /            -> serves client.html (the browser-side probe UI)
 *   GET  /health       -> "ok" (plain text, for host health checks)
 *   WS   /             -> upgrade to a WebSocket; JSON message protocol below
 *
 * WebSocket message protocol (all messages are JSON-stringified text frames):
 *   Client -> Server:
 *     { t: "join", room: string }
 *     { t: "rtt", ts: number, seq: number }
 *     { t: "broadcast", room: string, payload: any }
 *   Server -> Client:
 *     { t: "welcome", id: string, serverTs: number }
 *     { t: "rtt", ts: number, seq: number, serverTs: number }
 *     { t: "broadcast", from: string, self: boolean, payload: any, serverTs: number }
 *     { t: "peer-count", room: string, count: number }
 */

'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ---------------------------------------------------------------------------
// Static client page
// ---------------------------------------------------------------------------

const CLIENT_HTML_PATH = path.join(__dirname, 'client.html');
let clientHtmlCache = null;

function getClientHtml() {
  // Re-read each time in dev-friendliness (probe traffic is tiny; cost is
  // negligible), but fall back to a cached copy if the file briefly fails
  // to read (e.g. mid-deploy file swap on some hosts).
  try {
    clientHtmlCache = fs.readFileSync(CLIENT_HTML_PATH, 'utf8');
  } catch (_err) {
    if (!clientHtmlCache) {
      return '<!doctype html><html><body><h1>client.html not found</h1></body></html>';
    }
  }
  return clientHtmlCache;
}

// ---------------------------------------------------------------------------
// HTTP server (also handles the WebSocket upgrade handshake)
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }

  if (url === '/' || url === '/index.html') {
    const html = getClientHtml();
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(html);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

// ---------------------------------------------------------------------------
// Minimal RFC 6455 WebSocket implementation (no deps)
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
  const payloadBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '', 'utf8');
  const len = payloadBuf.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode; // FIN=1
    header[1] = len; // MASK=0
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    // High 32 bits assumed 0 - probe payloads are always tiny JSON blobs.
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }

  return Buffer.concat([header, payloadBuf]);
}

function sendText(socket, str) {
  if (socket.destroyed || !socket.writable) return;
  try {
    socket.write(encodeFrame(OPCODE.TEXT, str));
  } catch (_err) {
    // socket already gone; ignore, close handler will clean up
  }
}

function sendClose(socket, code, reason) {
  if (socket.destroyed || !socket.writable) return;
  const body = Buffer.alloc(2 + Buffer.byteLength(reason || ''));
  body.writeUInt16BE(code || 1000, 0);
  if (reason) body.write(reason, 2, 'utf8');
  try {
    socket.write(encodeFrame(OPCODE.CLOSE, body));
  } catch (_err) {
    /* ignore */
  }
}

/**
 * Per-connection frame parser. Buffers incoming bytes across TCP chunks
 * (a single WS frame is not guaranteed to arrive in one `data` event, and
 * one `data` event can contain multiple frames) and yields complete frames.
 */
function makeFrameParser(onFrame) {
  let buf = Buffer.alloc(0);

  return function feed(chunk) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;

    // Try to parse as many complete frames as are available.
    for (;;) {
      if (buf.length < 2) return;

      const byte0 = buf[0];
      const byte1 = buf[1];
      const fin = (byte0 & 0x80) !== 0;
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
        // Only the low 32 bits matter for our tiny payloads.
        const hi = buf.readUInt32BE(offset);
        const lo = buf.readUInt32BE(offset + 4);
        if (hi !== 0) {
          // Payload absurdly large for a probe - bail out defensively.
          onFrame({ opcode: OPCODE.CLOSE, payload: Buffer.alloc(0) });
          buf = Buffer.alloc(0);
          return;
        }
        len = lo;
        offset += 8;
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
        for (let i = 0; i < len; i++) {
          unmasked[i] = payload[i] ^ maskKey[i % 4];
        }
        payload = unmasked;
      }

      buf = buf.slice(offset + len);
      onFrame({ opcode, payload, fin });
    }
  };
}

// room -> Set<socket>
const rooms = new Map();

function joinRoom(conn, room) {
  leaveRoom(conn);
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(conn.socket);
  conn.room = room;
  broadcastPeerCount(room);
}

function leaveRoom(conn) {
  if (!conn.room) return;
  const set = rooms.get(conn.room);
  if (set) {
    set.delete(conn.socket);
    if (set.size === 0) rooms.delete(conn.room);
  }
  const room = conn.room;
  conn.room = null;
  broadcastPeerCount(room);
}

function broadcastPeerCount(room) {
  const set = rooms.get(room);
  const count = set ? set.size : 0;
  const msg = JSON.stringify({ t: 'peer-count', room, count, serverTs: Date.now() });
  if (set) {
    for (const s of set) sendText(s, msg);
  }
}

function broadcastToRoom(conn, room, payload) {
  const set = rooms.get(room);
  if (!set) return;
  for (const s of set) {
    const self = s === conn.socket;
    sendText(
      s,
      JSON.stringify({
        t: 'broadcast',
        from: conn.id,
        self,
        payload,
        serverTs: Date.now(),
      }),
    );
  }
}

let nextId = 1;

server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers['upgrade'] || '').toLowerCase() !== 'websocket') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      '\r\n',
  );

  // Keep the probe alive on flaky proxies: disable Nagle, no idle timeout
  // from our side (we WANT to see how long the network path tolerates it).
  socket.setNoDelay(true);
  socket.setTimeout(0);

  const conn = {
    id: 'c' + nextId++,
    socket,
    room: null,
  };

  if (head && head.length) {
    // Any bytes that arrived along with the upgrade request get fed first.
    process.nextTick(() => feed(head));
  }

  const feed = makeFrameParser(({ opcode, payload }) => {
    switch (opcode) {
      case OPCODE.TEXT: {
        let msg;
        try {
          msg = JSON.parse(payload.toString('utf8'));
        } catch (_err) {
          return; // ignore malformed frames
        }
        handleMessage(conn, msg);
        break;
      }
      case OPCODE.PING:
        try {
          socket.write(encodeFrame(OPCODE.PONG, payload));
        } catch (_err) {
          /* ignore */
        }
        break;
      case OPCODE.PONG:
        // no-op; we don't currently send unsolicited server pings
        break;
      case OPCODE.CLOSE:
        sendClose(socket, 1000, '');
        socket.end();
        break;
      default:
        break;
    }
  });

  socket.on('data', feed);

  socket.on('close', () => leaveRoom(conn));
  socket.on('error', () => leaveRoom(conn));

  sendText(socket, JSON.stringify({ t: 'welcome', id: conn.id, serverTs: Date.now() }));
});

function handleMessage(conn, msg) {
  if (!msg || typeof msg.t !== 'string') return;

  switch (msg.t) {
    case 'join':
      if (typeof msg.room === 'string' && msg.room.length > 0 && msg.room.length < 128) {
        joinRoom(conn, msg.room);
      }
      break;

    case 'rtt':
      sendText(
        conn.socket,
        JSON.stringify({ t: 'rtt', ts: msg.ts, seq: msg.seq, serverTs: Date.now() }),
      );
      break;

    case 'broadcast':
      if (typeof msg.room === 'string') {
        broadcastToRoom(conn, msg.room, msg.payload);
      }
      break;

    default:
      break;
  }
}

server.listen(PORT, () => {
  console.log(`[ws-probe] listening on port ${PORT}`);
  console.log(`[ws-probe] open http://<host>:${PORT}/ in a browser`);
});
