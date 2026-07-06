/**
 * Hero skills (M5 "mana + skill framework v2", 86d3jv7m3).
 *
 * Each class has a KIT of skills (see `SKILLS` in config) unlocked by LEVEL
 * within a TIER. A skill costs MANA and keeps a PER-SKILL cooldown (GDD: both).
 * Skills resolve through a handful of EXISTING mechanics (no new ProjectileKind):
 *  - `nova`   : instant AoE around the hero (swordsman whirl).
 *  - `strike` : instant AoE at the nearest in-range target (slam / frost burst).
 *  - `meteor` : a single falling point-projectile AoE (mage meteor / cataclysm).
 *  - `rain`   : many small falling point-projectiles over the cluster (arrow rain).
 *  - `bolt`   : one high-damage HOMING arrow at the nearest target (power shot).
 *  - `buff`   : a self ATK buff for a duration (war cry).
 *
 * The cast GUARD is preserved: never cast without a valid target in range, and
 * never when the skill is on cooldown or the hero can't afford the mana cost.
 * This is what stops "swinging at air" and is why auto-cast is safe to leave on.
 * Mana-starvation only ever SKIPS a cast — basic attacks (which cost no mana)
 * keep flowing, so idle progression never hard-stalls.
 *
 * NO RNG is drawn here — the seeded stream stays reserved for wave composition
 * (the rain's landing spread comes from the FIXED `arrowRainOffsets` table).
 */

import {
  CONFIG,
  SKILLS,
  CLASS_SKILLS,
  type SkillType,
} from "@/engine/config";
import { applyAoeDamage } from "@/engine/systems/damage";
import { heroAtkOf } from "@/engine/systems/stats";
import {
  aliveHeroes,
  getTargets,
  nearestAny,
  nearestWithin,
} from "@/engine/systems/targeting";
import type { Hero, CombatTarget } from "@/engine/entities";
import type { GameState } from "@/engine/state";
import type { FrameInput } from "@/engine/core/step";

const L = CONFIG.layout;

/**
 * The fixed drop-offset table a `rain` skill uses (M7.7). The signature arrow rain
 * uses the tight 9-drop `arrowRainOffsets`; the tier-2 BARRAGE ultimate uses the
 * WIDE 13-drop `barrageOffsets` to blanket the whole field. Length MUST equal the
 * skill's `targets`. NO RNG — both tables are constant, so casts stay deterministic.
 */
function rainOffsetsFor(def: SkillType): readonly { dx: number; ry: number }[] {
  if (def.id === "archer_storm") return CONFIG.stormOffsets; // tier-3 sustained storm
  if (def.id === "archer_barrage") return CONFIG.barrageOffsets;
  return CONFIG.arrowRainOffsets;
}

/** Remaining cooldown on a specific skill (0 = ready). */
export function skillCdOf(hero: Hero, skillId: string): number {
  return hero.skillCds[skillId] ?? 0;
}

/**
 * Whether `hero` has LEARNED skill `def` — its class matches and both the tier
 * and the level gate are met (unlock-by-level within the tier).
 */
export function isSkillLearned(hero: Hero, def: SkillType): boolean {
  return def.cls === hero.cls && hero.tier >= def.tier && hero.level >= def.unlockLevel;
}

/** The learned skill kit for a hero (ordered: signature first, then by unlock). */
export function learnedSkills(hero: Hero): SkillType[] {
  return CLASS_SKILLS[hero.cls].map((id) => SKILLS[id]).filter((def) => isSkillLearned(hero, def));
}

/**
 * How many auto-cast slots are unlocked for a hero at `level` / `tier`. A slot unlocks
 * only when BOTH its level threshold (`autoSlots.unlockLevels`) AND its tier gate
 * (`autoSlots.tierRequired`) are met. `tier` defaults to 1 so pre-tier-3 callers (and
 * the UI's level-only read) keep the historical 3-slot behaviour — the M7.9 4th slot
 * needs level 40 AND tier 3.
 */
export function unlockedAutoSlotCount(level: number, tier: 1 | 2 | 3 = 1): number {
  return CONFIG.autoSlots.unlockLevels.filter(
    (lvl, i) => level >= lvl && tier >= CONFIG.autoSlots.tierRequired[i],
  ).length;
}

/**
 * Whether `hero` could cast `def` RIGHT NOW: learned, not dead, off cooldown,
 * enough mana. (The positional target guard is checked inside `castSkill`.) Pure.
 */
