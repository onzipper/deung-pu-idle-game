/**
 * Entity type definitions (data only — behaviour lives in `systems/`).
 *
 * Ported to match what the POC actually tracks per entity: flat positions, HP,
 * attack cooldown timers, revive state, and (for projectiles) either a homing
 * target id or a fixed ground-target point. Factories live in `./factory`.
 */

/** Player hero classes (POC: sword / archer / mage). */
export type HeroClass = "swordsman" | "archer" | "mage";

/** Enemy kinds (POC: grunt / runner / tank / shooter). */
export type EnemyKind = "normal" | "fast" | "tank" | "ranged";

/** How a hero deals damage. */
export type AttackKind = "melee" | "arrow" | "aoe";

/** How an enemy engages. */
export type EnemyBehavior = "melee" | "ranged";

/**
 * Projectile flavours.
 *  - arrow / bolt: HOME on a live target id.
 *  - orb / meteor / rainArrow: POINT-target — fall/travel to a fixed (tx,ty) and
 *    resolve as an AoE there. `rainArrow` is one drop of the archer's ARROW RAIN
 *    skill (many small arrows falling from the sky over the enemy cluster); it
 *    reuses the meteor's falling-point mechanic but is a distinct kind so render
 *    can draw a small arrow instead of a meteor.
 */
export type ProjectileKind = "arrow" | "orb" | "meteor" | "bolt" | "rainArrow";

/** Which side fired a projectile / owns an entity. */
export type Team = "hero" | "enemy";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Hero {
  id: number;
  cls: HeroClass;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Attack cooldown timer, seconds until the next attack is allowed. */
  cd: number;
  dead: boolean;
  /** Seconds until revival while `dead`. */
  reviveTimer: number;
  /** Active skill cooldown, seconds (Phase B — decays here already). */
  skillCd: number;
  /**
   * Per-hero level (M5). Starts at 1, capped at `CONFIG.leveling.levelCap`. Grants
   * a small atk/hp bonus that compounds with the upgrade lines. Persisted per hero.
   */
  level: number;
  /** XP banked toward the NEXT level (resets on level-up by `xpToLevel(level)`). */
  xp: number;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  speed: number;
  size: number;
  behavior: EnemyBehavior;
  /** Attack range for ranged behaviour (0 for melee). */
  range: number;
  /** Attack cooldown timer. */
  cd: number;
  /** Per-enemy jitter so melee attackers don't stack on the exact same x. */
  engageOffset: number;
}

/**
 * Boss entity. Populated by `makeBoss` and driven by the boss system in Phase B;
 * kept here so `GameState` and the save/render layers already know its shape.
 */
export interface Boss {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  cd: number;
  skillCd: number;
  /** Slam wind-up timer; > 0 means a telegraphed AoE is incoming. */
  telegraph: number;
  enraged: boolean;
}

export interface Projectile {
  id: number;
  team: Team;
  kind: ProjectileKind;
  x: number;
  y: number;
  damage: number;
  speed: number;
  /** Homing target id (arrow/bolt); null for point-target projectiles. */
  targetId: number | null;
  /** Fixed ground-target point (orb/meteor); unused by homing kinds. */
  tx: number;
  ty: number;
  /** AoE radius (orb/meteor); 0 for single-target projectiles. */
  aoe: number;
}

/** Anything a hero attack / projectile can damage. */
export type CombatTarget = Enemy | Boss;

export * from "@/engine/entities/factory";
