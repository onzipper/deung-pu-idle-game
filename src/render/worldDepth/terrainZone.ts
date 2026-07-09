/**
 * Zone → cosmetic terrain resolver for the promoted "โลกมีมิติ" ground layer —
 * pure math, NO Pixi/DOM (imports only the pure `terrain`/`depthAssign` leaves,
 * the render-safe `zoneGates` config reader, and the `Zone` type).
 *
 * Picks a deterministic terrain preset per farm zone and — crucially — flattens
 * the ground back to EXACTLY `GROUND_Y` around both walk gates, so the hero
 * enters/leaves every zone on level footing (props, gate archways and the
 * boss-door all sit at GROUND_Y) and travel scroll never shows a ground seam.
 *
 * BOSS-ZONE / TOWN DETECTION RULE (documented per the plan): zones carry an
 * explicit `kind` (engine/systems/world.ts `buildZones`: every map is
 * `[town?, farm×N, boss]`). So `kind === "town" || kind === "boss"` → exact
 * flat terrain; only `kind === "farm"` gets a rolling preset. No arena/gate
 * flag lookup is needed — the boss room IS a `kind:"boss"` zone.
 *
 * The flatten envelope: blend ∈ [0,1] = smoothstep of (distance to the NEAREST
 * gate x / GATE_FLATTEN_PX). At a gate (dist 0) blend=0 → the terrain deviation
 * is multiplied to nothing → exactly GROUND_Y; ≥ GATE_FLATTEN_PX from both
 * gates blend=1 → full terrain. The wrapper re-samples `polyline` THROUGH the
 * same envelope so the render polygon matches `groundY` point-for-point.
 */

import { GROUND_Y, WORLD_WIDTH } from "@/render/layout";
import { gateX } from "@/render/environment/zoneGates";
import { createTerrain, type Terrain, type TerrainPresetId } from "./terrain";
import { hashUnit } from "./depthAssign";
import type { Zone } from "@/engine";

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

/** Half-width (px) of the ease from a gate's exact GROUND_Y out to full terrain. */
const GATE_FLATTEN_PX = 90;

/** Preset pool for farm zones, indexed by hashUnit(`mapId:zoneIdx`) — "flat" is
 * intentionally in the pool so a fraction of zones stay level for variety. */
const FARM_PRESETS: readonly TerrainPresetId[] = ["hills", "valley", "plateau", "flat"];

/** Per-zone Terrain cache (render-side; tiny FIFO). Same zone → same instance
 * (zero re-alloc for the per-frame ground sampler). */
const CACHE_CAP = 16;
const cache = new Map<string, Terrain>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Classic smoothstep on an already-[0,1] argument (0 slope at both ends). */
function smoothstep01(t: number): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Wrap a Terrain so its ground eases to exactly GROUND_Y within GATE_FLATTEN_PX
 * of either gate. `polyline` is re-derived from the enveloped `groundY`. */
function flattenAtGates(base: Terrain, gateLeft: number, gateRight: number): Terrain {
  const blendAt = (x: number): number => {
    const dist = Math.min(Math.abs(x - gateLeft), Math.abs(x - gateRight));
    return smoothstep01(dist / GATE_FLATTEN_PX);
  };
  const groundY = (x: number): number => {
    const b = blendAt(x);
    if (b >= 1) return base.groundY(x);
    // b===0 at a gate → (deviation)*0 === 0 → exactly GROUND_Y.
    return GROUND_Y + (base.groundY(x) - GROUND_Y) * b;
  };
  const polyline = (step: number): number[] => {
    const s = Math.max(1, step);
    const pts: number[] = [];
    for (let x = 0; x < WORLD_WIDTH; x += s) pts.push(x, groundY(x));
    pts.push(WORLD_WIDTH, groundY(WORLD_WIDTH));
    return pts;
  };
  return { groundY, polyline };
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** The terrain preset id for a zone — "flat" for town/boss, else a stable
 * hash-picked rolling preset. Exposed for env/debug labeling. */
export function terrainPresetForZone(zone: Zone): TerrainPresetId {
  if (zone.kind === "town" || zone.kind === "boss") return "flat";
  const r = hashUnit(`${zone.mapId}:${zone.zoneIdx}`);
  const idx = Math.min(FARM_PRESETS.length - 1, Math.floor(r * FARM_PRESETS.length));
  return FARM_PRESETS[idx];
}

/** Resolve (and cache) the Terrain for a zone. Town/boss → exact flat; farm →
 * hash-picked preset flattened at both gates. Repeated calls with the same
 * `mapId:zoneIdx` return the SAME Terrain instance. */
export function terrainForZone(zone: Zone): Terrain {
  const key = `${zone.mapId}:${zone.zoneIdx}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let terrain: Terrain;
  if (zone.kind === "town" || zone.kind === "boss") {
    terrain = createTerrain("flat", WORLD_WIDTH);
  } else {
    const base = createTerrain(terrainPresetForZone(zone), WORLD_WIDTH);
    terrain = flattenAtGates(base, gateX(zone.mapId, "left"), gateX(zone.mapId, "right"));
  }

  if (cache.size >= CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, terrain);
  return terrain;
}
