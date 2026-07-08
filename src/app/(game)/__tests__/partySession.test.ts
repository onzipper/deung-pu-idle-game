import { describe, expect, it } from "vitest";
import { LockstepClient } from "@/engine/lockstep";
import { buildCohortState, type CohortProgression, type SharedCohortSave } from "../partyHandshake";
import { CONFIG, initGameState, type HeroClass } from "@/engine";
import {
  SeqTracker,
  deriveCohort,
  electLeader,
  liveCohortSlots,
  resolveMemberDisplayName,
  synthesizeShadowMessage,
  type ZoneBeat,
} from "../partySession";

// ── deriveCohort (design §3 "same-zone cohort") ───────────────────────────────────

describe("deriveCohort", () => {
  const zoneA: ZoneBeat = { mapId: "map1", zoneIdx: 2 };
  const zoneB: ZoneBeat = { mapId: "map1", zoneIdx: 3 };

  it("always includes myself even with zero peers", () => {
    expect(deriveCohort(0, zoneA, new Map())).toEqual([0]);
  });

  it("includes ONLY peers whose latest beat matches my zone, sorted ascending", () => {
    const beats = new Map<number, ZoneBeat>([
      [2, zoneA],
      [1, zoneB], // different zone — excluded
      [3, zoneA],
    ]);
    expect(deriveCohort(0, zoneA, beats)).toEqual([0, 2, 3]);
  });

  it("re-derives correctly when a peer's LATEST beat has moved away", () => {
    const beats = new Map<number, ZoneBeat>([[1, zoneA]]);
    expect(deriveCohort(0, zoneA, beats)).toEqual([0, 1]);
    beats.set(1, zoneB); // peer walked to a different zone
    expect(deriveCohort(0, zoneA, beats)).toEqual([0]);
  });

  it("a member-left is modeled by the caller deleting the beat entry", () => {
    const beats = new Map<number, ZoneBeat>([
      [1, zoneA],
      [2, zoneA],
    ]);
    expect(deriveCohort(0, zoneA, beats)).toEqual([0, 1, 2]);
    beats.delete(2);
    expect(deriveCohort(0, zoneA, beats)).toEqual([0, 1]);
  });

  // ── fix C: NEVER form a lockstep cohort while I'm in a town zone ──────────────────
  // map1 layout (CONFIG): zoneIdx 0 = town, 1..5 = farm, 6 = boss.
  const town: ZoneBeat = { mapId: "map1", zoneIdx: 0 };
  const farm: ZoneBeat = { mapId: "map1", zoneIdx: 2 };
  const boss: ZoneBeat = { mapId: "map1", zoneIdx: 6 };

  it("fix C: a town beat NEVER cohorts, even with same-zone peers standing in town", () => {
    const beats = new Map<number, ZoneBeat>([
      [1, town],
      [2, town],
    ]);
    expect(deriveCohort(0, town, beats)).toEqual([0]);
  });

  it("fix C: farm zones still form cohorts as before", () => {
    const beats = new Map<number, ZoneBeat>([[1, farm]]);
    expect(deriveCohort(0, farm, beats)).toEqual([0, 1]);
  });

  it("fix C: boss zones still form cohorts as before", () => {
    const beats = new Map<number, ZoneBeat>([
      [1, boss],
      [2, boss],
    ]);
    expect(deriveCohort(0, boss, beats)).toEqual([0, 1, 2]);
  });

  it("fix C: walking OUT of town into a farm zone re-forms the cohort on the next beat", () => {
    const beats = new Map<number, ZoneBeat>([[1, farm]]);
    // Peer is farming; while I'm in town I see only myself…
    expect(deriveCohort(0, town, beats)).toEqual([0]);
    // …then I walk to the peer's farm zone and the cohort re-derives immediately.
    expect(deriveCohort(0, farm, beats)).toEqual([0, 1]);
  });
});

// ── liveCohortSlots (D1/D2: a shadowed member never acks — filter it out of formation) ─

