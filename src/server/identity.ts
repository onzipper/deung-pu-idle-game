/**
 * Player identity (MVP: anonymous cookie).
 *
 * There is no auth yet. A player is identified by an httpOnly cookie holding a
 * `User.id` (a `cuid()`). The row is created lazily on first save/load. No
 * passwords, no PII — this is deliberately minimal and isolated here so it can
 * be swapped for real auth later without touching save/load or the route.
 *
 * Server-only: reads/writes the outgoing cookie via `next/headers`, so it must
 * run inside a Route Handler / Server Function (not during RSC render).
 */

import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

/** Cookie name holding the anonymous `User.id`. */
const COOKIE_NAME = "dpu_uid";
/** ~1 year — idle saves should outlive short sessions. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    // Cookie is only marked Secure in production; dev is plain http on localhost.
    secure: process.env.NODE_ENV === "production",
  };
}

/**
 * Resolve the current player's `User.id`, creating the row + issuing the cookie
 * on first contact. If the cookie references a user that no longer exists (DB
 * reset, forged value), a fresh user is minted rather than trusting the id.
 */
export async function getOrCreateUserId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME)?.value;

  if (existing) {
    const user = await prisma.user.findUnique({
      where: { id: existing },
      select: { id: true },
    });
    if (user) return user.id;
  }

  const user = await prisma.user.create({ data: {}, select: { id: true } });
  store.set(COOKIE_NAME, user.id, cookieOptions());
  return user.id;
}

/**
 * Repoint the identity cookie at an existing `User.id` (M8 login). The target user
 * must already be resolved/verified by the caller — this only rewrites the cookie.
 */
export async function setUserIdCookie(userId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, userId, cookieOptions());
}

/** Clear the identity cookie (M8 logout). Next visit mints a fresh guest. */
export async function clearUserIdCookie(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, "", { ...cookieOptions(), maxAge: 0 });
}
