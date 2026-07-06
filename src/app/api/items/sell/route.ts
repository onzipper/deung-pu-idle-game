/**
 * NPC-sell endpoint (M7.5 Sell, Bots & Inventory).
 *
 * POST { itemIds: string[] } -> soft-destroy the active character's UNEQUIPPED,
 * non-deleted items and return a per-item status + `totalGold`. Each item is ONE
 * tx (soft-delete + `destroyed` ItemEvent recording the sell-time price). Equipped
 * items are REJECTED (reason "equipped") — sell never auto-unequips.
 *
 * Trust boundary: identity + active character come from httpOnly cookies (never the
 * body); ids are strictly zod-validated + deduped. The player's GOLD lives in the
 * engine save blob — the client applies `totalGold` via an engine intent; the
 * ItemEvent ledger is the authoritative audit for later server re-derivation. The
 * "town-only" sell rule is enforced engine/client-side in v1 (known gap; see
 * src/server/items.ts sellItems).
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { sellItems, sellSchema } from "@/server/items";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = sellSchema.safeParse(body);
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

    const { results, totalGold } = await sellItems(characterId, parsed.data.itemIds);
    return NextResponse.json({ results, totalGold });
  } catch (err) {
    console.error("[api/items/sell] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
