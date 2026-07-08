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

import { CONFIG, HERO_TYPES, ENEMY_TYPES, EVADE_TUNING, type HeroType } from "@/engine/config";
import { FIXED_DT } from "@/engine/core/loop";
import { clamp, sign } from "@/engine/core/math";
import { dsin, dhypot } from "@/engine/core/dmath";
import {
  heroAtkOf,
  heroAtkSpeedOf,
  heroManaRegenOf,
  heroMaxManaOf,
} from "@/engine/systems/stats";
import { applyDamage, applyAoeDamage, damageInRadius, isHero } from "@/engine/systems/damage";
import { dashHeroTo } from "@/engine/systems/dash";
import { rollEnemyDrop } from "@/engine/systems/gear";
import { creditKillGold } from "@/engine/systems/economy";
import { grantKillXp } from "@/engine/systems/leveling";
import { advanceQuestObjective } from "@/engine/systems/quests";
import { advanceDailyProgress } from "@/engine/systems/dailyQuests";
import { onBossKilled } from "@/engine/systems/boss";
import { respawnToTown } from "@/engine/systems/world";
import {
  aliveHeroes,
  getTargets,
  nearestAliveHero,
  nearestTarget,
  nearestWithin,
} from "@/engine/systems/targeting";
import type { Hero, Enemy, Boss, Projectile, CombatTarget, ManualCommand } from "@/engine/entities";
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

/**
 * TARGET-SPREAD (M8 "party feel pack") — nearest alive target whose id is NOT already
 * CLAIMED by a lower-index hero this step, tie-broken by lower id (same determinism as
 * `huntTarget`). Returns null when every target is claimed (the caller then falls back to
 * plain `huntTarget` = sharing). Lets a cohort fan out over a farm field instead of all
 * dog-piling the single nearest mob (the "มอนไม่พอแบ่ง" starvation flag). Only ever used in
 * the multi-hero, non-boss, no-engaged-boss case — solo / boss / world-boss keep `huntTarget`.
 */
function nearestUnclaimed(
  targets: readonly CombatTarget[],
  x: number,
  claimed: ReadonlySet<number>,
): CombatTarget | null {
  let best: CombatTarget | null = null;
  let bd = Infinity;
  for (const target of targets) {
    if (claimed.has(target.id)) continue;
    const d = Math.abs(target.x - x);
    if (d < bd || (d === bd && best !== null && target.id < best.id)) {
      bd = d;
      best = target;
    }
  }
  return best;
}

/**
 * The x a hero WALKS toward to engage `tgt`: melee closes to `contactGap` (stopping
 * `meleeApproachGap` short), ranged holds at its standoff (kites back if crowded).
 * Shared by AUTO-HUNT (systems/combat.updateHeroes) and a MANUAL attack command
 * (M7.8) so both approach identically — the auto path is byte-for-byte unchanged.
 */
function approachGoalX(h: Hero, t: HeroType, tgt: CombatTarget): number {
  const hunt = CONFIG.hunt;
  const d = tgt.x - h.x;
  const dist = Math.abs(d);
  const dir = sign(d) || 1;
  if (t.attack === "melee") {
    return dist > hunt.contactGap ? tgt.x - dir * hunt.meleeApproachGap : h.x;
  }
  const standoff = t.range * hunt.rangedStandoffFrac;
  if (dist > standoff) return tgt.x - dir * standoff; // close in to firing range
  // Crowded: SERVO back to a fixed target-relative kite distance, mirroring the
  // approach branch above. The old form (`h.x - dir*rangedKiteStep`) was a fixed
  // LUNGE relative to the hero's OWN position: when a chasing mob stabilised at
  // exactly `kiteDist`, the hero over-shot ~2.9px past the threshold, held 2 frames
  // while the mob closed the gap, then lunged again — a 20Hz stop-start STUTTER
  // ("ตัวเด้ง ๆ"). Anchoring the goal to `tgt.x` (like the approach standoff) makes
  // the hero glide to hold exactly `kiteDist`: the per-step move-clamp tracks the
  // mob's slower approach continuously, so no dead-zone chatter at the boundary.
  if (dist < CONFIG.kiteDist) return tgt.x - dir * CONFIG.kiteDist; // crowded: hold at kite distance
  return h.x; // hold and fire
}

