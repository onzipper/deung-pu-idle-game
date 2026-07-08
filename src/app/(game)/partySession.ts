/**
 * M8 party P4b — the relay transport (docs/party-relay-protocol.md). Owns the actual
 * `WebSocket`; DORMANT unless the store's `party` field is non-null (a guest or a
 * player with no party never mints a ticket — the solo path stays byte-identical, zero
 * network reads added). `GameClient.tsx` is the only caller: it constructs ONE
 * `PartySession`, feeds it store `party` changes + zone changes, and reacts to its
 * callbacks (cohort membership, ordered game messages, shadow transitions).
 *
 * Everything genuinely PURE (cohort derivation from zone beats, the seq-gap detector,
 * leader election, shadow-intent synthesis) is exported as free functions/classes here
 * so `__tests__/partySession.test.ts` exercises them with a fake feed — no real socket
 * needed. The `PartySession` class itself is the thin impure glue around them; a real
 * 3-browser-tab pass is a MANUAL test (see `docs/party-dev-setup.md`) — a genuine
 * WebSocket/Render-cold-start round trip isn't something a unit test can usefully fake.
 */

import { INPUT_DELAY_TURNS, type TurnMessage } from "@/engine/lockstep";
import { zoneAt } from "@/engine";
import type { FrameInput } from "@/engine";

// ── Pure: zone beats -> cohort (design §3 "same-zone cohort") ─────────────────────

export interface ZoneBeat {
  mapId: string;
  zoneIdx: number;
}

function sameZone(a: ZoneBeat, b: ZoneBeat): boolean {
  return a.mapId === b.mapId && a.zoneIdx === b.zoneIdx;
}

/**
 * Cohort = members whose LATEST zone beat equals mine, always including myself,
 * sorted ascending by slot (canonical hero-index order) — re-derived on every beat
 * or `member-left` (design §3). `beats` holds the latest beat seen per OTHER slot
 * (never mine — my own zone is `myZone`, tracked separately by the caller).
 */
export function deriveCohort(
  mySlot: number,
  myZone: ZoneBeat,
  beats: ReadonlyMap<number, ZoneBeat>,
): number[] {
  // Fix C (owner "เมืองไม่ตั้งวง lockstep"): NEVER form a lockstep cohort while I'm in a
  // town zone — everyone in town sims solo (still party-linked; the ghost layer shows
  // peers) so bot restock/sell trips run their full town path instead of deadlocking on a
  // shared cohort. `ZoneBeat` is `{mapId, zoneIdx}` = `WorldLocation`, so `zoneAt` (a pure
  // CONFIG read) resolves it directly. Deterministic + identical on every client, so no
  // town cohort ever forms; walking back out to a farm zone re-derives the cohort on the
  // next beat. Engine-side town/farm-gate defenses stay as defense-in-depth for old peers.
  if (zoneAt(myZone).kind === "town") return [mySlot];
  const slots = [mySlot];
  for (const [slot, beat] of beats) {
    if (slot !== mySlot && sameZone(beat, myZone)) slots.push(slot);
  }
  return slots.sort((a, b) => a - b);
}

/**
 * The LIVE subset of a raw cohort slot list — every slot whose relay socket is NOT
 * currently shadowed. Preserves the raw list's ascending order. A shadowed peer's
 * zone beat LINGERS in peers' beat maps (only `member-left` removes a beat, not
 * `member-shadowed`), so a raw cohort can still list a member whose socket is dead;
 * handshake FORMATION and idle/in-flight membership reconciliation must operate on
 * THIS list, because a shadowed member never sends a reseed-ack — waiting on it
 * deadlocks the exchange forever (the "กำลังเชื่อมต่อปาร์ตี้…" stuck chip). My own
 * slot is never in `shadowed` (a client never shadows itself), so the result always
 * retains at least my slot (all-peers-shadowed ⇒ just me ⇒ the solo path).
 */
export function liveCohortSlots(
  cohortSlots: readonly number[],
  shadowed: ReadonlySet<number>,
): number[] {
  return cohortSlots.filter((s) => !shadowed.has(s));
}

// ── Pure: leader election + shadow-intent synthesis ────────────────────────────────

