/**
 * The "world socket" — ONE WebSocket carrying ghost-presence + global chat + ping
 * (docs/ghost-presence-design.md §3). Modeled on `partySession.ts`'s transport but far
 * simpler: NO slots, NO seq, NO handshake, NO grace/shadow — presence is pub/sub, lossy,
 * unordered by design (design §2 invariant #2). It shares ZERO code with the party
 * socket; a presence/chat frame can never be parsed as a lockstep `TurnMessage`.
 *
 * THE ONE RULE (design §2): inbound presence goes ONLY to `onGhost`; inbound chat ONLY
 * to `onChat`. This class holds no reference to the engine, the store, or `pendingInput`.
 * There is no "apply" path for anything received here — it is a display feed and nothing
 * more. `GameClient` owns the visibility lifecycle and calls `connect()`/`disconnect()`
 * (mirroring how it drives `partySession` on `visibilitychange`), and only ever connects
 * lazily while `ghostsVisible && page-visible`.
 */

interface WorldSessionHandlers {
  /** A peer presence snapshot (`{t:"p",payload}` frame). The RAW payload — the caller's
   *  `GhostStore` validates it. This is the entire presence write surface. */
  onGhost: (payload: unknown) => void;
  /** A chat frame (`c` / `c-history` / `c-rej`). Buffered for a later chat UI (not in
   *  this wave's scope) — kept as an opaque forward so the socket layer is chat-ready. */
  onChat?: (frame: unknown) => void;
  /** Diagnostic connection-status hook (optional). */
  onStatus?: (status: WorldConnStatus) => void;
}

export type WorldConnStatus = "off" | "connecting" | "connected" | "reconnecting";

interface PresenceTicketResponse {
  relayUrl: string | null;
  ticket: string;
  charId: string;
  displayName: string;
  classId: string;
  tier: number;
  exp: number;
}

const RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000];

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

export class WorldSession {
  private readonly handlers: WorldSessionHandlers;
  private ws: WebSocket | null = null;
  private status: WorldConnStatus = "off";
  private myZone: string | null = null;
  private wantConnected = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on every teardown/connect so a slow in-flight ticket fetch from a superseded
   *  attempt can never resurrect a socket the caller already tore down. */
  private generation = 0;
  /** The identity minted for THIS connection — `charId` is the ghost snapshot `cid` and
   *  `displayName`/`classId`/`tier` are the server-derived cosmetics (see design §3.2). */
  private identity: { charId: string; displayName: string; classId: string; tier: number } | null =
    null;

  constructor(handlers: WorldSessionHandlers) {
    this.handlers = handlers;
  }

  /** My server-derived identity for this connection (null until connected), so the
   *  publisher can stamp the snapshot `cid`/`name` and self-dedup the ghost store. */
  get me(): { charId: string; displayName: string; classId: string; tier: number } | null {
    return this.identity;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.status === "connected";
  }

  /** Open the world socket (idempotent while already live). Lazy: `GameClient` calls this
   *  only while the feature is on AND the tab is visible. */
  connect(): void {
    if (this.wantConnected && this.status !== "off") return;
    this.wantConnected = true;
    this.reconnectAttempt = 0;
    const gen = ++this.generation;
    void this.openFlow(gen);
  }

