/**
 * Send an emoji ping to a friend (M8 Phase 1).
 *
 * POST { toUserId, emoji } -> store-and-forward ping (polled). Emoji must be in the
 * server allowlist (pre-2020 glyphs only); sender + recipient must be friends; the
 * sender is rate-limited to 10 pings/minute (429 { code: "rate_limited" }).
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { sendEmoji, emojiSchema } from "@/server/friends";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = emojiSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const userId = await getOrCreateUserId();
    const result = await sendEmoji(userId, parsed.data);
    if (result.ok) return NextResponse.json({ ok: true });
    switch (result.code) {
      case "account_required":
        return NextResponse.json(
          { error: "a registered account is required", code: result.code },
          { status: 403 },
        );
      case "bad_emoji":
        return NextResponse.json({ error: "emoji not allowed", code: result.code }, { status: 400 });
      case "not_friends":
        return NextResponse.json({ error: "not friends", code: result.code }, { status: 403 });
      case "rate_limited":
        return NextResponse.json({ error: "too many pings", code: result.code }, { status: 429 });
    }
  } catch (err) {
    console.error("[api/friends/emoji] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
