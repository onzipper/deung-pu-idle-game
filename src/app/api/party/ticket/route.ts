/**
 * Mint a party relay auth ticket (M8 P4a).
 *
 * POST (no body) -> { relayUrl, ticket, slot, partyId, exp } for the caller's current
 * party. Identity is the httpOnly cookie; a guest gets 403 { code: "account_required" }.
 * Not in a party -> 409 { code: "not_in_party" }. The shared relay secret being absent
 * (server misconfig) -> 503 { code: "relay_not_configured" } — never a silent unsigned
 * ticket. The client opens `relayUrl` and sends the `ticket` in its join frame.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { issuePartyTicket } from "@/server/partyTicket";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const userId = await getOrCreateUserId();
    const result = await issuePartyTicket(userId);
    if (result.ok) {
      return NextResponse.json({
        relayUrl: result.relayUrl,
        ticket: result.ticket,
        slot: result.slot,
        partyId: result.partyId,
        exp: result.exp,
      });
    }
    if (result.code === "account_required") {
      return NextResponse.json(
        { error: "a registered account is required", code: result.code },
        { status: 403 },
      );
    }
    if (result.code === "relay_not_configured") {
      return NextResponse.json(
        { error: "party relay is not configured", code: result.code },
        { status: 503 },
      );
    }
    // not_in_party
    return NextResponse.json({ error: result.code, code: result.code }, { status: 409 });
  } catch (err) {
    console.error("[api/party/ticket] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