describe("liveCohortSlots", () => {
  it("filters out shadowed slots, preserving the raw ascending order", () => {
    expect(liveCohortSlots([0, 1, 2], new Set([1]))).toEqual([0, 2]);
  });

  it("all peers shadowed leaves just me (⇒ the solo path)", () => {
    // My own slot (0) is never shadowed from my own perspective.
    expect(liveCohortSlots([0, 1, 2], new Set([1, 2]))).toEqual([0]);
  });

  it("no shadowed slots is the identity", () => {
    expect(liveCohortSlots([0, 1, 2], new Set())).toEqual([0, 1, 2]);
  });

  it("a shadowed slot not present in the cohort is a no-op", () => {
    expect(liveCohortSlots([0, 2], new Set([1]))).toEqual([0, 2]);
  });
});

// ── electLeader ────────────────────────────────────────────────────────────────────

describe("electLeader", () => {
  it("is always the lowest live slot", () => {
    expect(electLeader([2, 0, 1])).toBe(0);
    expect(electLeader([2, 1])).toBe(1);
    expect(electLeader([2])).toBe(2);
  });
});

// ── SeqTracker (protocol §2 gap detection) ────────────────────────────────────────

describe("SeqTracker", () => {
  it("accepts a monotonic run starting at the welcome seq", () => {
    const t = new SeqTracker(10);
    expect(t.accept(10)).toBe(true);
    expect(t.accept(11)).toBe(true);
    expect(t.accept(12)).toBe(true);
  });

  it("rejects ANY gap — skip-ahead", () => {
    const t = new SeqTracker(0);
    expect(t.accept(0)).toBe(true);
    expect(t.accept(2)).toBe(false); // skipped 1 — fatal
  });

  it("rejects a duplicate/out-of-order (behind-expected) seq", () => {
    const t = new SeqTracker(5);
    expect(t.accept(5)).toBe(true);
    expect(t.accept(5)).toBe(false); // replay
    // tracker did not advance on the rejected replay
    expect(t.accept(6)).toBe(true);
  });
});

// ── synthesizeShadowMessage — only the leader emits, and only the leader's ─────────
// message ever ends up applied identically on every client (bridges into the
// already-proven `LockstepClient`/`stateHash` determinism from engine P3).

function prog(cls: HeroClass, level = 5): CohortProgression {
  return {
    cls,
    level,
    xp: 0,
    tier: 1,
    statPoints: 0,
    stats: { ...CONFIG.stats.base[cls] },
    autoSlots: [null, null, null],
    equipped: { weapon: null, armor: null, refine: { weapon: 0, armor: 0 } },
    config: {
      autoCast: false,
      autoAllocate: false,
      autoHunt: true,
      autoHpPotion: true,
      autoManaPotion: true,
      autoHpThreshold: 0.5,
      autoManaThreshold: 0.3,
      enabled: false,
      sellTripEnabled: false,
      hpPotionTarget: 0,
      mpPotionTarget: 0,
      scrollReserve: 0,
      goldReserve: 0,
    },
    quest: null,
    mainClaimed: [],
    dailies: { serverDay: 0, quests: [] },
  };
}

function sharedSaveFixture(): SharedCohortSave {
  const s = initGameState(1);
  return {
    stage: s.stage,
    gold: s.gold,
    goldEarned: s.goldEarned,
    bossBest: {},
    levelCapAt: s.levelCapAt,
    location: { ...s.location },
    unlockedZones: { ...s.unlockedZones },
    lastFarmZone: { ...s.lastFarmZone },
    consumables: { ...s.consumables },
    bot: { ...s.bot },
    autoHunt: s.autoHunt,
    zoneKills: { ...s.zoneKills },
    lootSalt: s.lootSalt,
    lootCounter: s.lootCounter,
    materials: s.materials,
  };
}

