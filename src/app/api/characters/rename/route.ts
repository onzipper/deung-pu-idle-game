/**
 * Self-service character rename (once per Asia/Bangkok server-day).
 *
 * POST { characterId, name } -> rename a LIVE character owned by the identity-cookie
 * account. Ownership + liveness are gated server-side (never the body); the name is
 * held to the SAME validity + global-CI-uniqueness bar as creation, and limited to
 * once/day via an atomic compare-and-set in `renameCharacter` (src/server/characters.ts).
 *
 * Responses: 200 { ok, character } · 400 bad body · 404 { code: "not_found" } ·
 * 409 { code: "name_taken" | "rename_cooldown" } · 500 internal.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { renameCharacter, renameCharacterSchema } from "@/server/characters";

// Reads the cookie + writes the DB per request — never static.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = renameCharacterSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const userId = await getOrCreateUserId();
    const result = await renameCharacter(userId, parsed.data.characterId, parsed.data.name);
    if (!result.ok) {
      // not_found -> 404 (don't leak whether the id exists); name_taken /
      // rename_cooldown -> 409 Conflict.
      const status = result.code === "not_found" ? 404 : 409;
      return NextResponse.json({ error: result.code, code: result.code }, { status });
    }
    return NextResponse.json({ ok: true, character: result.character });
  } catch (err) {
    console.error("[api/characters/rename] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
