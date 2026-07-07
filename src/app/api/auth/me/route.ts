/**
 * Account status (M8 Phase 0) — the Settings → My Account read model.
 *
 * GET -> { registered, email, displayName, friendCode } for the CURRENT identity
 * cookie. A guest reads { registered: false, email/displayName/friendCode: null }.
 * `getOrCreateUserId` ensures a guest cookie exists so the response is stable.
 *
 * Responses: 200 AccountInfo · 500 internal.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { getAccountInfo } from "@/server/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await getOrCreateUserId();
    const info = await getAccountInfo(userId);
    return NextResponse.json(info);
  } catch (err) {
    console.error("[api/auth/me] GET failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