export function canCastSkill(hero: Hero, def: SkillType): boolean {
  return (
    !hero.dead &&
    isSkillLearned(hero, def) &&
    skillCdOf(hero, def.id) <= 0 &&
    hero.mana >= def.cost
  );
}

/** Does any target sit within `range` of the hero on the x-axis? */
function targetInRange(targets: readonly CombatTarget[], hero: Hero, range: number): boolean {
  return targets.some((e) => Math.abs(e.x - hero.x) < range);
}

/**
 * Attempt to cast skill `def` for `hero`. Returns false (no effect) if the hero
 * is down, hasn't learned it, it's on cooldown, mana is insufficient, or the
 * positional guard fails. Otherwise spends mana, starts the per-skill cooldown,
 * emits a `skillCast` event, and applies the effect.
 */
export function castSkill(state: GameState, hero: Hero, def: SkillType): boolean {
  if (!canCastSkill(hero, def)) return false;

  const targets = getTargets(state);
  if (!targets.length) return false;

  // Positional guard (POC): don't waste a cast with nothing to hit. `nova` uses
  // its own blast radius; every other kind uses the skill's cast range.
  const guardRange = def.kind === "nova" ? def.radius : def.range;
  if (!targetInRange(targets, hero, guardRange)) return false;

  // --- commit ---
  hero.mana -= def.cost;
  hero.skillCds[def.id] = def.cd;
  state.events.push({
    type: "skillCast",
    heroClass: hero.cls,
    slot: state.heroes.indexOf(hero),
    skillId: def.id,
  });

  applySkillEffect(state, hero, def, targets);
  return true;
}

function applySkillEffect(
  state: GameState,
  hero: Hero,
  def: SkillType,
  targets: CombatTarget[],
): void {
  switch (def.kind) {
    case "buff": {
      // War cry: refresh the self ATK buff (no damage).
      hero.atkBuffMult = def.buffMult;
      hero.atkBuffTimer = def.buffDuration;
      return;
    }
    case "nova": {
      // Instant AoE around the hero. The AoE-aggro rule caps how many passive mobs
      // this wakes (M6 hunt follow-up — see applyAoeDamage).
      const dmg = Math.round(heroAtkOf(hero) * def.mult);
      applyAoeDamage(state, targets, hero.x, def.radius, dmg, "skill");
      return;
    }
    case "strike": {
      // Instant AoE centred on the nearest in-range target's x (aggro-capped).
      const center = nearestWithin(targets, hero.x, def.range);
      if (!center) return;
      const dmg = Math.round(heroAtkOf(hero) * def.mult);
      applyAoeDamage(state, targets, center.x, def.radius, dmg, "skill");
      return;
    }
    case "bolt": {
      // Single high-damage HOMING arrow at the nearest in-range target.
      const tgt = nearestWithin(targets, hero.x, def.range);
      if (!tgt) return;
      const px = hero.x + L.heroProjSpawnXOffset;
      const py = L.groundY - L.heroProjSpawnYOffset;
      state.projectiles.push({
        id: state.nextId++,
        team: "hero",
        kind: "arrow",
        x: px,
        y: py,
        damage: Math.round(heroAtkOf(hero) * def.mult),
        speed: def.projSpeed,
        targetId: tgt.id,
        tx: 0,
        ty: 0,
        aoe: 0,
      });
      state.events.push({ type: "projectileSpawn", kind: "arrow", x: px, y: py });
      return;
    }
    case "rain": {
      // ARROW RAIN / BARRAGE: `targets` small arrows fall onto a zone centred on the
      // centroid of the foes within range (the guard guarantees ≥1). Landing spread +
      // spawn-height stagger come from a FIXED offset table (`arrowRainOffsets` for the
      // signature, the wider `barrageOffsets` for the tier-2 ultimate) — NO RNG. Each
      // drop is a point-target AoE (meteor-style fall). M7.7: survivor-retaliation is
      // applied per-drop by the AoE damage path (combat.stepProjectile) — no separate
      // wake pass, so every tough mob a drop leaves alive fights back.
      const inRange = targets.filter((e) => Math.abs(e.x - hero.x) < def.range);
      const cx = inRange.reduce((sum, e) => sum + e.x, 0) / inRange.length;
      const dmg = Math.round(heroAtkOf(hero) * def.mult);
      const ty = L.groundY - L.heroProjImpactYOffset;
      const offsets = rainOffsetsFor(def);
      for (let i = 0; i < def.targets; i++) {
        const off = offsets[i];
        const tx = cx + off.dx;
        const spawnY = CONFIG.skills.arrowRainSpawnY - off.ry;
        state.projectiles.push({
          id: state.nextId++,
          team: "hero",
          kind: "rainArrow",
          x: tx,
          y: spawnY,
          damage: dmg,
          speed: def.projSpeed,
          targetId: null,
          tx,
          ty,
          aoe: def.radius,
        });
        state.events.push({ type: "projectileSpawn", kind: "rainArrow", x: tx, y: spawnY });
      }
      return;
    }
    case "meteor": {
      // The mage's meteor family. A SINGLE meteor (signature/cataclysm, `targets` = 0)
      // falls onto the nearest target's x. The tier-3 APOCALYPSE (`targets` > 0) spawns
      // a VOLLEY of `targets` meteors on the fixed `apocalypseOffsets` table, centred on
      // that same x, each staggered by spawn HEIGHT (`ry`) so they land across a window.
      // REUSES the meteor ProjectileKind (no new kind — footgun #6); the guard
      // guarantees at least one target for the centroid. Deterministic (constant table).
      const dmg = Math.round(heroAtkOf(hero) * def.mult);
      const ty = L.groundY - L.heroProjImpactYOffset;
      const tgt = nearestAny(targets, hero.x);
      const cx = tgt ? tgt.x : hero.x + CONFIG.skills.mageFallbackAheadX;
      if (def.targets > 0) {
        const offsets = CONFIG.apocalypseOffsets;
        for (let i = 0; i < def.targets; i++) {
          const off = offsets[i];
          const tx = cx + off.dx;
          const spawnY = CONFIG.skills.meteorSpawnY - off.ry;
          state.projectiles.push({
            id: state.nextId++,
            team: "hero",
            kind: "meteor",
            x: tx,
            y: spawnY,
            damage: dmg,
            speed: def.projSpeed,
            targetId: null,
            tx,
            ty,
            aoe: def.radius,
          });
          state.events.push({ type: "projectileSpawn", kind: "meteor", x: tx, y: spawnY });
        }
        return;
      }
      state.projectiles.push({
        id: state.nextId++,
        team: "hero",
        kind: "meteor",
        x: cx,
        y: CONFIG.skills.meteorSpawnY,
        damage: dmg,
        speed: def.projSpeed,
        targetId: null,
        tx: cx,
        ty,
        aoe: def.radius,
      });
      state.events.push({
        type: "projectileSpawn",
        kind: "meteor",
        x: cx,
        y: CONFIG.skills.meteorSpawnY,
      });
      return;
    }
  }
}

