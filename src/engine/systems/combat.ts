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
import { clamp, sign } from "@/engine/core/math";
import {
  heroAtkOf,
  heroAtkSpeedOf,
  heroManaRegenOf,
  heroMaxManaOf,
} from "@/engine/systems/stats";
import { applyDamage, isHero } from "@/engine/systems/damage";
import { grantKillXp } from "@/engine/systems/leveling";
import { advanceQuestObjective } from "@/engine/systems/quests";
import { onBossKilled } from "@/engine/systems/boss";
import { respawnToTown } from "@/engine/systems/world";
import {
  aliveHeroes,
  getTargets,
  nearestAliveHero,
  nearestTarget,
  nearestWithin,
} from "@/engine/systems/targeting";
import type { Hero, Enemy, Boss, Projectile, CombatTarget } from "@/engine/entities";
import type { GameState, HitSource } from "@/engine/state";

const L = CONFIG.layout;

/** The current zone's walkable right edge (M6 "สนามล่ามอน" hero clamp). */
function fieldMaxX(state: GameState): number {
  const map = CONFIG.world.maps.find((m) => m.id === state.location.mapId);
  return map?.fieldWidth ?? 900;
}

/**
 * Nearest alive target to `x` for the hero auto-hunt, tie-broken by the LOWER id
 * so equidistant mobs never make the hero ping-pong between them (deterministic).
 */
