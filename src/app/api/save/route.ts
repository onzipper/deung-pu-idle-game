/**
 * Save / load endpoint.
 *
 * GET  -> resolve identity (create anon user if needed), load the migrated save,
 *         and return it alongside the capped offline-idle credit.
 * POST -> resolve identity, validate the body, persist (server stamps lastSeen).
 *
 * The client is untrusted: all validation + the offline calc + the lastSeen
 * stamp happen server-side (see `@/server/save`). Errors return a plain message
 * and an appropriate status — never a stack trace.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { loadSave, persistSave } from "@/server/save";

// This route reads/writes cookies and the DB per request — never static.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await getOrCreateUserId();
    // M5: saves are per-character. Resolve the active character (cookie, with the
    // single-character auto-select fallback). No character yet -> nothing to load.
    const characterId = await resolveActiveCharacterId(userId);
    if (!characterId) {
      return NextResponse.json({
        save: null,
        offline: { creditedSeconds: 0, capped: false },
        activeCharacterId: null,
      });
    }
    const { save, offline } = await loadSave(characterId);
    return NextResponse.json({ save, offline, activeCharacterId: characterId });
  } catch (err) {
    console.error("[api/save] GET failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const userId = await getOrCreateUserId();
    const characterId = await resolveActiveCharacterId(userId);
    if (!characterId) {
      // No character to save into yet — the creation UI must make/select one.
      return NextResponse.json(
        { error: "no active character", code: "no_active_character" },
        { status: 409 },
      );
    }
    const result = await persistSave(characterId, userId, body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, lastSeen: result.lastSeen });
  } catch (err) {
    console.error("[api/save] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
