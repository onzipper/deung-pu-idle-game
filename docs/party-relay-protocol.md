# 🛰️ Party Relay Wire Protocol (M8 P4a)

> The party relay is a **dumb, zero-dependency, zero-game-logic** WebSocket server
> (`scripts/party-relay/server.js`). It does exactly three things: **membership**,
> **ordered fan-out**, and **connection arbitration**. It never parses game payloads,
> never runs `step()`, never stores game state. The single ordered message stream it
> produces IS the determinism backbone every cohort client replays.
>
> Companion reading: `docs/party-design-m8.md` (§1 lockstep turns, §4 join re-seed, §9
> shadow-body), `src/engine/lockstep/turnLoop.ts` (the turn algorithm), the P2 shadow
> contract in `src/engine/systems/shadow.ts`.

---

## 0. Transport

- Plain RFC 6455 WebSocket over HTTP upgrade (same hand-rolled framing as the
  `scripts/ws-probe` spike). Text frames only; all messages are JSON.
- Client→server frames are **masked** (per spec); server→client frames are unmasked.
- `GET /health` → `{ "status":"ok", "rooms":N, "sockets":M, "uptimeSec":S }` (JSON).
  Used for liveness AND **pre-wake** (see §9).

---

## 1. Ticket (auth) — the ONLY trust boundary

The relay cannot reach the DB, so it cannot decide membership. The game server mints a
short-lived signed ticket (`src/server/partyTicket.ts`, `POST /api/party/ticket`); the
relay only **verifies the HMAC** and trusts the embedded slot.

**Format** (`.`-joined, both parts base64url):

```
ticket = base64url(JSON payload) + "." + base64url( HMAC-SHA256(payloadB64, SECRET) )
payload = { partyId: string, userId: string, slot: number, exp: number /* ms epoch */ }
```

- `SECRET` = env **`PARTY_RELAY_SECRET`**, shared by the game server and the relay.
- `slot` is the caller's index in the party's canonical **`joinedAt` asc (id tie-break)**
  order — the same order every client derives for hero/lane indexing. The client can
  never choose its own slot.
- `exp` = mint time + 60s. The relay rejects `now >= exp`.
- Verification: constant-time HMAC compare, JSON well-formedness, `0 <= slot < 3`,
  not expired. Any failure → the join is refused (close `4001`).
- **Fail-loud:** if `PARTY_RELAY_SECRET` is unset, the relay **refuses to start** and
  the ticket route returns `503 { code: "relay_not_configured" }`. No unsigned rooms.

The wire/HMAC format is duplicated **byte-identically** in `partyTicket.ts` (TS) and
`server.js` (standalone JS) on purpose — the relay takes zero app imports. A cross-impl
test asserts they agree.

---

## 2. Rooms, slots, seq

- A **room** is keyed by `partyId`, created lazily on the first valid join, destroyed
  when the last **live** socket is gone.
- Up to `MAX_SLOTS = 3` slots (must match `MAX_PARTY_SIZE` in `src/server/party.ts`).
  A slot is `empty | live | shadowed`; the slot index comes from the ticket.
- **`seq`** is a room-scoped monotonically increasing integer starting at `0`. **Every
  fanned-out message — game AND control — consumes exactly one `seq`**, delivered to all
  live members in one identical order. That total order is the lockstep contract:
  clients feed the ordered stream into `LockstepClient` (2-turn input delay absorbs
  jitter). The point-to-point `welcome` snapshot does **not** consume a `seq`.

---

## 3. Client → server messages

| Message                                 | Meaning                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `{ "t":"join", "ticket": "<b64.b64>" }` | First message after connect. Verified → slot assigned. A second `join` on a live connection is ignored. |
| `{ "t":"g", "payload": <any> }`         | An **opaque** game message (e.g. a lockstep `TurnMessage`). The relay never inspects `payload`.         |
| `{ "t":"leave" }`                       | Clean leave: relay fans `member-left` and frees the slot.                                               |

Unknown `t` values are ignored (forward-compat). A message before a successful join,
a missing `payload`, or a malformed shape → close (see §6).

---

## 4. Server → client messages

Point-to-point (a single joiner, **no `seq`**):

```jsonc
{
  "t": "welcome",
  "slot": 1,
  "partyId": "p1",
  "seq": 42,
  "slots": [
    { "slot": 0, "userId": "uA", "status": "live" },
    null,
    { "slot": 2, "userId": "uC", "status": "shadowed" },
  ],
}
```

`welcome.seq` is where the **live stream resumes**: every subsequent message this client
receives has `seq >= welcome.seq`. `slots[i]` is `null` for an empty slot.

Streamed (fanned to all live members, each carries `seq`):

