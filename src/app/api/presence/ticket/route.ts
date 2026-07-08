/**
 * Mint a presence "world socket" auth ticket (ghost-presence + global chat).
 *
 * POST (no body) -> { relayUrl, ticket, charId, displayName, classId, tier, exp } for
 * the caller's currently-played character. Identity is the httpOnly cookie; GUESTS ARE
 * ALLOWED (unlike the party ticket) — every player appears in the world. Owns no live
 * character yet -> 409 { code: "no_character" }. The shared relay secret being absent
 * (server misconfig) -> 503 { code: "relay_not_configured" } — never a silent unsigned
 * ticket. The client opens `relayUrl` and sends the `ticket` in its `pjoin`/`cjoin`
 * frame. Modeled on /api/party/ticket; displayName/classId/tier are SERVER-derived.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { issuePresenceTicket } from "@/server/partyTicket";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const userId = await getOrCreateUserId();
    const result = await issuePresenceTicket(userId);
    if (result.ok) {
      return NextResponse.json({
        relayUrl: result.relayUrl,
        ticket: result.ticket,
        charId: result.charId,
        displayName: result.displayName,
        classId: result.classId,
        tier: result.tier,
        exp: result.exp,
      });
    }
    if (result.code === "relay_not_configured") {
      return NextResponse.json(
        { error: "presence relay is not configured", code: result.code },
        { status: 503 },
      );
    }
    // no_character
    return NextResponse.json({ error: result.code, code: result.code }, { status: 409 });
  } catch (err) {
    console.error("[api/presence/ticket] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