function huntTarget(targets: readonly CombatTarget[], x: number): CombatTarget | null {
  let best: CombatTarget | null = null;
  let bd = Infinity;
  for (const target of targets) {
    const d = Math.abs(target.x - x);
    if (d < bd || (d === bd && best !== null && target.id < best.id)) {
      bd = d;
      best = target;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

/**
 * Tick hero revive, per-skill cooldowns, the self ATK buff, and mana regen
 * (M5 "mana + skill framework v2"). Runs at the top of `step()` before skills
 * cast, so a freshly-regenerated point can fund a cast the same step.
 */
export function decayHeroTimers(state: GameState): void {
  // M6: a TOTAL wipe (solo hero down, or a whole party down) revives via the WORLD
  // respawn (dead hero walks home to town -> revives there; see combat.resolveDeaths
  // -> world.respawnToTown). Only a PARTIAL party loss (some heroes still up — the
  // M8 party case) revives IN PLACE here on the per-hero revive timer.
  const totalWipe = aliveHeroes(state).length === 0;
  for (const h of state.heroes) {
    if (h.dead && !totalWipe) {
      h.reviveTimer -= FIXED_DT;
      if (h.reviveTimer <= 0) {
        h.dead = false;
        h.hp = h.maxHp * CONFIG.reviveHpFraction;
        state.events.push({
          type: "heroRevived",
          id: h.id,
          cls: h.cls,
          x: h.x,
          y: h.y,
        });
      }
    }
    // Per-skill cooldowns (M5 skill framework v2).
    for (const id in h.skillCds) {
      if (h.skillCds[id] > 0) h.skillCds[id] = Math.max(0, h.skillCds[id] - FIXED_DT);
    }
    // Self ATK buff (war cry) countdown.
    if (h.atkBuffTimer > 0) {
      h.atkBuffTimer = Math.max(0, h.atkBuffTimer - FIXED_DT);
      if (h.atkBuffTimer === 0) h.atkBuffMult = 1;
    }
    // Mana regen toward the (INT-derived) pool. Refresh the cached max first so a
    // just-allocated INT point is reflected immediately.
    h.maxMana = heroMaxManaOf(h);
    if (h.mana < h.maxMana) {
      h.mana = Math.min(h.maxMana, h.mana + heroManaRegenOf(h) * FIXED_DT);
    } else if (h.mana > h.maxMana) {
      h.mana = h.maxMana;
    }
  }
}

// ---------------------------------------------------------------------------
// Enemies: move OR attack
// ---------------------------------------------------------------------------

/**
 * Idle wander around a mob's spawn point (M6 "สนามล่ามอน"). Deterministic: an
 * id-hashed phase + frequency drive a gentle sine drift — NO RNG draw (the seeded
 * stream is reserved for spawn composition; mid-combat draws stay forbidden).
 */
function wanderMob(state: GameState, e: Enemy): void {
  const hunt = CONFIG.hunt;
  const phase = e.id * 2.399963; // golden-angle-ish spread so mobs desync
  const freq = hunt.wanderFreqBase + ((e.id * 0.618034) % 1) * hunt.wanderFreqSpread;
  const target = e.homeX + Math.sin(state.time * freq + phase) * hunt.wanderAmp;
  e.x += clamp(target - e.x, -hunt.wanderSpeed * FIXED_DT, hunt.wanderSpeed * FIXED_DT);
}

/**
 * Hunt-field enemy behaviour (M6). A mob is either IDLE (wandering its spawn
 * point) or ENGAGED (approaching + attacking the hero on either side of it):
 *  - AGGRESSIVE mobs engage when the hero enters their aggro radius (emit
 *    `mobAggroed`); PASSIVE mobs only engage once HIT (combat.applyDamage /
 *    damage.ts latches `engaged`), never initiating.
 *  - engaged melee closes to `mobContactGap` (+ its jitter) and swings; engaged
 *    ranged closes to its range and fires. No march-model free-hit hacks are
 *    needed — the hero comes TO the mob, so nothing is ever stuck out of reach.
 * Boss phase clears the enemy list, so this loop is a no-op then.
 */
export function updateEnemies(state: GameState): void {
  const hunt = CONFIG.hunt;
  for (const e of state.enemies) {
    const h = nearestAliveHero(state, e.x);
    if (!h) {
      wanderMob(state, e); // no living hero (transient): just drift
      continue;
    }
    if (!e.engaged) {
      if (e.aggressive && Math.abs(e.x - h.x) <= e.aggroRadius) {
        e.engaged = true;
        state.events.push({ type: "mobAggroed", id: e.id, kind: e.kind, x: e.x, y: e.y });
      } else {
        wanderMob(state, e);
        continue;
      }
    }
    if (e.behavior === "ranged") {
      const dist = Math.abs(e.x - h.x);
      if (dist > e.range) {
        e.x += sign(h.x - e.x) * e.speed * FIXED_DT;
      } else {
        e.cd -= FIXED_DT;
        if (e.cd <= 0) {
          spawnBolt(state, e, h);
          e.cd = ENEMY_TYPES.ranged.atkSpeed;
        }
      }
    } else {
      const d = h.x - e.x;
      if (Math.abs(d) > hunt.mobContactGap + e.engageOffset) {
        e.x += sign(d) * e.speed * FIXED_DT;
      } else {
        e.cd -= FIXED_DT;
        if (e.cd <= 0) {
          applyDamage(state, h, e.atk, "attack");
          e.cd = CONFIG.enemyMeleeAtkCd;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Heroes: move THEN attack
// ---------------------------------------------------------------------------

export function updateHeroes(state: GameState): void {
  const hunt = CONFIG.hunt;
  const targets = getTargets(state);
  const minX = hunt.heroMinX;
  const maxX = fieldMaxX(state) - hunt.fieldRightMargin;
  for (const h of state.heroes) {
    if (h.dead) continue;
    const t = HERO_TYPES[h.cls];

    // AUTO-HUNT (M6 "สนามล่ามอน"): walk to the nearest alive target (deterministic
    // id tie-break) and stop at attack range — melee closes to contact, ranged
    // holds at a standoff and kites if the target crowds it. No formation anchor /
    // forward march: the hero goes to the mob wherever it is on the field. Aggro-ed
    // mobs coming AT the hero are just targets that arrive early. The multi-actor
    // machinery is retained for M8 — each party member hunts independently here, and
    // the per-class `offset` (formation spacing) is preserved in config for it.
    const hntTgt = huntTarget(targets, h.x);
    let goalX = h.x;
    if (hntTgt) {
      const d = hntTgt.x - h.x;
      const dist = Math.abs(d);
      const dir = sign(d) || 1;
      if (t.attack === "melee") {
        goalX = dist > hunt.contactGap ? hntTgt.x - dir * hunt.meleeApproachGap : h.x;
      } else {
        const standoff = t.range * hunt.rangedStandoffFrac;
        if (dist > standoff)
          goalX = hntTgt.x - dir * standoff; // close in to firing range
        else if (dist < CONFIG.kiteDist)
          goalX = h.x - dir * CONFIG.rangedKiteStep; // crowded: step back
        // else hold and fire
      }
    }
    goalX = clamp(goalX, minX, maxX);
    h.x += clamp(goalX - h.x, -hunt.huntSpeed * FIXED_DT, hunt.huntSpeed * FIXED_DT);

    h.cd -= FIXED_DT;
    if (h.cd <= 0) {
      // Melee retaliates against the nearest foe within its range on EITHER side
      // (symmetric |Δx| ≤ range) so a monster in melee contact is never a free
      // hitter — replaces the POC's asymmetric [meleeTargetMinD, range] window that
      // left an 80–96px blind spot behind him ("มอนตีดาบฟรี"). Ranged stays forward
      // only (nearestTarget with minD 0).
      const tgt =
        t.attack === "melee"
          ? nearestWithin(targets, h.x, t.range)
          : // Ranged heroes fire FORWARD by default (nearestTarget, minD 0). But if
            // NOTHING is forward-in-range they must not idle while an enemy is actively
            // engaging the party from their flank/behind — fall back to the nearest foe
            // within range on EITHER side so the whole team answers a live threat (BUG 2:
            // "ranged heroes stand idle while the melee hero is free-hit"). Only the
            // otherwise-idle case changes, so normal nearest-forward selection — and its
            // balance pacing — is unchanged.
            (nearestTarget(targets, h.x, 0, t.range) ??
            nearestWithin(targets, h.x, t.range));
      if (tgt) {
        h.cd = heroAtkSpeedOf(h);
        const dmg = heroAtkOf(h);
        if (t.attack === "melee") {
          applyDamage(state, tgt, dmg, "attack");
        } else if (t.attack === "arrow") {
          // Basic-attack VOLLEY (86d3k2rgf): fire `archerVolleyCount` small arrows
          // at the SAME target. Damage is split as a float — per-arrow = dmg /
          // count, and the LAST arrow carries `dmg - per*(count-1)` so the volley
          // sums BIT-EXACTLY to the old single-arrow `dmg` (Sterbenz makes that
          // remainder exact for a ~1/3 split). Offsets come from a FIXED table —
          // NO RNG draw here (the seeded stream is reserved for wave composition).
          const count = CONFIG.archerVolleyCount;
          const per = dmg / count;
          for (let i = 0; i < count; i++) {
            const off = CONFIG.archerVolleyOffsets[i];
            const arrowDmg = i === count - 1 ? dmg - per * (count - 1) : per;
            const px = h.x + L.heroProjSpawnXOffset + off.dx;
            const py = L.groundY - L.heroProjSpawnYOffset + off.dy;
            state.projectiles.push({
              id: state.nextId++,
              team: "hero",
              kind: "arrow",
              x: px,
              y: py,
              damage: arrowDmg,
              speed: t.projSpeed * off.speedMult,
              targetId: tgt.id,
              tx: 0,
              ty: 0,
              aoe: 0,
            });
            state.events.push({ type: "projectileSpawn", kind: "arrow", x: px, y: py });
          }
        } else {
          const px = h.x + L.heroProjSpawnXOffset;
          const py = L.groundY - L.heroProjSpawnYOffset;
          state.projectiles.push({
            id: state.nextId++,
            team: "hero",
            kind: "orb",
            x: px,
            y: py,
            damage: dmg,
            speed: t.projSpeed,
            targetId: null,
            tx: tgt.x,
            ty: L.groundY - L.heroProjImpactYOffset,
            aoe: t.aoe,
          });
          state.events.push({ type: "projectileSpawn", kind: "orb", x: px, y: py });
        }
      }
    }
  }
}

function spawnBolt(state: GameState, e: Enemy, h: Hero): void {
  const px = e.x - L.boltSpawnXOffset;
  const py = L.groundY - L.enemyProjSpawnYOffset;
  state.projectiles.push({
    id: state.nextId++,
    team: "enemy",
    kind: "bolt",
    x: px,
    y: py,
    damage: e.atk,
    speed: ENEMY_TYPES.ranged.projSpeed,
    targetId: h.id,
    tx: 0,
    ty: 0,
    aoe: 0,
  });
  state.events.push({ type: "projectileSpawn", kind: "bolt", x: px, y: py });
}

/** Map a projectile kind to the `hit`-event source flavour it lands with. */
function projHitSource(kind: Projectile["kind"]): HitSource {
  if (kind === "bolt") return "bolt";
  if (kind === "meteor" || kind === "rainArrow") return "skill";
  return "attack";
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

function findById(state: GameState, id: number | null): Hero | Enemy | Boss | null {
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

  if (p.kind === "orb" || p.kind === "meteor" || p.kind === "rainArrow") {
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d <= arrive) {
      const src = projHitSource(p.kind);
      for (const target of list) {
        if (Math.abs(target.x - p.tx) < p.aoe) applyDamage(state, target, p.damage, src);
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
    applyDamage(state, target, p.damage, projHitSource(p.kind));
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
        const goldGained = CONFIG.goldPerKill(state.stage);
        state.gold += goldGained;
        // Every alive hero banks kill XP (dead heroes earn nothing).
        grantKillXp(state, CONFIG.leveling.xpPerKill(state.stage));
        state.events.push({
          type: "kill",
          kind: e.kind,
          x: e.x,
          y: e.y,
          goldGained,
        });
        // Count the kill toward the solo hero's class-change quest (M5 task 5).
        advanceQuestObjective(state, "kill");
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

  // Death -> respawn in TOWN (M6 "World & Town"; GDD: dead hero = respawn in town,
  // no penalty). Covers BOTH a farm-zone wipe and a boss-room wipe (replacing the
  // old in-place solo revive AND the boss retreat): the field is cleared, the dead
  // hero walks home to town over `heroReviveTime` (unchanged death cost), revives
  // there, then (toggle-gated) auto-returns to the last farm zone — see
  // world.respawnToTown / arriveAtZone. `!state.traveling` makes this fire ONCE
  // (respawnToTown sets `traveling`, and the next steps only tick the walk). Kills
  // banked toward a zone/quest are kept (no progress penalty).
  if (aliveHeroes(state).length === 0 && !state.traveling) {
    respawnToTown(state);
  }
}
