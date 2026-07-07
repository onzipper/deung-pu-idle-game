/**
 * Friends poll endpoint (M8 Phase 1).
 *
 * GET -> the whole friends panel in ONE call: friends[] (with derived presence +
 * current character + lastZone), incomingRequests[], emojiPings[] (unseen pings are
 * returned then marked seen; older seen rows purged). Polling, no websockets.
 *
 * Identity comes from the httpOnly cookie (never the body). A guest (unregistered)
 * gets 403 { code: "account_required" }.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { getFriendsPanel } from "@/server/friends";

// Reads cookies + the DB per request — never static.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await getOrCreateUserId();
    const result = await getFriendsPanel(userId);
    if (!result.ok) {
      return NextResponse.json(
        { error: "a registered account is required", code: result.code },
        { status: 403 },
      );
    }
    return NextResponse.json(result.panel);
  } catch (err) {
    console.error("[api/friends] GET failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
