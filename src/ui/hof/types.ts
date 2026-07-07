/**
 * M7.95 "Hall of Fame" — wire/query types for the `/api/hof` route (FROZEN
 * contract, see the task brief). This module is the ONLY place the shape is
 * declared on the UI side; every hof/ file imports from here rather than
 * re-declaring fields, same "wire DTO" convention as `ui/gear/types.ts` /
 * `ui/announcements/types.ts`.
 *
 * `HOF_BOSS_STAGES` is read LIVE off `CONFIG.world.maps` (each map's
 * `bossStageId`) instead of a hand-copied `[5,10,15,20,25,30]` literal — a
 * future map addition never needs a second edit here (footgun #5: absolute
 * constants rot when the anchor design deepens).
 */

import { CONFIG, type HeroClass } from "@/engine";

export type HofBoard = "level" | "power" | "gold" | "boss" | "online";

export type HofClassFilter = "all" | HeroClass;

/** Every map's boss-gate stage, in map order (currently [5,10,15,20,25,30]). */
export const HOF_BOSS_STAGES: readonly number[] = CONFIG.world.maps.map(
  (m) => m.bossStageId,
);

export interface HofQuery {
  board: HofBoard;
  /** Only meaningful when `board === "boss"` — one of `HOF_BOSS_STAGES`. */
  bossStage: number;
  cls: HofClassFilter;
}

/** Read-only paper-doll snapshot for the profile popover. `prestigeTier` is a
 * server-computed cosmetic signal (see the contract doc) — this UI only uses
 * it for an optional aura ring on the profile card header; a 0/absent value
 * simply renders no flourish, it never blocks the rest of the profile. */
export interface HofProfile {
  loadout: { weapon: string | null; armor: string | null };
  refineLevels: { weapon: number; armor: number };
  prestigeTier: number;
}

export interface HofEntry {
  rank: number;
  charName: string;
  cls: HeroClass;
  tier: 1 | 2 | 3;
  level: number;
  /** Per-board value: level=level, power=power, gold=goldEarned,
   * boss=clear-time seconds (lower is better), online=onlineSeconds. */
  value: number;
  /** ISO timestamp of when this stat was recorded. */
  at: string;
  profile: HofProfile;
}

export interface HofMe {
  rank: number;
  value: number;
}

export interface HofResponse {
  top: HofEntry[];
  me: HofMe | null;
}
