/**
 * ดินแดนอสูร (ASURA) daily hot-zone — pure day-key derivation, shared by
 * `GameClient.tsx` (queues the `setAsuraHotZone` intent off the server-clock-
 * aligned `serverNowMs()`, same split as `ui/worldBoss/schedule.ts`'s
 * `worldBossPhaseAt`) and `FastTravelPicker.tsx` (a client-clock cosmetic hint —
 * "which zone is hot today" — computed WITHOUT touching engine state, since
 * `asuraHotZoneFor` is a pure `@/engine` export).
 *
 * Mirrors the daily-quest calendar's Asia/Bangkok (UTC+7) day boundary
 * (`src/server/dailyQuests.ts`'s `serverDayFor`, the "server day" precedent) —
 * same fixed-offset floor-division shape, just parameterized over an epoch-ms
 * instant instead of a `Date` (so it stays engine/DOM-free and headlessly
 * testable here, `__tests__/schedule.test.ts`).
 */

const DAILY_TZ_OFFSET_SECONDS = 7 * 3600; // Asia/Bangkok = UTC+7
const SECONDS_PER_DAY = 86400;

/** The integer Asia/Bangkok day-epoch for a given `nowMs` instant — identical
 * shape to `serverDayFor(new Date(nowMs))`, just Date-free. */
export function asuraDayKeyForMs(nowMs: number): number {
  return Math.floor((nowMs / 1000 + DAILY_TZ_OFFSET_SECONDS) / SECONDS_PER_DAY);
}
