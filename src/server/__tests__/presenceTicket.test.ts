import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";

/**
 * Presence ("world socket") ticket tests. Prisma is mocked (no DB), mirroring
 * partyTicket.test.ts. Covers: the fail-loud missing-secret gate, the no-character
 * gate, guests-allowed, most-recently-played character selection, server-derived
 * cosmetics, the sign/verify roundtrip (valid / expired / tampered / kind-mismatch),
 * and CROSS-IMPL + CROSS-KIND compatibility with the standalone relay's own verifiers.
 */

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    character: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    // Present so the friends/party import chain that partyTicket.ts pulls resolves.
    partyMember: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import {
  issuePresenceTicket,
  signPresenceTicket,
  verifyPresenceTicket,
  signTicket,
  verifyTicket,
  TICKET_TTL_MS,
  type PresenceTicketPayload,
  type TicketPayload,
} from "@/server/partyTicket";

// The standalone relay carries its own verifiers — assert both impls agree byte-for-byte.
const require = createRequire(import.meta.url);
const relay = require("../../../scripts/party-relay/server.js") as {
  verifyPresenceTicket: (t: string, s: string, now?: number) => PresenceTicketPayload | null;
  signPresenceTicket: (p: PresenceTicketPayload, s: string) => string;
  verifyTicket: (t: string, s: string, now?: number) => TicketPayload | null;
  signTicket: (p: TicketPayload, s: string) => string;
};

const ME = "user_m";
const SECRET = "test-secret-abc";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PARTY_RELAY_SECRET = SECRET;
  process.env.PARTY_RELAY_URL = "wss://relay.example/ws";
});
afterEach(() => {
  delete process.env.PARTY_RELAY_SECRET;
  delete process.env.PARTY_RELAY_URL;
});

describe("issuePresenceTicket", () => {
  it("fails loud when the shared secret is absent (relay_not_configured)", async () => {
    delete process.env.PARTY_RELAY_SECRET;
    const r = await issuePresenceTicket(ME);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("relay_not_configured");
  });

  it("rejects an account with no live character (no_character)", async () => {
    mockPrisma.character.findMany.mockResolvedValueOnce([]);
    const r = await issuePresenceTicket(ME);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("no_character");
  });

  it("picks the most-recently-saved character and signs a verifiable presence ticket", async () => {
    mockPrisma.character.findMany.mockResolvedValueOnce([
      { id: "c_old", name: "OldOne", baseClass: "swordsman", tier: 1, save: { lastSeen: new Date(1000) } },
      { id: "c_new", name: "Nina", baseClass: "ninja", tier: 3, save: { lastSeen: new Date(9000) } },
    ]);
    // Account handle wins over the character name for display.
    mockPrisma.user.findUnique.mockResolvedValueOnce({ displayName: "JomThePro" });

    const now = 1_000_000;
    const r = await issuePresenceTicket(ME, now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.charId).toBe("c_new");
    expect(r.displayName).toBe("JomThePro");
    expect(r.classId).toBe("ninja");
    expect(r.tier).toBe(3);
    expect(r.exp).toBe(now + TICKET_TTL_MS);
    expect(r.relayUrl).toBe("wss://relay.example/ws");
    // Verifiable by our verifier AND the relay's independent copy.
    const payload = verifyPresenceTicket(r.ticket, SECRET, now + 1);
    expect(payload).toMatchObject({ kind: "presence", userId: ME, charId: "c_new", tier: 3 });
    expect(relay.verifyPresenceTicket(r.ticket, SECRET, now + 1)).toMatchObject({
      charId: "c_new",
      classId: "ninja",
    });
  });

  it("allows a GUEST (no account displayName) — falls back to the character name", async () => {
    mockPrisma.character.findMany.mockResolvedValueOnce([
      { id: "c1", name: "GuestHero", baseClass: "archer", tier: 2, save: null },
    ]);
    mockPrisma.user.findUnique.mockResolvedValueOnce({ displayName: null });
    const r = await issuePresenceTicket(ME);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.displayName).toBe("GuestHero");
      expect(r.classId).toBe("archer");
    }
  });

  it("returns relayUrl null when PARTY_RELAY_URL is unset", async () => {
    delete process.env.PARTY_RELAY_URL;
    mockPrisma.character.findMany.mockResolvedValueOnce([
      { id: "c1", name: "H", baseClass: "mage", tier: 1, save: { lastSeen: new Date() } },
    ]);
    mockPrisma.user.findUnique.mockResolvedValueOnce({ displayName: null });
    const r = await issuePresenceTicket(ME);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.relayUrl).toBe(null);
  });
});

describe("verifyPresenceTicket", () => {
  const payload: PresenceTicketPayload = {
    kind: "presence",
    userId: ME,
    charId: "c1",
    displayName: "Nina",
    classId: "ninja",
    tier: 3,
    exp: 2_000_000,
  };

  it("accepts a valid unexpired ticket (both impls agree)", () => {
    const t = signPresenceTicket(payload, SECRET);
    expect(verifyPresenceTicket(t, SECRET, 1_999_999)).toEqual(payload);
    expect(relay.verifyPresenceTicket(t, SECRET, 1_999_999)).toEqual(payload);
  });

  it("rejects an expired ticket", () => {
    const t = signPresenceTicket(payload, SECRET);
    expect(verifyPresenceTicket(t, SECRET, 2_000_000)).toBe(null);
  });

  it("rejects a wrong-secret / tampered HMAC", () => {
    const t = signPresenceTicket(payload, SECRET);
    expect(verifyPresenceTicket(t, "other-secret", 1)).toBe(null);
    const [, sig] = t.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...payload, displayName: "Impostor" }),
      "utf8",
    ).toString("base64url");
    expect(verifyPresenceTicket(`${forged}.${sig}`, SECRET, 1)).toBe(null);
  });

  it("CROSS-KIND: a party ticket is NOT a valid presence ticket, and vice versa", () => {
    const party: TicketPayload = { partyId: "p1", userId: ME, slot: 0, exp: 2_000_000 };
    const partyTicket = signTicket(party, SECRET);
    const presenceTicket = signPresenceTicket(payload, SECRET);
    // A party ticket (no `kind`) rejected by BOTH presence verifiers.
    expect(verifyPresenceTicket(partyTicket, SECRET, 1)).toBe(null);
    expect(relay.verifyPresenceTicket(partyTicket, SECRET, 1)).toBe(null);
    // A presence ticket rejected by BOTH party verifiers.
    expect(verifyTicket(presenceTicket, SECRET, 1)).toBe(null);
    expect(relay.verifyTicket(presenceTicket, SECRET, 1)).toBe(null);
  });
});
