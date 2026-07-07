/**
 * Leave my party (M8 Phase 1).
 *
 * POST (no body) -> remove my membership. Idempotent. Leader leaving promotes the
 * oldest remaining member; the last member leaving dissolves the party. Identity is
 * the httpOnly cookie; a guest gets 403 { code: "account_required" }.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { leaveParty } from "@/server/party";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const userId = await getOrCreateUserId();
    const result = await leaveParty(userId);
    if (!result.ok) {
      return NextResponse.json(
        { error: "a registered account is required", code: result.code },
        { status: 403 },
      );
    }
    return NextResponse.json({
      ok: true,
      left: result.left,
      dissolved: result.dissolved,
      promoted: result.promoted,
    });
  } catch (err) {
    console.error("[api/party/leave] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
