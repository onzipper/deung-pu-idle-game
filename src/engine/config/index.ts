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
  meleeTargetMinD: -80, // (superseded by symmetric |Δx| ≤ range melee targeting — see combat.ts free-hit fix; kept for reference)
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
  // Free-hit fix ("มอนตีดาบฟรี"): a melee enemy only lands hits inside a CONTACT
  // BAND around the front line. The upper edge is engageX (fX + clash + jitter, its
  // normal front stop); this is the lower edge — how far BEHIND the front hero it may
  // still attack from. When the swordsman sprint-charges (chargeSpeed 265) he outruns
  // slow melee enemies, leaving them behind him; with the POC's one-sided `e.x <=
  // engageX` test they kept plinking him from ARBITRARILY far back (well beyond his
  // 96 melee reach) and he could never retaliate = the "free hit". Kept < swordsman
  // range (96) so any enemy still allowed to attack sits inside his reach; a melee
  // enemy that has fallen further behind than this RE-APPROACHES the line (walks back
  // into contact) instead of free-hitting. Only ever triggers for left-behind enemies
  // — a normally-approaching enemy (e.x > engageX) is untouched, so wave pacing holds.
  // 90 sits strictly inside the swordsman's 96 melee reach, so every enemy still
  // ALLOWED to attack from behind is one he can symmetrically swing back at.
  enemyBehindReach: 90,
  // Free-hit fix (ranged counterpart of enemyBehindReach): a ranged enemy that
  // has ended up beyond EVERY alive hero's reach (the swordsman walled at
  // chargeHardCap becomes its nearest hero, so it parks at range 160 ≈ 930, past
  // his 96 melee reach and the anchor-capped backline's ~834/766 forward reach)
  // HOLDS FIRE and creeps forward at THIS speed until a hero can answer it (see
  // combat.ts). Deliberately far slower than its own approach speed (32): the
  // creep re-creates, as a FAIR fight, the ~10-35 s stall the un-killable shooter
  // used to impose — the clear time the M4.6 table is tuned around — instead of
  // deleting it (a straight pull-in ran S2-S6 25-45 % fast) or inflating it (a
  // freeze ran +9..+97 % and broke the S9 gate). 4 px/s ≈ a ~15 s close over the
  // typical overhang, which sim-lands every stage inside the ±15 % budget (worst
  // S8 +13 %) with the S9 prestige gate (~5x) and 0 wipes preserved.
  rangedReengageSpeed: 4,

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

  // ---- archer ARROW RAIN skill drop pattern (86d3k2t18) ----
  // FIXED per-drop table (length MUST equal SKILL_TYPES.archer.targets). Carries NO
  // RNG on purpose (see archerVolleyOffsets). `dx` spreads the landing x around the
  // cluster centroid so the rain blankets a zone (not a single point); `ry` is extra
  // spawn HEIGHT so the drops fall for slightly different durations and land across
  // several frames (the raining-in look + staggered damage ticks) rather than one
  // lump. Deterministic because the table is constant.
  arrowRainOffsets: [
    { dx: -96, ry: 0 },
    { dx: -72, ry: 34 },
    { dx: -48, ry: 12 },
    { dx: -24, ry: 46 },
    { dx: 0, ry: 20 },
    { dx: 24, ry: 52 },
    { dx: 48, ry: 8 },
    { dx: 72, ry: 38 },
    { dx: 96, ry: 26 },
  ] as const,

  // ---- skills ----
  skills: {
    meteorSpawnY: -48, // meteor projectile spawns at this absolute y (falls to impact)
    mageFallbackAheadX: 150, // if no target, aim the meteor at h.x + this
    // Archer ARROW RAIN ("ฝนลูกธนู"): the skill spawns `SKILL_TYPES.archer.targets`
    // small point-target arrows that FALL from the sky (reusing the meteor mechanic)
    // onto a zone centred on the centroid of the foes within `arrowRainRange`. Each
    // drop is a small AoE (`SKILL_TYPES.archer.radius`) dealing heroAtk *
    // `SKILL_TYPES.archer.mult` (sim-tuned for effective DPS, not raw total). Landing
    // spread + spawn-height stagger come from a FIXED table (`arrowRainOffsets`) —
    // NO RNG (the seeded stream is reserved for wave composition), so it stays
    // deterministic.
    arrowRainSpawnY: -60, // base spawn y (above the top); each arrow adds its ry stagger
    // The rain ARCS from the sky, so it out-ranges the archer's direct-fire basic
    // attack (HERO_TYPES.archer.range 350): the guard + centroid use THIS range. The
    // archer's formation slot sits ~400px back from the enemy line on average, so a
    // 350 cast range gated the skill to ~6% of frames (vs the old spread, which had
    // NO range limit and fired every cooldown) — starving S2/S3 clears. A field-
    // spanning artillery range restores the old cast cadence; per-drop power is tuned
    // (SKILL_TYPES.archer.mult) to keep total DPS in the balance budget.
    arrowRainRange: 760,
  },

  // ---- hero XP / levels (M5 "Character XP + Level system", 86d3jv7m3) ----
  // Per-hero level is a SECOND power axis layered on top of the three global
  // upgrade lines. Kills feed XP to every ALIVE hero (dead heroes earn nothing);
  // enough XP levels the hero, which grants a small per-level atk/hp bonus that
  // COMPOUNDS MULTIPLICATIVELY with the upgrade lines (see systems/stats.ts).
  // These knobs are deliberately conservative: levels must give "constant small
  // wins" (the 30-second goal tier) WITHOUT re-tuning the M4 curves — the balance
  // sim has to stay within ±15% of the docs/balance-m4.md table per stage, keep
  // the ~5x stage-9 prestige gate, and 0 wipes. NO RNG is drawn here (kills are
  // deterministic); the seeded stream stays wave-composition-only.
  leveling: {
    // Generous cap; the evolution card keys off level thresholds below this.
    levelCap: 50,
    // Per-level stat multipliers, compounded MULTIPLICATIVELY onto the upgrade-line
    // multiplier (systems/stats). The split is deliberately ASYMMETRIC and was
    // forced by the sim: team ATTACK is what gates the boss, and the stage-9 wall
    // is a structural knife-edge where team power ≈ the recommended floor, so even
    // a +0.15%/level atk bonus (≈+4% by S9, where heroes reach ~level 26) COLLAPSED
    // the ~5x prestige gate from 628s to 418s (-33%) — outside the ±15% budget and
    // it would require retuning the M4 atk/HP curves (forbidden). atk is therefore
    // held to a token +0.1%/level (S9 stays 633s / 4.9x gate, +1% — sim-verified),
    // and HP carries the felt "small win": +1.5%/level survivability, which does
    // NOT speed clears (waves are DPS-gated, 0 wipes) so it is pacing-neutral. See
    // the M5 section in docs/balance-m4.md for the sweep.
    atkPerLevel: 0.001,
    hpPerLevel: 0.015,
    // XP granted to each alive hero per NORMAL enemy kill; scales gently with
    // stage so deeper (tougher) kills are worth a touch more.
    xpPerKill: (n: number): number => 4 + n,
    // XP granted per BOSS kill — a chunky milestone reward (a level or two).
    xpPerBossKill: (n: number): number => 30 + n * 10,
    // XP needed to advance FROM `level` TO `level+1`. Strictly increasing so early
    // levels pop fast (small wins) and later ones slow down. round() of a geometric
    // curve: L1->2 = 20, doubling roughly every ~4-5 levels.
    xpToLevel: (level: number): number => Math.round(20 * Math.pow(1.15, level - 1)),
  },

  // ---- flow / progression ----
  bossHintPowerDivisor: 26, // recommendedPower = round(bossHp / this)
  bossRetreatWaveGap: 1.0, // waveGap after a boss retreat (team wipe)
  nextStageWaveGap: 0.8, // waveGap at the start of a new stage
  autoUpgradeInterval: 0.15, // seconds between auto-upgrade attempts (POC 150ms tick)

  // ---- boss (movement + slam/enrage tuning) ----
  boss: {
    y: 190,
    // Boss-phase anchor cap (playtest fix "ตัวตีไกลไม่ตีบอส" — ranged heroes not
    // hitting the boss). During the boss phase `getTargets` is the single boss, so
    // `updateAnchor` already tracks (boss.x - battleAnchorLead); but the shared
    // `battleMaxAnchor` (510) clamps the anchor too shallow for a boss that engages
    // near the spawn edge: the boss settles at frontHeroX + clash + engageExtra ≈
    // chargeHardCap(770)+66 = 836, while archer(510-26=484)+range 350 = 834 and
    // mage(510-74=436)+range 330 = 766 both fall SHORT of 836 -> the backline stands
    // idle. This boss-only cap lets the anchor ride up to (boss.x - battleAnchorLead)
    // ≈ 836-150 = 686 so mage(686-74=612)+330 = 942 and archer(686-26=660)+350 = 1010
    // both cover the boss with margin. It is boss-scoped on purpose: raising the
    // GLOBAL battleMaxAnchor would deepen the normal-wave push and blow the pacing
    // budget (see battleMaxAnchor note), whereas a lone boss (no wave stream to walk
    // into) is safe to close on. The swordsman is unaffected — his charge is capped
    // by chargeHardCap(770) regardless of anchor depth, so the boss still engages at
    // ~836 and this only pulls the backline into range. Sim-validated.
    maxAnchor: 700,
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
  /** AoE radius: swordsman spin / mage meteor blast / archer per-rain-drop splash. */
  radius: number;
  /** Damage multiplier on heroAtk. For the archer this is PER falling arrow. */
  mult: number;
  /** For the archer ARROW RAIN this is the NUMBER OF DROPS; 0 for other classes. */
  targets: number;
  /** Skill projectile speed (archer rain-drop fall / mage meteor); 0 for the spin. */
  projSpeed: number;
}

/** Per-class skill tuning. */
export const SKILL_TYPES: Record<HeroClass, SkillType> = {
  swordsman: { cd: 8, radius: 95, mult: 2.2, targets: 0, projSpeed: 0 },
  // ARROW RAIN (86d3k2t18): `targets` drops fall over the cluster, each a `radius`
  // splash for `mult` * heroAtk. Unlike the OLD nearest-3 spread (3 * 1.35 = 4.05
  // heroAtk onto exactly 3 foes) the rain reliably BLANKETS every enemy in its zone
  // every cooldown (whole-field arc range, see skills.arrowRainRange), so per-drop
  // `mult` is tuned WELL below the old per-hit value — 9 * 0.29 = 2.61 nominal — to
  // land the same EFFECTIVE DPS. Sim-tuned to keep S1–S9 time-to-clear within ±15%
  // of the pre-change table (0 wipes). Was { radius:0, mult:1.35, targets:3 }.
  archer: { cd: 7, radius: 44, mult: 0.29, targets: 9, projSpeed: 900 },
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
