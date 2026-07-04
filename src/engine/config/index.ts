/**
 * Tunable balance constants — ported faithfully from the POC `CONFIG` block
 * (plus the per-type stat tables it kept as separate objects).
 *
 * This is the ONLY home for magic numbers. Systems must read every constant from
 * here so the balance-sim harness can sweep them. Curves are functions of the
 * stage number `n`, exactly as the POC wrote them.
 */

import type { HeroClass, EnemyKind, AttackKind, EnemyBehavior } from "@/engine/entities";

export const CONFIG = {
  // ---- existing engine-infra keys (do not remove) ----
  /** Speed multipliers the player can toggle. */
  speeds: [1, 2, 3] as const,
  /** Offline idle earnings are capped to this many hours (anti-cheat). */
  offlineCapHours: 8,
  /** Throttle for engine -> UI (Zustand) state sync, in Hz. */
  uiSyncHz: 10,

  // ---- team / hero base ----
  maxHeroes: 3,
  heroBaseAtk: 10,
  heroBaseHp: 150,
  heroReviveTime: 4,
  /** Revived heroes come back at this fraction of max HP. */
  reviveHpFraction: 0.5,

  // ---- formation / movement ----
  baseAnchor: 180,
  maxAnchor: 300, // anchor upper clamp when NO enemies are present (easing home)
  anchorSpeed: 60, // anchor ease speed when NO enemies present
  /** Anchor tracks (min enemy x - anchorLead), clamped to [baseAnchor,maxAnchor]. */
  anchorLead: 170,
  heroMove: 150,
  midCap: 400,
  clash: 46,
  meleeLeash: 90,
  kiteDist: 100,

  // ---- charge behaviour (task 86d3k2he0 -> 86d3k2nhm: heroes RUN AT + SMASH,
  //      whole team pushes forward at ALL times, no standing around waiting) ----
  // When ANY enemy is alive the swordsman sprints at the nearest one and the whole
  // formation surges deep so the ranged heroes' coverage TRAVELS with the fight.
  // These are the ONLY knobs that make the team aggressive; the non-battle
  // (no-enemy) easing above is untouched, and between waves the anchor now HOLDS
  // its forward line instead of retreating (see movement.ts / waveGap handling).
  battleAnchorLead: 150, // (86d3k2nhm: was 130) anchor tracks minEnemyX - this; sized so the anchor rides right up near the engagement line but the ranged heroes still sit a touch behind it
  // (86d3k2nhm follow-up) HELD at 510 — deliberately NOT deepened alongside the new
  // dynamic charge cap. The deepest engaged enemy now sits at chargeHardCap(770) +
  // clash(46) + enemyEngageJitter(24) = 840; archer @ (510-26=484)+rangedHomeFront(8)+
  // range 350 -> 842 >= 840 covers the fight line, and a spawn-edge ranged enemy is
  // reached by the SWORDSMAN's dynamic cap (770 + range 96 = 866 >= spawnX 860), NOT by
  // pushing the backline forward. So the free-hit fix does not require a deeper anchor.
  // Pushing this to 590 (as first drafted) gave archer+mage too much uptime and made
  // clears ~18% too fast — 5 stages fell outside the ±15% balance budget (S3 -14 -> S9
  // -14, S5/S7/S8 -20..-23%); 510 keeps every stage in budget except the two earliest,
  // which are inherently faster from removing the ~4s/wave park (S1 has no ranged heroes
  // at all). mage @ (510-74=436)+8+330 = 774 covers the incoming stream (the bulk of a
  // staggered wave) rather than the very front enemy — that trailing coverage cost is
  // the price of staying inside budget. Sim-validated; see docs/balance-m4.md.
  battleMaxAnchor: 510,
  battleAnchorSpeed: 115, // (was anchorSpeed 60) formation surges forward ~2x faster on enemy contact
  // Charge trigger is now whole-field: chargeSeekRange exceeds spawnX (860) - the
  // deepest a hero can stand (~150), so a freshly-spawned enemy is ALWAYS in range
  // and the swordsman charges the instant a wave appears (no wave-start idling).
  chargeSeekRange: 900, // (86d3k2nhm: was 560) >= full-field span; effectively "any enemy alive => charge"
  chargeSpeed: 265, // sprint speed while charging a target (~1.77x heroMove 150) — the "run at them" feel
  meleeChargeLeash: 260, // loosened forward leash while a charge target exists (was meleeLeash 90) — he genuinely runs across the field
  // Forward-cap FLOOR while charging. The swordsman's forward cap is now DYNAMIC
  // (combat.ts): upperCap = min(homeX + meleeChargeLeash, clamp(target.x -
  // meleeApproachGap, chargeCap, chargeHardCap)). chargeCap is the FLOOR — it keeps him
  // aggressive when the target is already close/behind — while chargeHardCap is the
  // ceiling. A STATIC 640 cap caused two playtest bugs (86d3k2nhm follow-up): (2) the
  // swordsman froze at 640 for ~4s while enemies walked 860 -> ~686, and (3) a ranged
  // enemy resting at nearestHero+160 (~800) sat 160px away > his 96 melee range, pinned
  // at 640 he could NEVER close -> permanent "free hits". The dynamic cap tracks the
  // target so he keeps closing (kills the park) and can always reach it (kills the free
  // hit).
  chargeCap: 640,
  // Dynamic-cap CEILING (spawn-relative: spawnX 860 - 90). 770 + swordsman range 96 =
  // 866 >= spawnX 860, so the swordsman can always close to melee range of a ranged
  // enemy resting at the spawn edge -> no permanent free-hits (must be >= 860-96 = 764).
  // Also leaves a small entrance corridor so waves still visibly read as they arrive.
  chargeHardCap: 770,

  // hero engagement tuning (pulled out of the POC update loop)
  meleeSeekRange: 260, // legacy hold-formation seek radius (superseded by chargeSeekRange for the charge behaviour; kept for reference)
  meleeStopGap: 34, // |d| > this => approach, else hold
  meleeApproachGap: 26, // stop this far short of the target
  meleeHomeBack: 60, // lower clamp = homeX - this
  meleeTargetMinD: -80, // nearestTarget minD for a melee attack (can hit slightly behind)
  rangedKiteStep: 46, // step back by this when an enemy is within kiteDist
  rangedHomeFront: 8, // ranged upper clamp = min(homeX + this, rangedForwardCap)
  rangedMinX: 55, // ranged lower clamp (don't back off the screen)
  // (86d3k2nhm follow-up) Ranged upper-clamp SAFETY NET, spawn-relative (spawnX 860 -
  // 120). REPLACES the POC-era absolute `midCap` (400) in the ranged clamp. midCap no
  // longer scaled with the deep-push anchor: at battleMaxAnchor 510 archer homeX(484)
  // and mage homeX(436) BOTH clamped to 400 -> exact stack (playtest bug 1). Because
  // homeX = anchorX + offset already carries the -26/-74 formation spread, a cap that
  // sits ABOVE the max ranged homeX (~572 at anchor 590) never collides, so spacing is
  // preserved at ANY anchor depth; this is purely a "don't walk into the spawn" net.
  rangedForwardCap: 740,

  // ---- waves ----
  waveGap: 1.2, // gap before each subsequent wave
  firstWaveGap: 0.5, // gap before the very first wave of a stage
  waveHpScale: 0.05, // per-wave multiplier wm = 1 + wave * this
  waveCountBase: 3,
  waveCountPerWave: 1.1,
  waveCountPerStage: 0.6,
  spawnX: 860, // enemies spawn at this x (right edge)
  spawnGap: 48, // stagger between spawned enemies
  enemyEngageJitter: 24, // engageOffset = rng() * this
  enemyInitialCdJitter: 0.8, // starting attack cd = rng() * this
  enemyMeleeAtkCd: 1.0, // melee enemy attack cooldown

  /** Stage-gated random thresholds for wave composition (POC rollWave). */
  waveComp: {
    fastChance: 0.2, // stage >= 1
    rangedChanceS2: 0.34, // stage >= 2
    tankChanceS2: 0.46, // stage >= 2
    rangedChanceS3: 0.55, // stage >= 3
  },

  // ---- curves (functions of stage n), verbatim from the POC ----
  killGoal: (n: number): number => 10 + n * 5,
  // M4 tune: HP scaling exponent 1.23 -> 1.20. `heroAtk` is ADDITIVE
  // (base*(1+per*level)) while enemy/boss HP is GEOMETRIC, so the atk level (and
  // its geometric cost) needed to keep pace grows super-linearly with stage — a
  // wall is structurally unavoidable. 1.20 is identical at stage 1 (exp 0) and
  // only bends the LATE curve down, buying ~1 extra smooth stage and lowering the
  // wall's height without touching the early-game feel. Same base is reused for
  // bossHp, so the boss-power target (rec = bossHp / divisor) softens in lockstep.
  enemyHp: (n: number): number => Math.round(25 * Math.pow(1.2, n - 1)),
  enemyAtk: (n: number): number => Math.round(6 * Math.pow(1.19, n - 1)),
  bossHp: (n: number): number => Math.round(25 * Math.pow(1.2, n - 1) * 16),
  bossAtk: (n: number): number => Math.round(6 * Math.pow(1.19, n - 1) * 2.1),
  // M4 tune: gold/kill was purely linear (5 + 2n) while upgrade costs are
  // geometric, so late stages starved and the wall spiked. A gentle 1.05^(n-1)
  // multiplier keeps stage 1-3 values effectively unchanged (7, 9, 12 vs 7, 9,
  // 11) but lets income track the cost curve deeper, converting the old stage-8
  // stall into a comfortable stage and pushing the hard stall out to stage 9.
  goldPerKill: (n: number): number => Math.round((5 + n * 2) * Math.pow(1.05, n - 1)),
  goldPerBoss: (n: number): number => 50 + n * 20,

  // ---- spatial layout ----
  // The POC hard-coded GROUND=232 (a render constant) but the update loop used it
  // for projectile spawn/impact y-coordinates, which affect hypot() travel timing.
  // Ported here so combat stays byte-for-byte faithful to the POC's geometry.
  layout: {
    groundY: 232,
    heroY: 200,
    enemyY: 200,
    heroProjSpawnYOffset: 30, // hero projectile spawns at groundY - 30
    heroProjImpactYOffset: 16, // hero projectile impact y = groundY - 16
    enemyProjSpawnYOffset: 24, // enemy bolt spawns at groundY - 24
    enemyProjImpactYOffset: 30, // enemy projectile impact y = groundY - 30
    heroProjSpawnXOffset: 10, // hero projectile spawns at h.x + 10
    boltSpawnXOffset: 6, // enemy bolt spawns at e.x - 6
    projMinStep: 12, // arrival threshold = max(this, speed * dt)
  },

  // ---- archer basic-attack volley (86d3k2rgf) ----
  // The archer's BASIC attack fires a mini-volley of `archerVolleyCount` small
  // arrows at the SAME target instead of a single arrow ("ยิงลูกธนูย่อยๆ" — a
  // rapid-fire feel). Total damage per attack is UNCHANGED: it is split across
  // the volley (per-arrow = heroAtk / count; the LAST arrow carries the float
  // remainder so the volley sums BIT-EXACTLY to the old single-arrow damage — no
  // rounding drift). The archer SKILL (SKILL_TYPES.archer, 3 SEPARATE targets)
  // is deliberately left alone and stays the multi-target spread; the basic
  // volley is 3 arrows at ONE target.
  //
  // `archerVolleyOffsets` is a FIXED per-arrow table (length must equal
  // `archerVolleyCount`). It carries NO RNG on purpose: the seeded RNG stream
  // order is load-bearing for wave composition, so combat must never draw from
  // it. The small spawn jitter (dx/dy) plus the ±5% speed variance (speedMult)
  // stagger the arrows so they leave slightly apart and arrive on different
  // frames — that is what sells the rapid-fire look and yields up to 3 separate
  // damage-number ticks instead of one lumped hit. Deterministic because the
  // table is constant.
  archerVolleyCount: 3,
  archerVolleyOffsets: [
    { dx: 0, dy: -5, speedMult: 1.05 },
    { dx: -4, dy: 0, speedMult: 1.0 },
    { dx: 4, dy: 5, speedMult: 0.95 },
  ] as const,

  // ---- skills ----
  skills: {
    meteorSpawnY: -48, // meteor projectile spawns at this absolute y (falls to impact)
    mageFallbackAheadX: 150, // if no target, aim the meteor at h.x + this
  },

  // ---- flow / progression ----
  bossHintPowerDivisor: 26, // recommendedPower = round(bossHp / this)
  bossRetreatWaveGap: 1.0, // waveGap after a boss retreat (team wipe)
  nextStageWaveGap: 0.8, // waveGap at the start of a new stage
  autoUpgradeInterval: 0.15, // seconds between auto-upgrade attempts (POC 150ms tick)

  // ---- boss (movement + slam/enrage tuning) ----
  boss: {
    y: 190,
    initialCd: 1.2,
    initialSkillCd: 5,
    moveSpeed: 40,
    engageExtra: 20, // engageX = frontHeroX + clash + this
    enrageThreshold: 0.3, // enrage below this HP fraction
    slamMult: 1.7,
    slamCdEnraged: 4,
    slamCdNormal: 6.5,
    telegraphEnraged: 0.7,
    telegraphNormal: 1.0,
    attackCdEnraged: 0.7,
    attackCdNormal: 1.1,
  },
} as const;

