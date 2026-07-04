/**
 * Game state + save schema.
 *
 * `GameState` is the live, per-step simulation state (entities, timers, RNG
 * cursor). `SaveData` is the persisted subset (progress + economy) written to
 * MySQL. They are intentionally different: transient runtime arrays (heroes,
 * enemies, projectiles) are never saved — they are rebuilt from progress on load.
 */

import { CONFIG, SLOT_ORDER } from "@/engine/config";
import { clamp } from "@/engine/core/math";
import { makeHero } from "@/engine/entities";
import type { Hero, Enemy, Boss, Projectile } from "@/engine/entities";
import type { Upgrades } from "@/engine/systems/stats";
import { SAVE_VERSION } from "@/engine/state/version";

/** High-level flow phase (POC PHASE). Boss/victory transitions land in Phase B. */
export type Phase = "battle" | "boss" | "victory";

/** Live simulation state — rebuilt each session, never persisted wholesale. */
export interface GameState {
  /** Accumulated simulated time in seconds (sum of FIXED_DT steps). */
  time: number;
  stage: number;
  phase: Phase;
  wave: number;
  kills: number;
  gold: number;
  /** Upgrade levels per stat line — the modifier path into `systems/stats`. */
  upgrades: Upgrades;
  autoUpgrade: boolean;
  autoCast: boolean;
  /** Countdown driving the auto-upgrade cadence (POC ticked every 150ms). */
  autoUpgradeTimer: number;
  /** Number of hero slots currently unlocked (1..maxHeroes). */
  heroSlots: number;
  heroes: Hero[];
  enemies: Enemy[];
  boss: Boss | null;
  projectiles: Projectile[];
  /** Formation anchor x the team advances toward. */
  anchorX: number;
  /** Countdown to the next wave spawn. */
  waveGap: number;
  /** True once the kill goal is met and the boss can be challenged. */
  bossReady: boolean;
  /** RNG stream cursor, persisted so a reload continues deterministically. */
  rngState: number;
  /** Monotonic id source for entities/projectiles. */
  nextId: number;
}

/**
 * Persisted save shape. Keep this small and JSON-serialisable — it goes into
 * `save_states.data`. Anything derivable from these fields is NOT stored.
 */
export interface SaveData {
  version: number;
  stage: number;
  gold: number;
  /** Unlocked hero classes (its length drives how many slots init). */
  unlocked: string[];
  /** Upgrade levels per stat line. */
  upgrades: Upgrades;
  /** Server-set wall-clock of last save, for offline idle. */
  lastSeen: number;
}

/** Build a fresh set of heroes for the currently unlocked slots. */
export function initHeroes(state: GameState): void {
  state.heroes = [];
  for (let i = 0; i < state.heroSlots; i++) {
    state.heroes.push(makeHero(state.nextId++, SLOT_ORDER[i], state.upgrades));
  }
}

/**
 * Construct a live `GameState` from a seed and (optionally) a loaded save.
 * A save restores stage / gold / upgrades / unlocked-slot count; the battlefield
 * always starts fresh at wave 0 of the saved stage.
 */
export function initGameState(seed: number, save?: SaveData): GameState {
  const stage = save?.stage ?? 1;
  const upgrades: Upgrades = save
    ? { ...save.upgrades }
    : { atk: 0, speed: 0, hp: 0 };
  const heroSlots = clamp(save ? save.unlocked.length : 1, 1, CONFIG.maxHeroes);

  const state: GameState = {
    time: 0,
    stage,
    phase: "battle",
    wave: 0,
    kills: 0,
    gold: save?.gold ?? 0,
    upgrades,
    autoUpgrade: false,
    autoCast: false,
    autoUpgradeTimer: CONFIG.autoUpgradeInterval,
    heroSlots,
    heroes: [],
    enemies: [],
    boss: null,
    projectiles: [],
    anchorX: CONFIG.baseAnchor,
    waveGap: CONFIG.firstWaveGap,
    bossReady: false,
    rngState: seed >>> 0,
    nextId: 1,
  };
  initHeroes(state);
  return state;
}

/**
 * Serialise a live `GameState` down to the persisted `SaveData` subset.
 *
 * The inverse of `initGameState(seed, save)`: only progress + economy are kept
 * (transient battlefield arrays are rebuilt on load). `unlocked` is derived from
 * the number of unlocked slots via `SLOT_ORDER`. `lastSeen` is a server-owned
 * field — the client cannot be trusted to stamp wall-clock time (offline-idle
 * anti-cheat), so it is emitted as 0 and the server overwrites it on persist.
 */
export function toSaveData(state: GameState): SaveData {
  return {
    version: SAVE_VERSION,
    stage: state.stage,
    gold: state.gold,
    unlocked: SLOT_ORDER.slice(0, state.heroSlots),
    upgrades: { ...state.upgrades },
    lastSeen: 0,
  };
}
