/**
 * Drop-claim endpoint (M7 Gear & Drops).
 *
 * POST { items: [{ rollId, templateId, stage }] } -> mint the active character's
 * drops. Each item is ONE tx (instance + minted event), idempotent per claimKey
 * (`<characterId>:<rollId>` — a retry can never double-mint), validated against
 * the engine drop tables, and bounded by a lifetime rate-plausibility ceiling.
 *
 * The client is untrusted: identity + active character come from httpOnly cookies
 * (never the body), templateId/stage are strictly zod-validated, and elapsed time
 * for the plausibility cap is server-stamped (mirrors the save lastSeen pattern).
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { claimBatch, claimBatchSchema } from "@/server/items";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = claimBatchSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const userId = await getOrCreateUserId();
    const characterId = await resolveActiveCharacterId(userId);
    if (!characterId) {
      return NextResponse.json(
        { error: "no active character", code: "no_active_character" },
        { status: 409 },
      );
    }

    const { results, unverifiedMembership } = await claimBatch(characterId, parsed.data.items);
    if (unverifiedMembership > 0) {
      // TODO(M7): engine drop tables are placeholder-empty for some claimed
      // stages — membership could not be verified, so these were accepted on
      // trust. Tighten to hard rejection once dropTableForStage() is fleshed out.
      console.warn(
        `[api/items/claim] ${unverifiedMembership} claim(s) accepted with unverifiable table membership (engine tables empty)`,
      );
    }
    return NextResponse.json({ results });
  } catch (err) {
    console.error("[api/items/claim] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
