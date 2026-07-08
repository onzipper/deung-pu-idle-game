/**
 * Self-service account displayName rename (once per Asia/Bangkok server-day).
 *
 * POST { displayName } -> set the CURRENT identity-cookie account's displayName.
 * Identity comes from the cookie, never the body. Only registered accounts have a
 * displayName (a guest gets 403 account_required). The once/day guard is an atomic
 * compare-and-set in `renameDisplayName` (src/server/auth.ts).
 *
 * Responses: 200 { ok, displayName } · 400 bad body · 403 { code: "account_required" } ·
 * 409 { code: "rename_cooldown" } · 500 internal.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { renameDisplayName, renameDisplayNameSchema } from "@/server/auth";

// Reads the cookie + writes the DB per request — never static.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = renameDisplayNameSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const userId = await getOrCreateUserId();
    const result = await renameDisplayName(userId, parsed.data.displayName);
    if (!result.ok) {
      const status = result.code === "account_required" ? 403 : 409;
      return NextResponse.json({ error: result.code, code: result.code }, { status });
    }
    return NextResponse.json({ ok: true, displayName: result.displayName });
  } catch (err) {
    console.error("[api/account/rename] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
