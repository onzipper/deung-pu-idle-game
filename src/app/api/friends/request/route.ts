/**
 * Send a friend request (M8 Phase 1).
 *
 * POST { friendCode } | { characterName } (EXACTLY ONE) -> send a request. A reverse
 * pending request auto-accepts into a friendship. A colliding character name returns
 * a `multiple_matches` candidate list (HTTP 300) so the UI can disambiguate.
 *
 * Identity is the httpOnly cookie; a guest gets 403 { code: "account_required" }.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { sendFriendRequest, friendRequestSchema } from "@/server/friends";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = friendRequestSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const userId = await getOrCreateUserId();
    const result = await sendFriendRequest(userId, parsed.data);
    if (result.ok) {
      return NextResponse.json({ ok: true, autoAccepted: result.autoAccepted });
    }
    switch (result.code) {
      case "account_required":
        return NextResponse.json(
          { error: "a registered account is required", code: result.code },
          { status: 403 },
        );
      case "not_found":
        return NextResponse.json({ error: "no such player", code: result.code }, { status: 404 });
      case "multiple_matches":
        // 300 Multiple Choices — the UI picks a candidate and re-sends by friendCode.
        return NextResponse.json(
          { code: result.code, candidates: result.candidates },
          { status: 300 },
        );
      default:
        // self / already_friends / already_pending / too_many_pending
        return NextResponse.json({ error: result.code, code: result.code }, { status: 409 });
    }
  } catch (err) {
    console.error("[api/friends/request] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
