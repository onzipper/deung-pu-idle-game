/**
 * Deterministic weather scheduler for the promoted "โลกมีมิติ" atmosphere —
 * pure math, NO Pixi/DOM. Decides WHICH weather a zone shows in a given time
 * window; the runtime `weather.ts` layer (pixi) just renders whatever kind this
 * returns. `WeatherKind` is a TYPE-ONLY import from `weather.ts`, so the pixi
 * that module pulls in is fully erased at compile time — this file stays pure.
 *
 * Model: split wall-clock time into fixed WEATHER_WINDOW_MS buckets; hash
 * `zoneKey:window` → a roll; ~NONE_CHANCE of windows are clear ("none"),
 * otherwise pick uniformly from the zone's allowed set (empty set → always
 * "none"). Same window + same zone on every client ⇒ same weather (shared feel,
 * no state, no hash surface). Allowed sets are per-map (real engine map ids:
 * map1-map6 + "asura"); town zones override to a soft rain/leaves set.
 */

import { hashUnit } from "./depthAssign";
import type { Zone } from "@/engine";
import type { WeatherKind } from "./weather";

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

/** One weather window = 20 minutes of wall-clock. */
export const WEATHER_WINDOW_MS = 20 * 60 * 1000;

/** Fraction of windows that are clear sky. Roll < this ⇒ "none". */
const NONE_CHANCE = 0.5;

/** Allowed weather per engine mapId. Empty = that map is always clear.
 * (map2 spooky-forest / map5 desert-ruins read best dry — owner atmosphere.) */
const ALLOWED_BY_MAP: Record<string, readonly WeatherKind[]> = {
  map1: ["rain", "leaves"],
  map2: [],
  map3: ["rain"],
  map4: ["snow"],
  map5: [],
  map6: ["ash"],
  asura: ["ash"],
};

/** Town zones override their map's set to a soft, friendly pair. */
const TOWN_ALLOWED: readonly WeatherKind[] = ["rain", "leaves"];

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** Allowed weather kinds for a zone (town override wins over its map). */
function allowedFor(zone: Zone): readonly WeatherKind[] {
  if (zone.kind === "town") return TOWN_ALLOWED;
  return ALLOWED_BY_MAP[zone.mapId] ?? [];
}

/**
 * The weather kind a zone shows at wall-clock `nowMs` (caller passes Date.now()
 * or a fixed value in tests). Deterministic in (zone, window). ~NONE_CHANCE of
 * windows are "none"; the rest pick uniformly from the zone's allowed set.
 */
export function weatherFor(zone: Zone, nowMs: number): WeatherKind {
  const allowed = allowedFor(zone);
  if (allowed.length === 0) return "none";

  const window = Math.floor(nowMs / WEATHER_WINDOW_MS);
  const roll = hashUnit(`${zone.mapId}:${zone.zoneIdx}:${window}`);
  if (roll < NONE_CHANCE) return "none";

  // Re-normalize the upper (1-NONE_CHANCE) band to [0,1) for a uniform pick.
  const sub = (roll - NONE_CHANCE) / (1 - NONE_CHANCE);
  const idx = Math.min(allowed.length - 1, Math.floor(sub * allowed.length));
  return allowed[idx];
}
