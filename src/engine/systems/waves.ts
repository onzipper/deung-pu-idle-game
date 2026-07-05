/**
 * Hunting-field spawn pool (M6 "สนามล่ามอน", combat rework decided 2026-07-05).
 *
 * Replaces the forward-march wave scheduler. Each FARM zone keeps a POOL of up to
 * `maxAlive` mobs alive on its walkable field: they spawn at RANDOM positions
 * across the field, and a killed mob respawns after `respawnDelay`. On zone entry
 * the field BURSTS to full (`spawnBurst`), then trickles one mob per `respawnDelay`.
 *
 * RNG: spawn COMPOSITION + PLACEMENT is exactly what the seeded stream is reserved
 * for, so drawing here is allowed. Draw ORDER per mob is fixed for determinism:
 *   1) kind roll  2) temperament roll  3) x-position roll  4,5) makeEnemy's two
 * draws (initial cd, engage jitter). Mob WANDER + hero HUNT movement draw NOTHING
 * (deterministic id-hashed phase / plain movement) — mid-combat draws stay
 * forbidden. No wall-clock; the respawn timer is a fixed-dt countdown.
 */

import { CONFIG } from "@/engine/config";
import { FIXED_DT } from "@/engine/core/loop";
import { clamp, lerp } from "@/engine/core/math";
import type { Rng } from "@/engine/core/rng";
import { makeEnemy } from "@/engine/entities";
import type { EnemyKind } from "@/engine/entities";
import { zoneAt, type Zone } from "@/engine/systems/world";
import type { GameState } from "@/engine/state";

/** Resolved per-zone spawn parameters (map defaults + the aggro ramp). */
export interface SpawnParams {
  maxAlive: number;
  respawnDelay: number;
  spawnMinX: number;
  spawnMaxX: number;
  /** Probability a spawned mob is AGGRESSIVE (ramps toward the boss room). */
  aggroFraction: number;
  aggroRadius: number;
}

/**
 * Resolve the spawn params for a farm zone: per-map maxAlive/respawnDelay/radius,
 * a spawn band from the zone's `fieldWidth`, and an AGGRESSIVE fraction that ramps
 * linearly across the map's farm zones (index 0 = passive start, last farm before
 * the boss = aggroEnd) so aggression concentrates toward the boss room (GDD).
 */
export function zoneSpawnParams(zone: Zone): SpawnParams {
  const map = CONFIG.world.maps.find((m) => m.id === zone.mapId) ?? CONFIG.world.maps[0];
  const h = map.hunt;
  const stages: readonly number[] = map.zoneStageIds;
  const idx = stages.indexOf(zone.stage);
  const t = stages.length > 1 && idx >= 0 ? idx / (stages.length - 1) : 0;
  return {
    maxAlive: h.maxAlive,
    respawnDelay: h.respawnDelay,
    spawnMinX: map.fieldWidth * CONFIG.hunt.spawnMinXFrac,
    spawnMaxX: map.fieldWidth * CONFIG.hunt.spawnMaxXFrac,
    aggroFraction: clamp(lerp(h.aggroStart, h.aggroEnd, t), 0, 1),
    aggroRadius: h.aggroRadius,
  };
}

/** Roll one mob's kind, stage-gated exactly like the old wave composition. */
function rollMobKind(stage: number, rng: Rng): EnemyKind {
  const r = rng.next();
  const wc = CONFIG.waveComp;
  if (stage >= 1 && r < wc.fastChance) return "fast";
  if (stage >= 2 && r < wc.rangedChanceS2) return "ranged";
  if (stage >= 2 && r < wc.tankChanceS2) return "tank";
  if (stage >= 3 && r < wc.rangedChanceS3) return "ranged";
  return "normal";
}

/** Spawn one mob at a random field position with a rolled kind + temperament. */
function spawnMob(state: GameState, rng: Rng, sp: SpawnParams): void {
  const kind = rollMobKind(state.stage, rng); // draw 1
  const aggressive = rng.next() < sp.aggroFraction; // draw 2
  const x = sp.spawnMinX + rng.next() * (sp.spawnMaxX - sp.spawnMinX); // draw 3
  const e = makeEnemy(state.nextId++, kind, state.stage, 0, rng); // draws 4,5
  e.x = x;
  e.homeX = x;
  e.aggressive = aggressive;
  e.aggroRadius = aggressive ? sp.aggroRadius : 0;
  e.engaged = false;
  state.enemies.push(e);
}

/**
 * Maintain the farm zone's mob pool. On entry (`spawnBurst`) fill to `maxAlive`
 * at once so the field reads as populated immediately; thereafter trickle one mob
 * per `respawnDelay` while below the cap. No-op outside a farm/battle zone, while
 * paused (a test/isolation flag), or with no living hero (mirrors the old
 * hold-fire so a dead hero never wakes into a fresh pile — though `traveling`
 * already short-circuits step() before this runs on a death respawn).
 */
export function updateSpawns(state: GameState, rng: Rng): void {
  if (state.phase !== "battle" || state.spawnPaused) return;
  const zone = zoneAt(state.location);
  if (zone.kind !== "farm") return;
  const sp = zoneSpawnParams(zone);

  if (state.spawnBurst) {
    while (state.enemies.length < sp.maxAlive) spawnMob(state, rng, sp);
    state.spawnBurst = false;
    state.spawnCd = sp.respawnDelay;
    return;
  }

  if (state.enemies.length >= sp.maxAlive) return;
  state.spawnCd -= FIXED_DT;
  if (state.spawnCd <= 0) {
    spawnMob(state, rng, sp);
    state.spawnCd = sp.respawnDelay;
  }
}
