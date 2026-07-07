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
import { currentBuildId } from "@/server/buildId";
import { getOrCreateUserId } from "@/server/identity";
import { resolveActiveCharacterId } from "@/server/activeCharacter";
import { getOwnedLiveCharacterClass } from "@/server/characters";
import { loadSave, persistSave } from "@/server/save";
import {
  loadInventory,
  equippedLoadoutFrom,
  loadMaterials,
  recentAnnouncements,
} from "@/server/items";
import { loadUiConfig } from "@/server/uiConfig";
import { dailyRosterPayload } from "@/server/dailyQuests";

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
        // M8 Quest Wave B: today's daily roster is USER-scoped (seeded from serverDay +
        // userId), so it is meaningful even before a character is selected — the client
        // (Wave C) fires the engine `setDailies` from this. Zero extra requests.
        dailies: dailyRosterPayload(userId, new Date()),
        offline: { creditedSeconds: 0, capped: false },
        activeCharacterId: null,
        baseClass: null,
        inventory: [],
        equipped: { weapon: null, armor: null, refine: { weapon: 0, armor: 0 } },
        materials: 0,
        // Cross-device UI config: no character yet → nothing stored; the client
        // keeps its own localStorage/defaults (see @/server/uiConfig).
        uiConfig: null,
        // M7.9: still worth surfacing even pre-character (a fresh login lands
        // here for a beat before a character is selected) — see the POST
        // branch's doc for the feed shape.
        announcements: await recentAnnouncements(),
        // Mid-session "new patch deployed" banner: piggyback the build id on
        // this boot response too (a fresh login lands here for a beat before
        // a character is selected) — see `@/server/buildId` + `@/ui/updateBanner`.
        buildId: currentBuildId(),
      });
    }
    // M7 boot payload: additively include the character's inventory + equipped
    // loadout alongside the save. PRECEDENCE: the ItemInstance table is
    // AUTHORITATIVE over any equipped cache serialized in the save blob — the
    // client must hydrate gear from `inventory`/`equipped` here, not from the
    // save's own copy (an item is not re-derivable from the save; persistence-m7).
    const userId2 = userId; // (identity already resolved above)
    const [{ save, offline }, inventory, character, materials, uiConfig, announcements] =
      await Promise.all([
        loadSave(characterId),
        loadInventory(characterId),
        getOwnedLiveCharacterClass(userId2, characterId),
        // M7.6 ตีบวก: the AUTHORITATIVE material balance (DB column, not the save
        // blob) — the client seeds its `materials` mirror from this on boot, same as
        // `equipped` is seeded from the DB ledger over the save's cache.
        loadMaterials(characterId),
        // Cross-device UI config (owner request 2026-07-07): the per-character
        // preference blob. `null` for a pre-existing/fresh character → the client
        // keeps its own localStorage/defaults; a stored blob WINS over localStorage.
        loadUiConfig(characterId),
        // M7.9: a fresh login should see a recent server-wide high-refine
        // landing too, not just players who happen to be online across an
        // autosave tick — see `recentAnnouncements`'s doc (last 5 min, LIMIT 10).
        recentAnnouncements(),
      ]);
    // `baseClass` is the AUTHORITATIVE class (immutable at creation) — the
    // client must correct/seed the save's `hero.cls` from it (the 2026-07-06
    // "everyone is a swordsman" repair; see engine `repairHeroClass`).
    return NextResponse.json({
      save,
      offline,
      // M8 Quest Wave B: today's daily roster (serverDay + 3 quest ids), computed per
      // request from the SERVER clock (Asia/Bangkok UTC+7) — the client fires the engine
      // `setDailies` from this, so no extra request. See `@/server/dailyQuests`.
      dailies: dailyRosterPayload(userId, new Date()),
      activeCharacterId: characterId,
      baseClass: character?.baseClass ?? null,
      inventory,
      equipped: equippedLoadoutFrom(inventory),
      materials,
      uiConfig,
      announcements,
      // Mid-session "new patch deployed" banner (owner-approved feature): the
      // client compares this against its own inlined `NEXT_PUBLIC_BUILD_ID` on
      // every save response — see `@/server/buildId` + `@/ui/updateBanner`.
      buildId: currentBuildId(),
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
    // Cross-device UI config rides the SAME autosave POST body as an OPTIONAL
    // sibling `uiConfig` key (owner request 2026-07-07). Split it off BEFORE the
    // save reaches `parseSaveData` — the save schema is `.strict()` and would
    // otherwise reject the extra key. Absent → `undefined` → the stored config is
    // left untouched (old clients don't wipe it). `persistSave` validates it and
    // never lets a bad one fail the save.
    let uiConfig: unknown;
    let saveBody: unknown = body;
    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      const rec = body as Record<string, unknown>;
      if ("uiConfig" in rec) {
        const { uiConfig: uc, ...rest } = rec;
        uiConfig = uc;
        saveBody = rest;
      }
    }
    const result = await persistSave(characterId, userId, saveBody, new Date(), uiConfig);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    // M7.9 server-wide high-refine announcements: piggyback on the existing
    // autosave polling cycle (owner-approved design, no websockets this
    // phase) — every online player's next autosave POST picks up any
    // recent (last 5 min, LIMIT 10, newest first) landing within one cycle.
    return NextResponse.json({
      ok: true,
      lastSeen: result.lastSeen,
      // M8 Quest Wave B: refresh the daily roster on the autosave cycle too, so a client
      // that crosses the Asia/Bangkok midnight boundary mid-session picks up the new day
      // within one save tick (zero extra requests) — see `@/server/dailyQuests`.
      dailies: dailyRosterPayload(userId, new Date()),
      announcements: await recentAnnouncements(),
      // Mid-session "new patch deployed" banner: zero extra requests — this
      // rides the existing autosave POST response (see `@/server/buildId` +
      // `@/ui/updateBanner`).
      buildId: currentBuildId(),
    });
  } catch (err) {
    console.error("[api/save] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
