import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";

/**
 * Party ticket tests (M8 P4a). Prisma is mocked (no DB), mirroring party.test.ts.
 * Covers: the guest gate, the not-in-party gate, the fail-loud missing-secret gate,
 * canonical slot derivation, the sign/verify roundtrip (valid / expired / tampered),
 * and CROSS-IMPL compatibility with the standalone relay's own verifier.
 */

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn() },
    partyMember: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import {
  issuePartyTicket,
  signTicket,
  verifyTicket,
  TICKET_TTL_MS,
  type TicketPayload,
} from "@/server/partyTicket";

// The standalone relay carries its own verifier — assert both impls agree byte-for-byte.
const require = createRequire(import.meta.url);
const relay = require("../../../scripts/party-relay/server.js") as {
  verifyTicket: (t: string, s: string, now?: number) => TicketPayload | null;
  signTicket: (p: TicketPayload, s: string) => string;
};

const ME = "user_m";
const SECRET = "test-secret-abc";

function registered() {
  mockPrisma.user.findUnique.mockResolvedValueOnce({ registeredAt: new Date() });
}
function guest() {
  mockPrisma.user.findUnique.mockResolvedValueOnce({ registeredAt: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PARTY_RELAY_SECRET = SECRET;
  process.env.PARTY_RELAY_URL = "wss://relay.example/ws";
});
afterEach(() => {
  delete process.env.PARTY_RELAY_SECRET;
  delete process.env.PARTY_RELAY_URL;
});

describe("issuePartyTicket", () => {
  it("blocks a guest (account_required)", async () => {
    guest();
    const r = await issuePartyTicket(ME);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("account_required");
  });

  it("fails loud when the shared secret is absent (relay_not_configured)", async () => {
    delete process.env.PARTY_RELAY_SECRET;
    registered();
    const r = await issuePartyTicket(ME);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("relay_not_configured");
  });

  it("rejects a caller not in a party", async () => {
    registered();
    mockPrisma.partyMember.findUnique.mockResolvedValueOnce(null);
    const r = await issuePartyTicket(ME);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_in_party");
  });

  it("derives the canonical slot from joinedAt-asc order and signs a verifiable ticket", async () => {
    registered();
    mockPrisma.partyMember.findUnique.mockResolvedValueOnce({ partyId: "p1" });
    // Canonical order: leader-ish first-joined u_a (slot 0), then ME (slot 1), then u_c.
    mockPrisma.partyMember.findMany.mockResolvedValueOnce([
      { userId: "u_a" },
      { userId: ME },
      { userId: "u_c" },
    ]);
    const now = 1_000_000;
    const r = await issuePartyTicket(ME, now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.slot).toBe(1);
    expect(r.partyId).toBe("p1");
    expect(r.exp).toBe(now + TICKET_TTL_MS);
    expect(r.relayUrl).toBe("wss://relay.example/ws");
    // Verifiable by our verifier AND the relay's independent copy.
    const payload = verifyTicket(r.ticket, SECRET, now + 1);
    expect(payload).toMatchObject({ partyId: "p1", userId: ME, slot: 1 });
    expect(relay.verifyTicket(r.ticket, SECRET, now + 1)).toMatchObject({
      slot: 1,
      userId: ME,
    });
  });

  it("returns relayUrl null when PARTY_RELAY_URL is unset (relay not deployed yet)", async () => {
    delete process.env.PARTY_RELAY_URL;
    registered();
    mockPrisma.partyMember.findUnique.mockResolvedValueOnce({ partyId: "p1" });
    mockPrisma.partyMember.findMany.mockResolvedValueOnce([{ userId: ME }]);
    const r = await issuePartyTicket(ME);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.relayUrl).toBe(null);
  });
});

describe("verifyTicket", () => {
  const payload: TicketPayload = { partyId: "p1", userId: ME, slot: 0, exp: 2_000_000 };

  it("accepts a valid unexpired ticket", () => {
    const t = signTicket(payload, SECRET);
    expect(verifyTicket(t, SECRET, 1_999_999)).toEqual(payload);
  });

  it("rejects an expired ticket", () => {
    const t = signTicket(payload, SECRET);
    expect(verifyTicket(t, SECRET, 2_000_000)).toBe(null);
  });

  it("rejects a wrong-secret / tampered HMAC", () => {
    const t = signTicket(payload, SECRET);
    expect(verifyTicket(t, "other-secret", 1)).toBe(null);
    // Tamper the body (flip slot) but keep the old signature.
    const [, sig] = t.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({ ...payload, slot: 2 }),
      "utf8",
    ).toString("base64url");
    expect(verifyTicket(`${forgedBody}.${sig}`, SECRET, 1)).toBe(null);
  });

  it("rejects an out-of-range slot", () => {
    const t = signTicket({ ...payload, slot: 9 }, SECRET);
    expect(verifyTicket(t, SECRET, 1)).toBe(null);
  });

  it("rejects malformed tickets", () => {
    expect(verifyTicket("", SECRET, 1)).toBe(null);
    expect(verifyTicket("nodot", SECRET, 1)).toBe(null);
    expect(verifyTicket(".onlyempty", SECRET, 1)).toBe(null);
  });

  it("cross-verifies: relay-signed ticket accepted by the app verifier", () => {
    const t = relay.signTicket(payload, SECRET);
    expect(verifyTicket(t, SECRET, 1)).toEqual(payload);
  });
});
