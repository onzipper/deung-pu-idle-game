/**
 * HOF chosen-display-title (owner-approved docs/hof-rewards-design.md).
 *
 * POST { titleId: string | null } -> set (or clear with null) the ONE title the active
 * character shows on nameplates/HOF/party. The SERVER validates the pick against the
 * titles the character ACTUALLY holds this season (a client cannot show a title it did
 * not win) and persists it into the per-character `uiConfig.displayTitle` sidecar.
 *
 * Response: { ok: true, displayTitle } | error.
 *   - no_character  -> 409 (no active character selected)
 *   - invalid_title -> 400 (a title the character does not currently hold)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrCreateUserId } from "@/server/identity";
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { setDisplayTitle } from "@/server/hofSeason";

export const dynamic = "force-dynamic";

const titleSchema = z.object({ titleId: z.string().min(1).max(16).nullable() }).strict();

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = titleSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const userId = await getOrCreateUserId();
    const characterId = await resolveActiveCharacterId(userId);
    const result = await setDisplayTitle(characterId, parsed.data.titleId);
    if (!result.ok) {
      const status = result.code === "no_character" ? 409 : 400;
      return NextResponse.json({ error: result.code, code: result.code }, { status });
    }
    return NextResponse.json({ ok: true, displayTitle: result.displayTitle });
  } catch (err) {
    console.error("[api/hof/title] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
