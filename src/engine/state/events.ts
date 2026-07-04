/**
 * Per-step EVENT BUFFER — the engine's one-way "what just happened" channel.
 *
 * `GameState.events` is filled during a `step()` (cleared at the very start of
 * each step) and drained by render/audio AFTER the step to drive transient juice
 * (damage numbers, hit flashes, screenshake, SFX, kill pops). It is:
 *
 *  - TRANSIENT: never persisted (`toSaveData` picks only progress/economy),
 *  - ONE-WAY: engine systems never READ it (events flow engine -> outside only),
 *  - DETERMINISTIC: same `(state, dt, input, seed)` produces the same event
 *    stream, so it is safe to leave inside the byte-compared state in tests.
 *
 * Payloads are intentionally tiny (ids, positions, amounts) so pushing one is a
 * single plain-object allocation per game moment.
 */

import type { EnemyKind, HeroClass, ProjectileKind } from "@/engine/entities";
import type { Upgrades } from "@/engine/systems/stats";

/** Which side of the board a damaged target belongs to. */
export type HitTargetKind = "hero" | "enemy" | "boss";

/** What dealt a hit — lets render pick a flavour (weapon vs spell vs slam). */
export type HitSource = "attack" | "skill" | "slam" | "bolt";

/** Upgrade line key (mirrors `keyof Upgrades`). */
export type UpgradeLine = keyof Upgrades;

/**
 * Discriminated union of everything a frame's render/audio layer may want to
 * react to. Discriminant is `type`. Positions are engine (logical) coordinates.
 */
export type GameEvent =
  | {
      type: "hit";
      /** Which board side the victim is on. */
      target: HitTargetKind;
      /** Victim entity id. */
      id: number;
      x: number;
      y: number;
      /** Damage dealt this hit (post-rounding). */
      amount: number;
      source: HitSource;
    }
  | { type: "kill"; kind: EnemyKind; x: number; y: number; goldGained: number }
  | { type: "heroDown"; id: number; cls: HeroClass; x: number; y: number }
  | { type: "heroRevived"; id: number; cls: HeroClass; x: number; y: number }
  | { type: "skillCast"; heroClass: HeroClass; slot: number }
  | { type: "projectileSpawn"; kind: ProjectileKind; x: number; y: number }
  | { type: "bossSlamTelegraph"; x: number; y: number }
  | { type: "bossSlamLand"; x: number; y: number }
  | { type: "bossEnraged"; x: number; y: number }
  | { type: "bossDefeated"; x: number; y: number; goldGained: number }
  | { type: "bossRetreat"; x: number; y: number }
  | { type: "waveSpawn"; wave: number }
  | { type: "stageCleared"; stage: number }
  | { type: "stageAdvanced"; stage: number }
  | { type: "upgradeBought"; line: UpgradeLine; level: number };
