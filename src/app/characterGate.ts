/**
 * Read-only "does this visitor already have a resolvable active character?"
 * check for the game page's server-side gate (M5 Character Pivot).
 *
 * Deliberately does NOT call `getOrCreateUserId` (`@/server/identity`) or
 * `resolveActiveCharacterId` (`@/server/activeCharacter`): both may WRITE a
 * cookie (mint a brand-new anonymous user; persist the single-character
 * auto-select fallback), and Next.js only allows `cookies().set()` inside a
 * Server Action or Route Handler — calling them during a plain page render
 * throws `ReadonlyRequestCookiesError` ("Cookies can only be modified in a
 * Server Action or Route Handler"). That would crash the very common case of
 * an existing single-character account whose browser doesn't have the new
 * `activeCharacterId` cookie yet.
 *
 * This gate only READS the two relevant cookies (names mirror the private
 * constants in `src/server/identity.ts` / `src/server/activeCharacter.ts`,
 * which don't export them) plus the read-only character queries from
 * `@/server/characters` (`listCharacters` / `getOwnedLiveCharacter` — no
 * cookie writes). The REAL resolution + cookie persistence still happens
 * exactly once, safely, the moment `GameClient` mounts and calls
 * `GET /api/save` (a Route Handler, where cookie writes are allowed) — this
 * gate is only a pre-render short-circuit so a visitor with no selectable
 * character never sees the game shell before bouncing to `/characters`.
 */

import { cookies } from "next/headers";
import { getOwnedLiveCharacter, listCharacters } from "@/server/characters";

/** Mirrors `COOKIE_NAME` in `src/server/identity.ts` (not exported there). */
const USER_COOKIE = "dpu_uid";
/** Mirrors `COOKIE_NAME` in `src/server/activeCharacter.ts` (not exported there). */
const ACTIVE_CHARACTER_COOKIE = "activeCharacterId";

/**
 * Returns true if the current request can resolve to a live character right
 * now (a valid `activeCharacterId` cookie, or exactly one live character to
 * silently fall back to). Fails OPEN (returns true) on unexpected read
 * errors — this is a UX routing gate, not a security boundary, and
 * `GameClient`'s own `GET /api/save` handles a missing/invalid character
 * either way.
 */
export async function hasResolvableActiveCharacter(): Promise<boolean> {
  try {
    const store = await cookies();
    const userId = store.get(USER_COOKIE)?.value;
    if (!userId) return false; // brand-new visitor: no account yet, no characters possible

    const activeId = store.get(ACTIVE_CHARACTER_COOKIE)?.value;
    if (activeId) {
      const owned = await getOwnedLiveCharacter(userId, activeId);
      if (owned) return true;
    }

    // Read-only mirror of `resolveActiveCharacterId`'s single-character
    // auto-select fallback (the cookie write itself happens later, safely,
    // inside GET /api/save).
    const characters = await listCharacters(userId);
    return characters.length === 1;
  } catch (err) {
    console.error("[characterGate] read failed, failing open:", err);
    return true;
  }
}

/**
 * True only for a visitor with NO identity cookie at all — i.e. someone who
 * has genuinely never touched the game before. Used by the game page (M6.5b
 * UI Skin, wave 1) to decide "show the title screen" vs. an existing account
 * that just needs to pick/create a character (which still skips straight to
 * `/characters`, unchanged). Read-only, same cookie mirror as the check
 * above; fails CLOSED (returns false) on an unexpected read error so a
 * broken cookie read degrades to the pre-existing redirect behavior rather
 * than stranding a returning player on a title screen.
 */
export async function isBrandNewVisitor(): Promise<boolean> {
  try {
    const store = await cookies();
    return !store.get(USER_COOKIE)?.value;
  } catch (err) {
    console.error("[characterGate] read failed, failing closed:", err);
    return false;
  }
}
