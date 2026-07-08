/**
 * ดินแดนอสูร legendary AWAKENING "ปลุกพลัง" (endgame v1.3, docs/endgame-design.md).
 *
 * POST { instanceId } -> GUARANTEED +1 on an owned "ตำราตำนาน" legendary (100% success, never
 * breaks — owner design). This is the legendary's ONLY progression path: the refine endpoint
 * rejects kind "legendary", so without this a crafted legendary sits at +0 forever. The SERVER
 * debits the cost (`awakenCost`): STONES from the authoritative `Character.materials` column, GOLD
 * checked against the persisted save-blob balance (client-authoritative MVP gap) + returned as
 * `goldDelta` — the `refineItem` trust split, minus the roll. Appends an `awakened` ItemEvent.
 *
 * Trust boundary: identity + active character come from httpOnly cookies, never the body.
 * Errors: not_found -> 404 · not_legendary / max / insufficient_gold / insufficient_materials -> 409.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { awakenLegendary, awakenSchema } from "@/server/asura";
import { loadSave } from "@/server/save";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = awakenSchema.safeParse(body);
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

    // Gold is client-authoritative in the save blob (MVP, same as refine). The best server
    // snapshot is the last persisted save; it is only a BALANCE CHECK (returned as goldDelta).
    const { save } = await loadSave(characterId);
    const goldBalance = save?.gold ?? 0;

    const result = await awakenLegendary(characterId, parsed.data.instanceId, goldBalance);
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : 409;
      return NextResponse.json({ error: result.reason, code: result.reason }, { status });
    }
    return NextResponse.json({
      ok: true,
      refineLevel: result.refineLevel,
      materials: result.materials,
      materialsDelta: result.materialsDelta,
      goldDelta: result.goldDelta,
      cost: result.cost,
    });
  } catch (err) {
    console.error("[api/asura/awaken] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
