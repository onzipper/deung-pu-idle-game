/**
 * Tunable balance constants — ported faithfully from the POC `CONFIG` block
 * (plus the per-type stat tables it kept as separate objects).
 *
 * This is the ONLY home for magic numbers. Systems must read every constant from
 * here so the balance-sim harness can sweep them. Curves are functions of the
 * stage number `n`, exactly as the POC wrote them.
 */

import type {
  HeroClass,
  EnemyKind,
  AttackKind,
  EnemyBehavior,
  StatKey,
  HeroStats,
} from "@/engine/entities";

// M5 Character Pivot (docs/GDD.md v2): the 3-hero team became a SINGLE player
// character. The formation / targeting / multi-hero combat engine is KEPT intact
// (it becomes the M8 party engine) but gameplay spawns exactly ONE hero of the
// chosen class. The three purchasable upgrade lines (atk/speed/hp) are REMOVED —
// power now = level + tier (+ base stats/gear later). Balance is rebaselined for
// solo play (docs/balance-m5.md); the old docs/balance-m4.md team table is
// superseded and kept only for reference.

export const CONFIG = {
  // ---- existing engine-infra keys (do not remove) ----
  /** Speed multipliers the player can toggle. */
  speeds: [1, 2, 3] as const,
  /** Offline idle earnings are capped to this many hours (anti-cheat). */
  offlineCapHours: 8,
  /** Throttle for engine -> UI (Zustand) state sync, in Hz. */
  uiSyncHz: 10,

  // ---- party / hero base ----
  // Party cap (M8 real-time party of ≤3). Solo gameplay spawns 1 hero, but the
  // multi-actor engine is retained for M8, so this stays as the formation cap.
  maxHeroes: 3,
  heroBaseAtk: 10,
  heroBaseHp: 150,
  // Solo RESPAWN (GDD: dead solo hero = respawn, town doesn't exist until M6).
  // The lone hero going down auto-respawns after this many seconds; the
  // battlefield is cleared so it never respawns into a pile-up death spiral
  // (see combat.resolveDeaths). No penalty — respawn at FULL HP.
  heroReviveTime: 4,
  /** Respawn HP fraction (1.0 = full, no death penalty per GDD). */
  reviveHpFraction: 1.0,

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
  // With the upgrade lines REMOVED (M5 Character Pivot), per-hero LEVEL is the
  // PRIMARY interim power axis (base-stat allocation is a later task). The solo
  // hero banks ALL kill XP (no team split); each level grants an atk/hp bonus that
  // must keep pace with the GEOMETRIC enemy/boss HP curve (25 * 1.2^(n-1)), so
  // these are far more generous than the pre-pivot team knobs. NO RNG is drawn
  // here (kills are deterministic); the seeded stream stays wave-composition-only.
  // Sim-rebaselined per class solo — see docs/balance-m5.md.
  leveling: {
    // Level cap; the evolution gate keys off a threshold below this.
    levelCap: 60,
    // Per-level ADDITIVE bonuses (combine additively with the primary-stat atk
    // bonus, then the tier multiplier applies).
    //
    // M5 "Base stats" re-tune (avoid double-counting): pre-stats, LEVELS carried
    // ALL atk scaling at 0.10/level. Base stats now let the player allocate
    // `stats.pointsPerLevel` (3) points per level into the class PRIMARY stat for
    // `stats.atkPerPrimaryPoint` (0.02) each, so an auto-allocated hero adds
    // 3 * 0.02 = 0.06/level of atk from STATS. atkPerLevel is dropped 0.10 -> 0.04
    // so the innate level bonus (0.04) + auto-allocated primary bonus (0.06) sum
    // back to the SAME 0.10/level total power growth as the pre-stats baseline
    // (exact for an organically-levelled hero — see stats.ts / docs/balance-m5.md).
    // Manually diverting points into vit/dex trades atk for survivability/speed.
    atkPerLevel: 0.04,
    // hp stays LEVEL-driven at 0.09/level: auto-allocate feeds the PRIMARY stat
    // (never vit), so if HP scaling moved to vit an idle hero would get none and
    // die. VIT (below) is an OPTIONAL survivability investment ON TOP of this.
    // Unchanged from the pre-stats baseline, so auto-allocated HP == baseline.
    hpPerLevel: 0.09,
    // XP granted to the solo hero per NORMAL enemy kill; scales with stage so
    // deeper (tougher) kills are worth more and leveling keeps pace with HP.
    xpPerKill: (n: number): number => 10 + n * 3,
    // XP granted per BOSS kill — a chunky milestone reward (a level or more).
    xpPerBossKill: (n: number): number => 80 + n * 25,
    // XP needed to advance FROM `level` TO `level+1`. Strictly increasing; gentle
    // geometric growth so the hero keeps leveling deep into the run (reaching
    // ~L40+ by S10) rather than stalling at a hard cap mid-game.
    xpToLevel: (level: number): number => Math.round(30 * Math.pow(1.12, level - 1)),
  },

  // ---- base stats (M5 "Base stats", 86d3jv7m3) ----
  // Four RO-flavoured axes the player allocates on level-up (see entities StatKey).
  // A class's DAMAGE scales off its PRIMARY stat only (str/dex/int); dex also gives
  // a small UNIVERSAL atk-speed factor and vit a UNIVERSAL max-HP bonus. Bonuses
  // are computed from the amount ALLOCATED ABOVE the class base, so a fresh hero
  // sits exactly on its class baseline (stats.ts). Auto-allocate (UI toggle) dumps
  // points into the primary stat so idle players never drown in unspent points.
  // NO RNG (deterministic); the seeded stream stays wave-composition-only.
  stats: {
    // Points granted per level-up. The atk re-tune above is calibrated to this:
    // pointsPerLevel * atkPerPrimaryPoint (3 * 0.02 = 0.06) is exactly the atk/level
    // moved out of the innate level bonus, so auto == baseline (docs/balance-m5.md).
    pointsPerLevel: 3,
    // Per-stat allocation ceiling (no respec in this phase — a future NPC service).
    // Generous; exists only so a hand-edited save can't drive stats to absurdity.
    cap: 999,
    // ATK-mult per PRIMARY-stat point above base (additive with the level bonus).
    atkPerPrimaryPoint: 0.02,
    // HP-mult per VIT point above base (additive with the level hp bonus). VIT is
    // NOT auto-allocated, so this never perturbs the auto baseline — it's the
    // manual "tank" investment. (No mitigation axis exists in combat yet — VIT is
    // HP-only; a defense/mitigation factor is a documented future hook.)
    hpPerVitPoint: 0.03,
    // Universal atk-SPEED factor per DEX point above base (lower cooldown = faster).
    // Deliberately tiny: the archer's PRIMARY is dex, so auto-allocate funnels every
    // point into dex — a large factor would inflate archer DPS out of budget. At the
    // ~S10 clear level (~108 allocated dex) this is only ~+4% attack speed. It is
    // mostly a future-facing hook; a manual off-stat dabbler feels it slightly.
    atkSpeedPerDexPoint: 0.0004,
    // Per-class STARTING stat block (the zero-point for bonuses + the RO-flavour
    // display value). Primary stat highest; vit tracks the class survivability
    // identity (sword tanky, mage squishy). Because bonuses are measured ABOVE
    // base, these values grant NO power themselves — they set where allocation
    // begins. (The class HP identity itself still lives in HERO_TYPES.hpMult:
    // folding it into base vit is rejected because vit isn't auto-allocated, so
    // idle heroes would lose their class survivability — see docs/balance-m5.md.)
    base: {
      swordsman: { str: 8, dex: 4, int: 3, vit: 6 },
      archer: { str: 4, dex: 8, int: 3, vit: 5 },
      mage: { str: 3, dex: 4, int: 8, vit: 4 },
    } satisfies Record<HeroClass, HeroStats>,
  },

  // ---- combat power ("พลังต่อสู้") — the HOF metric + boss-hint gauge ----
  // A single scalar from a hero's EFFECTIVE DPS (basic + skill, so it no longer
  // under-reads the skill-heavy ranged classes the way raw summed atk did) plus a
  // survivability term from max HP. Monotonic non-decreasing in every stat point,
  // level, and tier. Weights are advisory-scale (the sim ignores the hint); tuned
  // so the boss-hint divisor lands "ready" near a real clear (see combatPower).
  power: {
    dpsWeight: 6,
    hpWeight: 0.5,
  },

  // ---- class advancement / evolution (M5 "ปลดคลาส evolution", 86d3jv7m3) ----
  // A second power axis on top of levels: the player pays gold to evolve the hero
  // to tier 2, granting a PERMANENT atk/hp multiplier (systems/stats
  // tierAtkMult/tierHpMult). PLAYER-TRIGGERED (evolveHero intent). Requirements:
  // hero level >= levelRequired AND gold >= cost(classIndex). Rejected (no-op) if
  // unmet or already tier 2. Single path in M5; class-change QUESTS replace the
  // trigger in a later task. With the upgrade-line gold sink gone, gold now
  // accumulates freely, so the gold gate is met quickly and the LEVEL gate times
  // evolution. NO RNG (deterministic).
  evolution: {
    // Level gate — a mid-run milestone ("evolve to power through the next wall").
    levelRequired: 15,
    // Gold cost by class index in SLOT_ORDER (swordsman 0 / archer 1 / mage 2).
    cost: (classIndex: number): number => Math.round(600 * (classIndex + 1)),
    // Permanent tier-2 multipliers. With the ±15% M4 budget gone (full rebaseline),
    // evolution can carry REAL offense again: a meaningful atk + hp jump that helps
    // the solo hero break the boss gate. Sim-tuned per class — see docs/balance-m5.md.
    atkMult: 1.35,
    hpMult: 1.5,
  },

  // ---- flow / progression ----
  // recommendedPower = round(bossHp / this), on the COMBAT-POWER scale (M5 base
  // stats): teamPower is now `sum(combatPower(hero))` (effective DPS + HP), not
  // raw summed atk, so the divisor was re-derived from 26 -> 2 to keep "ready"
  // landing near an actual clear. Advisory only (the sim challenges on the kill
  // goal + retry loop, never this hint).
  bossHintPowerDivisor: 2, // recommendedPower = round(bossHp / this)
  bossRetreatWaveGap: 1.0, // waveGap after a boss retreat / solo respawn
  nextStageWaveGap: 0.8, // waveGap at the start of a new stage

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
  /**
   * Per-class max-HP multiplier on `heroBaseHp` (M5 solo survivability knob):
   * the melee swordsman tanks a wave alone, the squishier ranged classes lean on
   * kiting + AoE. A precursor to full base-stat allocation (a later task).
   */
  hpMult: number;
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
    hpMult: 1.5,
    projSpeed: 0,
    aoe: 0,
  },
  archer: {
    offset: -26,
    attack: "arrow",
    range: 350,
    atkSpeed: 0.72,
    // Solo rebaseline: bumped from the team-era 0.55 — a lone archer needs real
    // single-target DPS (esp. vs the boss, where its arrow-rain AoE barely lands).
    dmgMult: 0.9,
    hpMult: 1.0,
    projSpeed: 660,
    aoe: 0,
  },
  mage: {
    offset: -74,
    attack: "aoe",
    // Solo rebaseline: faster cadence (1.35 -> 1.15) + more base (0.85 -> 1.0) so a
    // lone mage isn't helpless between meteors / on small early waves & the boss.
    range: 330,
    atkSpeed: 1.15,
    dmgMult: 1.0,
    hpMult: 0.95,
    projSpeed: 360,
    aoe: 46,
  },
};