export type SpeedMultiplier = (typeof CONFIG.speeds)[number];

// ---------------------------------------------------------------------------
// Per-type stat tables (POC HERO_TYPES / ENEMY_TYPES / SKILLS / UP).
// Visual-only fields (name/icon/color) are intentionally dropped — those belong
// to render/ui, not the pure sim.
// ---------------------------------------------------------------------------

export interface HeroType {
  /** x offset from the formation anchor (front heroes positive, back negative). */
  offset: number;
  attack: AttackKind;
  range: number;
  /** Seconds between attacks at base (lower = faster). */
  atkSpeed: number;
  dmgMult: number;
  /** Projectile travel speed (ranged classes only; 0 for melee). */
  projSpeed: number;
  /** AoE radius for `aoe` attackers (0 otherwise). */
  aoe: number;
}

export const HERO_TYPES: Record<HeroClass, HeroType> = {
  swordsman: {
    offset: 34,
    attack: "melee",
    range: 96,
    atkSpeed: 0.5,
    dmgMult: 1.0,
    projSpeed: 0,
    aoe: 0,
  },
  archer: {
    offset: -26,
    attack: "arrow",
    range: 350,
    atkSpeed: 0.72,
    dmgMult: 0.55,
    projSpeed: 660,
    aoe: 0,
  },
  mage: {
    offset: -74,
    attack: "aoe",
    range: 330,
    atkSpeed: 1.35,
    dmgMult: 0.85,
    projSpeed: 360,
    aoe: 46,
  },
};