| Message                                                     | When                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `{ "t":"g", "seq":S, "slot":F, "payload":<any> }`           | A member's game message, echoed to everyone (incl. sender), stamped with sender `slot` `F`. |
| `{ "t":"member-joined", "seq":S, "slot":X, "userId":"u" }`  | A fresh member occupied slot `X`.                                                           |
| `{ "t":"member-left", "seq":S, "slot":X, "reason":"left" }` | A member cleanly left; slot freed.                                                          |
| `{ "t":"member-shadowed", "seq":S, "slot":X }`              | Slot `X`'s socket died and did not return within `GRACE_MS` (peers still present).          |
| `{ "t":"member-unshadowed", "seq":S, "slot":X }`            | A previously-shadowed slot `X` successfully rejoined.                                       |

**Ordering guarantee:** all live members observe the same `(seq → message)` mapping.
Clients apply game messages by their embedded lockstep `executeTurn`, so relay delivery
reordering is irrelevant — the ordered stream + 2-turn delay is the sync.

---

## 5. Grace / shadow contract (design §9, engine `shadow.ts`)

- A socket death is detected via TCP FIN (`end`), reset (`close`/`error`), a heartbeat
  pong timeout (§7), or a protocol/abuse kill (§6). The slot's socket detaches but the
  slot stays `live` (grace-pending) for **`GRACE_MS` (default 5000ms)**.
- On grace expiry, **if the room still has other live members**, the slot flips to
  `shadowed` and `member-shadowed` is fanned. Each client then synthesizes the
  replicated `setShadowed` intent on that slot's own lane so the sim keeps the hero as a
  deterministic shadow-body (frozen `config`, no cross-credit — see design §9).
- If the dead socket was the **last** live socket, the room is destroyed immediately
  (no shadow — nobody left to render or receive it).
- **Rejoin:** a fresh valid ticket for the same slot cancels the grace timer / clears the
  shadow. If the slot was `shadowed` → `member-unshadowed` is fanned; otherwise
  `member-joined`. The rejoiner first gets a fresh `welcome` snapshot, then the live
  stream. State recovery is **not** replayed by the relay (see §8).
- **Arbiter:** a newer valid join for an already-live slot evicts the old socket
  (close `4010`), newest wins.

---

## 6. Error / close codes (application range 4000–4999)

| Code   | Meaning                                                                         |
| ------ | ------------------------------------------------------------------------------- |
| `4001` | Bad join ticket (missing / expired / bad HMAC / malformed / slot out of range). |
| `4002` | Protocol error (message before join, bad shape, missing payload, bad JSON).     |
| `4003` | Server at `maxRooms`.                                                           |
| `4004` | Frame exceeded `maxMsgBytes` (~8KB).                                            |
| `4008` | Over `maxMsgPerSec` (~40/s) — killed for abuse.                                 |
| `4010` | Slot taken over by a newer valid join (arbiter).                                |
| `4011` | Relay shutting down.                                                            |

A protocol/abuse kill of a **joined** socket still routes through the grace→shadow path,
so an evicted member is shadowed, not silently dropped.

---

## 7. Heartbeat

The relay sends a WebSocket **ping** control frame to every live socket every
`PARTY_RELAY_HEARTBEAT_MS` (default 15000ms). A socket that has not returned a **pong**
since the previous ping is treated as dead (→ grace → shadow). Clients must answer pings
(browsers do automatically); the relay also answers client-initiated pings.

---

## 8. State recovery on (re)join — relay stores NOTHING

The relay is dumb: it replays **no** game history. A (re)joiner receives only the
membership `welcome` snapshot (`slots` + `seq`) and the live stream from there. Actual
progression recovery is the **client-side zone-boundary re-seed** (design §4): at the
next zone boundary, members exchange their small server-authoritative progression
payloads as ordinary opaque `"g"` messages and every client `initGameState` /
`initHeroes` the shared field deterministically from those payloads + the agreed seed.
Battlefield entities are transient and rebuilt locally — nothing large ever crosses the
relay, and the relay never needs to understand any of it.

---

## 9. Environment variables

**Relay** (`scripts/party-relay`, Render service):

| Var                           | Required            | Default | Purpose                                     |
| ----------------------------- | ------------------- | ------- | ------------------------------------------- |
| `PARTY_RELAY_SECRET`          | **yes** (fail-loud) | —       | Shared HMAC secret for ticket verification. |
| `PORT`                        | provided by host    | 8090    | Listen port (Render injects it).            |
| `PARTY_RELAY_GRACE_MS`        | no                  | 5000    | Dead-socket → shadow grace.                 |
| `PARTY_RELAY_HEARTBEAT_MS`    | no                  | 15000   | Ping cadence.                               |
| `PARTY_RELAY_MAX_ROOMS`       | no                  | 500     | Room cap.                                   |
| `PARTY_RELAY_MAX_MSG_BYTES`   | no                  | 8192    | Per-frame size cap.                         |
| `PARTY_RELAY_MAX_MSG_PER_SEC` | no                  | 40      | Per-socket flood cap.                       |

