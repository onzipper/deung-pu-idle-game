/**
 * Game state + save schema.
 *
 * `GameState` is the live, per-step simulation state (entities, timers, RNG
 * cursor). `SaveData` is the persisted subset (progress + economy) written to
 * MySQL. They are intentionally different: transient runtime arrays (heroes,
 * enemies, projectiles) are never saved — they are rebuilt from progress on load.
 *
 * M5 Character Pivot: the persisted model is a SINGLE character (chosen class +
 * level/xp/tier); the purchasable upgrade lines are gone. The live `heroes` array
 * is KEPT (it becomes the M8 party engine) but holds exactly one hero.
 */

import { CONFIG } from "@/engine/config";
import { clamp } from "@/engine/core/math";
import { makeHero } from "@/engine/entities";
import type { Hero, Enemy, Boss, Projectile, HeroClass } from "@/engine/entities";
import { heroMaxHp } from "@/engine/systems/stats";
import type { GameEvent } from "@/engine/state/events";
import { SAVE_VERSION } from "@/engine/state/version";

export * from "@/engine/state/events";

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
  /** The player's chosen base class (M5). Drives which hero is spawned. */
  heroClass: HeroClass;
  autoCast: boolean;
  /**
   * Live heroes. Solo gameplay keeps exactly one here (the chosen class); the
   * array + formation machinery is retained for the M8 party of up to `maxHeroes`.
   */
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
  /**
   * Per-step event buffer for render/audio juice. Cleared at the START of each
   * `step()`, filled during the step, drained by the outside layers after it.
   * Deterministic, one-way (engine never reads it), and NEVER persisted.
   */
  events: GameEvent[];
}

/**
 * Persisted save shape. Keep this small and JSON-serialisable — it goes into
 * `save_states.data`. Anything derivable from these fields is NOT stored.
 */
/** The single active character's progression (M5). */
export interface CharacterSave {
  /** Chosen base class. */
  cls: HeroClass;
  level: number;
  xp: number;
  /** Class-advancement tier (1 = base, 2 = evolved). */
  tier: 1 | 2;
}

export interface SaveData {
  version: number;
  stage: number;
  gold: number;
  /** The single active character (M5 — replaces the team's `unlocked`/`heroes`). */
  hero: CharacterSave;
  /** Server-set wall-clock of last save, for offline idle. */
  lastSeen: number;
}

/**
 * (Re)build the live hero(es) for the current `heroClass`, PRESERVING per-hero
 * level/xp/tier across a battlefield reset (a stage advance never wipes
 * progression). Solo: rebuilds the single chosen-class hero. The loop is written
 * to scale back up to a party (M8) — a slot keeps whoever occupied it before.
 */
export function initHeroes(state: GameState): void {
  const prev = state.heroes[0];
  state.heroes = [
    makeHero(
      state.nextId++,
      state.heroClass,
      prev?.level ?? 1,
      prev?.xp ?? 0,
      prev?.tier ?? 1,
    ),
  ];
}

/**
 * Construct a live `GameState` from a seed and (optionally) a loaded save.
 * A save restores stage / gold / chosen class / character progression; the
 * battlefield always starts fresh at wave 0 of the saved stage.
 */
export function initGameState(seed: number, save?: SaveData): GameState {
  const stage = save?.stage ?? 1;
  const heroClass: HeroClass = save?.hero.cls ?? "swordsman";

  const state: GameState = {
    time: 0,
    stage,
    phase: "battle",
    wave: 0,
    kills: 0,
    gold: save?.gold ?? 0,
    heroClass,
    autoCast: false,
    heroes: [],
    enemies: [],
    boss: null,
    projectiles: [],
    anchorX: CONFIG.baseAnchor,
    waveGap: CONFIG.firstWaveGap,
    bossReady: false,
    rngState: seed >>> 0,
    nextId: 1,
    events: [],
  };
  initHeroes(state);
  // Restore per-character level/xp/tier from the save (M5). `initHeroes` built a
  // level-1 hero; overlay the saved progression and re-derive max HP.
  if (save) {
    const h = state.heroes[0];
    h.level = clamp(save.hero.level, 1, CONFIG.leveling.levelCap);
    h.xp = Math.max(0, save.hero.xp);
    h.tier = save.hero.tier === 2 ? 2 : 1;
    h.maxHp = heroMaxHp(h.cls, h.level, h.tier);
    h.hp = h.maxHp;
  }
  return state;
}

/**
 * Serialise a live `GameState` down to the persisted `SaveData` subset — the
 * inverse of `initGameState(seed, save)`. Only progress + economy are kept
 * (transient battlefield arrays rebuild on load). `lastSeen` is server-owned
 * (offline-idle anti-cheat), so it is emitted as 0 for the server to overwrite.
 */
export function toSaveData(state: GameState): SaveData {
  const h = state.heroes[0];
  return {
    version: SAVE_VERSION,
    stage: state.stage,
    gold: state.gold,
    hero: { cls: h.cls, level: h.level, xp: h.xp, tier: h.tier },
    lastSeen: 0,
  };
}