/**
 * The cohort's RUNTIME leader: the lowest LIVE slot. Distinct from the handshake's
 * "seed authority" (which is frozen at cohort-FORMATION time) — this is re-evaluated
 * continuously so a leader that itself goes shadowed hands the responsibility to the
 * next-lowest live slot automatically (every client derives the same value from the
 * same relay-ordered membership stream).
 */
export function electLeader(liveSlots: readonly number[]): number {
  return Math.min(...liveSlots);
}

/**
 * Translate a relay `member-shadowed`/`member-unshadowed` CONTROL message into a
 * replicated lockstep `setShadowed` intent — ONLY the leader (lowest live slot) ever
 * emits one (avoids every client racing to broadcast the identical thing). Every
 * client (leader included, via the relay's own echo) applies the resulting
 * `TurnMessage` through the ordinary `LockstepClient.deliver()` path — the exact same
 * mechanism proven byte-identical by `engine/lockstep/__tests__/lockstep.test.ts`'s
 * "slot shadowed mid-run" cases, so no new synchronization primitive is needed here.
 * `currentTurn` is the LEADER's own `LockstepClient.turn` at the moment it processes
 * the control message. Returns `null` when `mySlot` isn't the leader (nothing to send).
 */
export function synthesizeShadowMessage(
  leaderSlot: number,
  mySlot: number,
  affectedSlot: number,
  value: boolean,
  currentTurn: number,
): TurnMessage | null {
  if (mySlot !== leaderSlot) return null;
  return {
    slot: affectedSlot,
    executeTurn: currentTurn + INPUT_DELAY_TURNS,
    input: { setShadowed: { value } } satisfies FrameInput,
  };
}

// ── Pure: seq-gap detector (protocol §2: "ANY gap vs welcome.seq = fatal") ─────────

/**
 * Room-scoped seq continuity tracker. Starts at the `welcome.seq` the relay handed
 * back on join; every subsequent message (game OR control) must carry the next
 * integer in sequence. A gap is FATAL per protocol — the caller tears down and
 * rejoins with a FRESH ticket (tickets expire in 60s, so a stale one is never reused).
 */
export class SeqTracker {
  private expected: number;
  constructor(welcomeSeq: number) {
    this.expected = welcomeSeq;
  }
  /** `true` = `seq` was the expected next value (accepted; tracker advances past it).
   *  `false` = GAP — fatal, the caller must teardown + rejoin. */
  accept(seq: number): boolean {
    if (seq !== this.expected) return false;
    this.expected++;
    return true;
  }
}

// ── Pure: friendly-name resolution (NEVER leak a cuid) ─────────────────────────────

/**
 * Resolve a cohort member's HUMAN name from the friends-poll `party` snapshot: prefer
 * the account `displayName`, fall back to the currently-played character's name, and
 * return `null` when neither is known — NEVER the raw `userId` (a cuid), which is what
 * leaked to the HUD chip + nameplates before this. The `party` shape is typed
 * STRUCTURALLY (not imported from `src/ui`) so this session layer never reaches across
 * the layer boundary; `PartyWire`/`PartyMemberWire` in `@/ui/friends/types` are a
 * width-compatible superset. Callers OMIT a `null` result (show nothing) rather than
 * ever falling back to an id.
 */
export function resolveMemberDisplayName(
  userId: string,
  party: {
    members: readonly {
      userId: string;
      displayName: string | null;
      currentCharacter: { name: string } | null;
    }[];
  } | null,
): string | null {
  const m = party?.members.find((x) => x.userId === userId);
  if (!m) return null;
  return m.displayName ?? m.currentCharacter?.name ?? null;
}

// ── Impure: the actual relay transport ─────────────────────────────────────────────

export type PartyConnStatus = "off" | "connecting" | "connected" | "reconnecting";

export interface CohortMember {
  slot: number;
  userId: string;
  displayName: string | null;
}

