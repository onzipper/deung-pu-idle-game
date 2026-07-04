/**
 * Game state + save schema.
 *
 * `GameState` is the live, per-step simulation state (entities, timers, etc.).
 * `SaveData` is the persisted subset (progress + economy) written to MySQL.
 * They are intentionally different: transient runtime arrays never get saved.
 */

import type { Hero, Enemy, Projectile } from "@/engine/entities";

/** Live simulation state — rebuilt each session, never persisted wholesale. */
export interface GameState {
  time: number;
  stage: number;
  wave: number;
  gold: number;
  heroes: Hero[];
  enemies: Enemy[];
  projectiles: Projectile[];
  /** RNG stream state, so a reload continues deterministically. */
  rngState: number;
}

/**
 * Persisted save shape. Keep this small and JSON-serialisable — it goes into
 * `save_states.data`. Anything derivable from these fields should NOT be stored.
 */
export interface SaveData {
  version: number;
  stage: number;
  gold: number;
  /** Unlocked hero classes. */
  unlocked: string[];
  /** Upgrade levels per stat line. */
  upgrades: { atk: number; speed: number; hp: number };
  /** Server-set wall-clock of last save, for offline idle. */
  lastSeen: number;
}
