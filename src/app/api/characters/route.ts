/**
 * Character collection endpoint (M5 Character Pivot).
 *
 * GET  -> list the identity-cookie account's LIVE characters.
 * POST -> create a character { name, baseClass } (≤3 live, unique live name).
 *
 * The client is untrusted: identity comes from the httpOnly cookie (never the
 * body), and the body is strictly zod-validated in `@/server/characters`.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { setActiveCharacterCookie } from "@/server/activeCharacter";
import {
  createCharacter,
  createCharacterSchema,
  getNinjaUnlock,
  listCharacters,
} from "@/server/characters";

// Reads/writes cookies + DB per request — never static.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await getOrCreateUserId();
    // Both reads are account-scoped by the identity cookie; the roster carries the
    // ninja-unlock progress so the client renders the 4th (locked) card without a
    // second poll. `ninjaUnlock` is derived from Character.tier caches, never a blob.
    const [characters, ninjaUnlock] = await Promise.all([
      listCharacters(userId),
      getNinjaUnlock(userId),
    ]);
    return NextResponse.json({ characters, ninjaUnlock });
  } catch (err) {
    console.error("[api/characters] GET failed:", err);
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

  const parsed = createCharacterSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const userId = await getOrCreateUserId();
    const result = await createCharacter(userId, parsed.data);
    if (!result.ok) {
      // ninja_locked -> 403 Forbidden (unmet unlock condition, UI maps to progress
      // copy); limit / duplicate / ninja_only_slot -> 409 Conflict.
      const status = result.code === "ninja_locked" ? 403 : 409;
      return NextResponse.json({ error: result.error, code: result.code }, { status });
    }
    // First character created becomes the active one (convenience for the client);
    // subsequent creates leave the current selection untouched.
    const existing = await listCharacters(userId);
    if (existing.length === 1) {
      await setActiveCharacterCookie(result.character.id);
    }
    return NextResponse.json({ character: result.character }, { status: 201 });
  } catch (err) {
    console.error("[api/characters] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