/**
 * Canonical class list. Pre-pivot this was the stage-by-stage hero UNLOCK order;
 * post-pivot the player picks ONE base class at creation (hero-unlock progression
 * removed). Retained as the authoritative ordered class list — the server's
 * known-classes enum and the evolution cost index both key off it.
 */
export const SLOT_ORDER: readonly HeroClass[] = ["swordsman", "archer", "mage"];

/**
 * Each class's PRIMARY (damage-scaling) base stat, and the auto-allocate target
 * (M5 "Base stats"). Mirrors the attack kind: melee→str, ranged→dex, magic→int.
 * The class's `heroAtk` scales off this stat; off-affinity damage stats are inert.
 */
export const PRIMARY_STAT: Record<HeroClass, StatKey> = {
  swordsman: "str",
  archer: "dex",
  mage: "int",
};

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

/**
 * Per-class skill tuning. Skills stay COOLDOWN-ONLY in this task (mana is a later
 * task). For a SOLO hero the skill is a large slice of its effective DPS, so the
 * multipliers are rebaselined per class alongside the leveling curve — see
 * docs/balance-m5.md.
 */
export const SKILL_TYPES: Record<HeroClass, SkillType> = {
  swordsman: { cd: 8, radius: 95, mult: 2.2, targets: 0, projSpeed: 0 },
  // ARROW RAIN (86d3k2t18): `targets` drops fall over the cluster, each a `radius`
  // splash for `mult` * heroAtk. Blankets every enemy in its zone every cooldown
  // (whole-field arc range, see skills.arrowRainRange), so per-drop `mult` is tuned
  // well below a single-hit value to land the intended effective DPS.
  archer: { cd: 7, radius: 44, mult: 0.5, targets: 9, projSpeed: 900 },
  // Solo rebaseline: the meteor is the mage's single-target BURST — its only real
  // answer to a lone boss (its AoE basic is wasted on one target). Bumped cd 12->10
  // and mult 3.2->5.5 so a solo mage isn't walled at late-stage bosses (keeps S10
  // within ~2x of sword/archer — sim-tuned, docs/balance-m5.md).
  mage: { cd: 10, radius: 90, mult: 5.5, targets: 0, projSpeed: 560 },
};
