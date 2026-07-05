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

import type {
  EnemyKind,
  HeroClass,
  ProjectileKind,
  StatKey,
  ZoneKind,
} from "@/engine/entities";

/** Which side of the board a damaged target belongs to. */
export type HitTargetKind = "hero" | "enemy" | "boss";

/** What dealt a hit — lets render pick a flavour (weapon vs spell vs slam). */
export type HitSource = "attack" | "skill" | "slam" | "bolt";

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
  | { type: "levelUp"; id: number; cls: HeroClass; level: number }
  | { type: "evolve"; id: number; cls: HeroClass; tier: number }
  | { type: "statAllocated"; id: number; stat: StatKey; amount: number }
  | { type: "skillCast"; heroClass: HeroClass; slot: number; skillId: string }
  | { type: "projectileSpawn"; kind: ProjectileKind; x: number; y: number }
  | { type: "bossSlamTelegraph"; x: number; y: number }
  | { type: "bossSlamLand"; x: number; y: number }
  | { type: "bossEnraged"; x: number; y: number }
  | { type: "bossDefeated"; x: number; y: number; goldGained: number }
  | { type: "bossRetreat"; x: number; y: number }
  | { type: "waveSpawn"; wave: number }
  | { type: "stageCleared"; stage: number }
  | { type: "stageAdvanced"; stage: number }
  // Class-change quest lifecycle (M5 task 5 — for UI + future juice). All carry
  // the solo hero id + the quest id; progress fires ONLY on a real increment.
  | { type: "questAccepted"; id: number; questId: string }
  | {
      type: "questObjectiveProgress";
      id: number;
      questId: string;
      /** Which objective advanced (index into the quest def's objectives). */
      objectiveIndex: number;
      /** New progress count for that objective (post-increment). */
      progress: number;
      /** The objective's target count (for a "n/N" readout). */
      count: number;
    }
  | { type: "questCompleted"; id: number; questId: string }
  // World navigation lifecycle (M6 "World & Town" — for UI + future render juice).
  // One-way like every event; the engine never reads them back.
  | { type: "zoneEntered"; mapId: string; zoneIdx: number; kind: ZoneKind; stage: number }
  | { type: "zoneUnlocked"; mapId: string; zoneIdx: number }
  | { type: "mapUnlocked"; mapId: string }
  | { type: "bossRoomEntered"; mapId: string; stage: number };
