/**
 * Unequip endpoint (M7 Gear & Drops).
 *
 * POST { itemId } -> clear the active character's item slot (NULL + unequipped
 * event, one tx). Idempotent if already unequipped. Ownership resolved from
 * httpOnly cookies (never a client characterId).
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { unequipItem, unequipSchema } from "@/server/items";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = unequipSchema.safeParse(body);
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
    const result = await unequipItem(characterId, parsed.data.itemId);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason, code: result.reason }, { status: 404 });
    }
    return NextResponse.json({ ok: true, item: result.item });
  } catch (err) {
    console.error("[api/items/unequip] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
