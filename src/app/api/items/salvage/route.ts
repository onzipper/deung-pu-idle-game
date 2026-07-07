/**
 * Salvage endpoint — REMOVED (owner decision, หินเสริมพลัง wave).
 *
 * Salvage (ย่อย) is no longer the refine-material source; enhancement STONES are
 * (they drop per kill and credit via /api/items/claim). The endpoint's server module
 * (`salvageItems`) is deleted. This file is kept ONLY as a 410 Gone stub so a client
 * still deployed mid-session that posts an old salvage batch gets a clean, cheap
 * "gone" signal instead of a 404/500 — the UI/bot salvage paths are removed in the
 * follow-up UI wave. Existing `salvaged` ItemEvent audit rows remain valid & untouched.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { error: "salvage has been removed; enhancement stones are the material source now", code: "salvage_removed" },
    { status: 410 },
  );
}
