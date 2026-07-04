/**
 * Combat + per-entity engagement (POC update-loop enemy/hero blocks,
 * `updateProjectiles`, `dmgTo`, `spawnBolt`, `onEnemyKilled`).
 *
 * Enemy update is atomic move-OR-attack; hero update is atomic move-THEN-attack,
 * exactly as the POC iterates each entity once. Splitting these into separate
 * "movement" and "combat" passes would shift the engage-threshold crossing by a
 * frame, so they are deliberately kept together here.
 *
 * Variable-dt → fixed-dt: every `*dt` / `-=dt` in the POC becomes `* FIXED_DT`.
 * The POC ran the whole update `speed` times per frame on a (capped) wall-clock
 * dt; we instead run whole fixed steps via the accumulator, so per-second
 * behaviour is preserved (and made frame-rate independent).
 */

import { CONFIG, HERO_TYPES, ENEMY_TYPES } from "@/engine/config";
import { FIXED_DT } from "@/engine/core/loop";
import { clamp } from "@/engine/core/math";
import { heroAtk, heroAtkSpeed } from "@/engine/systems/stats";
import { applyDamage, isHero } from "@/engine/systems/damage";
import { onBossKilled, bossRetreat } from "@/engine/systems/boss";
import {
  aliveHeroes,
  frontHeroX,
  getTargets,
  nearestAliveHero,
  nearestAny,
  nearestTarget,
  nearestWithin,
} from "@/engine/systems/targeting";
import type { Hero, Enemy, Boss, Projectile } from "@/engine/entities";
import type { GameState } from "@/engine/state";

const L = CONFIG.layout;

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

/** Tick hero revive + skill cooldown timers (POC top of update loop). */
export function decayHeroTimers(state: GameState): void {
  for (const h of state.heroes) {
    if (h.dead) {
      h.reviveTimer -= FIXED_DT;
      if (h.reviveTimer <= 0) {
        h.dead = false;
        h.hp = h.maxHp * CONFIG.reviveHpFraction;
      }
    }
    if (h.skillCd > 0) h.skillCd = Math.max(0, h.skillCd - FIXED_DT);
  }
}

// ---------------------------------------------------------------------------
// Enemies: move OR attack
// ---------------------------------------------------------------------------

