/**
 * Boss fight (POC `startBossFight` / `updateBoss` / `onBossKilled` /
 * `bossRetreat`) + the hint-panel data helper.
 *
 * Flow, faithful to the POC:
 *  - challenge (only when bossReady) -> phase "boss", spawn boss, clear the
 *    field, revive + full-heal the team so it's a fresh duel.
 *  - the boss walks to engage range, then alternates a single-target hit with a
 *    telegraphed Slam AOE; below `enrageThreshold` it enrages (faster cooldowns).
 *  - boss dies -> gold reward + phase "victory".
 *  - whole team wiped -> boss retreats, back to "battle" so the player can retry.
 *
 * Variable-dt -> fixed-dt as in `combat.ts`.
 */

import { CONFIG } from "@/engine/config";
import { FIXED_DT } from "@/engine/core/loop";
import { makeBoss } from "@/engine/entities";
import { heroAtk } from "@/engine/systems/stats";
import { applyDamage } from "@/engine/systems/damage";
import { aliveHeroes, frontHeroX, nearestAliveHero } from "@/engine/systems/targeting";
import type { GameState } from "@/engine/state";

const B = CONFIG.boss;

/** Begin the boss fight. Precondition (checked by caller): bossReady + battle. */
export function startBossFight(state: GameState): void {
  state.phase = "boss";
  state.boss = makeBoss(state.nextId++, state.stage);
  state.enemies = [];
  // Drop any in-flight enemy projectiles; keep the team's own shots.
  state.projectiles = state.projectiles.filter((p) => p.team === "hero");
  for (const h of state.heroes) {
    h.dead = false;
    h.hp = h.maxHp;
  }
}

/** One fixed step of boss behaviour (movement, slam telegraph, normal attack). */
export function updateBoss(state: GameState): void {
  const b = state.boss;
  if (!b) return;
  const fX = frontHeroX(state);
  const engageX = fX + CONFIG.clash + B.engageExtra;

  // Close the distance before doing anything else.
  if (b.x > engageX) {
    b.x -= B.moveSpeed * FIXED_DT;
    return;
  }

  if (!b.enraged && b.hp < b.maxHp * B.enrageThreshold) {
    b.enraged = true;
  }

  // Slam: winds up (telegraph) then lands an AOE on the whole living team.
  if (b.telegraph > 0) {
    b.telegraph -= FIXED_DT;
    if (b.telegraph <= 0) {
      for (const h of aliveHeroes(state)) {
        applyDamage(h, Math.round(b.atk * B.slamMult));
      }
      b.skillCd = b.enraged ? B.slamCdEnraged : B.slamCdNormal;
    }
  } else {
    b.skillCd -= FIXED_DT;
    if (b.skillCd <= 0) {
      b.telegraph = b.enraged ? B.telegraphEnraged : B.telegraphNormal;
    }
  }

  // Normal single-target attack on the nearest living hero.
  b.cd -= FIXED_DT;
  if (b.cd <= 0) {
    const h = nearestAliveHero(state, b.x);
    if (h) {
      applyDamage(h, b.atk);
      b.cd = b.enraged ? B.attackCdEnraged : B.attackCdNormal;
    }
  }
}

/** Boss defeated: pay out and flag victory (nextStage is a separate action). */
export function onBossKilled(state: GameState): void {
  state.gold += CONFIG.goldPerBoss(state.stage);
  state.boss = null;
  state.phase = "victory";
}

/** Team wiped: boss leaves, revive the team, resume normal waves (retry allowed). */
export function bossRetreat(state: GameState): void {
  state.boss = null;
  state.phase = "battle";
  state.projectiles = state.projectiles.filter((p) => p.team === "hero");
  for (const h of state.heroes) {
    h.dead = false;
    h.hp = h.maxHp;
  }
  state.enemies = [];
  state.waveGap = CONFIG.bossRetreatWaveGap;
  // bossReady stays true — the player can immediately re-challenge.
}

/** Data the POC hint panel showed, computed purely for `ui/` to render. */
export interface BossHint {
  stage: number;
  bossHp: number;
  bossAtk: number;
  /** Suggested team attack power to attempt the fight. */
  recommendedPower: number;
  /** Current summed team attack power. */
  teamPower: number;
  ready: boolean;
}

export function bossHint(state: GameState): BossHint {
  const bossHp = CONFIG.bossHp(state.stage);
  const bossAtk = CONFIG.bossAtk(state.stage);
  const recommendedPower = Math.round(bossHp / CONFIG.bossHintPowerDivisor);
  const teamPower = state.heroes.reduce(
    (sum, h) => sum + heroAtk(h.cls, state.upgrades),
    0,
  );
  return {
    stage: state.stage,
    bossHp,
    bossAtk,
    recommendedPower,
    teamPower,
    ready: teamPower >= recommendedPower,
  };
}
