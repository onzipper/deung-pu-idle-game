import { describe, expect, it } from "vitest";
import { LockstepClient } from "@/engine/lockstep";
import { buildCohortState, type CohortProgression, type SharedCohortSave } from "../partyHandshake";
import { CONFIG, initGameState, type HeroClass } from "@/engine";
import {
  SeqTracker,
  deriveCohort,
  electLeader,
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
