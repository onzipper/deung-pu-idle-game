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
  listCharacters,
} from "@/server/characters";

// Reads/writes cookies + DB per request — never static.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await getOrCreateUserId();
    const characters = await listCharacters(userId);
    return NextResponse.json({ characters });
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
      // limit -> 409 Conflict; duplicate name -> 409 Conflict.
      return NextResponse.json({ error: result.error, code: result.code }, { status: 409 });
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
