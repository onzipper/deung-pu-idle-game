/**
 * Active-character selection (M5 Character Pivot).
 *
 * Which of an account's ≤3 characters the save endpoints read/write is held in an
 * httpOnly cookie (`activeCharacterId`), set via POST /api/characters/:id/select.
 * Server-only (reads/writes cookies via `next/headers`) — mirrors identity.ts.
 *
 * Resolution is trust-checked EVERY request: a cookie value is only honoured if it
 * still names a LIVE character owned by the current user. Fallback (transitional,
 * until the creation UI lands): if there is no valid cookie but the account has
 * EXACTLY ONE live character, auto-select it (and persist the cookie) so a
 * returning single-character player — every backfilled account — keeps working
 * unchanged.
 */

import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getOwnedLiveCharacter } from "@/server/characters";

const COOKIE_NAME = "activeCharacterId";
/** Match the identity cookie lifetime — the active slot should outlive sessions. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  };
}

/** Persist the active-character cookie (owner/liveness must already be checked). */
export async function setActiveCharacterCookie(characterId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, characterId, cookieOptions());
}

/** Clear the active-character cookie (e.g. when the active character is deleted). */
export async function clearActiveCharacterCookie(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, "", { ...cookieOptions(), maxAge: 0 });
}

/** Read the raw cookie value without validating it. */
export async function readActiveCharacterCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value || undefined;
}

/**
 * Resolve the current user's active character id, or null if none can be chosen.
 *
 * Honours the cookie only if it still names a live character owned by `userId`.
 * Otherwise applies the single-character fallback (auto-select + persist cookie).
 * Returns null when the account has zero — or more than one — characters and no
 * valid selection (the creation/selection UI must then pick one).
 */
export async function resolveActiveCharacterId(userId: string): Promise<string | null> {
  const cookieValue = await readActiveCharacterCookie();
  if (cookieValue) {
    const owned = await getOwnedLiveCharacter(userId, cookieValue);
    if (owned) return owned.id;
  }

  // Fallback: exactly one live character -> auto-select it.
  const live = await prisma.character.findMany({
    where: { userId, deletedAt: null },
    select: { id: true },
    take: 2, // only need to know if there is exactly one
  });
  if (live.length === 1) {
    await setActiveCharacterCookie(live[0].id);
    return live[0].id;
  }
  return null;
}
