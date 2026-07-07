/**
 * Hall of Fame board endpoint (M7.95).
 *
 * GET /api/hof?board=level|power|gold|boss|online[&bossStage=5|10|15|20|25|30][&cls=all|swordsman|archer|mage]
 *   -> { top: [{rank, charName, cls, tier, level, value, at, profile}...] (≤10),
 *        me: {rank, value} | null }
 *
 * FROZEN CONTRACT (the parallel UI wave builds to this exact shape). Query params
 * are zod-validated strictly (`hofQuerySchema`); an invalid combination is a 400.
 * `me` is the CALLER'S OWN character row (identity resolved server-side from the
 * httpOnly cookie — never a client-supplied id), or null if the caller has no
 * character / no record on that board. Suspect (flagged) rows are excluded.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { hofQuerySchema, readBoard } from "@/server/leaderboard";

// Reads cookies (identity) + the DB per request — never static.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const parsed = hofQuerySchema.safeParse({
      board: params.get("board") ?? undefined,
      bossStage: params.get("bossStage") ?? undefined,
      // Omit cls when absent so the schema default ("all") applies.
      ...(params.get("cls") ? { cls: params.get("cls") } : {}),
    });
    if (!parsed.success) {
      const error = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return NextResponse.json({ error }, { status: 400 });
    }

    // `me` is the caller's OWN character (may be null — a fresh visitor, or an
    // account with no single active character selected). A missing character just
    // yields me:null; the boards themselves are public.
    const userId = await getOrCreateUserId();
    const meCharacterId = await resolveActiveCharacterId(userId);

    const board = await readBoard(parsed.data, meCharacterId);
    return NextResponse.json(board);
  } catch (err) {
    console.error("[api/hof] GET failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
