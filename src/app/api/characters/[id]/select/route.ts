/**
 * Active-character selection endpoint (M5 Character Pivot).
 *
 * POST -> make :id the account's active character (owner + liveness checked),
 * persisting it in the httpOnly `activeCharacterId` cookie that GET/POST /api/save
 * key off. Selecting a character you don't own / that is deleted is a 404.
 *
 * Next 16: dynamic-route `params` is a Promise and must be awaited.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { setActiveCharacterCookie } from "@/server/activeCharacter";
import { getOwnedLiveCharacter } from "@/server/characters";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const userId = await getOrCreateUserId();
    const owned = await getOwnedLiveCharacter(userId, id);
    if (!owned) {
      return NextResponse.json({ error: "character not found" }, { status: 404 });
    }
    await setActiveCharacterCookie(owned.id);
    return NextResponse.json({ ok: true, activeCharacterId: owned.id });
  } catch (err) {
    console.error("[api/characters/:id/select] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