describe("synthesizeShadowMessage", () => {
  it("returns null for every non-leader slot", () => {
    expect(synthesizeShadowMessage(0, 1, 1, true, 5)).toBeNull();
    expect(synthesizeShadowMessage(0, 2, 1, true, 5)).toBeNull();
  });

  it("the leader's message targets the AFFECTED slot's lane, delayed by INPUT_DELAY_TURNS", () => {
    const msg = synthesizeShadowMessage(0, 0, 1, true, 40);
    expect(msg).not.toBeNull();
    expect(msg!.slot).toBe(1);
    expect(msg!.input).toEqual({ setShadowed: { value: true } });
    expect(msg!.executeTurn).toBeGreaterThan(40);
  });

  it("bridges into LockstepClient: the leader-only broadcast applies identically on every cohort client", () => {
    const seed = 4242;
    const shared = sharedSaveFixture();
    const order = [
      { slot: 0, progression: prog("swordsman") },
      { slot: 1, progression: prog("archer") },
      { slot: 2, progression: prog("mage") },
    ];
    const clients = [0, 1, 2].map(() => new LockstepClient(buildCohortState(seed, shared, order), 3));

    // Run a few idle turns first.
    for (const c of clients) c.runTo(10);

    // Slot 0 is the leader (lowest live slot). It observes "slot 1 went shadowed"
    // and is the ONLY one that emits the replicated intent (see the function doc).
    const leaderSlot = 0;
    for (const c of clients) expect(synthesizeShadowMessage(leaderSlot, leaderSlot, 1, true, c.turn)).not.toBeNull();
    for (const mySlot of [1, 2]) {
      expect(synthesizeShadowMessage(leaderSlot, mySlot, 1, true, clients[mySlot].turn)).toBeNull();
    }

    // The relay echoes the leader's ONE message to every client (incl. itself) —
    // model that by delivering the SAME TurnMessage object to all three.
    const wireMsg = synthesizeShadowMessage(leaderSlot, leaderSlot, 1, true, clients[0].turn)!;
    for (const c of clients) c.deliver(wireMsg);

    clients.forEach((c) => c.runTo(wireMsg.executeTurn + 5));

    expect(clients[1].hashes).toEqual(clients[0].hashes);
    expect(clients[2].hashes).toEqual(clients[0].hashes);
    for (const c of clients) expect(c.state.heroes[1].shadowed).toBe(true);
    // Sanity: hashes actually differ turn to turn (state really advanced).
    expect(new Set(clients[0].hashes).size).toBeGreaterThan(1);
  });
});

// ── prewake must never gate the websocket (CORS incident regression) ───────────────
//
// Real incident: the relay's /health had no CORS headers, the browser blocked the
// cross-origin pre-wake fetch, and the old code treated that as "unhealthy" ->
// scheduleReconnect forever -> party mode bricked while the relay was fine. The
// websocket handshake is CORS-exempt, so a failed/blocked prewake must fall through
// to openSocket after the deadline.

import { PartySession } from "../partySession";
import { afterEach, beforeEach, vi } from "vitest";

describe("PartySession prewake is best-effort", () => {
  const noopHandlers = {
    onCohortChanged: () => {},
    onGameMessage: () => {},
    onStatusChange: () => {},
    onMemberShadowChanged: () => {},
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function stubTicketFetch(healthBehavior: "reject" | "resolve"): { wsUrls: string[] } {
    const created: { wsUrls: string[] } = { wsUrls: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/party/ticket")) {
          return {
            ok: true,
            json: async () => ({
              relayUrl: "ws://relay.test",
              ticket: "t",
              slot: 0,
              partyId: "p1",
              exp: Date.now() + 60_000,
            }),
          } as Response;
        }
        // the /health prewake
        if (healthBehavior === "reject") throw new TypeError("Failed to fetch"); // CORS/network
        return { ok: false, type: "opaque" } as unknown as Response; // no-cors opaque
      }),
    );
    class FakeWebSocket {
      static instances: FakeWebSocket[] = [];
      url: string;
      onopen: (() => void) | null = null;
      onmessage: ((e: unknown) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) {
        this.url = url;
        created.wsUrls.push(url);
      }
      send(): void {}
      close(): void {}
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);
    return created;
  }

  it("opens the websocket even when every prewake fetch is CORS/network-blocked", async () => {
    const created = stubTicketFetch("reject");
    const session = new PartySession(noopHandlers);
    session.setParty({ partyId: "p1" });
    // Burn through the full prewake deadline (60s) + retry sleeps.
    await vi.advanceTimersByTimeAsync(65_000);
    expect(created.wsUrls).toContain("ws://relay.test");
    session.setParty(null);
  });

  it("opens the websocket immediately when the no-cors prewake resolves (opaque ok)", async () => {
    const created = stubTicketFetch("resolve");
    const session = new PartySession(noopHandlers);
    session.setParty({ partyId: "p1" });
    await vi.advanceTimersByTimeAsync(10);
    expect(created.wsUrls).toContain("ws://relay.test");
    session.setParty(null);
  });
});

