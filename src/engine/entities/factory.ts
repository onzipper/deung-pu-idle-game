/**
 * Entity factories — build heroes / enemies / bosses from config with the
 * POC's per-wave / per-stage scaling. Kept free of side effects: callers pass a
 * fresh `id` and (for enemies) the seeded RNG whose stream they own.
 */

import { CONFIG, HERO_TYPES, ENEMY_TYPES } from "@/engine/config";
import type { Rng } from "@/engine/core/rng";
import { heroMaxHp } from "@/engine/systems/stats";
import type { Hero, Enemy, Boss, HeroClass, EnemyKind } from "@/engine/entities";

/**
 * Build a hero at its formation home position, at full HP. `level` / `xp` / `tier`
 * carry per-hero M5 progression forward across stage resets and save loads; they
 * default to a fresh level-1, tier-1 hero.
 */
export function makeHero(
  id: number,
  cls: HeroClass,
  level = 1,
  xp = 0,
  tier: 1 | 2 = 1,
): Hero {
  const t = HERO_TYPES[cls];
  const maxHp = heroMaxHp(cls, level, tier);
  return {
    id,
    cls,
    x: CONFIG.baseAnchor + t.offset,
    y: CONFIG.layout.heroY,
    hp: maxHp,
    maxHp,
    cd: 0,
    dead: false,
    reviveTimer: 0,
    skillCd: 0,
    level,
    xp,
    tier,
  };
}

/**
 * Build an enemy scaled by stage + wave. Consumes exactly two RNG draws
 * (initial attack cd, engage jitter), in that order — see `waves.ts` for how
 * this interleaves with wave-composition draws.
 *
 * `x` is left at 0; the wave spawner positions it.
 */
export function makeEnemy(
  id: number,
  kind: EnemyKind,
  stage: number,
  wave: number,
  rng: Rng,
): Enemy {
  const et = ENEMY_TYPES[kind];
  const wm = 1 + wave * CONFIG.waveHpScale;
  const hp = Math.round(CONFIG.enemyHp(stage) * et.hpMult * wm);
  const atk = Math.round(CONFIG.enemyAtk(stage) * et.atkMult * wm);
  return {
    id,
    kind,
    x: 0,
    y: CONFIG.layout.enemyY,
    hp,
    maxHp: hp,
    atk,
    speed: et.speed,
    size: et.size,
    behavior: et.behavior,
    range: et.range,
    cd: rng.next() * CONFIG.enemyInitialCdJitter,
    engageOffset: rng.next() * CONFIG.enemyEngageJitter,
  };
}

/** Build the stage boss (Phase B wiring; factory ready now). */
export function makeBoss(id: number, stage: number): Boss {
  const hp = CONFIG.bossHp(stage);
  return {
    id,
    x: CONFIG.spawnX,
    y: CONFIG.boss.y,
    hp,
    maxHp: hp,
    atk: CONFIG.bossAtk(stage),
    cd: CONFIG.boss.initialCd,
    skillCd: CONFIG.boss.initialSkillCd,
    telegraph: 0,
    enraged: false,
  };
}
