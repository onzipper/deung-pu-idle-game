/**
 * Entity factories — build heroes / enemies / bosses from config with the
 * POC's per-wave / per-stage scaling. Kept free of side effects: callers pass a
 * fresh `id` and (for enemies) the seeded RNG whose stream they own.
 */

import { CONFIG, HERO_TYPES, ENEMY_TYPES, SIGNATURE_SKILL } from "@/engine/config";
import { emptyEquipped, ITEM_TEMPLATES, refineOf, type EquippedGear } from "@/engine/config/items";
import { refinedStat } from "@/engine/config/refine";
import type { Rng } from "@/engine/core/rng";
import { baseStats, heroMaxHp, heroMaxMana } from "@/engine/systems/stats";
import type {
  Hero,
  HeroConfig,
  Enemy,
  Boss,
  BossBehavior,
  HeroClass,
  HeroStats,
  HeroQuest,
  EnemyKind,
  SkillId,
} from "@/engine/entities";

/**
 * A fresh per-hero automation config (M8 party P1b), seeded to the SAME defaults the
 * global fields carried: auto-cast/allocate OFF, auto-hunt ON, auto-potions + their
 * thresholds from `CONFIG.shop.autoDefaults`. In solo these are immediately overwritten
 * each step by `syncPrimaryHeroConfig` (store-mirror); a cohort hero keeps them until a
 * `setHeroConfig` intent arrives. See `HeroConfig`.
 */
export function defaultHeroConfig(): HeroConfig {
  return {
    autoCast: false,
    autoAllocate: false,
    autoHunt: true,
    autoHpPotion: CONFIG.shop.autoDefaults.hpPotion,
    autoManaPotion: CONFIG.shop.autoDefaults.manaPotion,
    autoHpThreshold: CONFIG.shop.autoDefaults.hpThreshold,
    autoManaThreshold: CONFIG.shop.autoDefaults.manaThreshold,
  };
}

/**
 * How many auto-cast slots a hero of `tier` HOLDS (its `autoSlots` array LENGTH).
 * The 4th slot (M7.9) is tier-3-only, so tiers 1-2 keep the historical 3-slot loadout
 * — a pre-tier-3 save's persisted `autoSlots` stays byte-identical (length 3). Derived
 * from `autoSlots.tierRequired` so the config table stays the single source of truth.
 */
export function autoSlotCapacity(tier: 1 | 2 | 3 = 1): number {
  return CONFIG.autoSlots.tierRequired.filter((t) => t <= tier).length;
}

/** The default auto-slot loadout: signature in slot 0, the rest empty. The array
 * LENGTH is tier-scoped (`autoSlotCapacity`) — 3 for tiers 1-2, 4 for tier 3. */
export function defaultAutoSlots(cls: HeroClass, tier: 1 | 2 | 3 = 1): (SkillId | null)[] {
  const slots: (SkillId | null)[] = new Array(autoSlotCapacity(tier)).fill(null);
  slots[0] = SIGNATURE_SKILL[cls];
  return slots;
}

/**
 * Build a hero at its formation home position, at full HP. `level` / `xp` / `tier`
 * / `statPoints` / `stats` carry per-hero M5 progression forward across stage
 * resets and save loads; they default to a fresh hero — level 1, tier 1, the class
 * base stat block, and the retro-free `(level - 1) * pointsPerLevel` unspent points
 * (0 for a level-1 hero; each level-up grants more in leveling.ts).
 */
export function makeHero(
  id: number,
  cls: HeroClass,
  level = 1,
  xp = 0,
  tier: 1 | 2 | 3 = 1,
  statPoints: number = (level - 1) * CONFIG.stats.pointsPerLevel,
  stats: HeroStats = baseStats(cls),
  mana?: number,
  autoSlots: (SkillId | null)[] = defaultAutoSlots(cls, tier),
  quest: HeroQuest | null = null,
  equipped: EquippedGear = emptyEquipped(),
  config: HeroConfig = defaultHeroConfig(),
): Hero {
  const t = HERO_TYPES[cls];
  // Max HP folds in equipped armor's flat HP (0 for an unarmored hero, so a fresh
  // hero is unchanged), each item's HP scaled by its refine level (M7.6). Mirrors
  // `heroMaxHpOf`/`equipStatSum` without importing them (avoids a cycle).
  const armorHp =
    refinedStat(
      equipped.weapon ? (ITEM_TEMPLATES[equipped.weapon]?.stats.hp ?? 0) : 0,
      refineOf(equipped, "weapon"),
    ) +
    refinedStat(
      equipped.armor ? (ITEM_TEMPLATES[equipped.armor]?.stats.hp ?? 0) : 0,
      refineOf(equipped, "armor"),
    );
  const maxHp = heroMaxHp(cls, level, tier, stats.vit) + armorHp;
  const maxMana = heroMaxMana(cls, stats.int, tier);
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
    skillCds: {},
    // Default to a FULL pool (a fresh hero can immediately cast); a loaded save
    // overrides with its persisted current mana.
    mana: mana ?? maxMana,
    maxMana,
    atkBuffMult: 1,
    atkBuffTimer: 0,
    level,
    xp,
    tier,
    statPoints,
    stats,
    autoSlots,
    quest,
    equipped: {
      weapon: equipped.weapon,
      armor: equipped.armor,
      refine: { weapon: refineOf(equipped, "weapon"), armor: refineOf(equipped, "armor") },
    },
    // Manual command (M7.8) — a fresh hero is on AUTO (no command). Transient.
    command: null,
    // Per-hero automation config (M8 party P1b) — solo mirrors the globals each step;
    // cohort sets it via setHeroConfig. Transient.
    config,
    // Combat aim (render-only facing observer) — re-derived each step. Transient.
    aimX: null,
  };
}

