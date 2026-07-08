/**
 * ดินแดนอสูร DAILY z10 ตราอสูร sigil claim (endgame v1.3, docs/endgame-design.md).
 *
 * POST (no body) -> the SERVER stamps today's Asia/Bangkok (UTC+7) `day` from its OWN
 * wall-clock and INSERTs an `AsuraSigilClaim` whose @@unique(character, day) makes a
 * second claim on the same day impossible (`already_claimed` / 409 — the DailyClaim
 * idempotency pattern). A client that winds its clock forward gets no new sigil.
 *
 * NO reward is computed here — the sigil COUNT is engine-side economy (client-authoritative
 * v1, same trust tier as gold). On 200 the client fires the engine `claimAsuraSigil` intent
 * (which adds the sigil once), exactly like the daily/refine flow only mutates after 200.
 *
 * Trust boundary: identity + active character come from httpOnly cookies, never the body.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { claimAsuraSigil } from "@/server/asura";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const userId = await getOrCreateUserId();
    const characterId = await resolveActiveCharacterId(userId);
    if (!characterId) {
      return NextResponse.json(
        { error: "no active character", code: "no_active_character" },
        { status: 409 },
      );
    }

    const result = await claimAsuraSigil(characterId);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason, code: result.reason }, { status: 409 });
    }
    return NextResponse.json({ ok: true, day: result.day });
  } catch (err) {
    console.error("[api/asura/sigil] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
