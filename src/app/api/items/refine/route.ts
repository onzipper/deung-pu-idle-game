/**
 * Refine endpoint (M7.6 "ตีบวก", RO-style +N).
 *
 * POST { itemId: string } -> the SERVER rolls a refine attempt on one owned item
 * (the engine never rolls — anti-cheat, CLAUDE.md). ONE tx: validate cost via
 * `refineCost(tier, current+1)`, check materials (authoritative DB column) + gold
 * (persisted save-blob balance), debit materials, roll success vs
 * `successChanceForLevel`, apply the outcome (success +1 / degrade −1 / break =
 * soft-destroy, unequip in the same tx), and append a `refined` ItemEvent.
 *
 * Trust boundary: identity + active character from httpOnly cookies (never the body).
 * Gold lives in the save blob (MVP client-authoritative) — the server checks the
 * PERSISTED balance and returns `goldDelta` for the client to apply via a gold intent
 * (a client that has earned-but-not-saved should persist before refining). Materials
 * ARE server-authoritative: the response returns the new balance + `materialsDelta`
 * for the client to reconcile its mirror. Response also carries `refineLevel`/`outcome`
 * so the UI can play the win/break juice. "Town-only" is engine/client-enforced (v1).
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { refineItem, refineSchema } from "@/server/items";
import { loadSave } from "@/server/save";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = refineSchema.safeParse(body);
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

    // Gold is client-authoritative in the save blob (MVP). The best server-side
    // snapshot is the last persisted save; migrate() normalises it. It is only a
    // BALANCE CHECK — gold is not debited here (returned as `goldDelta`).
    const { save } = await loadSave(characterId);
    const goldBalance = save?.gold ?? 0;

    const result = await refineItem(characterId, parsed.data.itemId, goldBalance);
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : 409;
      return NextResponse.json({ error: result.reason, code: result.reason }, { status });
    }
    return NextResponse.json({
      outcome: result.outcome,
      refineLevel: result.refineLevel,
      destroyed: result.destroyed,
      materials: result.materials,
      materialsDelta: result.materialsDelta,
      goldDelta: result.goldDelta,
      cost: result.cost,
    });
  } catch (err) {
    console.error("[api/items/refine] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