// ── zone-beat re-announce on member-joined (late-joiner deadlock regression) ───────
//
// Real incident: beats are only broadcast on join + zone CHANGE, and the relay never
// replays history — so a peer joining while I was already standing in a zone could
// never learn MY zone. Its cohort derivation stayed solo, it dropped my reseed-offer,
// and both clients sat "connected, beats flowing, never seeing each other" forever.
// The fix: an existing member re-announces its zone when member-joined/-unshadowed
// arrives for another slot.

describe("PartySession re-announces its zone to late joiners", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Full fake transport: resolves the ticket + prewake instantly and hands the test
   * the live FakeWebSocket so it can inject server frames and inspect sent ones. */
  function connectFakeSession(): {
    session: PartySession;
    socket: () => {
      sent: string[];
      emit: (frame: object) => void;
      onopen: (() => void) | null;
    };
  } {
    const sockets: FakeWs[] = [];
    class FakeWs {
      static OPEN = 1;
      readyState = 1;
      url: string;
      sent: string[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) {
        this.url = url;
        sockets.push(this);
      }
      send(data: string): void {
        this.sent.push(data);
      }
      close(): void {}
      emit(frame: object): void {
        this.onmessage?.({ data: JSON.stringify(frame) });
      }
    }
    vi.stubGlobal("WebSocket", FakeWs);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/party/ticket")) {
          return {
            ok: true,
            json: async () => ({
              relayUrl: "ws://relay.test",
              ticket: "t",
              slot: 0,
              partyId: "p1",
              exp: Date.now() + 60_000,
            }),
          } as Response;
        }
        return { ok: false, type: "opaque" } as unknown as Response; // prewake
      }),
    );
    const session = new PartySession({
      onCohortChanged: () => {},
      onGameMessage: () => {},
      onStatusChange: () => {},
      onMemberShadowChanged: () => {},
    });
    return { session, socket: () => sockets[sockets.length - 1] };
  }

  async function connectedInZone(): Promise<ReturnType<typeof connectFakeSession>> {
    const rig = connectFakeSession();
    rig.session.setZone("map1", 2); // standing in a zone BEFORE the peer arrives
    rig.session.setParty({ partyId: "p1" });
    await vi.advanceTimersByTimeAsync(10); // ticket + prewake resolve
    const ws = rig.socket();
    ws.onopen?.();
    ws.emit({ t: "welcome", seq: 5, slots: [{ slot: 0, userId: "me" }] });
    ws.sent.length = 0; // discard the join frame + my welcome-time beat
    return rig;
  }

  function zoneBeatsIn(sent: string[]): Array<{ mapId: string; zoneIdx: number }> {
    return sent
      .map((s) => JSON.parse(s) as { t: string; payload?: { kind?: string; mapId?: string; zoneIdx?: number } })
      .filter((f) => f.t === "g" && f.payload?.kind === "zone")
      .map((f) => ({ mapId: f.payload!.mapId!, zoneIdx: f.payload!.zoneIdx! }));
  }

  it("re-broadcasts my zone when ANOTHER member joins the room", async () => {
    const rig = await connectedInZone();
    const ws = rig.socket();
    ws.emit({ t: "member-joined", seq: 5, slot: 1, userId: "friend" });
    expect(zoneBeatsIn(ws.sent)).toEqual([{ mapId: "map1", zoneIdx: 2 }]);
    rig.session.setParty(null);
  });

  it("re-broadcasts my zone when a member rejoins from grace (member-unshadowed)", async () => {
    const rig = await connectedInZone();
    const ws = rig.socket();
    ws.emit({ t: "member-unshadowed", seq: 5, slot: 2 });
    expect(zoneBeatsIn(ws.sent)).toEqual([{ mapId: "map1", zoneIdx: 2 }]);
    rig.session.setParty(null);
  });

  it("does NOT re-broadcast on my OWN echoed member-joined", async () => {
    const rig = await connectedInZone();
    const ws = rig.socket();
    ws.emit({ t: "member-joined", seq: 5, slot: 0, userId: "me" });
    expect(zoneBeatsIn(ws.sent)).toEqual([]);
    rig.session.setParty(null);
  });
});

