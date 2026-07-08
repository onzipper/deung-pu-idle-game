/**
 * World boss "เสี่ยจ๋อง" — shared-pool state read (zone-entry sync).
 *
 * GET /api/worldboss/state?windowId=<n> -> { windowId, hp, defeated } for the SERVER-WIDE
 * shared HP pool of that hourly window. An untouched window (no damage reported yet) has no
 * row, so the FULL pool is returned (not defeated). Read-only, PUBLIC (the shared pool hp is
 * not per-player), so no identity/cookie is set here — a client entering the boss zone reads
 * the current pool to seed its local render/engine before its first damage report.
 */

import { NextResponse } from "next/server";
import { getWorldBossPoolState } from "@/server/worldBoss";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("windowId");
  const windowId = Number(raw);
  if (raw === null || !Number.isInteger(windowId) || windowId < 0) {
    return NextResponse.json({ error: "windowId must be a non-negative integer" }, { status: 400 });
  }

  try {
    const state = await getWorldBossPoolState(windowId);
    return NextResponse.json({ ok: true, ...state });
  } catch (err) {
    console.error("[api/worldboss/state] GET failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
