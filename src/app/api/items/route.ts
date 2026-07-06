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
import { loadInventory, equippedLoadoutFrom, loadMaterials } from "@/server/items";
import { INVENTORY_CAP } from "@/engine/config/items";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await getOrCreateUserId();
    const characterId = await resolveActiveCharacterId(userId);
    if (!characterId) {
      return NextResponse.json({
        items: [],
        equipped: { weapon: null, armor: null, refine: { weapon: 0, armor: 0 } },
        count: 0,
        cap: INVENTORY_CAP,
        materials: 0,
      });
    }
    const [items, materials] = await Promise.all([
      loadInventory(characterId),
      loadMaterials(characterId),
    ]);
    // `count` = non-deleted instances shown (drives the client cap/sell-trip UI);
    // `cap` = INVENTORY_CAP, the same limit the claim backstop enforces. `materials`
    // = the authoritative refine-material balance (M7.6).
    return NextResponse.json({
      items,
      equipped: equippedLoadoutFrom(items),
      count: items.length,
      cap: INVENTORY_CAP,
      materials,
    });
  } catch (err) {
    console.error("[api/items] GET failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