/** Heroes are unlocked (and slotted) in this order as stages are cleared. */
export const SLOT_ORDER: readonly HeroClass[] = ["swordsman", "archer", "mage"];

export interface EnemyType {
  hpMult: number;
  atkMult: number;
  speed: number;
  size: number;
  behavior: EnemyBehavior;
  /** Attack range for ranged behaviour (0 for melee). */
  range: number;
  projSpeed: number;
  /** Attack cooldown for ranged behaviour (0 for melee — melee uses enemyMeleeAtkCd). */
  atkSpeed: number;
}

export const ENEMY_TYPES: Record<EnemyKind, EnemyType> = {
  // POC: grunt / runner / tank / shooter
  normal: {
    hpMult: 1.0,
    atkMult: 1.0,
    speed: 44,
    size: 1.0,
    behavior: "melee",
    range: 0,
    projSpeed: 0,
    atkSpeed: 0,
  },
  fast: {
    hpMult: 0.45,
    atkMult: 0.7,
    speed: 96,
    size: 0.8,
    behavior: "melee",
    range: 0,
    projSpeed: 0,
    atkSpeed: 0,
  },
  tank: {
    hpMult: 3.2,
    atkMult: 1.5,
    speed: 24,
    size: 1.5,
    behavior: "melee",
    range: 0,
    projSpeed: 0,
    atkSpeed: 0,
  },
  ranged: {
    hpMult: 0.8,
    atkMult: 1.1,
    speed: 32,
    size: 0.95,
    behavior: "ranged",
    range: 160,
    projSpeed: 300,
    atkSpeed: 1.7,
  },
};

