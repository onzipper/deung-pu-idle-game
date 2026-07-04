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
import { loadSave, persistSave } from "@/server/save";

// This route reads/writes cookies and the DB per request — never static.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await getOrCreateUserId();
    const { save, offline } = await loadSave(userId);
    return NextResponse.json({ save, offline });
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
    const result = await persistSave(userId, body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, lastSeen: result.lastSeen });
  } catch (err) {
    console.error("[api/save] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
