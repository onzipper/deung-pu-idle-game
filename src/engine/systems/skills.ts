/**
 * Hero skills (POC `castSkill` + the auto-cast block).
 *
 * Three class skills, each on its own cooldown (`hero.skillCd`, decayed by
 * `combat.decayHeroTimers`):
 *  - swordsman: instant AOE spin around itself (all targets within `radius`).
 *  - archer: ARROW RAIN ("ฝนลูกธนู") — many small arrows fall from the sky over
 *    the enemy cluster (86d3k2t18; was a nearest-3 instant homing spread).
 *  - mage: drops a meteor on the nearest target's x for a wide-radius nuke.
 *
 * The cast GUARD is preserved: never cast without a valid target in range
 * (swordsman needs a foe within spin radius; the archer AND mage need one within
 * their cast range). This is what stops "swinging at air" and is why auto-cast is
 * safe to leave on.
 */

import { CONFIG, HERO_TYPES, SKILL_TYPES } from "@/engine/config";
import { applyDamage } from "@/engine/systems/damage";
import { heroAtk } from "@/engine/systems/stats";
import { aliveHeroes, getTargets, nearestAny } from "@/engine/systems/targeting";
import type { Hero } from "@/engine/entities";
import type { GameState } from "@/engine/state";
import type { FrameInput } from "@/engine/core/step";

const L = CONFIG.layout;

/**
 * Attempt to cast `hero`'s skill. Returns false (no effect) if it's on cooldown,
 * the hero is down, or the range guard fails. Otherwise applies the effect and
 * starts the cooldown.
 */
export function castSkill(state: GameState, hero: Hero): boolean {
  if (hero.dead || hero.skillCd > 0) return false;

  const sk = SKILL_TYPES[hero.cls];
  const targets = getTargets(state);
  if (!targets.length) return false;

  // Range guard (POC): don't waste a cast with nothing to hit.
  if (
    hero.cls === "swordsman" &&
    !targets.some((e) => Math.abs(e.x - hero.x) < sk.radius)
  ) {
    return false;
  }
  if (
    hero.cls === "archer" &&
    !targets.some((e) => Math.abs(e.x - hero.x) < CONFIG.skills.arrowRainRange)
  ) {
    return false;
  }
  if (
    hero.cls === "mage" &&
    !targets.some((e) => Math.abs(e.x - hero.x) < HERO_TYPES.mage.range)
  ) {
    return false;
  }

  hero.skillCd = sk.cd;
  state.events.push({
    type: "skillCast",
    heroClass: hero.cls,
    slot: state.heroes.indexOf(hero),
  });

  if (hero.cls === "swordsman") {
    const dmg = Math.round(heroAtk(hero.cls, state.upgrades, hero.level) * sk.mult);
    for (const e of targets) {
      if (Math.abs(e.x - hero.x) < sk.radius) applyDamage(state, e, dmg, "skill");
    }
  } else if (hero.cls === "archer") {
    // ARROW RAIN: `sk.targets` small arrows fall from the sky onto a zone centred on
    // the centroid of the foes within archer range (the guard guarantees ≥1). Each
    // is a point-target "rainArrow" (meteor-style fall) with a small AoE splash. The
    // landing spread + spawn-height stagger come from the FIXED arrowRainOffsets
    // table — NO RNG draw here (the seeded stream is reserved for wave composition).
    const inRange = targets.filter(
      (e) => Math.abs(e.x - hero.x) < CONFIG.skills.arrowRainRange,
    );
    const cx = inRange.reduce((sum, e) => sum + e.x, 0) / inRange.length;
    const dmg = Math.round(heroAtk(hero.cls, state.upgrades, hero.level) * sk.mult);
    const ty = L.groundY - L.heroProjImpactYOffset;
    for (let i = 0; i < sk.targets; i++) {
      const off = CONFIG.arrowRainOffsets[i];
      const tx = cx + off.dx;
      const spawnY = CONFIG.skills.arrowRainSpawnY - off.ry;
      state.projectiles.push({
        id: state.nextId++,
        team: "hero",
        kind: "rainArrow",
        x: tx,
        y: spawnY,
        damage: dmg,
        speed: sk.projSpeed,
        targetId: null,
        tx,
        ty,
        aoe: sk.radius,
      });
      state.events.push({
        type: "projectileSpawn",
        kind: "rainArrow",
        x: tx,
        y: spawnY,
      });
    }
  } else {
    // mage meteor: falls onto the nearest target's x (guard guarantees one).
    const tgt = nearestAny(targets, hero.x);
    const tx = tgt ? tgt.x : hero.x + CONFIG.skills.mageFallbackAheadX;
    state.projectiles.push({
      id: state.nextId++,
      team: "hero",
      kind: "meteor",
      x: tx,
      y: CONFIG.skills.meteorSpawnY,
      damage: Math.round(heroAtk(hero.cls, state.upgrades, hero.level) * sk.mult),
      speed: sk.projSpeed,
      targetId: null,
      tx,
      ty: L.groundY - L.heroProjImpactYOffset,
      aoe: sk.radius,
    });
    state.events.push({
      type: "projectileSpawn",
      kind: "meteor",
      x: tx,
      y: CONFIG.skills.meteorSpawnY,
    });
  }

  return true;
}

/**
 * Process this step's skill activity: explicit `input.castSkills` slot indices
 * first, then auto-cast for any off-cooldown hero when the toggle is on. Both
 * route through `castSkill`, so the range guard always applies.
 */
export function processSkills(state: GameState, input: FrameInput): void {
  if (input.castSkills) {
    for (const slot of input.castSkills) {
      const h = state.heroes[slot];
      if (h) castSkill(state, h);
    }
  }
  if (state.autoCast) {
    for (const h of aliveHeroes(state)) {
      if (h.skillCd <= 0) castSkill(state, h);
    }
  }
}
