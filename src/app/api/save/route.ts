/**
 * Save / load endpoint (skeleton).
 *
 * GET  -> load the player's save (runs offline-idle catch-up before returning).
 * POST -> persist the player's save (server stamps `lastSeen`).
 *
 * Real persistence via `@/lib/db` + `save_states` lands in M3. For now these
 * return 501 so the route exists and the contract is documented.
 */

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "not implemented (M3)" }, { status: 501 });
}

export async function POST() {
  return NextResponse.json({ error: "not implemented (M3)" }, { status: 501 });
}
