/**
 * Party relay auth tickets (M8 P4a — docs/party-relay-protocol.md §ticket).
 *
 * The "dumb" party relay (scripts/party-relay) runs zero game logic and cannot reach
 * the DB, so it can't decide who belongs in which room. This module is the ONLY thing
 * that can: it reads the caller's DB-authoritative party membership and mints a short
 * (60s) HMAC-SHA256 ticket the relay verifies with the SHARED `PARTY_RELAY_SECRET`.
 *
 * Trust boundary (mirrors party.ts): identity (`userId`) is resolved from the httpOnly
 * cookie by the route handler and passed in — NEVER from the body. The slot embedded in
 * the ticket is DERIVED here from PartyMember.joinedAt asc (id tie-break) — the exact
 * canonical order every client independently derives for lane/hero indexing, so a
 * client can never pick its own slot.
 *
 * The wire format is duplicated (byte-identical) inside scripts/party-relay/server.js
 * BY DESIGN — the relay is a standalone zero-dep deploy and takes no app imports. The
 * cross-impl compatibility is asserted in the tests.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { isRegistered } from "@/server/friends";
import { MAX_PARTY_SIZE } from "@/server/party";

/** Ticket lifetime — long enough to open a socket, short enough to be single-use-ish. */
export const TICKET_TTL_MS = 60_000;

/** Decoded ticket payload. `slot` is the canonical party index; `exp` is ms epoch. */
export interface TicketPayload {
  partyId: string;
  userId: string;
  slot: number;
  exp: number;
}

export type PartyTicketResult =
  | {
      ok: true;
      relayUrl: string | null;
      ticket: string;
      slot: number;
      partyId: string;
      exp: number;
    }
  | { ok: false; code: "account_required" | "not_in_party" | "relay_not_configured" };

// ── Wire format (base64url(JSON) "." base64url(HMAC-SHA256)) ─────────────────────

/** Mint a `${payloadB64url}.${hmacB64url}` ticket. */
export function signTicket(payload: TicketPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/**
 * Verify + decode a ticket (constant-time HMAC compare, expiry + slot-range checks).
 * Returns the payload or `null`. Kept in the app layer for tests + potential server-side
 * reuse; the relay carries its own identical copy.
 */
export function verifyTicket(
  ticket: string,
  secret: string,
  now: number = Date.now(),
): TicketPayload | null {
  if (typeof ticket !== "string") return null;
  const dot = ticket.indexOf(".");
  if (dot <= 0 || dot >= ticket.length - 1) return null;
  const body = ticket.slice(0, dot);
  const sig = ticket.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as TicketPayload).partyId !== "string" ||
    typeof (payload as TicketPayload).userId !== "string" ||
    !Number.isInteger((payload as TicketPayload).slot) ||
    typeof (payload as TicketPayload).exp !== "number"
  ) {
    return null;
  }
  const p = payload as TicketPayload;
  if (p.slot < 0 || p.slot >= MAX_PARTY_SIZE) return null;
  if (now >= p.exp) return null;
  return p;
}

// ── Issue a ticket for the caller's current party ────────────────────────────────

/**
 * Mint a relay ticket for `userId`. Requires a REGISTERED account (like every party
 * route) and that the caller is currently in a party. The slot is the caller's index
 * in the party's canonical joinedAt-asc (id tie-break) order — the same order clients
 * derive for hero/lane indexing. Fails loud (`relay_not_configured`) if the shared
 * secret is absent, so the relay never sees an unsigned join.
 */
export async function issuePartyTicket(
  userId: string,
  now: number = Date.now(),
): Promise<PartyTicketResult> {
  if (!(await isRegistered(userId))) return { ok: false, code: "account_required" };

  const secret = process.env.PARTY_RELAY_SECRET;
  if (!secret) return { ok: false, code: "relay_not_configured" };

  const membership = await prisma.partyMember.findUnique({
    where: { userId },
    select: { partyId: true },
  });
  if (!membership) return { ok: false, code: "not_in_party" };

  const members = await prisma.partyMember.findMany({
    where: { partyId: membership.partyId },
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
    select: { userId: true },
  });
  const slot = members.findIndex((m) => m.userId === userId);
  if (slot < 0) return { ok: false, code: "not_in_party" };

  const exp = now + TICKET_TTL_MS;
  const ticket = signTicket({ partyId: membership.partyId, userId, slot, exp }, secret);

  return {
    ok: true,
    relayUrl: process.env.PARTY_RELAY_URL ?? null,
    ticket,
    slot,
    partyId: membership.partyId,
    exp,
  };
}
