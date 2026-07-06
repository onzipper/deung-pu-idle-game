/**
 * Equip endpoint (M7 Gear & Drops).
 *
 * POST { itemId } -> equip the item into its template's slot for the active
 * character. Any incumbent in that slot is unequipped in the SAME tx (≤1 per slot
 * — persistence invariant 6). classReq is enforced server-side against the
 * character's base class; a deleted item is never equippable.
 *
 * Ownership is resolved from httpOnly cookies (never a client characterId).
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { getOwnedLiveCharacterClass } from "@/server/characters";
import { equipItem, equipSchema } from "@/server/items";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = equipSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
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
    // Resolve base class server-side for the classReq gate (client class untrusted).
    const character = await getOwnedLiveCharacterClass(userId, characterId);
    if (!character) {
      return NextResponse.json({ error: "character not found" }, { status: 404 });
    }

    const result = await equipItem(characterId, parsed.data.itemId, character.baseClass);
    if (!result.ok) {
      const status = result.reason === "class_req" ? 409 : 404;
      return NextResponse.json({ error: result.reason, code: result.reason }, { status });
    }
    return NextResponse.json({ ok: true, item: result.item });
  } catch (err) {
    console.error("[api/items/equip] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
