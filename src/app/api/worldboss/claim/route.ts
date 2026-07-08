/**
 * World boss "เสี่ยจ๋อง" claim endpoint.
 *
 * POST { characterId, windowId } -> the SERVER re-validates everything it cannot trust
 * the client for: identity from the cookie, owner+liveness of `characterId`, and
 * `windowId` against the SERVER wall-clock (a forwarded/forged window is rejected). On
 * success it grants — in ONE tx — +350 materials, ONE minted "แกร่ง" fortifier (50:50
 * crypto), and returns `goldCredit` (5,000) for the client to apply via its engine gold
 * intent (gold is client-authoritative in the save blob, same trust tier as sell/refine).
 *
 * Response: { ok, item, goldCredit, materialsTotal }.
 *   - not_owned    -> 403 (foreign character / guest with no such character)
 *   - stale_window -> 409 (future or expired window)
 *   - already_claimed -> 409 (WorldBossClaim @@unique — the DailyClaim idempotency pattern)
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { claimWorldBoss, worldBossClaimSchema } from "@/server/worldBoss";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = worldBossClaimSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const userId = await getOrCreateUserId();
    const result = await claimWorldBoss(userId, parsed.data.characterId, parsed.data.windowId);
    if (!result.ok) {
      const status = result.reason === "not_owned" ? 403 : 409;
      return NextResponse.json({ error: result.reason, code: result.reason }, { status });
    }
    return NextResponse.json({
      ok: true,
      item: result.item,
      goldCredit: result.goldCredit,
      materialsTotal: result.materialsTotal,
    });
  } catch (err) {
    console.error("[api/worldboss/claim] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
