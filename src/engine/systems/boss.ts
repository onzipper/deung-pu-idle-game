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
import { makeBoss, makeBossAdd } from "@/engine/entities";
import type { Boss, BossBehavior, BossVarietyState, EnemyKind } from "@/engine/entities";
import { combatPower } from "@/engine/systems/stats";
import { grantKillXp } from "@/engine/systems/leveling";
import {
  advanceQuestObjective,
  isTier3QuestBossFight,
  tier3QuestBossScale,
} from "@/engine/systems/quests";
import { advanceDailyProgress } from "@/engine/systems/dailyQuests";
import { onBossRoomCleared, returnToQuestFrontier } from "@/engine/systems/world";
import { applyDamage } from "@/engine/systems/damage";
import { creditKillGold } from "@/engine/systems/economy";
import { recordBossClear } from "@/engine/systems/hallOfFame";
import { rollBossDrop } from "@/engine/systems/gear";
import { aliveHeroes, frontHeroX, nearestAliveHero } from "@/engine/systems/targeting";
import type { GameState } from "@/engine/state";

const B = CONFIG.boss;

/** Does this boss run mechanic `name`? */
function has(v: BossVarietyState, name: BossBehavior): boolean {
  return v.behaviors.includes(name);
}

/** Begin the boss fight. Precondition (checked by caller): bossReady + battle. */
export function startBossFight(state: GameState): void {
  state.phase = "boss";
  // Stamp the fight-start sim-time (M7.95 HOF): the clear DURATION is `state.time`
  // minus this at the boss's death — deterministic step counting, no wall-clock.
  state.bossFightStart = state.time;
  // M7.9b tier-3 quest boss: while the tier-3 quest is the ACTIVE reason for map4 boss-room
  // access (tier-2 hero, quest held, boss objective pending), the Glacial Sovereign spawns
  // with the softer quest-override scales (a "young" version a tier-2 hero can beat) — same
  // CHARGE behavior/telegraphs, just gentler hp/atk. Null for the REAL s20 boss (tier-3 /
  // post-quest), so it spawns at full bossVariety scale. Keys off quest state, not tier alone.
  state.boss = makeBoss(state.nextId++, state.stage, tier3QuestBossScale(state) ?? undefined);
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
  const v = b.variety;
  const fX = frontHeroX(state);
  const engageX = fX + CONFIG.clash + B.engageExtra;

  // M7.9 CHARGE dash: while committed to a rush the boss is fully occupied — it
  // moves toward the locked target x and resolves the hit on arrival, skipping the
  // normal approach / Slam / attack this step. Only bosses carrying "charge" ever
  // reach the "dash" phase, so classic bosses skip this entirely.
  if (v && v.chargePhase === "dash") {
    updateChargeDash(state, b, v);
    return;
  }

  // Close the distance before doing anything else.
  if (b.x > engageX) {
    b.x -= B.moveSpeed * FIXED_DT;
    return;
  }

  if (!b.enraged && b.hp < b.maxHp * B.enrageThreshold) {
    b.enraged = true;
    state.events.push({ type: "bossEnraged", x: b.x, y: b.y });
  }

  // ---- M7.9 signature mechanics (only fire for a boss that carries them) ----
  // For classic bosses (s5/s10/s15) `behaviors` is ["slam","enrage"], so none of
  // these run and control falls straight through to the unchanged Slam/attack kit
  // below (byte-identical to pre-M7.9).
  if (v) {
    // SUMMON is instantaneous — fire any due add waves, then keep the base kit.
    if (has(v, "summon")) maybeSummon(state, b, v);
    // CHARGE + HAZARD are CHANNELED: if one is winding up / acting this step it
    // consumes the boss's action (Slam + normal attack pause) — return early.
    if (has(v, "charge") && updateChargeWindup(state, b, v)) return;
    if (has(v, "hazard") && updateHazard(state, b, v)) return;
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

// ---------------------------------------------------------------------------
// M7.9 boss-variety mechanics (deterministic — no RNG-stream draws).
// ---------------------------------------------------------------------------

/**
 * CHARGE (map4 s20) — the idle→windup handoff. Returns true if the boss is BUSY
 * charging this step (windup in progress, or a fresh charge just launched), so the
 * caller pauses the Slam/normal-attack kit. The dash itself (once `chargePhase`
 * flips to "dash") is driven by `updateChargeDash` from the top of `updateBoss`.
 */
function updateChargeWindup(state: GameState, b: Boss, v: BossVarietyState): boolean {
  const C = CONFIG.bossBehavior.charge;
  if (v.chargePhase === "windup") {
    v.chargeTimer -= FIXED_DT;
    if (v.chargeTimer <= 0) v.chargePhase = "dash"; // launch next step
    return true; // busy winding up
  }
  // idle: count down toward the next charge; launch when ready.
  v.chargeCd -= FIXED_DT;
  if (v.chargeCd <= 0) {
    const h = nearestAliveHero(state, b.x);
    const targetX = h ? h.x : frontHeroX(state);
    v.chargePhase = "windup";
    v.chargeTimer = C.telegraph;
    v.chargeTargetX = targetX + C.stopGap; // stop just in front of the target
    state.events.push({ type: "bossChargeTelegraph", x: b.x, targetX });
    return true; // busy (windup started)
  }
  return false; // not charging → the base kit runs this step
}

/** CHARGE dash movement + landing hit (the hero sits at lower x than the boss). */
function updateChargeDash(state: GameState, b: Boss, v: BossVarietyState): void {
  const C = CONFIG.bossBehavior.charge;
  const target = v.chargeTargetX;
  const stepDist = C.dashSpeed * FIXED_DT;
  if (b.x - target <= stepDist) {
    // Arrived: snap to the landing point and resolve the heavy hit on every hero
    // within `hitRange`. `min(target, b.x)` guarantees the dash never moves the boss
    // AWAY from the hero when a melee hero has already closed INSIDE the target x
    // (then the boss simply resolves the hit in place); clamped out of the wall.
    b.x = Math.max(Math.min(target, b.x), CONFIG.hunt.heroMinX);
    const dmg = Math.round(b.atk * C.hitMult);
    let connected = false;
    for (const h of aliveHeroes(state)) {
      if (Math.abs(h.x - b.x) <= C.hitRange) {
        applyDamage(state, h, dmg, "slam");
        connected = true;
      }
    }
    state.events.push({ type: "bossChargeHit", x: b.x, connected });
    v.chargePhase = "idle";
    v.chargeCd = b.enraged ? C.cdEnraged : C.cd;
  } else {
    b.x -= stepDist; // rush toward the locked target x
  }
}

/**
 * SUMMON (map5 s25) — fire any add waves whose HP threshold the boss has crossed
 * this step (a `while` so a single big nuke that drops past several thresholds
 * fires them all, in order). Adds are normal Enemy entities pushed into
 * `state.enemies` (pooled render views key by id; the boss-phase target set +
 * `resolveDeaths` reap them). Instantaneous — never pauses the boss's base kit.
 */
function maybeSummon(state: GameState, b: Boss, v: BossVarietyState): void {
  const S = CONFIG.bossBehavior.summon;
  while (v.summonsFired < S.thresholds.length && b.hp <= b.maxHp * S.thresholds[v.summonsFired]) {
    const kinds = S.addKinds;
    for (let i = 0; i < kinds.length; i++) {
      const add = makeBossAdd(state.nextId++, kinds[i] as EnemyKind, state.stage, i);
      const x = b.x - (i + 1) * S.spawnSpacing;
      add.x = x;
      add.homeX = x;
      state.enemies.push(add);
    }
    state.events.push({ type: "bossSummon", x: b.x, count: kinds.length });
    v.summonsFired++;
  }
}

/**
 * FIELD HAZARD (map6 s30) — a telegraphed arena-wide danger channel. WARN window
 * (telegraph) → STRIKE window that ticks damage to EVERY alive hero (position
 * independent). Returns true while channeling (warn or strike) so the boss's Slam
 * + normal attack pause; false when idle (base kit runs, cd counting down).
 */
function updateHazard(state: GameState, b: Boss, v: BossVarietyState): boolean {
  const H = CONFIG.bossBehavior.hazard;
  if (v.hazardPhase === "warn") {
    v.hazardTimer -= FIXED_DT;
    if (v.hazardTimer <= 0) {
      v.hazardPhase = "strike";
      v.hazardTimer = H.duration;
      v.hazardTickTimer = 0;
      v.hazardTicksLeft = Math.max(1, Math.round(H.duration / H.tickInterval));
    }
    return true;
  }
  if (v.hazardPhase === "strike") {
    v.hazardTimer -= FIXED_DT;
    v.hazardTickTimer -= FIXED_DT;
    if (v.hazardTickTimer <= 0 && v.hazardTicksLeft > 0) {
      const dmg = Math.round(b.atk * H.tickMult);
      for (const h of aliveHeroes(state)) applyDamage(state, h, dmg, "slam");
      state.events.push({ type: "bossHazardStrike", x: b.x });
      v.hazardTickTimer = H.tickInterval;
      v.hazardTicksLeft--;
    }
    if (v.hazardTimer <= 0) {
      v.hazardPhase = "idle";
      v.hazardCd = b.enraged ? H.cdEnraged : H.cd;
    }
    return true;
  }
  // idle: count down toward the next hazard channel.
  v.hazardCd -= FIXED_DT;
  if (v.hazardCd <= 0) {
    v.hazardPhase = "warn";
    v.hazardTimer = H.telegraph;
    state.events.push({ type: "bossHazardWarn", x: b.x });
    return true;
  }
  return false;
}

/** Boss defeated: pay out and flag victory (nextStage is a separate action). */
export function onBossKilled(state: GameState): void {
  // M7.9b: capture the quest-boss flag BEFORE advancing the killBoss objective (which
  // flips the flag off). The young Sovereign completes the tier-3 quest + rewards the
  // fight, but must NOT progress the WORLD — it skips the HOF s20 record (its scaled
  // difficulty must not pollute the real-boss best), the guaranteed drop (the real s20
  // gear is earned by the real fight), and the map unlock (the hero still returns to beat
  // the REAL s15 boss for the persisted map4 unlock — see onBossRoomCleared below).
  const questBoss = isTier3QuestBossFight(state);
  // M7.95 HOF: record this boss stage's clear DURATION (fastest kept) before the
  // phase flip. Deterministic — `state.time` less the fight-start stamp (steps ×
  // FIXED_DT). A directly-invoked kill (no startBossFight) has no start -> skip.
  if (state.bossFightStart !== null) {
    if (!questBoss) {
      recordBossClear(state, state.stage, Math.max(0, state.time - state.bossFightStart));
    }
    state.bossFightStart = null;
  }
  const goldGained = CONFIG.goldPerBoss(state.stage);
  creditKillGold(state, goldGained);
  // Boss kills grant a larger XP milestone to every alive hero (before payout /
  // phase flip, while the winning team is still on the field).
  grantKillXp(state, CONFIG.leveling.xpPerBossKill(state.stage));
  // Count the boss defeat toward the solo hero's class-change quest (M5 task 5),
  // while the winning hero is still on the field (before the phase flip).
  advanceQuestObjective(state, "killBoss");
  // M8 Wave A: count toward the "clearAnyBoss" daily (inert until a roster exists). Any
  // boss room cleared counts — a presence objective, so the quest-scaled young Sovereign
  // counts as a boss clear too (no special-case; matches "เคลียร์บอสโซนไหนก็ได้").
  advanceDailyProgress(state, "clearAnyBoss", 1);
  // M7: a boss is a GUARANTEED drop (stateless hash; never the wave RNG). Rolled
  // while the boss is still on the field so the drop position/id are real. The tier-3
  // QUEST boss (young Sovereign) drops nothing — the real s20 gear is earned by the real
  // fight (a scaled practice boss must not be a loot faucet).
  if (!questBoss && state.boss) rollBossDrop(state, state.boss);
  const bx = state.boss?.x ?? 0;
  const by = state.boss?.y ?? 0;
  state.boss = null;
  // M7.9: despawn any boss-summoned adds still alive (render frees their pooled
  // views as the ids disappear). No-op for classic bosses (no adds).
  state.enemies = [];
  state.phase = "victory";
  state.events.push({ type: "bossDefeated", x: bx, y: by, goldGained });
  state.events.push({ type: "stageCleared", stage: state.stage });
  // M6 "World & Town": a boss room is the map's gate — beating it unlocks the next
  // MAP's first zone (emits mapUnlocked + zoneUnlocked). No-op for a non-boss-room
  // boss (there are none in M6, but the guard keeps this safe). The player then
  // walks out of the victory via `advanceStage` (-> next map) or backtracks.
  //
  // M7.9b: the tier-3 QUEST boss (young Sovereign) SKIPS this — beating it completes the
  // quest but never unlocks map5 or persists any map4 progression. The hero evolves to
  // tier 3, then returns to beat the REAL s15 boss, and THAT does the persisted map4
  // unlock; the next (real) s20 fight then unlocks map5 the normal way.
  //
  // M7.95 SOFT-LOCK FIX: the quest boss must ALSO not strand the hero. The killBoss
  // objective advanced above revoked the boss-room access grant this very step, so leaving
  // the hero in the now-illegal boss room on a paused "victory" dead-locks the UI. Resolve
  // the win by warping them back to the frontier field (phase->battle, field respawned) —
  // the completed quest surfaces its reachable "เปลี่ยนคลาส!" evolve affordance there.
  if (questBoss) returnToQuestFrontier(state);
  else onBossRoomCleared(state);
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
