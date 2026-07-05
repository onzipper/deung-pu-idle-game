/**
 * Single-character endpoint (M5 Character Pivot).
 *
 * DELETE -> soft-delete a character (owner-checked). If it was the active one,
 * the `activeCharacterId` cookie is cleared so the next save/load re-resolves.
 *
 * Next 16: dynamic-route `params` is a Promise and must be awaited.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import {
  clearActiveCharacterCookie,
  readActiveCharacterCookie,
} from "@/server/activeCharacter";
import { deleteCharacter } from "@/server/characters";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const userId = await getOrCreateUserId();
    const result = await deleteCharacter(userId, id);
    if (!result.ok) {
      // Not owned or already deleted — 404 (don't leak whether the id exists).
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    // If the deleted character was the active selection, drop the cookie.
    const active = await readActiveCharacterCookie();
    if (active === id) await clearActiveCharacterCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/characters/:id] DELETE failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
