/**
 * Respond to a friend request (M8 Phase 1).
 *
 * POST { requestId, accept } -> accept (create canonical friendship + delete request)
 * or decline (delete request). Only the addressee may respond; a missing/foreign
 * request is 404 (no existence leak).
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { respondFriendRequest, respondSchema } from "@/server/friends";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = respondSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const userId = await getOrCreateUserId();
    const result = await respondFriendRequest(userId, parsed.data);
    if (result.ok) return NextResponse.json({ ok: true, accepted: result.accepted });
    if (result.code === "account_required") {
      return NextResponse.json(
        { error: "a registered account is required", code: result.code },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: "no such request", code: result.code }, { status: 404 });
  } catch (err) {
    console.error("[api/friends/respond] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