/**
 * Build an enemy scaled by stage. Consumes exactly two RNG draws
 * (initial attack cd, engage jitter), in that order — see `hunt.ts` for how
 * this interleaves with spawn-composition draws.
 *
 * `x` is left at 0; the hunt-field spawner positions it.
 */
export function makeEnemy(id: number, kind: EnemyKind, stage: number, rng: Rng): Enemy {
  const et = ENEMY_TYPES[kind];
  const hp = Math.round(CONFIG.enemyHp(stage) * et.hpMult);
  const atk = Math.round(CONFIG.enemyAtk(stage) * et.atkMult);
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
    // Hunt-field fields (M6 "สนามล่ามอน"): the spawn system positions the mob and
    // sets its temperament (see systems/hunt.ts `spawnMob`). Defaults are a
    // passive mob anchored at x=0 — safe for a directly-injected test enemy.
    homeX: 0,
    aggressive: false,
    aggroRadius: 0,
    engaged: false,
  };
}

/** Build the stage boss (Phase B wiring; factory ready now).
 *
 * `scaleOverride` (M7.9b tier-3 quest boss): when provided, its hp/atk scales REPLACE the
 * bossVariety row's scales while the boss KEEPS the row's `behaviors` (mechanics + telegraphs
 * unchanged). Used by `systems/boss.startBossFight` to spawn the quest-scaled "young" Glacial
 * Sovereign for a tier-2 hero mid-tier-3-quest; the real s20 boss passes no override. */
export function makeBoss(
  id: number,
  stage: number,
  scaleOverride?: { hpScale: number; atkScale: number },
): Boss {
  // M7.9 boss variety: stamp the per-stage behavior snapshot + init the mechanic
  // timers. `hpScale`/`atkScale` are identity (1) in this first pass, so a boss's
  // stats stay byte-identical to the parametric curve; a stage with no roster row
  // (e.g. a test forcing a boss at a non-boss stage) falls back to the classic kit.
  const bb = CONFIG.bossBehavior;
  const row = CONFIG.bossVariety[stage];
  const hpScale = scaleOverride?.hpScale ?? row?.hpScale ?? 1;
  const atkScale = scaleOverride?.atkScale ?? row?.atkScale ?? 1;
  const hp = Math.round(CONFIG.bossHp(stage) * hpScale);
  return {
    id,
    x: CONFIG.spawnX,
    y: CONFIG.boss.y,
    hp,
    maxHp: hp,
    atk: Math.round(CONFIG.bossAtk(stage) * atkScale),
    cd: CONFIG.boss.initialCd,
    skillCd: CONFIG.boss.initialSkillCd,
    telegraph: 0,
    enraged: false,
    variety: {
      behaviors: (row?.behaviors ?? ["slam", "enrage"]) as BossBehavior[],
      chargeCd: bb.charge.cd,
      chargePhase: "idle",
      chargeTimer: 0,
      chargeTargetX: 0,
      summonsFired: 0,
      hazardCd: bb.hazard.cd,
      hazardPhase: "idle",
      hazardTimer: 0,
      hazardTickTimer: 0,
      hazardTicksLeft: 0,
    },
  };
}

/**
 * Fixed per-add attack-cd + engage-jitter tables (M7.9 boss SUMMON). Deterministic
 * substitutes for `makeEnemy`'s two RNG draws — boss behaviors must NEVER perturb
 * the wave-composition stream (CLAUDE.md). Indexed by the add's slot in its wave.
 */
const BOSS_ADD_CD = [0.2, 0.5, 0.35, 0.6];
const BOSS_ADD_ENGAGE_OFFSET = [0, 14, 28, 42];

/**
 * Build a boss-SUMMONED add (M7.9 map5 SUMMON). Mirrors `makeEnemy`'s stage stat
 * scaling but is fully DETERMINISTIC (fixed cd/engage tables, NO RNG draw) so a
 * summon can't shift the seeded stream. Spawned already ENGAGED so it immediately
 * hunts the hero; the caller sets `x`/`homeX`.
 */
export function makeBossAdd(id: number, kind: EnemyKind, stage: number, slot: number): Enemy {
  const et = ENEMY_TYPES[kind];
  const hp = Math.round(CONFIG.enemyHp(stage) * et.hpMult);
  const atk = Math.round(CONFIG.enemyAtk(stage) * et.atkMult);
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
    cd: BOSS_ADD_CD[slot % BOSS_ADD_CD.length],
    engageOffset: BOSS_ADD_ENGAGE_OFFSET[slot % BOSS_ADD_ENGAGE_OFFSET.length],
    homeX: 0,
    aggressive: true,
    aggroRadius: 0,
    engaged: true,
  };
}
