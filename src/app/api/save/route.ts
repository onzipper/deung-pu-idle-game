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
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { getOwnedLiveCharacterClass } from "@/server/characters";
import { loadSave, persistSave } from "@/server/save";
import { loadInventory, equippedLoadoutFrom, loadMaterials } from "@/server/items";

// This route reads/writes cookies and the DB per request — never static.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await getOrCreateUserId();
    // M5: saves are per-character. Resolve the active character (cookie, with the
    // single-character auto-select fallback). No character yet -> nothing to load.
    const characterId = await resolveActiveCharacterId(userId);
    if (!characterId) {
      return NextResponse.json({
        save: null,
        offline: { creditedSeconds: 0, capped: false },
        activeCharacterId: null,
        baseClass: null,
        inventory: [],
        equipped: { weapon: null, armor: null, refine: { weapon: 0, armor: 0 } },
        materials: 0,
      });
    }
    // M7 boot payload: additively include the character's inventory + equipped
    // loadout alongside the save. PRECEDENCE: the ItemInstance table is
    // AUTHORITATIVE over any equipped cache serialized in the save blob — the
    // client must hydrate gear from `inventory`/`equipped` here, not from the
    // save's own copy (an item is not re-derivable from the save; persistence-m7).
    const userId2 = userId; // (identity already resolved above)
    const [{ save, offline }, inventory, character, materials] = await Promise.all([
      loadSave(characterId),
      loadInventory(characterId),
      getOwnedLiveCharacterClass(userId2, characterId),
      // M7.6 ตีบวก: the AUTHORITATIVE material balance (DB column, not the save
      // blob) — the client seeds its `materials` mirror from this on boot, same as
      // `equipped` is seeded from the DB ledger over the save's cache.
      loadMaterials(characterId),
    ]);
    // `baseClass` is the AUTHORITATIVE class (immutable at creation) — the
    // client must correct/seed the save's `hero.cls` from it (the 2026-07-06
    // "everyone is a swordsman" repair; see engine `repairHeroClass`).
    return NextResponse.json({
      save,
      offline,
      activeCharacterId: characterId,
      baseClass: character?.baseClass ?? null,
      inventory,
      equipped: equippedLoadoutFrom(inventory),
      materials,
    });
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
    const characterId = await resolveActiveCharacterId(userId);
    if (!characterId) {
      // No character to save into yet — the creation UI must make/select one.
      return NextResponse.json(
        { error: "no active character", code: "no_active_character" },
        { status: 409 },
      );
    }
    const result = await persistSave(characterId, userId, body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, lastSeen: result.lastSeen });
  } catch (err) {
    console.error("[api/save] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