export interface PartySessionHandlers {
  /** The derived cohort slot list changed (a beat arrived, a member joined/left, or a
   * shadow transition affected membership). ALWAYS includes my own slot; length 1 =
   * "alone in my zone" (no cohort — GameClient falls back to solo). */
  onCohortChanged: (cohortSlots: number[], members: ReadonlyMap<number, CohortMember>) => void;
  /** An ordered, opaque relay game ("g") payload — INCLUDES my own echoed sends. */
  onGameMessage: (fromSlot: number, seq: number, payload: unknown) => void;
  onStatusChange: (status: PartyConnStatus) => void;
  /** A member's live socket flipped shadowed/unshadowed (protocol §5). The caller
   * turns this into a `synthesizeShadowMessage` broadcast IF it is the current
   * leader (see that function's doc) — this handler only reports the observation. */
  onMemberShadowChanged: (slot: number, shadowed: boolean) => void;
  /** The seq-gap detector fired (fatal) — the session has already torn itself down
   * and scheduled a rejoin with a fresh ticket; this is purely a diagnostic hook. */
  onFatalGap?: () => void;
  /** Wave 3 network HUD: the relay echoed a `ping` I sent (point-to-point, never
   * fanned/seq'd — protocol §"PING ECHO"). `n` is whatever I stamped the ping with
   * (the caller uses `Date.now()`, so `Date.now() - n` is the RTT sample). */
  onPong?: (n: number) => void;
}

const HEALTH_PREWAKE_TIMEOUT_MS = 60_000;
const HEALTH_PREWAKE_RETRY_MS = 3_000;
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000];

interface TicketResponse {
  relayUrl: string | null;
  ticket: string;
  slot: number;
  partyId: string;
  exp: number;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

/**
 * Owns the party relay `WebSocket` for the lifetime of a party membership. Dormant
 * (`setParty(null)`) whenever the player isn't in a party — see the module doc.
 */
export class PartySession {
  private readonly handlers: PartySessionHandlers;
  private ws: WebSocket | null = null;
  private mySlot = 0;
  private partyId: string | null = null;
  private seqTracker: SeqTracker | null = null;
  private myZone: ZoneBeat | null = null;
  private readonly beats = new Map<number, ZoneBeat>();
  private readonly members = new Map<number, CohortMember>();
  private cohortSlots: number[] = [];
  private status: PartyConnStatus = "off";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private torndown = true;
  /** Bumped on every `teardown()`/`connect()` so a slow in-flight ticket/health-probe
   * from a STALE attempt can never resurrect a session the caller already tore down. */
  private generation = 0;

  constructor(handlers: PartySessionHandlers) {
    this.handlers = handlers;
  }

  get slot(): number {
    return this.mySlot;
  }

  /**
   * Reacts to a store `party` change. `null` -> fully dormant (zero ticket fetch —
   * the solo path stays byte-identical). A non-null party (re)starts the connect flow
   * unless already live for THIS partyId.
   */
  setParty(party: { partyId: string } | null): void {
    if (!party) {
      this.teardown();
      return;
    }
    if (this.partyId === party.partyId && this.status !== "off") return;
    this.partyId = party.partyId;
    this.reconnectAttempt = 0;
    this.torndown = false;
    const gen = ++this.generation;
    void this.connect(gen);
  }

  /** Record my current zone + (re)broadcast a beat + re-derive the cohort locally.
   *
   * ORDER MATTERS: the beat is broadcast BEFORE `recomputeCohort()` (which fires
   * `onCohortChanged`, the hook the caller uses to send a reseed-offer). On the wire my
   * arrival beat MUST precede that offer — a peer that dropped me while I roamed solo
   * (town potion trip / warp) still lists only itself, so an offer that lands before my
   * beat is discarded as foreign (`receiveOffer`'s cohort check) and the whole re-form
   * stalls until the handshake deadline (~seconds — the "reconnecting every trip" seam).
   * Beat-first, the peer re-derives the cohort from my beat and is ready for the offer
   * that follows. The `welcome` handler already orders it this way; this must match. */
  setZone(mapId: string, zoneIdx: number): void {
    this.myZone = { mapId, zoneIdx };
    if (this.status === "connected") this.broadcastZoneBeat();
    this.recomputeCohort();
  }

  /** Send an opaque game payload (a lockstep `TurnMessage`, typically). No-op while
   * not connected — the caller's own turn-buffering logic handles the gap. */
  send(payload: unknown): void {
    this.sendRaw({ t: "g", payload });
  }

  /** Wave 3 network HUD: fire a `{t:"ping", n}` — the relay echoes it back
   * point-to-point as `{t:"pong", n}` (never fanned, never seq'd). No-op while not
   * connected (the caller's ~5s accumulator just tries again next tick). */
  ping(n: number): void {
    this.sendRaw({ t: "ping", n });
  }

