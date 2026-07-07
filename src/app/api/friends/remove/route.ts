/**
 * Remove a friend (M8 Phase 1).
 *
 * POST { userId } -> delete the canonical friendship (either side may). Idempotent.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { removeFriend, removeSchema } from "@/server/friends";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = removeSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const userId = await getOrCreateUserId();
    const result = await removeFriend(userId, parsed.data);
    if (!result.ok) {
      return NextResponse.json(
        { error: "a registered account is required", code: result.code },
        { status: 403 },
      );
    }
    return NextResponse.json({ ok: true, removed: result.removed });
  } catch (err) {
    console.error("[api/friends/remove] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
