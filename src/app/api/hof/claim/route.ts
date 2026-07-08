/**
 * HOF rank-1 fortifier claim (owner-approved docs/hof-rewards-design.md).
 *
 * POST { awardId } -> the SERVER re-validates everything it cannot trust the client
 * for: identity from the cookie, award OWNERSHIP (userId), that the award actually
 * carries a fortifier (online rank-1 does NOT), and owner+liveness of the winning
 * character. On success it mints ONE "แกร่ง" fortifier (50:50 crypto) through the same
 * idempotent pipeline as the world-boss claim; the compare-and-set on the award's
 * `claimedAt` makes it claim-at-most-once.
 *
 * Response: { ok, item }.
 *   - not_owned       -> 403 (unknown/foreign award, or the winning character is gone)
 *   - no_reward       -> 409 (a title-only award — e.g. online rank-1 / ranks 2-3)
 *   - already_claimed -> 409 (the fortifier was already minted for this award)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrCreateUserId } from "@/server/identity";
import { claimAward } from "@/server/hofSeason";

export const dynamic = "force-dynamic";

const claimSchema = z.object({ awardId: z.string().min(1).max(64) }).strict();

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = claimSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const userId = await getOrCreateUserId();
    const result = await claimAward(userId, parsed.data.awardId);
    if (!result.ok) {
      const status = result.reason === "not_owned" ? 403 : 409;
      return NextResponse.json({ error: result.reason, code: result.reason }, { status });
    }
    return NextResponse.json({ ok: true, item: result.item });
  } catch (err) {
    console.error("[api/hof/claim] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
