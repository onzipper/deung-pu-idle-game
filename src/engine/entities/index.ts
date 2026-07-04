/**
 * Entity type definitions (data only — behaviour lives in `systems/`).
 *
 * Skeleton to establish shape; fields are filled during the engine port (M1).
 */

export type HeroClass = "swordsman" | "archer" | "mage";
export type EnemyKind = "normal" | "fast" | "tank" | "ranged";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Stats {
  atk: number;
  atkSpeed: number;
  hp: number;
  maxHp: number;
}

export interface Hero {
  id: number;
  cls: HeroClass;
  pos: Vec2;
  stats: Stats;
  /** Remaining cooldown per skill, seconds. */
  skillCooldown: number;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  pos: Vec2;
  stats: Stats;
}

export interface Projectile {
  id: number;
  pos: Vec2;
  vel: Vec2;
  damage: number;
  /** Team that fired it, so we don't friendly-fire. */
  team: "hero" | "enemy";
}
