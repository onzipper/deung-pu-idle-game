/**
 * Respond to a party invite (M8 Phase 1).
 *
 * POST { inviteId, accept } -> accept (join / lazily create the inviter's party) or
 * decline (delete the invite). Only the addressee may respond; a missing/foreign/
 * non-pending invite is 404. Accepting while already in a party is 409
 * { code: "already_in_party" } (explicit leave required first); a full party is 409.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { respondPartyInvite, partyRespondSchema } from "@/server/party";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = partyRespondSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const userId = await getOrCreateUserId();
    const result = await respondPartyInvite(userId, parsed.data);
    if (result.ok) return NextResponse.json({ ok: true, accepted: result.accepted });
    switch (result.code) {
      case "account_required":
        return NextResponse.json(
          { error: "a registered account is required", code: result.code },
          { status: 403 },
        );
      case "not_found":
        return NextResponse.json({ error: "no such invite", code: result.code }, { status: 404 });
      default:
        // already_in_party / party_full
        return NextResponse.json({ error: result.code, code: result.code }, { status: 409 });
    }
  } catch (err) {
    console.error("[api/party/respond] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