export function updateEnemies(state: GameState): void {
  const fX = frontHeroX(state);
  // Phase A processes the live enemy list. Boss-phase movement (a single Boss in
  // getTargets) is Phase B and hooks in here alongside this loop.
  for (const e of state.enemies) {
    if (e.behavior === "ranged") {
      const h = nearestAliveHero(state, e.x);
      const dist = h ? Math.abs(e.x - h.x) : Infinity;
      if (dist > e.range) {
        e.x -= e.speed * FIXED_DT;
      } else {
        e.cd -= FIXED_DT;
        if (e.cd <= 0 && h) {
          spawnBolt(state, e, h);
          e.cd = ENEMY_TYPES.ranged.atkSpeed;
        }
      }
    } else {
      const engageX = fX + CONFIG.clash + e.engageOffset;
      if (e.x > engageX) {
        e.x -= e.speed * FIXED_DT;
      } else {
        e.cd -= FIXED_DT;
        if (e.cd <= 0) {
          const h = nearestAliveHero(state, e.x);
          if (h) {
            applyDamage(h, e.atk);
            e.cd = CONFIG.enemyMeleeAtkCd;
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Heroes: move THEN attack
// ---------------------------------------------------------------------------

export function updateHeroes(state: GameState): void {
  const targets = getTargets(state);
  for (const h of state.heroes) {
    if (h.dead) continue;
    const t = HERO_TYPES[h.cls];
    const homeX = state.anchorX + t.offset;

    if (t.attack === "melee") {
      const tgt = nearestWithin(targets, h.x, CONFIG.meleeSeekRange);
      let goalX = homeX;
      if (tgt) {
        const d = tgt.x - h.x;
        goalX =
          Math.abs(d) > CONFIG.meleeStopGap
            ? tgt.x + (d > 0 ? -CONFIG.meleeApproachGap : CONFIG.meleeApproachGap)
            : h.x;
      }
      goalX = clamp(
        goalX,
        homeX - CONFIG.meleeHomeBack,
        Math.min(homeX + CONFIG.meleeLeash, CONFIG.midCap),
      );
      h.x += clamp(goalX - h.x, -CONFIG.heroMove * FIXED_DT, CONFIG.heroMove * FIXED_DT);
    } else {
      const near = nearestAny(targets, h.x);
      let goalX =
        near && Math.abs(near.x - h.x) < CONFIG.kiteDist
          ? h.x - CONFIG.rangedKiteStep
          : homeX;
      goalX = clamp(
        goalX,
        CONFIG.rangedMinX,
        Math.min(homeX + CONFIG.rangedHomeFront, CONFIG.midCap),
      );
      h.x += clamp(goalX - h.x, -CONFIG.heroMove * FIXED_DT, CONFIG.heroMove * FIXED_DT);
    }

    h.cd -= FIXED_DT;
    if (h.cd <= 0) {
      const minD = t.attack === "melee" ? CONFIG.meleeTargetMinD : 0;
      const tgt = nearestTarget(targets, h.x, minD, t.range);
      if (tgt) {
        h.cd = heroAtkSpeed(h.cls, state.upgrades);
        const dmg = heroAtk(h.cls, state.upgrades);
        if (t.attack === "melee") {
          applyDamage(tgt, dmg);
        } else if (t.attack === "arrow") {
          state.projectiles.push({
            id: state.nextId++,
            team: "hero",
            kind: "arrow",
            x: h.x + L.heroProjSpawnXOffset,
            y: L.groundY - L.heroProjSpawnYOffset,
            damage: dmg,
            speed: t.projSpeed,
            targetId: tgt.id,
            tx: 0,
            ty: 0,
            aoe: 0,
          });
        } else {
          state.projectiles.push({
            id: state.nextId++,
            team: "hero",
            kind: "orb",
            x: h.x + L.heroProjSpawnXOffset,
            y: L.groundY - L.heroProjSpawnYOffset,
            damage: dmg,
            speed: t.projSpeed,
            targetId: null,
            tx: tgt.x,
            ty: L.groundY - L.heroProjImpactYOffset,
            aoe: t.aoe,
          });
        }
      }
    }
  }
}

function spawnBolt(state: GameState, e: Enemy, h: Hero): void {
  state.projectiles.push({
    id: state.nextId++,
    team: "enemy",
    kind: "bolt",
    x: e.x - L.boltSpawnXOffset,
    y: L.groundY - L.enemyProjSpawnYOffset,
    damage: e.atk,
    speed: ENEMY_TYPES.ranged.projSpeed,
    targetId: h.id,
    tx: 0,
    ty: 0,
    aoe: 0,
  });
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

function findById(
  state: GameState,
  id: number | null,
): Hero | Enemy | Boss | null {
  if (id == null) return null;
  for (const h of state.heroes) if (h.id === id) return h;
  for (const e of state.enemies) if (e.id === id) return e;
  if (state.boss && state.boss.id === id) return state.boss;
  return null;
}

export function updateProjectiles(state: GameState): void {
  const survivors: Projectile[] = [];
  for (const p of state.projectiles) {
    if (!stepProjectile(state, p)) survivors.push(p);
  }
  state.projectiles = survivors;
}

/** Advance one projectile a step; returns true if it expired (should be culled). */
function stepProjectile(state: GameState, p: Projectile): boolean {
  const list: (Hero | Enemy | Boss)[] =
    p.team === "hero" ? getTargets(state) : aliveHeroes(state);
  const arrive = Math.max(L.projMinStep, p.speed * FIXED_DT);

  if (p.kind === "orb" || p.kind === "meteor") {
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d <= arrive) {
      for (const target of list) {
        if (Math.abs(target.x - p.tx) < p.aoe) applyDamage(target, p.damage);
      }
      return true;
    }
    p.x += (dx / d) * p.speed * FIXED_DT;
    p.y += (dy / d) * p.speed * FIXED_DT;
    return false;
  }

  // Homing (arrow / bolt): dies if its target is gone or down.
  const target = findById(state, p.targetId);
  if (!target || target.hp <= 0 || (isHero(target) && target.dead)) return true;
  const ty =
    p.team === "hero"
      ? L.groundY - L.heroProjImpactYOffset
      : L.groundY - L.enemyProjImpactYOffset;
  const dx = target.x - p.x;
  const dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d <= arrive) {
    applyDamage(target, p.damage);
    return true;
  }
  p.x += (dx / d) * p.speed * FIXED_DT;
  p.y += (dy / d) * p.speed * FIXED_DT;
  return false;
}

// ---------------------------------------------------------------------------
// Deaths / rewards / boss-ready
// ---------------------------------------------------------------------------

export function resolveDeaths(state: GameState): void {
  if (state.phase !== "boss") {
    state.enemies = state.enemies.filter((e) => {
      if (e.hp <= 0) {
        state.kills++;
        state.gold += CONFIG.goldPerKill(state.stage);
        return false;
      }
      return true;
    });
  } else if (state.boss && state.boss.hp <= 0) {
    onBossKilled(state); // gold reward + phase -> victory
  }

  if (
    state.phase === "battle" &&
    !state.bossReady &&
    state.kills >= CONFIG.killGoal(state.stage)
  ) {
    state.bossReady = true;
  }

  // Team wiped during the boss fight -> boss retreats, back to normal waves.
  if (state.phase === "boss" && aliveHeroes(state).length === 0) {
    bossRetreat(state);
  }
}
