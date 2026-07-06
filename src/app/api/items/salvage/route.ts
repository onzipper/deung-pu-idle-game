/**
 * Salvage endpoint (M7.6 "ตีบวก" / Refine).
 *
 * POST { itemIds: string[] } -> soft-destroy the active character's UNEQUIPPED,
 * non-deleted items and MINT the summed refine materials into the authoritative
 * `Character.materials` column, all in ONE tx (soft-delete + `salvaged` ItemEvent
 * recording the yield + a single materials increment for the won set). Equipped
 * items are REJECTED ("equipped") — salvage never auto-unequips.
 *
 * Trust boundary: identity + active character come from httpOnly cookies (never the
 * body); ids are strictly zod-validated + deduped. Materials are SERVER-OWNED (unlike
 * gold, which lives in the save blob) — the response returns the new authoritative
 * balance + `totalMaterials`, and the client seeds its `materials` mirror from it.
 * No double-credit under concurrency: each item's soft-delete is an atomic check-and-
 * set, and only the won set feeds the increment (mirrors the sell idempotency pattern).
 * "Town-only" is enforced engine/client-side in v1 (same known gap as sell).
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { salvageItems, salvageSchema } from "@/server/items";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = salvageSchema.safeParse(body);
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

    const { results, totalMaterials, materials } = await salvageItems(
      characterId,
      parsed.data.itemIds,
    );
    return NextResponse.json({ results, totalMaterials, materials });
  } catch (err) {
    console.error("[api/items/salvage] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
