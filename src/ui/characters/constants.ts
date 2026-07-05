/**
 * Client-side mirror of `MAX_LIVE_CHARACTERS` (`@/server/characters`).
 * Duplicated (not imported) for the same reason as `validateName.ts`: that
 * module pulls in `@/lib/db` (Prisma) at module scope, which must never
 * enter a client bundle. This only powers the "hide the create button at 3"
 * UI hint — `POST /api/characters` is the actual, server-enforced limit.
 */
export const MAX_LIVE_CHARACTERS_CLIENT = 3;