// ── setZone: beat BEFORE onCohortChanged (leave-and-return re-form regression) ─────
//
// Real seam: on returning to a friend's zone after a solo town trip, `setZone` used to
// recompute the cohort (firing onCohortChanged — the caller's reseed-offer hook) BEFORE
// broadcasting my arrival beat, so on the wire my offer preceded my beat. A peer that had
// dropped me still listed only itself, discarded the early offer as foreign, and the
// re-form stalled until the multi-second handshake deadline ("reconnecting every trip").
// The fix: broadcast the beat FIRST so the peer re-derives the cohort before the offer.

describe("PartySession.setZone broadcasts the beat before firing onCohortChanged", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  type LogEntry = { type: "beat"; zoneIdx: number } | { type: "cohort"; slots: number[] };

  async function connectedRig(): Promise<{
    session: PartySession;
    socket: () => { sent: string[]; emit: (frame: object) => void; onopen: (() => void) | null };
    log: LogEntry[];
  }> {
    const sockets: FakeWs[] = [];
    const log: LogEntry[] = [];
    class FakeWs {
      static OPEN = 1;
      readyState = 1;
      url: string;
      sent: string[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) {
        this.url = url;
        sockets.push(this);
      }
      send(data: string): void {
        this.sent.push(data);
        const f = JSON.parse(data) as { t: string; payload?: { kind?: string; zoneIdx?: number } };
        if (f.t === "g" && f.payload?.kind === "zone") log.push({ type: "beat", zoneIdx: f.payload.zoneIdx! });
      }
      close(): void {}
      emit(frame: object): void {
        this.onmessage?.({ data: JSON.stringify(frame) });
      }
    }
    vi.stubGlobal("WebSocket", FakeWs);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/party/ticket")) {
          return {
            ok: true,
            json: async () => ({
              relayUrl: "ws://relay.test",
              ticket: "t",
              slot: 0,
              partyId: "p1",
              exp: Date.now() + 60_000,
            }),
          } as Response;
        }
        return { ok: false, type: "opaque" } as unknown as Response;
      }),
    );
    const session = new PartySession({
      onCohortChanged: (slots) => log.push({ type: "cohort", slots: [...slots] }),
      onGameMessage: () => {},
      onStatusChange: () => {},
      onMemberShadowChanged: () => {},
    });
    session.setZone("map1", 2);
    session.setParty({ partyId: "p1" });
    await vi.advanceTimersByTimeAsync(10);
    const ws = sockets[sockets.length - 1];
    ws.onopen?.();
    // welcome.seq is the seq the NEXT message carries — subsequent frames MUST be
    // consecutive from there or the SeqTracker fires a (fatal) gap and tears down.
    ws.emit({ t: "welcome", seq: 5, slots: [{ slot: 0, userId: "me" }] });
    ws.emit({ t: "member-joined", seq: 5, slot: 1, userId: "friend" });
    ws.emit({ t: "g", seq: 6, slot: 1, payload: { kind: "zone", mapId: "map1", zoneIdx: 2 } });
    return { session, socket: () => sockets[sockets.length - 1], log };
  }

  it("on returning to the peer's zone, the arrival beat precedes the cohort-change hook", async () => {
    const rig = await connectedRig();
    // Roam away solo (peer drops out of my cohort), then walk back into the shared zone.
    rig.session.setZone("map1", 3);
    rig.log.length = 0; // isolate the RETURN transition
    rig.session.setZone("map1", 2);

    const beatIdx = rig.log.findIndex((e) => e.type === "beat" && e.zoneIdx === 2);
    const cohortWithPeerIdx = rig.log.findIndex((e) => e.type === "cohort" && e.slots.length > 1);
    expect(beatIdx).toBeGreaterThanOrEqual(0);
    expect(cohortWithPeerIdx).toBeGreaterThanOrEqual(0);
    // The beat (peer learns I'm back) MUST be on the wire before the cohort-change hook
    // (where the caller sends its reseed-offer) — otherwise the offer arrives foreign.
    expect(beatIdx).toBeLessThan(cohortWithPeerIdx);
    rig.session.setParty(null);
  });
});