/**
 * Assign (or clear, with `skillId = null`) an auto-cast slot for `hero`. No-op
 * (returns false) if the hero is missing, the slot index is out of range or not
 * yet unlocked by level, or the skill isn't one this hero has learned. A skill
 * already sitting in another slot is moved (cleared from the old one) so the
 * same skill never occupies two slots.
 */
export function setAutoSlot(
  state: GameState,
  hero: Hero | undefined,
  slot: number,
  skillId: string | null,
): boolean {
  if (!hero) return false;
  if (!Number.isInteger(slot) || slot < 0 || slot >= CONFIG.autoSlots.max) return false;
  if (slot >= unlockedAutoSlotCount(hero.level, hero.tier)) return false;
  if (skillId !== null) {
    const def = SKILLS[skillId];
    if (!def || !isSkillLearned(hero, def)) return false;
    // De-dup: remove the skill from any slot it currently occupies.
    for (let i = 0; i < hero.autoSlots.length; i++) {
      if (hero.autoSlots[i] === skillId) hero.autoSlots[i] = null;
    }
  }
  hero.autoSlots[slot] = skillId;
  return true;
}

/**
 * Process this step's skill activity: explicit manual casts first, then
 * auto-cast for the slotted skills of every alive hero when the toggle is on.
 * Both route through `castSkill`, so the guards (cooldown, mana, range) hold.
 */
export function processSkills(state: GameState, input: FrameInput): void {
  if (input.castSkills) {
    for (const { slot, skillId } of input.castSkills) {
      const h = state.heroes[slot];
      const def = SKILLS[skillId];
      if (h && def) castSkill(state, h, def);
    }
  }
  if (state.autoCast) {
    for (const h of aliveHeroes(state)) {
      // Deterministic priority: walk the unlocked slots IN ORDER.
      const unlocked = unlockedAutoSlotCount(h.level, h.tier);
      for (let i = 0; i < unlocked && i < h.autoSlots.length; i++) {
        const id = h.autoSlots[i];
        if (!id) continue;
        const def = SKILLS[id];
        if (def) castSkill(state, h, def);
      }
    }
  }
}
