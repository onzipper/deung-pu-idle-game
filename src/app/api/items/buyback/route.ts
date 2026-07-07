/**
 * NPC buy-back endpoint (owner-approved).
 *
 * GET  -> this character's still-repurchasable sold items (unrestored, soldAt within
 *         BUYBACK_WINDOW_DAYS), SOONEST-TO-EXPIRE FIRST. Each entry carries the exact
 *         price credited at sale + a server-computed `expiresAt`.
 * POST { soldItemId } -> repurchase one, atomic check-and-set (mirrors refine): the
 *         row must belong to this character, be unrestored, within the window, and the
 *         PERSISTED save-blob gold must cover the price. On success the server re-mints
 *         a fresh ItemInstance (same templateId + refineLevel) + a `boughtBack` event
 *         and returns `goldDelta: -price` for the client to apply (gold is
 *         client-authoritative in the save blob — same MVP pattern as sell/refine).
 *
 * Trust boundary: identity + active character come from httpOnly cookies (never the
 * body); the 3-day window is measured from the SERVER-STAMPED soldAt vs the server
 * clock, so a client that forwards its clock cannot extend an offer. MANUAL-ONLY — no
 * bot/auto executor calls this.
 */

import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/server/identity";
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { loadBuyback, buybackItem, buybackSchema } from "@/server/items";
import { loadSave } from "@/server/save";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await getOrCreateUserId();
    const characterId = await resolveActiveCharacterId(userId);
    if (!characterId) return NextResponse.json({ items: [] });
    const items = await loadBuyback(characterId);
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[api/items/buyback] GET failed:", err);
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

  const parsed = buybackSchema.safeParse(body);
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

    // Gold is client-authoritative in the save blob (MVP) — the best server-side
    // snapshot is the last persisted save; it is only a BALANCE CHECK (returned as
    // `goldDelta`, never debited here), the SAME pattern the refine endpoint uses.
    const { save } = await loadSave(characterId);
    const goldBalance = save?.gold ?? 0;

    const result = await buybackItem(characterId, parsed.data.soldItemId, goldBalance);
    if (!result.ok) {
      const status = result.reason === "notFound" ? 404 : 409;
      return NextResponse.json({ ok: false, reason: result.reason }, { status });
    }
    return NextResponse.json({ ok: true, goldDelta: result.goldDelta, item: result.item });
  } catch (err) {
    console.error("[api/items/buyback] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