/** A live (hp > 0) target with `id` in `list`, or null — the manual attack lookup. */
function findAliveTargetIn(list: readonly CombatTarget[], id: number): CombatTarget | null {
  for (const t of list) if (t.id === id && t.hp > 0) return t;
  return null;
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
  const target = e.homeX + dsin(state.time * freq + phase) * hunt.wanderAmp;
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

/**
 * Targets `hero` MAY hunt/attack this step (M6.6 "autoHunt toggle"). With the
 * PER-HERO toggle ON (default) or during the boss phase, every current target is fair
 * game (unchanged behaviour). With it OFF outside the boss phase, the hero must not
 * acquire NEW targets — no chasing, no initiating on idle/passive mobs — but an enemy
 * already `engaged` (aggro-triggered or retaliating after a hit) stays a valid target,
 * so the hero fights off its current attackers then stands idle. `getTargets` returns
 * plain `state.enemies` whenever phase !== "boss", so this filter only ever touches
 * `Enemy`s (never the boss).
 *
 * M8 party P1b: the toggle is now `hero.config.autoHunt` (was the global `state.autoHunt`)
 * so each cohort member hunts independently. Solo mirrors the global onto heroes[0].config
 * — a 1-hero run is byte-identical (same list, same order). Computed per hero (≤3) each step.
 */
function huntableTargetsFor(state: GameState, hero: Hero): CombatTarget[] {
  if (hero.config.autoHunt || state.phase === "boss") return getTargets(state);
  return state.enemies.filter((e) => e.engaged);
}

/**
 * DASH-EVADE direction pick (NINJA FEEL RETUNE) — which way to blink OUT of a swarm.
 * Escapes toward the side (relative to the hero) holding FEWER engaged enemies within
 * `radius`; on a tie, away from the NEAREST engaged enemy. Fully deterministic (a pure
 * count + min over shared state; ≤ id-order is irrelevant since only the side sign matters,
 * and the nearest tie-break uses `<` so the first-seen nearest wins stably). Returns -1
 * (blink left) or +1 (blink right).
 */
function pickEvadeDir(state: GameState, h: Hero, radius: number): -1 | 1 {
  let left = 0;
  let right = 0;
  let nearest = Infinity;
  let nearestSide: -1 | 1 = 1;
  for (const e of state.enemies) {
    if (e.hp <= 0 || !e.engaged) continue;
    const dx = e.x - h.x;
    const ad = Math.abs(dx);
    if (ad <= radius) {
      if (dx < 0) left++;
      else right++;
    }
    if (ad < nearest) {
      nearest = ad;
      nearestSide = dx <= 0 ? -1 : 1;
    }
  }
  if (left < right) return -1; // fewer foes to the left → escape left
  if (right < left) return 1;
  // Tie (or no engaged foe found): flee AWAY from the nearest engaged enemy.
  return nearestSide <= 0 ? 1 : -1;
}

/**
 * DASH-EVADE ("แนวๆ นินจา" auto swarm-escape, per-class `EVADE_TUNING`) — when an AUTO-play hero
 * of a `dashEvade` class (ninja / archer) is SWARMED under pressure, blink OUT of the crowd toward
 * its clear side, then let the normal auto-hunt (and, for the archer, the kite servo) re-engage
 * next steps. Returns true if it dashed (the caller then SKIPS this step's approach-walk so the
 * hero doesn't immediately walk back in). The archer reads a tighter/higher-reach block than the
 * ninja (emergency escape vs belt-dweller relief) — see `EVADE_TUNING`.
 *
 * DETERMINISTIC: no RNG, no wall-clock. The three transient counters (`evadeCd` cooldown +
 * the `evadeHpMark`/`evadeMarkCd` damage-window) are ticked here by fixed dt and are a pure
 * function of shared hp/enemy state, so they evolve identically on every lockstep client
 * (see the Hero doc for why they are hash-excluded). Called ONLY for a `dashEvade` class and
 * ONLY when no manual command is active (manual + boss forced-combat keep priority upstream).
 */
function tryDashEvade(state: GameState, h: Hero): boolean {
  const ev = EVADE_TUNING[h.cls];
  if (!ev) return false; // no tuning for this class → never evades (defensive; dashEvade gate above)
  // Cooldown tick.
  if (h.evadeCd > 0) h.evadeCd = Math.max(0, h.evadeCd - FIXED_DT);
  // Damage-window: measure hp lost since the last snapshot, THEN roll the window if due.
  const lostFrac = (h.evadeHpMark - h.hp) / h.maxHp;
  if (h.evadeMarkCd > 0) h.evadeMarkCd = Math.max(0, h.evadeMarkCd - FIXED_DT);
  if (h.evadeMarkCd <= 0) {
    h.evadeHpMark = h.hp;
    h.evadeMarkCd = ev.hpWindowSec;
  }
  if (h.evadeCd > 0) return false; // still recovering from the last evade
  // Swarm measure: engaged enemies crowding the hero.
  let swarm = 0;
  for (const e of state.enemies) {
    if (e.hp > 0 && e.engaged && Math.abs(e.x - h.x) <= ev.radius) swarm++;
  }
  if (swarm < ev.minEnemies) return false;
  // Pressure: low hp OR a recent burst of damage.
  if (h.hp / h.maxHp >= ev.hpFrac && lostFrac < ev.hpLossFrac) return false;
  // FIRE: blink to the clear side. Pass a far target in that direction so `dashHeroTo`'s
  // maxReach cap produces a clean directional hop (clamped to the walkable field there).
  const dir = pickEvadeDir(state, h, ev.radius);
  dashHeroTo(state, h, h.x + dir * (ev.maxReach + CONFIG.ninja.dashLandGap + 1), ev.maxReach);
  h.evadeCd = ev.cooldownSec;
  h.evadeHpMark = h.hp; // reset the damage window after slipping out
  h.evadeMarkCd = ev.hpWindowSec;
  return true;
}

export function updateHeroes(state: GameState): void {
  const hunt = CONFIG.hunt;
  // Manual attack commands (M7.8) resolve against the FULL target list (not the
  // AUTO-off-filtered per-hero huntable set) so a tapped passive/idle mob is engageable
  // even with auto-hunt off. Empty during the boss phase — commands are ignored there
  // (boss forced-combat overrides them, exactly like the AUTO-off toggle).
  const bossPhase = state.phase === "boss";
  const commandTargets = bossPhase ? [] : getTargets(state);
  const minX = hunt.heroMinX;
  const maxX = fieldMaxX(state) - hunt.fieldRightMargin;

  // TARGET-SPREAD + BOSS DOG-PILE (M8 "party feel pack", owner "แต่มีบอส ทุกคนต้องรุม"). Only a
  // MULTI-HERO cohort spreads — solo keeps plain `huntTarget` (byte-identical). A boss ALWAYS
  // pulls the WHOLE party: the stage/quest-boss phase (`bossPhase`) clears the enemy list so all
  // heroes already target the boss, and an ENGAGED world boss (passive-until-hit → hp < maxHp)
  // is a `forcedBoss` every auto hero converges on, EXEMPT from the claim/spread (claimable by
  // all). Spread applies ONLY to ordinary farm mobs with no engaged boss present.
  const multi = state.heroes.length > 1;
  const wb = state.worldBoss;
  const forcedBoss: CombatTarget | null =
    multi && !bossPhase && wb && wb.active && wb.entity && wb.entity.hp < wb.entity.maxHp
      ? wb.entity
      : null;
  // The world-boss id is NEVER claimed even before it engages (a boss is everyone's target).
  const wbId = wb && wb.active && wb.entity ? wb.entity.id : null;
  const allowSpread = multi && !bossPhase && !forcedBoss;
  const claimed: Set<number> | null = allowSpread ? new Set<number>() : null;

  for (const h of state.heroes) {
    if (h.dead) continue;
    const t = HERO_TYPES[h.cls];
    // Per-hero huntable set (M8 party P1b) — each hero honours its own autoHunt config.
    const targets = huntableTargetsFor(state, h);

    // MANUAL command (M7.8 "Manual Play") takes priority over auto-hunt, unless the
    // boss phase is forcing combat (then commands are ignored — see `bossPhase`).
    // `manualActive` suppresses this step's auto-hunt movement + target acquisition;
    // `atkTgt` (set only by an in-range attack command) drives the swing below.
    let goalX = h.x;
    let atkTgt: CombatTarget | null = null;
    // aimTarget: what the hero FACES this step (render observer, `hero.aimX`).
    // Set to whatever it is ENGAGING — the attack target, else the target it is
    // walking to close on — so facing tracks the foe even while a ranged hero
    // KITES the other way. A `move` command (merely walking) leaves it null so
    // the renderer faces the movement direction instead. See `Hero.aimX`.
    let aimTarget: CombatTarget | null = null;
    let manualActive = false;
    if (!bossPhase && h.command) {
      const cmd: ManualCommand = h.command;
      if (cmd.kind === "move") {
        // Walk to x, IGNORING huntable targets (no attacking; aggro is unchanged —
        // engaged mobs keep hitting the hero). Arrival within `arriveEps` COMPLETES
        // the command; this step then falls through to auto-hunt (AUTO on) / idle.
        if (Math.abs(h.x - cmd.x) <= CONFIG.manual.arriveEps) {
          h.command = null;
        } else {
          goalX = cmd.x;
          manualActive = true;
        }
      } else {
        // Attack a specific target: close to range + fight it until it dies (target
        // gone -> command complete) or the command is cancelled/replaced. Overrides
        // the auto/hunt target selection.
        const ct = findAliveTargetIn(commandTargets, cmd.targetId);
        if (!ct) {
          h.command = null; // dead / despawned -> complete
        } else {
          goalX = approachGoalX(h, t, ct);
          if (Math.abs(ct.x - h.x) <= t.range) atkTgt = ct;
          // Face the commanded target throughout (even while still approaching).
          aimTarget = ct;
          manualActive = true;
        }
      }
    }

    // DASH-EVADE (NINJA FEEL RETUNE): a swarmed `dashEvade` hero on AUTO blinks OUT of the
    // crowd this step and SKIPS its approach-walk (so it doesn't immediately step back in).
    // Only when no manual command is active — manual moveTo/attackTarget and boss forced-combat
    // keep priority (both leave `manualActive` false only in the auto/boss cases, and a real
    // manual command sets it true, suppressing the evade). Byte-identical for non-dashEvade
    // classes (the `t.dashEvade` guard is false → tryDashEvade never runs, counters untouched).
    let evaded = false;
    if (!manualActive && t.dashEvade) {
      evaded = tryDashEvade(state, h);
    }

    if (!manualActive && !evaded) {
      // AUTO-HUNT (M6 "สนามล่ามอน"): walk to the nearest alive target (deterministic
      // id tie-break) and stop at attack range — melee closes to contact, ranged
      // holds at a standoff and kites if the target crowds it. No formation anchor /
      // forward march: the hero goes to the mob wherever it is on the field. Aggro-ed
      // mobs coming AT the hero are just targets that arrive early. The multi-actor
      // machinery is retained for M8 — each party member hunts independently here, and
      // the per-class `offset` (formation spacing) is preserved in config for it.
      // Pick the approach target: everyone dog-piles a forced boss; else a cohort fans out
      // over UNCLAIMED farm mobs (sharing when all are claimed / fewer mobs than heroes); solo
      // + boss keep plain nearest (`claimed` null → byte-identical). Claiming the chosen mob
      // reserves it from lower-index... i.e. from HIGHER-index heroes later this step. The world
      // boss is never claimed (a boss belongs to all heroes at once).
      // Spread only MELEE approach: melee heroes physically CONVERGE on a mob's position, so
      // dog-piling one mob is the visible "มอนไม่พอแบ่ง" bunching. RANGED heroes fire from a
      // standoff and barely move, so forcing them onto a farther unclaimed mob only adds travel
      // (measured: it dropped archer throughput) for no gain on a spawn-rate-capped field —
      // they keep plain nearest (byte-identical to pre-spread) and do not claim.
      let hntTgt: CombatTarget | null;
      if (forcedBoss) {
        hntTgt = forcedBoss;
      } else if (claimed && t.attack === "melee") {
        hntTgt = nearestUnclaimed(targets, h.x, claimed) ?? huntTarget(targets, h.x);
        if (hntTgt && hntTgt.id !== wbId) claimed.add(hntTgt.id);
      } else {
        hntTgt = huntTarget(targets, h.x);
      }
      goalX = hntTgt ? approachGoalX(h, t, hntTgt) : h.x;
      // Melee retaliates against the nearest foe within its range on EITHER side
      // (symmetric |Δx| ≤ range) so a monster in melee contact is never a free
      // hitter — replaces the POC's asymmetric [meleeTargetMinD, range] window that
      // left an 80–96px blind spot behind him ("มอนตีดาบฟรี"). Ranged stays forward
      // only (nearestTarget with minD 0).
      atkTgt =
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
      // Forced-boss dog-pile: focus-FIRE the engaged world boss when it's in reach (melee
      // symmetric, ranged forward), so the party gangs it instead of peeling to farm mobs;
      // still retaliate to a threat while closing (atkTgt keeps its normal value out of reach).
      if (forcedBoss) {
        const d = forcedBoss.x - h.x;
        const inReach = t.attack === "melee" ? Math.abs(d) <= t.range : d >= 0 && d <= t.range;
        if (inReach) atkTgt = forcedBoss;
      }
      // Face the foe being fired at, else the one being approached — so a kiting
      // ranged hero faces (and shoots) its target while retreating. Boss phase
      // routes here too (the boss is in `targets`), so boss fights are covered. A forced
      // boss is always FACED (the whole party orients on it even while approaching).
      aimTarget = forcedBoss ?? atkTgt ?? hntTgt;
    }

    // Publish this step's combat aim (render-only facing). Null when not engaging
    // anything (idle / walking a move order) -> renderer holds/uses velocity.
    h.aimX = aimTarget ? aimTarget.x : null;

    goalX = clamp(goalX, minX, maxX);
    h.x += clamp(goalX - h.x, -hunt.huntSpeed * FIXED_DT, hunt.huntSpeed * FIXED_DT);

    h.cd -= FIXED_DT;
    if (h.cd <= 0) {
      const tgt = atkTgt;
      if (tgt) {
        h.cd = heroAtkSpeedOf(h);
        const dmg = heroAtkOf(h);
        if (t.attack === "melee") {
          // NINJA dagger DOUBLE-HIT (SAVE v18): `multiHit` swings per attack, each
          // `multiHitMult` of the rolled atk. Absent/1 for the swordsman → the single
          // full-damage strike (byte-identical to pre-v18). Each hit routes through
          // applyDamage so a survivor retaliates + render sees a hit per swing. No RNG.
          const hits = t.multiHit ?? 1;
          if (hits > 1) {
            const per = Math.round(dmg * (t.multiHitMult ?? 1));
            for (let i = 0; i < hits; i++) applyDamage(state, tgt, per, "attack");
          } else {
            applyDamage(state, tgt, dmg, "attack");
          }
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
  // WORLD BOSS "เสี่ยจ๋อง": homing hero shots (arrows/bolts) must be able to find the
  // live world boss the same way they find `state.boss`.
  const wb = state.worldBoss;
  if (wb && wb.active && wb.entity && wb.entity.id === id) return wb.entity;
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
    const d = dhypot(dx, dy);
    if (d <= arrive) {
      const src = projHitSource(p.kind);
      // M7.7 survivor-retaliation: every falling AoE (rain drop, meteor, cataclysm,
      // mage basic orb) wakes the TOUGH mobs it damages-but-doesn't-kill, via the one
      // shared AoE path (damageInRadius/applyAoeDamage are the same now — no cap pass).
      if (p.kind === "rainArrow") damageInRadius(state, list, p.tx, p.aoe, p.damage, src);
      else applyAoeDamage(state, list, p.tx, p.aoe, p.damage, src);
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
  const d = dhypot(dx, dy);
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
        creditKillGold(state, goldGained);
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
        // M8 Wave A: count toward the "killAnywhere" daily (inert until a roster exists).
        advanceDailyProgress(state, "killAnywhere", 1);
        // M7: roll a farm drop for this kill (stateless hash; NEVER the wave RNG).
        rollEnemyDrop(state, e);
        return false;
      }
      return true;
    });
  } else {
    // Boss phase. M7.9: reap boss-SUMMONED adds that died (a normal kill payout so
    // clearing them feels + reads like any other kill — gold/xp/pop/quest credit).
    // No loot roll (adds are threats, not a loot faucet). For classic bosses the
    // enemy list is empty, so this filter is a no-op (byte-identical to pre-M7.9).
    if (state.enemies.length) {
      state.enemies = state.enemies.filter((e) => {
        if (e.hp <= 0) {
          // NB: no `state.kills++` — that's the FARM-zone quota counter; a boss-room
          // kill must not touch it (checkZoneUnlock is a boss-phase no-op anyway).
          const goldGained = CONFIG.goldPerKill(state.stage);
          creditKillGold(state, goldGained);
          grantKillXp(state, CONFIG.leveling.xpPerKill(state.stage));
          state.events.push({ type: "kill", kind: e.kind, x: e.x, y: e.y, goldGained });
          advanceQuestObjective(state, "kill");
          advanceDailyProgress(state, "killAnywhere", 1);
          return false;
        }
        return true;
      });
    }
    if (state.boss && state.boss.hp <= 0) {
      onBossKilled(state); // gold reward + phase -> victory
    }
  }

  // bossReady arming moved to world.checkZoneUnlock (2026-07-07): quota alone
  // is NOT enough — the button must only light where the boss room is actually
  // next door (see the note there).

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