  /** Clean close (visibilitychange hide / toggle off). Peers despawn my ghost on silence. */
  disconnect(): void {
    this.wantConnected = false;
    this.generation++;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      // Best-effort explicit pleave (peers despawn on silence anyway).
      if (this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ t: "pleave", v: 1 }));
        } catch {
          /* closing anyway */
        }
      }
      this.ws.close(1000);
      this.ws = null;
    }
    this.identity = null;
    this.setStatus("off");
  }

  /** Record my current zone and (re)join its presence room. Zone switch = pleave + pjoin
   *  (design §3.1). No-op transport side while not connected — `pjoin` is (re)sent on the
   *  next successful open. */
  setZone(mapId: string, zoneIdx: number): void {
    const zone = `${mapId}:${zoneIdx}`;
    if (zone === this.myZone) return;
    this.myZone = zone;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendRaw({ t: "pleave", v: 1 });
      this.joinPresence();
    }
  }

  /** Publish MY presence snapshot (one-way; there is no echo/apply path — invariant #6).
   *  Dropped silently while not connected or before a zone is known. */
  publish(payload: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN || !this.myZone) return;
    this.sendRaw({ t: "p", v: 1, payload });
  }

  private setStatus(s: WorldConnStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.handlers.onStatus?.(s);
  }

  private sendRaw(obj: unknown): void {
    try {
      this.ws?.send(JSON.stringify(obj));
    } catch {
      /* socket died mid-send — the close handler reconnects */
    }
  }

  private joinPresence(): void {
    if (!this.identity || !this.myZone) return;
    // Re-mint isn't needed per-zone: the ticket authorizes the connection, not the room.
    this.sendRaw({ t: "pjoin", v: 1, ticket: this.currentTicket, zone: this.myZone });
  }

  private currentTicket = "";

  private async openFlow(gen: number): Promise<void> {
    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    const ticket = await this.mintTicket();
    if (gen !== this.generation || !this.wantConnected) return; // superseded / torn down
    if (!ticket) {
      this.scheduleReconnect(gen);
      return;
    }
    if (!ticket.relayUrl) {
      // Relay not deployed server-side (PARTY_RELAY_URL unset) — silently off, matching
      // the ticket route's documented `relayUrl: null` contract.
      this.setStatus("off");
      this.wantConnected = false;
      return;
    }
    this.currentTicket = ticket.ticket;
    this.identity = {
      charId: ticket.charId,
      displayName: ticket.displayName,
      classId: ticket.classId,
      tier: ticket.tier,
    };
    this.openSocket(ticket.relayUrl, gen);
  }

  private async mintTicket(): Promise<PresenceTicketResponse | null> {
    try {
      const res = await fetch("/api/presence/ticket", { method: "POST" });
      if (!res.ok) return null; // 409 no_character / 503 relay_not_configured / 500
      return (await res.json()) as PresenceTicketResponse;
    } catch {
      return null;
    }
  }

  private openSocket(relayUrl: string, gen: number): void {
    const ws = new WebSocket(relayUrl);
    this.ws = ws;
    ws.onopen = () => {
      if (gen !== this.generation) return;
      this.reconnectAttempt = 0;
      this.setStatus("connected");
      this.joinPresence(); // pjoin with my current zone (if known)
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (gen !== this.generation) return;
      this.handleMessage(ev.data);
    };
    ws.onclose = () => {
      if (this.ws !== ws || gen !== this.generation) return; // superseded
      this.ws = null;
      if (!this.wantConnected) return;
      this.setStatus("reconnecting");
      this.scheduleReconnect(gen);
    };
    ws.onerror = () => {
      /* browser follows an error with a close event — handled above */
    };
  }

  private scheduleReconnect(gen: number): void {
    if (!this.wantConnected || gen !== this.generation) return;
    const delay =
      RECONNECT_BACKOFF_MS[Math.min(this.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      if (gen !== this.generation || !this.wantConnected) return;
      // Fresh ticket every reconnect (short-lived; a stale one is never reused).
      void this.openFlow(gen);
    }, delay);
  }

  private handleMessage(raw: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return;
    }
    const msg = asRecord(parsed);
    if (!msg || typeof msg.t !== "string") return;
    switch (msg.t) {
      case "p":
        // Presence snapshot -> the GhostStore ONLY. No other path exists (invariant #3).
        this.handlers.onGhost(msg.payload);
        break;
      case "c":
      case "c-history":
      case "c-rej":
        this.handlers.onChat?.(msg);
        break;
      // "pong" (ping echo) — no RTT UI in this wave; ignored.
      default:
        break; // unknown t — forward-compat, ignored
    }
  }
}