**Game server** (Next app):

| Var                  | Required                | Purpose                                                                                  |
| -------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `PARTY_RELAY_SECRET` | **yes** to mint tickets | Same shared secret as the relay.                                                         |
| `PARTY_RELAY_URL`    | no                      | Relay WS URL handed to clients (`{ relayUrl }`); `null` if the relay isn't deployed yet. |

The two `PARTY_RELAY_SECRET` values **must match exactly** or every join is rejected.

---

## 10. Deploy to Render (mirrors the ws-probe spike verdict)

The infra probe passed on Render free tier (RTT ~36ms; persistent WS held). The relay
deploys as a **standalone folder** — no build, no bundler, no app code.

1. New **Web Service** on Render, connected to the repo.
2. **Root Directory:** `scripts/party-relay` (so only this folder + its `package.json`
   ship — zero deps, nothing else installed).
3. **Build Command:** _(none / empty)_ — zero dependencies.
4. **Start Command:** `npm start` (runs `node server.js`).
5. **Environment:** set `PARTY_RELAY_SECRET` (a long random string; the SAME value in the
   game server's env). Optionally override the tunables above. Do **not** hardcode
   `PORT` — Render injects it and `server.js` reads `process.env.PORT`.
6. Health check path: `/health`.
7. In the game server env, set `PARTY_RELAY_URL` to `wss://<service>.onrender.com` and
   `PARTY_RELAY_SECRET` to the matching secret.

**Pre-wake note:** Render free-tier services sleep when idle and cold-start on the next
request. When a party forms, the game server should `GET <relayUrl>/health` first to
wake the instance before clients attempt the WS upgrade, avoiding a cold-start stall on
the first join. `/health` is cheap and returns the current room/socket counts.

---

## 12. Presence action stream (`pa`) — additive visual layer (R3)

The ghost-presence world layer already fans a **last-value** snapshot via `p` (§ world
layer in `server.js`; that snapshot is the sole snapshot-on-join + client-side liveness
source). `pa` is an **additive** high-frequency (~8Hz) visual pose feed layered on top —
it drives peer facing/animation between the coarse `p` snapshots, and carries **no**
authority (it never touches game state, membership, or the lockstep party protocol).

**Client → server**

```jsonc
{
  "t": "pa",
  "v": 1,
  "payload": {
    "cid": "cA",          // sender char id (echoed verbatim; relay never inspects it)
    "x": 512,             // world x
    "y": 128,             // world y (optional)
    "f": 1,               // facing: 1 | -1
    "a": "walk",          // action: idle|walk|basic|skill1|skill2|skill3|skill4|dash
    "at": 1234,           // action-start marker (client clock)
    "t": 1712345678901,   // client send time
  },
}
```

The relay fans it verbatim to zone peers as `{ "t":"pa", "payload": <payload> }`.

**Contract (all additive — every existing opcode/behaviour is byte-identical):**

- **Requires a prior `pjoin`.** A `pa` before joining a presence zone is **dropped
  silently** (no close, unlike `p`'s hard `4002`) — the stream is lossy and must never
  kill a socket.
- **NOT cached.** `pa` never enters the presence last-value snapshot and is never handed
  to a late joiner. `p` remains the ONLY snapshot-on-join source.
- **No liveness.** `pa` never refreshes any liveness/prune timestamp or the cached
  snapshot. A peer that spams `pa` but stops sending `p` still despawns on `p` silence.
- **Fan cap:** at most `PRESENCE_FAN` (12) other zone members, sender excluded, no `seq`,
  unordered — same lossy fan as `p`.
- **Size cap:** payload reuses the presence `256B` cap (`PARTY_RELAY_PRESENCE_MAX_BYTES`).
  Oversized is **dropped silently** (not the `4004` close `p` uses).
- **Rate cap:** a per-connection `~8Hz` min-interval guard
  (`PARTY_RELAY_PA_RATE_MS`, default **100ms** ≈ a 10Hz ceiling with jitter headroom).
  A faster frame is **dropped silently** — no `c-rej`-style reply, no kill.
- **Version drop:** `v !== 1` → dropped silently (deploy-skew safety, same as `p`).

**Forward-compat:** an old client that receives a `pa` frame it doesn't understand
ignores it — clients switch on `msg.t`, and unknown `t` values are no-ops (§3). So the
relay can ship `pa` before any client speaks it.

**Deploy note — relay FIRST.** `pa` is a relay-only additive opcode. Deploy the **relay
first**, then the web client that emits/consumes `pa`; a client that sends `pa` to an
old relay is simply ignored (unknown `t`), and an old client on a new relay never
receives `pa` traffic it didn't subscribe to. There is no schema/DB change (no
`prisma db push`).
