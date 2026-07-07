/**
 * Account logout (M8 Phase 0).
 *
 * POST -> clear BOTH the identity (`dpu_uid`) and active-character
 * (`activeCharacterId`) cookies. The next visit mints a fresh anonymous guest.
 * No body, no identity trust needed — it only deletes cookies.
 *
 * Responses: 200 { ok } · 500 internal.
 */

import { NextResponse } from "next/server";
import { clearUserIdCookie } from "@/server/identity";
import { clearActiveCharacterCookie } from "@/server/activeCharacter";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await clearUserIdCookie();
    await clearActiveCharacterCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/auth/logout] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
