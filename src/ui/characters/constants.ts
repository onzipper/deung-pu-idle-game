/**
 * Client-side mirror of `MAX_LIVE_CHARACTERS` (`@/server/characters`).
 * Duplicated (not imported) for the same reason as `validateName.ts`: that
 * module pulls in `@/lib/db` (Prisma) at module scope, which must never
 * enter a client bundle. This only powers the "hide the create button at 4"
 * UI hint — `POST /api/characters` is the actual, server-enforced limit.
 *
 * Ninja wave: 3 -> 4 (docs/ninja-design.md §5 — the 4th slot is reserved for
 * the account-gated ninja class).
 */
export const MAX_LIVE_CHARACTERS_CLIENT = 4;
