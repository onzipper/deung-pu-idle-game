/**
 * Inventory endpoint (M7 Gear & Drops).
 *
 * GET -> the active character's non-deleted item instances + equipped loadout.
 *
 * Identity + active character are resolved server-side from httpOnly cookies; a
 * client never supplies the characterId (trust boundary). The DB is authoritative
 * over any equipped cache in the save blob.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { loadInventory, equippedLoadoutFrom } from "@/server/items";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await getOrCreateUserId();
    const characterId = await resolveActiveCharacterId(userId);
    if (!characterId) {
      return NextResponse.json({ items: [], equipped: { weapon: null, armor: null } });
    }
    const items = await loadInventory(characterId);
    return NextResponse.json({ items, equipped: equippedLoadoutFrom(items) });
  } catch (err) {
    console.error("[api/items] GET failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