// ── prewake is skipped on the first connect, run only on a reconnect ────────────────
//
// The relay is kept awake externally (UptimeRobot); a cold start is only plausible AFTER
// a socket failure. Firing the serial /health round-trip on every connect only added
// latency to the join. So the first attempt goes straight to the websocket; a reconnect
// (after a ws close bumps `reconnectAttempt`) prewakes.

describe("PartySession prewake timing", () => {
  const noopHandlers = {
    onCohortChanged: () => {},
    onGameMessage: () => {},
    onStatusChange: () => {},
    onMemberShadowChanged: () => {},
  };
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function rig(): { healthHits: () => number; wsCount: () => number; closeLast: () => void } {
    let healthHits = 0;
    const sockets: FakeWs[] = [];
    class FakeWs {
      static OPEN = 1;
      readyState = 1;
      url: string;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) {
        this.url = url;
        sockets.push(this);
      }
      send(): void {}
      close(): void {}
    }
    vi.stubGlobal("WebSocket", FakeWs);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/party/ticket")) {
          return {
            ok: true,
            json: async () => ({
              relayUrl: "ws://relay.test",
              ticket: "t",
              slot: 0,
              partyId: "p1",
              exp: Date.now() + 60_000,
            }),
          } as Response;
        }
        healthHits++; // the /health prewake
        return { ok: false, type: "opaque" } as unknown as Response;
      }),
    );
    return {
      healthHits: () => healthHits,
      wsCount: () => sockets.length,
      closeLast: () => sockets[sockets.length - 1]?.onclose?.(),
    };
  }

  it("does NOT prewake on the first connect, but DOES on a reconnect", async () => {
    const r = rig();
    const session = new PartySession(noopHandlers);
    session.setParty({ partyId: "p1" });
    await vi.advanceTimersByTimeAsync(10);
    // First attempt: ticket -> straight to the websocket, no /health round-trip.
    expect(r.wsCount()).toBe(1);
    expect(r.healthHits()).toBe(0);

    // A ws failure schedules a reconnect (backoff); that attempt DOES prewake.
    r.closeLast();
    await vi.advanceTimersByTimeAsync(2_000); // past the first backoff step
    await vi.advanceTimersByTimeAsync(10);
    expect(r.wsCount()).toBe(2);
    expect(r.healthHits()).toBeGreaterThanOrEqual(1);
    session.setParty(null);
  });
});

// ── resolveMemberDisplayName (never leak a cuid to the HUD) ─────────────────────────

describe("resolveMemberDisplayName", () => {
  const party = {
    members: [
      { userId: "u1", displayName: "Nok", currentCharacter: { name: "SwordGuy" } },
      { userId: "u2", displayName: null, currentCharacter: { name: "MageGal" } },
      { userId: "u3", displayName: null, currentCharacter: null },
    ],
  };

  it("prefers the account displayName", () => {
    expect(resolveMemberDisplayName("u1", party)).toBe("Nok");
  });

  it("falls back to the current character's name when displayName is null", () => {
    expect(resolveMemberDisplayName("u2", party)).toBe("MageGal");
  });

  it("returns null (NEVER the userId) when both are absent, or the user/party is unknown", () => {
    expect(resolveMemberDisplayName("u3", party)).toBeNull();
    expect(resolveMemberDisplayName("nope", party)).toBeNull();
    expect(resolveMemberDisplayName("u1", null)).toBeNull();
  });
});
