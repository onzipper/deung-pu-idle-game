/**
 * World boss "เสี่ยจ๋อง" — SERVER-WIDE shared-pool damage report.
 *
 * POST { windowId, damage } -> the SERVER chips the shared HP pool for `windowId` down by
 * `damage` (owner-approved: one boss, one pool, every online player hits the SAME hp). It
 * re-validates everything it cannot trust the client for: identity + the ACTIVE character
 * come from httpOnly cookies (never the body); `windowId` is checked against the SERVER
 * wall-clock (a forwarded/forged window → 410); `damage` is bounded by a generous
 * client-trust-v1 plausibility cap (→ 422). The pool is lazily minted at full hp on the
 * first report of a window, decremented ATOMICALLY floored at 0, and stamped defeated once.
 *
 * Response: { ok, hp, defeated } — the client feeds `hp` into its engine `syncWorldBoss`
 * intent; `defeated` (pool at 0) unlocks the per-character claim.
 *   - no_active_character -> 409
 *   - stale_window        -> 410 (future/past hour)
 *   - implausible         -> 422 (damage over the cap)
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { reportWorldBossDamage, worldBossDamageSchema } from "@/server/worldBoss";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = worldBossDamageSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const userId = await getOrCreateUserId();
    const characterId = await resolveActiveCharacterId(userId);
    if (!characterId) {
      return NextResponse.json(
        { error: "no active character", code: "no_active_character" },
        { status: 409 },
      );
    }

    const result = await reportWorldBossDamage(characterId, parsed.data.windowId, parsed.data.damage);
    if (!result.ok) {
      const status = result.reason === "stale_window" ? 410 : 422;
      return NextResponse.json({ error: result.reason, code: result.reason }, { status });
    }
    return NextResponse.json({ ok: true, hp: result.hp, defeated: result.defeated });
  } catch (err) {
    console.error("[api/worldboss/damage] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
