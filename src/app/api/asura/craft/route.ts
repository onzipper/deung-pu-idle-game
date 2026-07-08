/**
 * ดินแดนอสูร legendary craft "ตำราตำนาน" (endgame v1.2/v1.3, docs/endgame-design.md).
 *
 * POST { instanceId } -> the SERVER owns the ITEM half of the tome recipe it cannot trust
 * the client for: it CONSUMES the supplied t10 weapon of the character's class (soft-delete
 * + `consumed` ItemEvent) and MINTS the bind-on-craft `LEGENDARY_FOR_CLASS[cls]` instance
 * (origin "craft", `minted` event) in ONE tx. A unique claimKey `${characterId}:legendary:${cls}`
 * makes it IDEMPOTENT + one-legendary-per-class-per-character. The ENGINE already consumed the
 * currency counts (แก่นอสูร/ตรา/ศิลา/gold/materials) client-side (client-authoritative v1 —
 * anti-cheat re-derive DEFERRED). On the FIRST craft of a class the server fires a
 * first-craft-per-class announcement (reused feed).
 *
 * Trust boundary: identity + active character come from httpOnly cookies, never the body.
 * Errors: wrong_class -> 403 · no_weapon -> 404 · not_t10 -> 409.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { craftLegendaryWeapon, craftSchema } from "@/server/asura";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = craftSchema.safeParse(body);
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

    const result = await craftLegendaryWeapon(characterId, parsed.data.instanceId);
    if (!result.ok) {
      const status =
        result.reason === "wrong_class" ? 403 : result.reason === "no_weapon" ? 404 : 409;
      return NextResponse.json({ error: result.reason, code: result.reason }, { status });
    }
    return NextResponse.json({ ok: true, status: result.status, item: result.item });
  } catch (err) {
    console.error("[api/asura/craft] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
