/**
 * Account login (M8 Phase 0).
 *
 * POST { email, password } -> verify credentials, then repoint the `dpu_uid`
 * identity cookie at the matching account and CLEAR the `activeCharacterId` cookie
 * (it may point at the previous account's character — GameClient/gate re-selects).
 *
 * If the current cookie is an unregistered guest with characters, logging in
 * silently ABANDONS that guest (owner-approved; the guest can register instead to
 * keep progress). Cookie writes happen here (Route Handler), never in RSC render.
 *
 * Responses: 200 { ok } · 400 bad body · 401 bad credentials · 500 internal.
 */

import { NextResponse } from "next/server";
import { setUserIdCookie } from "@/server/identity";
import { clearActiveCharacterCookie } from "@/server/activeCharacter";
import { loginAccount, loginSchema } from "@/server/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const result = await loginAccount(parsed.data);
    if (!result.ok) {
      return NextResponse.json(
        { error: "incorrect email or password", code: result.code },
        { status: 401 },
      );
    }
    // Repoint identity at the verified account; drop the (possibly foreign) active char.
    await setUserIdCookie(result.userId);
    await clearActiveCharacterCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/auth/login] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
