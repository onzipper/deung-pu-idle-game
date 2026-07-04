/**
 * Offline idle earnings.
 *
 * When a save loads, compute progress earned while the game was closed from the
 * server-stamped `lastSeen`. MUST be capped (anti-cheat: a client clock can't be
 * trusted, and we don't want infinite idle by setting the system clock forward).
 *
 * Runs server-side so `now` is the server's wall-clock, not the client's.
 * Skeleton: real earning rate wired in M3.
 */

import { CONFIG } from "@/engine/config";

const HOUR_MS = 60 * 60 * 1000;

export interface OfflineResult {
  /** Seconds of idle time actually credited (after the cap). */
  creditedSeconds: number;
  /** True if the raw elapsed time exceeded the cap. */
  capped: boolean;
}

export function computeOfflineTime(lastSeen: number, now: number): OfflineResult {
  const capMs = CONFIG.offlineCapHours * HOUR_MS;
  const elapsed = Math.max(0, now - lastSeen);
  const credited = Math.min(elapsed, capMs);
  return {
    creditedSeconds: credited / 1000,
    capped: elapsed > capMs,
  };
}