  private sendRaw(obj: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }

  teardown(): void {
    this.torndown = true;
    this.generation++;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close(1000);
    this.ws = null;
    this.partyId = null;
    this.beats.clear();
    this.members.clear();
    this.cohortSlots = [];
    this.setStatus("off");
  }

  private setStatus(s: PartyConnStatus): void {
    this.status = s;
    this.handlers.onStatusChange(s);
  }

  private async connect(gen: number): Promise<void> {
    this.setStatus("connecting");
    const ticket = await this.mintTicket();
    if (gen !== this.generation) return; // superseded (teardown/new party) mid-flight
    if (!ticket) {
      this.scheduleReconnect(gen);
      return;
    }
    if (!ticket.relayUrl) {
      // Relay isn't deployed yet (`PARTY_RELAY_URL` unset server-side) — silently off,
      // matching the ticket route's own documented `relayUrl: null` contract.
      this.setStatus("off");
      return;
    }
    // Prewake ONLY on a reconnect (`reconnectAttempt > 0`), never on the first attempt.
    // A sleeping Render instance is only plausible AFTER a socket failure; on the happy
    // path the relay is kept awake externally (UptimeRobot) and, failing that, the ws
    // handshake below wakes it just as well and has its own retry (ws close ->
    // scheduleReconnect, which bumps `reconnectAttempt` so the NEXT try prewakes). Firing
    // the serial /health round-trip on every connect only added latency to the common
    // case — the "long เชื่อมต่อ on join" seam. Best-effort even when it does run: its
    // result never gates the join (the ws handshake is CORS-exempt; gating here once
    // bricked party mode when a cross-origin /health lacked CORS headers).
    if (this.reconnectAttempt > 0) {
      await this.prewake(ticket.relayUrl, gen);
      if (gen !== this.generation) return;
    }
    this.mySlot = ticket.slot;
    this.openSocket(ticket.relayUrl, ticket.ticket, gen);
  }

  private async mintTicket(): Promise<TicketResponse | null> {
    try {
      const res = await fetch("/api/party/ticket", { method: "POST" });
      if (!res.ok) return null;
      return (await res.json()) as TicketResponse;
    } catch {
      return null;
    }
  }

  /** Pre-wake `GET <relayUrl>/health` (protocol §10) — Render free tier sleeps when
   * idle, so the first join after a while can cold-start. Fired `no-cors` so a relay
   * without CORS headers (or any future policy quirk) can never block it: the response
   * comes back opaque (`res.ok` unreadable) but the REQUEST reaching the server is the
   * whole point. "Resolved without throwing" = the instance answered = awake. The
   * return value is diagnostic only — `connect()` proceeds to the websocket either way. */
  private async prewake(relayUrl: string, gen: number): Promise<boolean> {
    const healthUrl = `${relayUrl.replace(/^ws/, "http")}/health`;
    const deadline = Date.now() + HEALTH_PREWAKE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (gen !== this.generation) return false;
      try {
        await fetch(healthUrl, { method: "GET", mode: "no-cors" });
        return true; // resolved (even opaque) = the server answered = awake
      } catch {
        /* cold start / transient network — keep retrying within the deadline */
      }
      await new Promise((resolve) => setTimeout(resolve, HEALTH_PREWAKE_RETRY_MS));
    }
    return false;
  }

  private openSocket(relayUrl: string, ticket: string, gen: number): void {
    const ws = new WebSocket(relayUrl);
    this.ws = ws;
    ws.onopen = () => {
      if (gen !== this.generation) return;
      ws.send(JSON.stringify({ t: "join", ticket }));
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (gen !== this.generation) return;
      this.handleMessage(ev.data, gen);
    };
    ws.onclose = () => {
      if (this.ws !== ws || gen !== this.generation) return; // superseded already
      this.ws = null;
      if (this.torndown) return;
      this.setStatus("reconnecting");
      this.scheduleReconnect(gen);
    };
    ws.onerror = () => {
      /* the browser follows an error with a close event — handled above */
    };
  }

  private scheduleReconnect(gen: number): void {
    if (this.torndown || gen !== this.generation) return;
    const delay =
      RECONNECT_BACKOFF_MS[Math.min(this.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      if (gen !== this.generation) return;
      void this.connect(gen);
    }, delay);
  }

