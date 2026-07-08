/**
 * HOF seasonal rewards read (owner-approved docs/hof-rewards-design.md).
 *
 * GET /api/hof/rewards[?characterId=<id>]
 *   -> {
 *        season: string | null,                    // latest finalized month key ("YYYY-MM")
 *        champions: { level|power|gold|online: [{rank,charName,cls,value,titleId}...] },
 *        me: { titles:[{titleId,board,rank,charName}], displayTitle, unclaimedAwards:[{awardId,board,titleId}] } | null,
 *        badges: [{titleId,board,rank,month,charName}] | null   // rank-1 history for ?characterId
 *      }
 *
 * This read is ALSO the lazy-finalize trigger (no cron): the first request after a
 * Bangkok month cutoff snapshots the just-ended season. `me` is the caller's active
 * character (identity from the httpOnly cookie — never a client id). `badges` is the
 * permanent rank-1 history for the optional `characterId` (the profile view), else null.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { readRewards } from "@/server/hofSeason";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const badgeCharacterId = new URL(request.url).searchParams.get("characterId") || null;
    const userId = await getOrCreateUserId();
    const meCharacterId = await resolveActiveCharacterId(userId);
    const rewards = await readRewards(meCharacterId, badgeCharacterId);
    return NextResponse.json(rewards);
  } catch (err) {
    console.error("[api/hof/rewards] GET failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
