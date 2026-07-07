/**
 * Account registration (M8 Phase 0).
 *
 * POST { email, password, displayName? } -> claim the account layer on the CURRENT
 * identity-cookie user (guest upgrades IN PLACE; saves/characters survive). If the
 * visitor has no cookie yet, `getOrCreateUserId` mints the row (+cookie) first, then
 * we bind onto it. Identity comes from the cookie, never the body.
 *
 * Responses: 201 { ok, registered, email, displayName, friendCode } · 400 bad body ·
 * 409 { code: "email_taken" | "already_registered" } · 500 internal.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { registerAccount, registerSchema } from "@/server/auth";

// Reads/writes cookies + DB per request — never static.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const userId = await getOrCreateUserId();
    const result = await registerAccount(userId, parsed.data);
    if (!result.ok) {
      const error =
        result.code === "email_taken"
          ? "that email is already registered"
          : "this account is already registered";
      return NextResponse.json({ error, code: result.code }, { status: 409 });
    }
    return NextResponse.json(
      {
        ok: true,
        registered: true,
        email: result.email,
        displayName: result.displayName,
        friendCode: result.friendCode,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("[api/auth/register] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
