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
import { combatPower } from "@/engine/systems/stats";
import { grantKillXp } from "@/engine/systems/leveling";
import { advanceQuestObjective } from "@/engine/systems/quests";
import { onBossRoomCleared } from "@/engine/systems/world";
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
    state.events.push({ type: "bossEnraged", x: b.x, y: b.y });
  }

  // Slam: winds up (telegraph) then lands an AOE on the whole living team.
  if (b.telegraph > 0) {
    b.telegraph -= FIXED_DT;
    if (b.telegraph <= 0) {
      state.events.push({ type: "bossSlamLand", x: b.x, y: b.y });
      for (const h of aliveHeroes(state)) {
        applyDamage(state, h, Math.round(b.atk * B.slamMult), "slam");
      }
      b.skillCd = b.enraged ? B.slamCdEnraged : B.slamCdNormal;
    }
  } else {
    b.skillCd -= FIXED_DT;
    if (b.skillCd <= 0) {
      b.telegraph = b.enraged ? B.telegraphEnraged : B.telegraphNormal;
      state.events.push({ type: "bossSlamTelegraph", x: b.x, y: b.y });
    }
  }

  // Normal single-target attack on the nearest living hero.
  b.cd -= FIXED_DT;
  if (b.cd <= 0) {
    const h = nearestAliveHero(state, b.x);
    if (h) {
      applyDamage(state, h, b.atk, "attack");
      b.cd = b.enraged ? B.attackCdEnraged : B.attackCdNormal;
    }
  }
}

/** Boss defeated: pay out and flag victory (nextStage is a separate action). */
export function onBossKilled(state: GameState): void {
  const goldGained = CONFIG.goldPerBoss(state.stage);
  state.gold += goldGained;
  // Boss kills grant a larger XP milestone to every alive hero (before payout /
  // phase flip, while the winning team is still on the field).
  grantKillXp(state, CONFIG.leveling.xpPerBossKill(state.stage));
  // Count the boss defeat toward the solo hero's class-change quest (M5 task 5),
  // while the winning hero is still on the field (before the phase flip).
  advanceQuestObjective(state, "killBoss");
  const bx = state.boss?.x ?? 0;
  const by = state.boss?.y ?? 0;
  state.boss = null;
  state.phase = "victory";
  state.events.push({ type: "bossDefeated", x: bx, y: by, goldGained });
  state.events.push({ type: "stageCleared", stage: state.stage });
  // M6 "World & Town": a boss room is the map's gate — beating it unlocks the next
  // MAP's first zone (emits mapUnlocked + zoneUnlocked). No-op for a non-boss-room
  // boss (there are none in M6, but the guard keeps this safe). The player then
  // walks out of the victory via `advanceStage` (-> next map) or backtracks.
  onBossRoomCleared(state);
}

/** Team wiped: boss leaves, revive the team, resume normal waves (retry allowed). */
export function bossRetreat(state: GameState): void {
  state.events.push({
    type: "bossRetreat",
    x: state.boss?.x ?? 0,
    y: state.boss?.y ?? 0,
  });
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
  /** Suggested combat power to attempt the fight (bossHp / divisor). */
  recommendedPower: number;
  /** Current summed team COMBAT POWER (effective DPS + HP, not raw atk). */
  teamPower: number;
  ready: boolean;
}

export function bossHint(state: GameState): BossHint {
  const bossHp = CONFIG.bossHp(state.stage);
  const bossAtk = CONFIG.bossAtk(state.stage);
  const recommendedPower = Math.round(bossHp / CONFIG.bossHintPowerDivisor);
  // teamPower is now sum(combatPower) — effective DPS + survivability — so it no
  // longer under-reads the skill-heavy ranged classes that raw summed atk did
  // (the pivot-handoff flag). Both sides are on the same combat-power scale.
  const teamPower = state.heroes.reduce((sum, h) => sum + combatPower(h), 0);
  return {
    stage: state.stage,
    bossHp,
    bossAtk,
    recommendedPower,
    teamPower,
    ready: teamPower >= recommendedPower,
  };
}
