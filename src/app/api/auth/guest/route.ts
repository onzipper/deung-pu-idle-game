/**
 * Guest entry (M8 Phase 0 welcome screen).
 *
 * POST -> mint (or reuse) the anonymous identity cookie via `getOrCreateUserId`,
 * with zero form friction ("เล่นเลย" lane). The client then routes to
 * `/characters`. No body, no validation needed.
 *
 * Responses: 200 { ok } · 500 internal.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await getOrCreateUserId();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/auth/guest] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