export interface SkillType {
  cd: number;
  /** AoE radius (swordsman spin / mage meteor); 0 for the archer. */
  radius: number;
  mult: number;
  /** Number of targets (archer spread); 0 otherwise. */
  targets: number;
  /** Skill projectile speed (archer arrows / mage meteor); 0 for the melee spin. */
  projSpeed: number;
}

/** Per-class skill tuning. */
export const SKILL_TYPES: Record<HeroClass, SkillType> = {
  swordsman: { cd: 8, radius: 95, mult: 2.2, targets: 0, projSpeed: 0 },
  archer: { cd: 7, radius: 0, mult: 1.35, targets: 3, projSpeed: 840 },
  mage: { cd: 12, radius: 90, mult: 3.2, targets: 0, projSpeed: 560 },
};

export interface UpgradeLineDef {
  base: number;
  growth: number;
  /** Per-level effect (e.g. +12% atk per level). */
  per: number;
}

/** The three upgrade lines. `speed` alone is capped (see `speedCap`). */
export const UPGRADES: {
  atk: UpgradeLineDef;
  speed: UpgradeLineDef;
  hp: UpgradeLineDef;
} = {
  // M4 tune: atk growth 1.45 -> 1.38. atk is the boss-gating stat (team power =
  // sum of heroAtk), so its high-level cost is what builds the wall. 1.38 barely
  // moves L0-3 costs (25/35/48/66 vs 25/36/53/76) but roughly halves L12+ costs,
  // softening the stage-9 wall (~7.5x -> ~4.9x) and shaving stage 1. It also makes
  // atk the cheapest-GROWTH line, so the cheapest-first auto-buy funnels a bit
  // more into the stat that actually advances the boss gate — without starving hp
  // /speed (final mix stays ~atk 40% / hp 33% / speed 27%, no dominant line).
  atk: { base: 25, growth: 1.38, per: 0.12 },
  speed: { base: 32, growth: 1.55, per: 0.06 },
  hp: { base: 22, growth: 1.48, per: 0.15 },
};

/** Speed-line level cap (POC UP.speed.cap). */
export const SPEED_UPGRADE_CAP = 18;
