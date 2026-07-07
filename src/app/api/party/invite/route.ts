/**
 * Invite a friend into my party (M8 Phase 1).
 *
 * POST { toUserId } -> reserve a pending PartyInvite (must be friends; my party must
 * have room). Identity is the httpOnly cookie; a guest gets 403 { code:
 * "account_required" }. Conflict states (self / not_friends / party_full /
 * already_member / already_invited / too_many_pending) map to 409.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { invitePartyMember, partyInviteSchema } from "@/server/party";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = partyInviteSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const userId = await getOrCreateUserId();
    const result = await invitePartyMember(userId, parsed.data);
    if (result.ok) return NextResponse.json({ ok: true });
    if (result.code === "account_required") {
      return NextResponse.json(
        { error: "a registered account is required", code: result.code },
        { status: 403 },
      );
    }
    // self / not_friends / party_full / already_member / already_invited / too_many_pending
    return NextResponse.json({ error: result.code, code: result.code }, { status: 409 });
  } catch (err) {
    console.error("[api/party/invite] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
