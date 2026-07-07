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
  const slots = [mySlot];
  for (const [slot, beat] of beats) {
    if (slot !== mySlot && sameZone(beat, myZone)) slots.push(slot);
  }
  return slots.sort((a, b) => a - b);
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

  /** Record my current zone + (re)broadcast a beat + re-derive the cohort locally. */
  setZone(mapId: string, zoneIdx: number): void {
    this.myZone = { mapId, zoneIdx };
    this.recomputeCohort();
    if (this.status === "connected") this.broadcastZoneBeat();
  }

  /** Send an opaque game payload (a lockstep `TurnMessage`, typically). No-op while
   * not connected — the caller's own turn-buffering logic handles the gap. */
  send(payload: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: "g", payload }));
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
    // Best-effort ONLY: prewake nudges a sleeping Render instance, but its result
    // never gates the join — the websocket handshake below is exempt from CORS,
    // wakes the instance just as well, and has its own retry path (ws close ->
    // scheduleReconnect). Gating here once bricked party mode when a cross-origin
    // /health response lacked CORS headers while the relay itself was healthy.
    await this.prewake(ticket.relayUrl, gen);
    if (gen !== this.generation) return;
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
        if (slot !== null) this.handlers.onMemberShadowChanged(slot, false);
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