  private handleMessage(raw: unknown, gen: number): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return;
    }
    const msg = asRecord(parsed);
    if (!msg || typeof msg.t !== "string") return;

    if (msg.t === "welcome") {
      const seq = typeof msg.seq === "number" ? msg.seq : 0;
      this.seqTracker = new SeqTracker(seq);
      this.setStatus("connected");
      this.reconnectAttempt = 0;
      this.members.clear();
      const slots = Array.isArray(msg.slots) ? msg.slots : [];
      for (const entry of slots) {
        const rec = asRecord(entry);
        if (rec && typeof rec.slot === "number" && typeof rec.userId === "string") {
          this.members.set(rec.slot, { slot: rec.slot, userId: rec.userId, displayName: null });
        }
      }
      if (this.myZone) this.broadcastZoneBeat();
      this.recomputeCohort();
      return;
    }

    if (typeof msg.seq === "number") {
      if (!this.seqTracker || !this.seqTracker.accept(msg.seq)) {
        // Fatal per protocol §2 — teardown + rejoin with a FRESH ticket (tickets are
        // short-lived, so `connect()` always mints a new one).
        this.ws?.close();
        this.ws = null;
        this.handlers.onFatalGap?.();
        if (this.torndown) return;
        this.setStatus("reconnecting");
        this.scheduleReconnect(gen);
        return;
      }
    }

    const slot = typeof msg.slot === "number" ? msg.slot : null;
    switch (msg.t) {
      case "g":
        if (slot !== null) this.handleGameMessage(slot, typeof msg.seq === "number" ? msg.seq : 0, msg.payload);
        break;
      case "member-joined":
        if (slot !== null && typeof msg.userId === "string") {
          this.members.set(slot, { slot, userId: msg.userId, displayName: null });
          this.recomputeCohort();
          // Re-announce MY zone to the newcomer: the relay never replays history, and
          // beats are otherwise only sent on join + zone CHANGE — without this, a peer
          // who joins while I'm already standing in a zone can never learn my zone, so
          // its cohort derivation stays solo and it silently drops my reseed-offer
          // (the "both connected, beats flowing, but never see each other" deadlock).
          if (slot !== this.mySlot) this.broadcastZoneBeat();
        }
        break;
      case "member-left":
        if (slot !== null) {
          this.members.delete(slot);
          this.beats.delete(slot);
          this.recomputeCohort();
        }
        break;
      case "member-shadowed":
        if (slot !== null) this.handlers.onMemberShadowChanged(slot, true);
        break;
      case "member-unshadowed":
        if (slot !== null) {
          this.handlers.onMemberShadowChanged(slot, false);
          // Same-slot rejoin fans member-unshadowed (not member-joined) to peers, and
          // the rejoiner missed any zone changes while its socket was dead — re-announce
          // for the same reason as the member-joined case above.
          if (slot !== this.mySlot) this.broadcastZoneBeat();
        }
        break;
      case "pong":
        if (typeof msg.n === "number") this.handlers.onPong?.(msg.n);
        break;
      default:
        break; // unknown t — forward-compat, ignored (protocol §3/§4)
    }
  }

  private handleGameMessage(fromSlot: number, seq: number, payload: unknown): void {
    const rec = asRecord(payload);
    if (rec && rec.kind === "zone" && typeof rec.mapId === "string" && typeof rec.zoneIdx === "number") {
      // Zone beats are session-layer bookkeeping only — never forwarded as a game
      // message (the lockstep layer above never sees them).
      if (fromSlot !== this.mySlot) {
        this.beats.set(fromSlot, { mapId: rec.mapId, zoneIdx: rec.zoneIdx });
        this.recomputeCohort();
      }
      return;
    }
    this.handlers.onGameMessage(fromSlot, seq, payload);
  }

  private recomputeCohort(): void {
    if (!this.myZone) return;
    this.cohortSlots = deriveCohort(this.mySlot, this.myZone, this.beats);
    this.handlers.onCohortChanged(this.cohortSlots, this.members);
  }

  private broadcastZoneBeat(): void {
    if (!this.myZone) return;
    this.send({ kind: "zone", mapId: this.myZone.mapId, zoneIdx: this.myZone.zoneIdx });
  }
}
