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
// Cross-engine deterministic pow (M8 party P1a): every growth curve here raises a
// literal base to an INTEGER exponent (stage/level offsets), so `dpow` is exact
// integer exponentiation-by-squaring — bit-identical on V8/JSC/SpiderMonkey, unlike
// the implementation-defined `Math.pow`. See src/engine/core/dmath.ts.
import { dpow } from "@/engine/core/dmath";

// M5 Character Pivot (docs/GDD.md v2): the 3-hero team became a SINGLE player
// character. The formation / targeting / multi-hero combat engine is KEPT intact
// (it becomes the M8 party engine) but gameplay spawns exactly ONE hero of the
// chosen class. The three purchasable upgrade lines (atk/speed/hp) are REMOVED —
// power now = level + tier (+ base stats/gear later). Balance is rebaselined for
// solo play (docs/balance-m5.md); the old docs/balance-m4.md team table is
// superseded and kept only for reference.

// ---------------------------------------------------------------------------
// M7.9 "Grand Expansion" s16-30 FARM rebalance overlays (docs/balance-m79.md).
// Per-stage multipliers folded into the enemyAtk / enemyHp curves below. They are
// IDENTITY (1.0) for every stage in the frozen bands — enemyAtk ≤ s20, enemyHp ≤ s22
// — so s1-15 AND the now-healthy s16-20 band (fixed via gear DEF + the trimmed aggro
// belt) stay BYTE-IDENTICAL; only the deep frontier is damped. RATIONALE: the shared
// geometric curves (enemyAtk ×1.19^n, enemyHp ×1.20^n) compound past s20 into (a)
// per-hit burst the squishy classes can't survive even in-band gear (archer map5
// farm death-spiral) and (b) a ~780s clear-time wall at s26-29. The overlays bend
// BOTH down GENTLY and WITHOUT a hard cap (the climb stays monotonic / "steepening").
// The BOSS curves (bossAtk/bossHp) are UNTOUCHED here — bosses are tuned only via
// `bossVariety` scales — so this eases FARM pressure alone. killGoal/gold/xpPerKill
// are also untouched, so per-zone leveling+economy stay on-curve (enemyHp damp cuts
// clear TIME via faster TTK, not the kill count → xp/gold-per-zone is preserved).
// Both damps are IDENTITY through s20 (the s16-20 band measured healthy on gear DEF +
// the trimmed aggro belt alone) and engage at s21+. enemyHpDamp is the CLEAR-TIME +
// exposure lever (faster TTK → the single-target archer / adjacent melee spend far less
// time soaking the deep field, which was the real death driver — archer cleared s21 in
// ~2× the mage's time); enemyAtkDamp is the per-HIT burst lever.
//   enemyAtkDamp(n): 1 for n≤15, then 0.92^(n-15)  → s20 ≈0.66, s25 ≈0.44, s30 ≈0.29
//   enemyHpDamp(n):  1 for n≤15, then 0.94^(n-15)  → s20 ≈0.73, s25 ≈0.54, s30 ≈0.40
// The two damps together rescue the squishy single-target ARCHER, whose frontier death
// -spiral was the binding constraint: its weak arrow-rain AoE can't one-shot a cluster,
// so under survivor-retaliation (hunt.ts) every volley WAKES a swarm it then can't
// out-DPS → it is burst through the auto-potion cooldown. Crucially the spiral ORIGINATES
// at s18-20 (the archer died ~180× across map4 while sword/mage sailed through), so the
// damp engages at s16 (NOT s21) to break it at the source — s1-15 stays BYTE-IDENTICAL
// (n≤15 → 1), and the s16-20 band was never a gated invariant. enemyHpDamp turns more of
// the woken cluster from "survivor" into "kill"; enemyAtkDamp (the stronger lever) makes
// the swarm it does wake hit softly enough to tank + pick off single-target. The AoE
// classes (mage meteors, sword whirl) already clear clusters, so both levers
// disproportionately help the archer while only making the (boss-gated) frontier FARMS
// breezier for sword/mage — the frontier's teeth are the s20/25/30 boss soft-walls
// (boss-scaled via bossVariety, untouched by these farm overlays).
const STAGE_ATK_DAMP_FROM = 15;
const STAGE_ATK_DAMP_BASE = 0.92;
const STAGE_HP_DAMP_FROM = 15;
const STAGE_HP_DAMP_BASE = 0.94;
const enemyAtkDamp = (n: number): number =>
  n <= STAGE_ATK_DAMP_FROM ? 1 : dpow(STAGE_ATK_DAMP_BASE, n - STAGE_ATK_DAMP_FROM);
const enemyHpDamp = (n: number): number =>
  n <= STAGE_HP_DAMP_FROM ? 1 : dpow(STAGE_HP_DAMP_BASE, n - STAGE_HP_DAMP_FROM);

// ---------------------------------------------------------------------------
// ดินแดนอสูร (ASURA) hard-map difficulty overlay (endgame v1, docs/endgame-design.md).
// The 7th map "asura" is a 10-zone (stages 31-40) hard endgame run gated behind the s30
// boss (see the `world.maps` block + systems/asura.ts). Its DEPTH-LADDER difficulty is
// owner-target: a +8-refined L60-70 char BARELY survives z1-3, needs +9 for z4-7, +10 for
// z8-10 (below +8 = a wall). These per-zone-depth multipliers apply ON TOP of the base
// geometric enemy curve — but ONLY to the asura stages (31-40), so every s1-30 stage stays
// BYTE-IDENTICAL (the mults are 1 for n < 31). Stages 31-40 are UNIQUE to asura (no other map
// uses them), so keying the overlay off the stage number is equivalent to keying off the map.
// WAVE-4 TUNED (docs/balance-asura.md): the overlay produces a smooth, MONOTONIC total-difficulty
// climb tuned to the SWORD reference (z1-3 real pressure → z4-7 comfy → z8-10 comfy-at-+10). The
// deep-zone mults DAMP (fall z8→z10) to tame the base curve's ~2.3× atk / ~3× hp s31→s40 explosion
// so +10 stays survivable. KEY FINDING (loud flag in the doc): a GLOBAL mult scales all refine
// levels equally, so +8/+9/+10 land near-identical d/100kill — the mults CANNOT gate bands; making
// refine "the key" needs a hard refine-DOOR (game-engine-specialist). Class outliers: mage trivial
// (ceiling), ninja walls z8 / archer runs hot (floor) — global fit can't equalize a ~3× eHP spread.
// Indexed by asura DEPTH (0..9 = z1..z10); the boss room (stage 40) resolves to depth 9.
const ASURA_MAP_ID = "asura";
const ASURA_STAGE_BASE = 31; // asura farm zones = stages 31..40
const ASURA_FARM_ZONES = 10;
// ---- band difficulty overlay (endgame v1, wave 4 sim-tuned) ----
// The owner GATE (docs/balance-asura.md): a +8-refined L60-70 char BARELY survives z1-3 (real
// deaths + potion burn, progresses but does NOT wall), needs +9 for z4-7, +10 for z8-10; +7 and
// below = a hard wall at z1. The refine level must be THE key that opens each band, so each band
// BOUNDARY (z3→z4, z7→z8) costs ≈ +1 refine worth of survivability (~8-10% enemy atk), while
// WITHIN a band the ramp is gentle (no death cliffs). ATK mult drives incoming damage = deaths
// (the primary gate lever); HP mult drives TTK = clear pace (secondary). z1 is deliberately NOT
// trivial — a +8 hero must feel z1-3 (that is the whole point of the +8 barely-survives band).
const ASURA_HP_MULT_BY_DEPTH = [1.15, 1.18, 1.21, 1.3, 1.33, 1.36, 1.39, 1.35, 1.3, 1.25];
const ASURA_ATK_MULT_BY_DEPTH = [1.18, 1.2, 1.22, 1.28, 1.29, 1.3, 1.3, 1.24, 1.18, 1.12];
// ศิลาโซน-INDEPENDENT zone-UNLOCK quota override for asura. The base killGoal(n)=24+12n makes the
// s31-40 quota 396-504 kills/zone — FAR too grindy for zone advancement (owner: pace should feel
// like maps 4-6). asura uses a FLAT quota so climbing the ladder feels like maps 4-6; the long
// tail (the "climb every zone once" craft proof) is the SEPARATE zoneStoneGoal counter (80). Only
// applies to stages ≥ 31, so s1-30 killGoal is BYTE-IDENTICAL.
const ASURA_KILLGOAL = 130;
const asuraDepthOfStage = (n: number): number =>
  Math.max(0, Math.min(ASURA_FARM_ZONES - 1, n - ASURA_STAGE_BASE));
const asuraEnemyHpMult = (n: number): number =>
  n < ASURA_STAGE_BASE ? 1 : ASURA_HP_MULT_BY_DEPTH[asuraDepthOfStage(n)];
const asuraEnemyAtkMult = (n: number): number =>
  n < ASURA_STAGE_BASE ? 1 : ASURA_ATK_MULT_BY_DEPTH[asuraDepthOfStage(n)];

// ---------------------------------------------------------------------------
// M8 party — SAME-ZONE COHORT tuning scalars (docs/party-design-m8.md §3 + answers;
// "Cohort exp pass" in docs/balance-m79.md). Owner rule: farming together in ONE zone
// is REWARDED (exp buff + shared exp) but must NOT become a mandatory meta; drops/gold
// stay personal ("จอใครจอมัน"). These are the only knobs the sim sweeps for the cohort
// reward. They are IDENTITY at solo (size 1) so a 1-hero sim is byte-identical, and every
// derived quantity is a PURE function of the cohort size (heroes present) + the alive
// count — no RNG, no wall-clock — so all cohort clients compute the same result.
//   PARTY_EXP_SHARE_RATE (0.20, TRIMMED from 0.6 — 2026-07-08 "share trim" pass): a kill's xp is
//     credited to the KILLER in full (1.0) and to every OTHER alive cohort hero at this SHARE (they
//     were present/fighting). The engine does NOT attribute kills to a hero (no lastHitBy — that
//     needs a structural change, flagged for game-engine-specialist), so grantKillXp credits the
//     design's §5 EQUAL-to-all-present form: the mean-field of "killer 1.0 + others share",
//     identical in aggregate to per-killer crediting when heroes kill at equal rates (the symmetric
//     cohort case). WHY IT SHRANK: the 0.6 value was COMPENSATION for kill-STARVATION (a cohort's
//     kills/hero/min sat at 45-68% of solo — the field couldn't refill fast enough). The respawn-
//     rate scaling (PARTY_RESPAWN_SCALE_PER_MEMBER, 7778f1c) FIXED that (throughput now ~95-100% of
//     solo), so the 0.6 compensation turned into a SURPLUS: measured per-member party xp had inflated
//     to ×2.7-3.9 at 3p (well over the 1.3-1.5 target band). Trimming share 0.6→0.20 re-seats it —
//     2p lands ~1.0-1.5, 3p compresses from ×2.7-3.9 to ×1.7-2.4. NOTE (owner flag): 3p still sits
//     ABOVE 1.5 at ANY share in the swept 0.20-0.30 range — the residual is a STRUCTURAL co-op
//     snowball (survival → deeper reach → geometric xp/kill) STACKED on the owner-locked +10%/member
//     ladder (×1.20 at 3p) + respawn throughput, none of which the share governs; 0.20 is the value
//     that best approaches the band for BOTH sizes at once (2p archer even dips slightly UNDER). If
//     the owner wants 3p strictly ≤1.5 the lever is the ladder buff (locked) or a reach cap, NOT the
//     share. See docs/balance-m79.md "Party feel pack — share trim".
//   PARTY_EXP_BUFF_PER_MEMBER (0.10): a cohort-wide xp BUFF added per EXTRA member on ALL xp
//     earned — OWNER SPEC (2026-07-08 "party feel pack"): +10% per ADDITIONAL cohort member,
//     so 2p → ×1.10, 3p → ×1.20, … 6p → ×1.50 (`partyExpBuff(size)` = 1 + 0.10×(size−1)). This
//     REPLACES the earlier +0.04 tune (kept small by the buff-vs-ceiling finding below). The
//     owner chose the larger number knowingly (a clear same-zone incentive); the combined net
//     multiplier (this buff × share × the new target-spread throughput lift) is REPORTED to him
//     with a compensating lever (share-rate trim) if it overshoots the old 1.2-1.5 band — the
//     spec is NOT silently reduced. See docs/balance-m79.md "Party feel pack".
//   PARTY_SPAWN_SCALE_PER_MEMBER (0.5): the mob-pool `maxAlive` grows per extra member so a
//     shared field reads FULL for N bodies (2p → ×1.5, 3p → ×2.0). It barely moves throughput
//     (clustering-bound, below) — its job is target AVAILABILITY + a busy group field, NOT a
//     starvation fix. Scales DENSITY only — NOT killGoal (zone-unlock quotas stay personal/
//     unchanged) and NOT the spawn DRAW order (kind→temperament→placement→makeEnemy is
//     unperturbed; a bigger cap just lets the same seeded sequence fill further).
// M8 "party feel pack" (2026-07-08) closed the three "Cohort exp pass" flags: (1) auto-hunt
// TARGET-CLUSTERING is fixed by the deterministic target-SPREAD in systems/combat.updateHeroes
// (each hero prefers the nearest UNCLAIMED farm mob; boss/quest-boss/world-boss = whole party
// dog-piles, per owner "แต่มีบอส ทุกคนต้องรุม"), lifting kills/hero/min out of the 45-65% starve
// band; (2) STAGE bosses stay melty (a party reward), but QUEST bosses now scale HP by headcount
// (PARTY_QUEST_BOSS_HP_PER_MEMBER above); (3) the xp buff is the owner's +10%/extra-member spec
// (see docs/balance-m79.md "Party feel pack" for the measured post-change per-member xp/hr).
const PARTY_EXP_SHARE_RATE = 0.2;
const PARTY_EXP_BUFF_PER_MEMBER = 0.1;
const PARTY_SPAWN_SCALE_PER_MEMBER = 0.5;
// M8 "party feel pack" follow-up (2026-07-08, owner-approved) — per-headcount RESPAWN-RATE
// scaling. PARTY_SPAWN_SCALE_PER_MEMBER above lifts the maxAlive CAP, but a solo hero already
// SATURATES the respawn cadence (respawnDelay-bound), so a bigger cap alone barely moved
// kills/hero/min (stayed 45-68% of solo). Owner call: scale spawn THROUGHPUT with cohort size
// too — the respawnDelay countdown is DIVIDED by (1 + rate×(N−1)) so a 2p field refills ×1.6
// faster / 3p ×2.2, composing 1:1 with the maxAlive scale (cap and refill grow together, the
// field reads full for N bodies AND replenishes as N bodies clear it). xp/gold inflation is
// ACCEPTED (owner: "เงินเฟ้อ เดี๋ยวหากิจมาละลายทีหลัง"). IDENTITY at solo (size 1) → the
// respawn countdown is byte-identical, and the seeded spawn DRAW order is untouched (a faster
// countdown just reaches the SAME kind→temperament→placement→makeEnemy sequence sooner; no solo
// baseline exists for cohorts so a faster stream advance is fine). Sim-swept 0.4-0.7: 0.6 is the
// sweet spot — kills/hero/min rose from 45-68% of solo (respawn-cap starve) to 75-98% (2p ×1.6
// field, 3p ×2.2; the ×2.0 maxAlive cap was the bind before). 0.7 gained nothing at 3p (spread-
// clustering caps kills once the field is full) while inflating xp more; the residual ~75% cases
// (2p archer / 3p sword) are clustering/death-spiral bound, NOT respawn bound.
const PARTY_RESPAWN_SCALE_PER_MEMBER = 0.6;
// M8 "party feel pack" (2026-07-08) — QUEST-boss HP headcount scaling. STAGE bosses stay as-is
// (owner: melting at headcount is a party REWARD, a feature). QUEST bosses — the tier-1 class-
// change exam boss + the tier-2 young-Glacial-Sovereign — must NOT melt to a party ("ไม่มีการ
// จ้างเพื่อนมาสอบผ่าน" / no hiring friends to pass your exam): their HP scales by cohort size so a
// 2-3p exam takes roughly its SOLO duration. Pure fn of headcount (no RNG/wall-clock → all cohort
// clients agree); IDENTITY at solo (size 1) so a 1-hero fight is byte-identical. atk is NOT scaled
// (HP only — the fight lasts longer, it doesn't hit harder). Sim-tuned: 0.8 keeps a 3p quest boss
// near its solo clear time (×(1+0.8×2)=×2.6 hp vs ~2-3× the DPS).
const PARTY_QUEST_BOSS_HP_PER_MEMBER = 0.8;
const partyQuestBossHpScale = (size: number): number =>
  size <= 1 ? 1 : 1 + PARTY_QUEST_BOSS_HP_PER_MEMBER * (size - 1);
// Cohort-wide xp buff from group size S (>=1): 1 at solo, +PARTY_EXP_BUFF_PER_MEMBER per
// extra member. Pure; deterministic (only + - *).
const partyExpBuff = (size: number): number =>
  size <= 1 ? 1 : 1 + PARTY_EXP_BUFF_PER_MEMBER * (size - 1);
// Respawn-delay MULTIPLIER for a cohort of size S (>=1): the delay is DIVIDED by
// (1 + rate×(S−1)) so throughput rises with headcount, composing 1:1 with the maxAlive scale.
// Solo (size 1) → 1 (byte-identical countdown). Pure; deterministic (only + - * /).
const partyRespawnDelayScale = (size: number): number =>
  size <= 1 ? 1 : 1 / (1 + PARTY_RESPAWN_SCALE_PER_MEMBER * (size - 1));
// Per-hero-per-kill xp multiplier for a cohort: the group buff × the EQUAL share of the
// per-kill xp pot (killer 1.0 + each other alive hero PARTY_EXP_SHARE_RATE), distributed
// evenly across the `alive` present heroes. Solo (size 1) → 1 (byte-identical). Only
// + - * / (cross-engine deterministic; no transcendental).
const partyExpKillMult = (size: number, alive: number): number => {
  if (size <= 1) return 1;
  const a = Math.max(1, alive);
  return partyExpBuff(size) * ((1 + (a - 1) * PARTY_EXP_SHARE_RATE) / a);
};

export const CONFIG = {
  // ---- existing engine-infra keys (do not remove) ----
  /** Speed multipliers the player can toggle. */
  speeds: [1, 2, 3] as const,
  /** Offline idle earnings are capped to this many hours (anti-cheat). */
  offlineCapHours: 8,
  /** Throttle for engine -> UI (Zustand) state sync, in Hz. */
  uiSyncHz: 10,

  // ---- world / zones (M6 "World & Town", ROADMAP task 1) ----
  // The world is a set of ordered MAPS (themes). Each map is a left-to-right run
  // of walkable ZONES: farm zones (one existing STAGE each) + a single BOSS ROOM.
  // The TOWN (safe hub + respawn point) is one zone at the LEFT edge of
  // `townMapId`. This REGROUPS the existing stage content (stages 1-5 -> map1's
  // five farm zones, 6-10 -> map2, 11+ -> map3 frontier) — per-zone enemy
  // rosters/scaling are still driven by `state.stage` (= the zone's stage), so
  // combat balance INSIDE a zone is UNCHANGED. Config-driven so M7/M8 add maps by
  // data. Progression + navigation live in systems/world.ts.
  //
  // A farm zone unlocks the NEXT zone once its kill quota (killGoal(stage)) is met;
  // clearing a farm zone grants the SAME xp/gold the old per-stage boss did
  // (xpPerBossKill/goldPerBoss are REUSED, so the leveling curve is preserved
  // WITHOUT a per-zone boss). The boss room unlocks after the last farm zone;
  // beating it unlocks the next map. map3 is the soft-wall frontier (bossStageId 15
  // sits past the current content ceiling — intended; extended by M7/M8 content).
  // Per-map fields:
  //  - `fieldWidth`: the zone's walkable width in engine units (M6 "สนามล่ามอน").
  //    Default = the current screen field (~900, the letterboxed logical width in
  //    render/layout.ts). A wider zone is a DATA change here (+ a camera-follow
  //    render task) — the hunt/spawn systems already read it, so no engine rework.
  //  - `hunt`: the per-map spawn-pool + temperament knobs (see the `hunt` block
  //    below for the shared defaults). `aggroStart`/`aggroEnd` ramp the AGGRESSIVE
  //    fraction across the map's farm zones (index 0 -> last farm before the boss),
  //    so aggression concentrates toward the boss room (GDD). `aggroRadius` is that
  //    map's aggressive aggro range (slightly larger in later maps).
  //
  // M6 "ALIVE FIELD" retune (2026-07-06): `maxAlive` was raised ~2.5× (6-8 -> 15/17/18)
  // so a zone reads as a busy hunting ground, `respawnDelay` cut so the denser field
  // stays populated. Because the aggressive-mob COUNT = aggroFraction × maxAlive, the
  // aggro FRACTIONS were cut in step (map3 0.35-0.60 -> 0.15-0.25) so the belt's
  // ABSOLUTE danger only rose modestly (no meat grinder) — danger toward the frontier
  // now comes mostly from tougher + more-aggressive mobs, not raw body count. The
  // clear-time ballpark is held by the ×1.6 killGoal (see the curve block); see
  // docs/balance-m6.md task 4 for the sim table + the archer frontier caveat.
  world: {
    maps: [
      // M7.7 density retune: maxAlive raised 15/17/18 → 17/19/21 so live fields read
      // ~17/19/21 (owner: "15-20+ ตัว"); respawnDelay cut so the denser field stays
      // full. Because the nuked-up skills + SURVIVOR-RETALIATION (any passive that
      // survives a hero SKILL fights back) add heat, map3's aggro FRACTIONS were
      // trimmed (0.15-0.25 → 0.12-0.20) to keep the belt — not a self-inflicted swarm
      // — the danger source (owner's rule). killGoal ×~1.7 restores clear TIME; xp/gold
      // ÷ the same so per-zone leveling/economy hold (see the curve block).
      {
        id: "map1", zoneStageIds: [1, 2, 3, 4, 5], bossStageId: 5, fieldWidth: 900,
        hunt: { maxAlive: 17, respawnDelay: 0.7, aggroStart: 0.0, aggroEnd: 0.05, aggroRadius: 125 },
      },
      {
        id: "map2", zoneStageIds: [6, 7, 8, 9, 10], bossStageId: 10, fieldWidth: 900,
        hunt: { maxAlive: 19, respawnDelay: 0.6, aggroStart: 0.04, aggroEnd: 0.08, aggroRadius: 145 },
      },
      {
        id: "map3", zoneStageIds: [11, 12, 13, 14, 15], bossStageId: 15, fieldWidth: 900,
        hunt: { maxAlive: 21, respawnDelay: 0.55, aggroStart: 0.1, aggroEnd: 0.16, aggroRadius: 145 },
      },
      // ---- M7.9 "Grand Expansion" world foundation (engine-only first pass) ----
      // Maps 4/5/6 extend the run to stage 30 following the EXACT structural formula
      // of maps 1-3: each map = 5 farm zones (one content stage each) + 1 boss room at
      // the last farm's stage. Per-zone combat balance is still driven by `state.stage`
      // through the SAME parametric curves (killGoal/enemyHp/enemyAtk/goldPerKill/
      // xpPerKill = f(n)), so s16-30 scaling falls straight out of the existing curve
      // block — nothing per-stage is hand-authored, and s1-15 stays byte-identical
      // (these curve functions are untouched). The geometric enemyHp (×1.2^(n-1))
      // naturally STEEPENS toward s30, giving the intended soft-wall (s30 ≈ 15× s15 HP)
      // without a hard cap. Hunt/aggro knobs continue the maps-1-3 ramp (density +
      // aggressive belt climb modestly per map so danger concentrates deeper). Themes
      // are naming/id only here (biomes/art are a render task): map4 ice tundra, map5
      // desert ruins, map6 hell city. FULL rebalance of s16-30 is a LATER wave — these
      // are sane monotonic first-pass numbers, not a tuned curve.
      {
        // map4 — ICE TUNDRA (s16-20). maxAlive 21 (holds map3's dense field),
        // respawn a touch faster, aggro belt one notch above map3's tail.
        // M7.9 rebalance (docs/balance-m79.md): the first-pass aggro fractions (a naive
        // continuation of the maps-1-3 ramp) multiplied the HIGH s16-30 enemyAtk into a
        // farm death-spiral for the squishy classes (archer s16-20 farm deaths 9→91).
        // Because #aggressive = fraction × maxAlive AND each aggressive hit is huge at
        // this depth, the belt was trimmed hard (danger now comes from the tough mobs +
        // gear-gated survival, per the M6 "not a self-inflicted swarm" rule). aggroRadius
        // eased too so fewer mobs latch onto a passing kiter. Maps 1-3 untouched.
        id: "map4", zoneStageIds: [16, 17, 18, 19, 20], bossStageId: 20, fieldWidth: 900,
        hunt: { maxAlive: 21, respawnDelay: 0.5, aggroStart: 0.07, aggroEnd: 0.1, aggroRadius: 140 },
      },
      {
        // map5 — DESERT RUINS (s21-25). M7.9 rebalance: maxAlive eased 23 → 20 — the
        // single-target archer couldn't out-clear a 23-mob field (it cleared s21-24 in
        // ~2× the mage/sword time → ~2× exposure → a farm death-spiral). 20 is still a
        // dense "alive field" but lets the archer keep pace. Modest (trimmed) aggro belt.
        id: "map5", zoneStageIds: [21, 22, 23, 24, 25], bossStageId: 25, fieldWidth: 900,
        hunt: { maxAlive: 18, respawnDelay: 0.5, aggroStart: 0.07, aggroEnd: 0.11, aggroRadius: 138 },
      },
      {
        // map6 — HELL CITY (s26-30). The frontier: dense field (maxAlive eased 25 → 22,
        // same archer-pace reasoning as map5), the widest (but still trimmed) aggressive
        // belt. s30's boss room is the soft-wall gate.
        id: "map6", zoneStageIds: [26, 27, 28, 29, 30], bossStageId: 30, fieldWidth: 900,
        hunt: { maxAlive: 16, respawnDelay: 0.45, aggroStart: 0.09, aggroEnd: 0.13, aggroRadius: 142 },
      },
      // ---- ดินแดนอสูร (ASURA) — hard endgame map (endgame v1, docs/endgame-design.md) ----
      // The 7th map: 10 farm zones (stages 31-40) + a boss-room capstone (stage 40). Follows
      // the EXACT structural formula of maps 1-6 (buildZones appends its boss room), so it needs
      // no world-layout special-casing — combat inside a zone is driven by `state.stage` through
      // the same parametric curves. Its owner-locked DEPTH-LADDER difficulty (+8 barely survives
      // z1-3, +9 z4-7, +10 z8-10) rides the ASURA stat overlay folded into enemyHp/enemyAtk
      // (identity for s1-30 → the canonical s1-30 sim stays byte-identical). UNLOCK is automatic:
      // appended AFTER map6, so clearing the s30 boss unlocks asura z1 through the existing
      // `onBossRoomCleared` map-gate (the tier3GateCleared-style persist gate — see
      // systems/asura.isAsuraUnlocked). Dense field + wide (but trimmed) aggro belt — the frontier
      // of frontiers. The elite roaming mob, แก่นอสูร essence, ศิลาโซน counters, and daily hot
      // zone all live in systems/asura.ts (v1 = map + accrual; craft/secret-quest are a later
      // patch). The s40 boss room is the structural capstone (its daily z10-boss ตราอสูร reward
      // lands with the craft patch); on v1 it is an intentionally hard wall with no reward.
      {
        id: "asura", zoneStageIds: [31, 32, 33, 34, 35, 36, 37, 38, 39, 40], bossStageId: 40, fieldWidth: 900,
        hunt: { maxAlive: 18, respawnDelay: 0.45, aggroStart: 0.1, aggroEnd: 0.16, aggroRadius: 148 },
      },
    ],
    townMapId: "map1",
    // Deterministic walk transit per hop (seconds). Negligible vs clear times;
    // render animates the actual multi-zone walk (a later task). Death respawn
    // reuses `heroReviveTime` as its walk-home time (unchanged death cost).
    transitSeconds: 0.6,
  },

  // ---- ดินแดนอสูร (ASURA) hard-map knobs (endgame v1, docs/endgame-design.md) ----
  // The map itself is `world.maps[6]` (id "asura", stages 31-40); THIS block holds the
  // endgame-v1 accrual systems that ride it (systems/asura.ts). All FIRST-CUT numbers —
  // the sim wave (HARD=1 + REFLVL=8|9|10 fixture-gear sweep) + wave 4 finalize them; v1
  // only BANKS these materials (the craft menu + secret quest are a later patch). Every
  // hook is inert / identity outside asura (stage < 31), so s1-30 stays byte-identical.
  asura: {
    /** The asura map id (mirrors `world.maps[].id`). */
    mapId: ASURA_MAP_ID,
    /** First asura stage (= s31; the 10 farm zones are s31..s40). */
    stageBase: ASURA_STAGE_BASE,
    /** Farm-zone count (the depth ladder's rungs). */
    farmZones: ASURA_FARM_ZONES,
    /** Flat zone-UNLOCK quota for every asura zone (overrides base killGoal for s≥31) — maps-4-6
     *  advance pace, NOT the 396-504 grind. The craft "climb once" proof is zoneStoneGoal. */
    killGoal: ASURA_KILLGOAL,
    /** Per-zone-depth enemy stat overlay (also folded into enemyHp/enemyAtk above) — the
     *  owner-locked depth ladder. Exposed here so the sim + UI can read the band shape. */
    hpMultByDepth: ASURA_HP_MULT_BY_DEPTH,
    atkMultByDepth: ASURA_ATK_MULT_BY_DEPTH,
    /** Which refine level each depth band TARGETS (UI hint + sim readout): z1-3 +8, z4-7 +9,
     *  z8-10 +10 (inclusive 0-based depth ranges). */
    refineBands: [
      { minDepth: 0, maxDepth: 2, refine: 8 },
      { minDepth: 3, maxDepth: 6, refine: 9 },
      { minDepth: 7, maxDepth: 9, refine: 10 },
    ],
    // ELITE roaming mob (deterministic — NO combat-RNG contamination): every `cadence`-th
    // asura farm spawn is promoted to an elite via a plain transient COUNTER (state.asuraSpawnTally),
    // NOT a seeded-stream draw, so spawn composition/placement stays unperturbed. An elite is a
    // NORMAL enemy (spread rules apply — no boss dog-pile) with boosted stats + a big xp/gold/stone
    // burst on kill, and it banks แก่นอสูร essence.
    elite: {
      /** One elite per this many asura farm spawns (rarity knob). */
      cadence: 60,
      /** HP multiplier vs a normal same-stage asura mob. */
      hpMult: 6,
      /** ATK multiplier vs a normal same-stage asura mob. */
      atkMult: 2.2,
      /** Kill xp multiplier (the burst). */
      xpMult: 8,
      /** Kill gold multiplier (the burst). */
      goldMult: 10,
      /** GUARANTEED bonus refine stones on an elite kill (on top of the normal roll). */
      stoneBonus: 20,
      /** แก่นอสูร essence banked per elite kill (accrue-only in v1; craft consumes it later). */
      essence: 1,
    },
    // ศิลาโซน — a per-asura-zone LIFETIME kill counter (SAVE v19 `asuraZoneKills`). Reaching the
    // goal earns that zone's ศิลา (a craft material — banked in v1, spent later). Distinct from the
    // zone-UNLOCK quota (killGoal): this is the "climb every zone once" first-clear proof.
    zoneStoneGoal: 80, // ~60-100 knob
    // DAILY HOT ZONE — one of the 10 asura zones runs hot each Bangkok day (+reward). The client
    // computes the day-key off its wall clock and injects it via the `setAsuraHotZone` intent; the
    // engine resolves the zone deterministically (FNV over the day-key, mod farmZones) and applies
    // the multiplier to xp/gold/stone earned IN that zone — mirroring the world-boss schedule split
    // (pure helper client-side, deterministic apply engine-side; the engine never reads a clock).
    hotZone: {
      /** xp/gold/stone multiplier while farming the day's hot zone (+40%, owner band +30-50%). */
      rewardMult: 1.4,
    },
    // ---- "ตำราตำนาน" secret tome + legendary craft (endgame v1.2/v1.3) ----
    // The SECRET 3-page quest unlocks the craft menu (systems/asura). All FIRST-CUT knobs — the
    // asura SIM/economy wave finalizes them; inert until a hero farms asura, so s1-30 byte-identical.
    tome: {
      /** The asura FARM zoneIdx whose FIRST-EVER kill drops tome page 2 + page 3 respectively.
       *  DEVIATION (docs adapt): v1.3 named "หน้ากระดาษจากบอส z5 + z10", but asura has a SINGLE
       *  unbeatable capstone boss room (s40) and z5 has none — so pages 2-3 anchor to the first
       *  kill in the z5 farm (idx 4, the +9 band) and the z10 farm (idx 9, the deepest +10 farm),
       *  the cleanest depth-anchored triggers that still gate on reaching those bands. Page 1 is
       *  the first ELITE kill (docs: "เศษกระดาษไหม้จาก Elite ตัวแรก"). */
      pageDepthZones: [4, 9] as const,
      /** The tome-craft RECIPE the ENGINE validates + consumes on `craftLegendary` (the counts it
       *  owns): แก่นอสูร essence + ตราอสูร sigils + a gold/stone forge SINK (inflation drain). The
       *  t10-class-weapon consumption + the legendary item MINT are SERVER-side (item-instance
       *  ledger). The 10 ศิลาโซน (all asura zones at `zoneStoneGoal`) are a PERMANENT gate — checked,
       *  never consumed ("ครั้งเดียวตลอดชีพ"). */
      craft: {
        /** แก่นอสูร essence consumed per craft (~10-15 knob; first legendary ≈ 1-1.5 days). */
        essence: 12,
        /** ตราอสูร sigils consumed per craft — v1.3: ×1 for the FIRST legendary (1-day-able). */
        sigils: 1,
        /** Forge gold sink (deliberate inflation drain, docs §3). */
        gold: 50000,
        /** Forge หิน (enhancement-stone / materials) sink. */
        materials: 200,
      },
      /** Sigils granted per DAILY z10 claim (`claimAsuraSigil` — the server stamps the day; the
       *  engine just holds the count like essence, client-authoritative v1). */
      sigilPerClaim: 1,
    },
  },

  // ---- hunting field ("สนามล่ามอน", M6 combat rework, decided 2026-07-05) ----
  // The forward-march wave model is replaced by an OPEN FIELD the hero HUNTS across.
  // A per-zone spawn POOL keeps `maxAlive` mobs on the field (seeded RNG places +
  // composes them — spawn composition/placement is exactly what the RNG stream is
  // reserved for); a killed mob respawns after `respawnDelay`. Mobs idle-WANDER
  // gently around their spawn point via a DETERMINISTIC id-hashed phase (NOT the RNG
  // stream — mid-combat draws stay forbidden). Temperament: PASSIVE (default — never
  // initiates; fights back once HIT) + AGGRESSIVE (an aggro radius — engages when the
  // hero enters it). The AGGRESSIVE fraction ramps per map (`world.maps[].hunt`) so
  // danger concentrates toward the boss rooms. All knobs sim-tuned — docs/balance-m6.md.
  hunt: {
    // Spawn-pool defaults (a map's `hunt` block overrides maxAlive/respawnDelay).
    maxAlive: 7,
    respawnDelay: 1.6,
    /** Delay before the first spawn on zone entry (the field then bursts to full). */
    initialGap: 0.3,
    /** Spawn band as fractions of the zone `fieldWidth` (mobs placed in [min,max]). */
    // Widened (was 0.30-0.96) to spread 15-20 concurrent mobs over a longer stretch
    // so a fuller field reads less clumped. Placement is still uncollided random
    // uniform, so a fuller field WILL visually overlap at points (acceptable for now
    // — flagged in docs/balance-m6.md); a wider band lowers the overlap density.
    spawnMinXFrac: 0.22,
    spawnMaxXFrac: 0.98,
    // Idle wander around the spawn point (deterministic; no RNG). Amplitude in px,
    // a gentle drift speed cap, and an id-hashed frequency spread so mobs desync.
    wanderAmp: 22,
    wanderSpeed: 18,
    wanderFreqBase: 0.5,
    wanderFreqSpread: 0.4,
    /** Default aggro radius (per-map `aggroRadius` overrides). */
    aggroRadius: 150,
    // Hero auto-hunt: walk speed toward the target, the melee stop gap (+approach
    // short), and the ranged standoff (hold at range*frac; kite in below kiteDist).
    huntSpeed: 175,
    contactGap: 34,
    meleeApproachGap: 26,
    rangedStandoffFrac: 0.82,
    /** Engaged melee mob stops this far from the hero before swinging. */
    mobContactGap: 34,
    /** Hero field bounds: left clamp (don't back off-screen) + right margin. */
    heroMinX: 55,
    fieldRightMargin: 24,

    // ---- M6 hunt follow-ups (engine, 2026-07-06 — flagged in docs/balance-m6.md) ----
    // (1) Gradual RE-ENTRY fill. Entering/re-entering a farm zone used to BURST the
    // field to `maxAlive` in one step — on a death respawn that re-swarmed the
    // returning hero instantly (no retreat room; the squishy archer's AoE-aggro
    // death-spiral walled it at s13). Instead the field bursts only THIS FRACTION of
    // `maxAlive` on entry, then the normal respawn cadence (`respawnDelay`) trickles
    // it up to the cap over a few seconds — so a returning kiter gets breathing room
    // while the field refills. Still ends up FULL (the owner's "alive field" intent
    // is preserved; only the first seconds after each entry ramp). Deterministic.
    reentryBurstFrac: 0.35,
    // (2) Min-spacing spawn PLACEMENT (best-candidate). A spawn draws THIS many
    // candidate x's (a FIXED count so the RNG draw-count per spawn stays BOUNDED +
    // deterministic — spawn placement legitimately uses the seeded stream) and keeps
    // the one FARTHEST from the nearest existing mob, so a dense field reads spread
    // out instead of stacking mobs on a point. 1 = plain uniform random (old behaviour).
    spawnCandidates: 7,
    // (3) SURVIVOR-RETALIATION rule (M7.7, replaces the old aoeWakeCap/aoeWakeRadiusFrac
    // AoE-aggro cap). ANY passive mob DAMAGED by a hero SKILL (or any hit) that SURVIVES
    // the hit becomes ENGAGED and fights back; a mob KILLED by the hit does not (it's
    // gone). This is enforced uniformly in `damage.applyDamage` (mob + hp > 0 after the
    // hit → engaged), so it needs NO knob — the M7.7 "เบิ้ม" skills kill most of a
    // cluster outright (killed → silent), and only the TOUGH survivors at the frontier
    // retaliate, which is exactly where the heat should be. Deterministic (no RNG). The
    // old cap knobs are REMOVED; danger is governed by the aggressive belt + how much a
    // skill leaves alive, not a wake cap.
  },

  // ---- NPC shop / consumables (M6 "เมืองหลัก + NPC shops", ROADMAP task) ----
  // The FIRST real gold sink since the upgrade lines were removed (gold otherwise
  // accumulates unused). Three NPC-bought, non-tradable, stackable consumables:
  //   hpPotion     — restore `restoreFrac` of MAX HP (idle sustain; cooldown-gated)
  //   manaPotion   — restore `restoreFrac` of MAX MANA (caster sustain)
  //   returnScroll — teleport to town from anywhere (consumed; instant)
  //
  // PRICING is FLAT (owner call 2026-07-08 "ราคาตายตัว... ไม่อยากให้มันยากไป"):
  // `priceAt(item, stage) = basePrice` — `priceStageBase` is 1.0, killing the old
  // 1.12^(stage-1) depth-scaling that made a frontier hp potion cost 1,605g at s30
  // (players reported being unable to afford potions at all). Base prices are the
  // original early-game-tuned values, so a fresh character's burden is UNCHANGED;
  // everyone deeper simply pays less. KNOWN TRADE-OFF, owner-accepted: late-game
  // gold now accumulates faster (the potion sink no longer tracks income growth) —
  // the owner plans future events/sinks to drain it ("เดี๋ยวเราคอยหา event มาทำให้
  // เงินไม่เฟ้ออีกที"); revisit before the central-marketplace milestone. The
  // scaling machinery (`shopPriceAt`/`shopStageOf`) is kept intact so a future
  // knob-turn can restore depth pricing without a code change. Non-tradable +
  // fungible => plain COUNTS in the save (SAVE v9), NOT M7 item-instances (see
  // entities `ShopItemId`).
  //
  // AUTO-USE (the idle feature): settings-style toggles + thresholds (UI-owned like
  // autoCast, mirrored onto state each frame). `autoDefaults` seeds the initial
  // toggle/threshold values; a step-level, per-type-cooldown deterministic use
  // fires when the pool drops below the threshold (systems/consumables). Defaults
  // ON so idle play benefits without setup (same spirit as autoReturn).
  //
  // Sim-tuned — see docs/balance-m6.md (prices, sustain deltas, gold sink rate).
  shop: {
    /** Max held per item (a hand-edited save can't stockpile absurd counts). */
    stackCap: 99,
    /** Per-stage price multiplier (compounds on `basePrice`). 1.0 = FLAT pricing
     *  everywhere (owner call 2026-07-08); was 1.12 — see the PRICING note above. */
    priceStageBase: 1.0,
    /** Initial (UI-owned) auto-use toggle + threshold values. */
    autoDefaults: {
      hpPotion: true,
      manaPotion: true,
      /** Auto hp-potion fires below this fraction of MAX HP. */
      hpThreshold: 0.35,
      /** Auto mana-potion fires below this fraction of MAX MANA. */
      manaThreshold: 0.25,
    },
    /** The catalog. `restoreFrac` / `cooldown` are 0 for the non-potion scrolls. */
    items: {
      hpPotion: { basePrice: 60, restoreFrac: 0.5, cooldown: 8 },
      manaPotion: { basePrice: 45, restoreFrac: 0.45, cooldown: 10 },
      returnScroll: { basePrice: 150, restoreFrac: 0, cooldown: 0 },
      // "วาปหาเพื่อน" warp scroll (M8, SAVE v17): a party "warp to a friend" hop. Priced
      // ABOVE the return scroll (150) — warping to an arbitrary unlocked zone is worth
      // more than a one-way trip home. (Flat like everything else since 2026-07-08.)
      warpScroll: { basePrice: 200, restoreFrac: 0, cooldown: 0 },
    },
  },

  // ---- "หินเสริมพลัง" enhancement-stone drops (M7.6 follow-up, owner 2026-07-08) ----
  // Refine materials used to come ONLY from SALVAGING gear (cumbersome — owner's word).
  // Stones now DROP from mob kills directly and AUTO-COLLECT into the SAME materials
  // counter salvage feeds (server credits Character.materials idempotently by claimKey).
  // The roll is a STATELESS, domain-tagged hash off the SAME (lootSalt, lootCounter) the
  // gear roll uses (core/hash.stoneFloat) — it consumes NO extra counter tick, so the
  // GEAR-drop sequence is byte-identical and there is no SAVE-shape change. NEVER the
  // wave RNG (reserved for wave composition). All knobs sim-tuned so material income per
  // run ≈ the salvage-era bank (docs/balance-m79.md "หินเสริมพลัง drop conversion").
  //
  // Per NORMAL kill: drop with `dropChance(stage)` = baseChance + (mapTier-1) *
  //   chancePerMapTier (deeper maps drop a touch more often), yielding
  //   qtyBase + (mapTier-1)*qtyPerMapTier whole stones (deeper maps — where refine costs
  //   scale by tier — trickle bigger stacks, matching salvage's own deep-weighted income).
  //   `mapTier` = which of the 6 maps the stage sits in (ceil(stage/5), clamped to count).
  // Per BOSS kill: a GUARANTEED bonus of `bossBonusBase + (mapTier-1)*bossBonusPerMapTier`
  //   stones (a chunky milestone, like the guaranteed boss gear drop) — rolled off the
  //   stone stream but not gated on the drop chance.
  //
  // Tuned (docs/balance-m79.md "หินเสริมพลัง drop conversion"): total stones/run ≈ the
  // salvage-era material BANK (sim: ~8500-9000/run, matched within ±20%). Materials were
  // never the binding refine constraint anyway (banked ~8900 vs spent ~4500 — GOLD gates
  // refining), so refine pacing (+N reached, attempts) is unchanged; this just removes the
  // salvage chore. Deep-weighted like salvage (m1 ~150/run → m6 ~3300/run).
  stoneDrops: {
    /** Per-NORMAL-kill base drop probability at map tier 1 (s1-5). */
    baseChance: 0.18,
    /** Added to the drop probability per map tier deeper (mapTier 2..6). */
    chancePerMapTier: 0.02,
    /** Whole stones granted per NORMAL drop at map tier 1. */
    qtyBase: 2,
    /** +this stones per drop per map tier deeper (tier→qty: 2,3,4,5,6,7). */
    qtyPerMapTier: 1,
    /** GUARANTEED stones a boss drops at map tier 1. */
    bossBonusBase: 8,
    /** Added to the boss stone bonus per map tier deeper. */
    bossBonusPerMapTier: 4,
  },

  // ---- idle bots + fast travel (M7.5 "Sell, Bots & Inventory UX") ----
  // Engine-side, DETERMINISTIC automations (same pattern as autoReturn/auto-potion,
  // no RNG, no wall-clock): a potion-restock bot + a sell-trip bot make a town round
  // trip (warp via a held ยันกลับเมือง scroll, else a direct walk transit — reusing
  // the death respawn's walk-home mechanic), then auto-return to the last farm zone.
  // Fast travel is a player intent: a short damage-cancellable channel then an
  // instant, FREE hop to any UNLOCKED zone (the scroll keeps its value — it warps
  // even while swarmed; fast travel demands a clear standoff). All sim-OFF by default
  // so the balance baseline is byte-identical (docs/balance-m7.md).
  bot: {
    // Seed values for a fresh save's BotSettings (both bots OFF so a cold start /
    // the sim run behave exactly as pre-M7.5). Targets are stack counts.
    defaults: {
      enabled: false,
      sellTripEnabled: false,
      hpPotionTarget: 15,
      mpPotionTarget: 15,
      scrollReserve: 3,
      goldReserve: 0,
    },
    // How long a SELL trip waits in town (s) for the client's async sell API to
    // shrink the fed `inventoryCount` below the cap before giving up and walking
    // home. On give-up the count is latched as a watermark and no new sell trip
    // starts until the count drops below it (or the settings change) — the
    // anti-warp-loop guard (2026-07-06 bug: bot looped town trips burning
    // scrolls whenever the auto-sell rules matched nothing).
    sellDwellSeconds: 6,
  },
  travel: {
    // Fast-travel channel time (s). The hero stands still (no hunt/skills) and any
    // damage taken during it CANCELS the warp (fastTravelBlocked "damaged").
    fastTravelCastSeconds: 1.75,
    // Bot walk-to-town time PER ZONE OF DEPTH (s) when no return scroll is held
    // — a single direct transit whose duration = botWalkSeconds x zoneIdx (min 1).
    // Depth-scaled so the return scroll is a real time-saver from deep zones
    // instead of a pointless purchase (2026-07-06 logic review).
    botWalkSeconds: 1.2,
  },

  // ---- manual play (M7.8 "Manual Play") ----
  // RO-style tap-to-move / tap-to-attack. The player's intents (moveTo /
  // attackTarget / cancelCommand) set the solo hero's transient `command`
  // (systems/manual), honoured by the hunt movement in systems/combat and
  // OVERRIDDEN by the boss phase's forced combat. Deterministic (no RNG, no
  // wall-clock). Sweepable knobs:
  manual: {
    // Arrival epsilon (engine px) for a moveTo command: once the hero is within
    // this of the commanded x the walk COMPLETES (command cleared) and it resumes
    // auto-hunt (AUTO on) / idles (AUTO off). Sized a touch above one hunt-step of
    // travel (huntSpeed 175 × FIXED_DT ≈ 2.9px) so arrival latches cleanly without
    // a jitter overshoot.
    arriveEps: 6,
  },

  // ---- town NPC anchors (M6 town NPCs, phase 2 — engine owns the geometry) ----
  // The two named town actors' WORLD positions + interaction radius (engine units, the
  // same space as the hunt field / render layout). The ENGINE is the single source of
  // truth: render derives its rigs from this (render/townNpcs.ts) and phase-3 UI gates
  // tap-to-talk on `npcInRange` (systems/townNpcs.ts) — so the layer rule holds (engine
  // never imports render). `id` matches entities `TownNpcId`; `x` is the feet anchor at
  // the town's ground line; `radius` is the half-width a hero must be within to interact
  // (the idle bot's auto-walk target + the phase-3 tap gate). ป้าปุ๊ = merchant (buy/
  // sell/salvage — the ONLY NPC the bot transacts with); ลุงดึ๋ง = refine smith
  // (player-only; never botted). Same values render phase-1 shipped with (commit 20b3da3).
  // `npc:elder` (M8 quest Wave C) = ผู้ใหญ่บ้าน the village head, opening the Quest Board
  // panel (main/daily quest claims) — player-only, never botted, same as the smith. x=400
  // sits clear of pahpu (230±42 -> 188-272) and lungdueng (560±42 -> 518-602), and clear
  // of the ambient town-llama patch (~690).
  townNpcs: [
    { id: "npc:pahpu", x: 230, radius: 42 },
    { id: "npc:lungdueng", x: 560, radius: 42 },
    { id: "npc:elder", x: 400, radius: 42 },
  ],

  // ---- party / hero base ----
  // Party cap (M8 real-time party of ≤3). Solo gameplay spawns 1 hero, but the
  // multi-actor engine is retained for M8, so this stays as the formation cap.
  maxHeroes: 3,
  // M8 party — SAME-ZONE COHORT reward/scaling (docs/party-design-m8.md §3 + answers;
  // "Cohort exp pass" in docs/balance-m79.md). Same zone = exp buff + shared exp; gold +
  // drops stay PERSONAL (goldShareMult kept INERT per owner). Every hook is IDENTITY at
  // solo (size 1) so a 1-hero sim is byte-identical, and a PURE function of the cohort
  // size (heroes present) + alive count — no RNG, no wall-clock — so all cohort clients
  // agree. The scalar drafts live above CONFIG (PARTY_EXP_SHARE_RATE / …) so the sim can
  // sweep them; these fields expose them + the derived curves at the kill/xp/spawn sites.
  party: {
    /** Non-killer present hero's share of a cohort kill's xp (killer gets 1.0). */
    expShareRate: PARTY_EXP_SHARE_RATE,
    /** Cohort-wide xp buff added per EXTRA member (2p → +0.10, 3p → +0.20). */
    expBuffPerMember: PARTY_EXP_BUFF_PER_MEMBER,
    /** `maxAlive` growth per extra member so more heroes don't starve one field. */
    spawnScalePerMember: PARTY_SPAWN_SCALE_PER_MEMBER,
    /** Respawn-RATE growth per extra member (delay ÷(1+rate×(N−1))) so throughput scales too. */
    respawnScalePerMember: PARTY_RESPAWN_SCALE_PER_MEMBER,
    /** QUEST-boss (class-change exam + young-Sovereign) HP scale per extra member. */
    questBossHpPerMember: PARTY_QUEST_BOSS_HP_PER_MEMBER,
    // QUEST-boss HP × cohort size (class-change exam + tier-3 young Sovereign only; STAGE
    // bosses untouched). Read by systems/boss.startBossFight. Solo → 1 (byte-identical).
    questBossHpScale: partyQuestBossHpScale,
    // Cohort xp BUFF from group size (design §answers "exp buff"). Solo → 1.
    expBuff: partyExpBuff,
    // Per-hero-per-kill xp multiplier (buff × equal share of killer-1.0 + others-share).
    // Read by systems/leveling.grantKillXp. Solo (size 1) → 1 (byte-identical).
    expKillMult: partyExpKillMult,
    // Per-client gold multiplier for a cohort kill — KEPT INERT (gold is personal per
    // owner "จอใครจอมัน"; each cohort client credits its OWN hero). Identity at any size.
    goldShareMult: (partySize: number): number => {
      void partySize; // inert by design — gold does NOT share in a cohort
      return 1;
    },
    // Mob-pool `maxAlive` scale per cohort size (design §2/§6 "density ต่อหัว"): more
    // heroes → a fuller field so they don't starve each other. Solo → 1 (byte-identical);
    // read by systems/hunt.updateSpawns. Scales DENSITY only, never killGoal (quotas are
    // personal) nor the seeded draw order.
    spawnMaxAliveScale: (partySize: number): number =>
      partySize <= 1 ? 1 : 1 + PARTY_SPAWN_SCALE_PER_MEMBER * (partySize - 1),
    // Mob respawn-DELAY scale per cohort size (owner-approved throughput fix): the delay is
    // DIVIDED by (1+rate×(N−1)) so the field REFILLS faster for more bodies, composing 1:1
    // with spawnMaxAliveScale (a solo saturates the delay cap, so the cap alone barely moves
    // kills/hero/min). Solo → 1 (byte-identical); read by systems/hunt.updateSpawns.
    respawnDelayScale: partyRespawnDelayScale,
  },
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

  // ---- curves (functions of stage n) ----
  // M6 hunt-density retune (2026-07-06): concurrent mobs per zone rose ~2.5×
  // (maxAlive 6-8 -> 15-20) to make the field feel ALIVE. Measured raw throughput
  // then rose ~1.6× (clear times ~halved), so the KILL QUOTA is the lever that
  // restores the M6 clear-time ballpark ("busier, not trivially faster"): killGoal
  // is scaled ×1.6 (10+5n -> 16+8n). Because level/gold-per-zone = quota × per-kill
  // reward, xpPerKill + goldPerKill are divided by the SAME 1.6 below so the
  // leveling trajectory, the map3 power wall, class-change-at-stage-5, and the
  // potion-sink %s all stay on the M6 curve — only the field density changed.
  // M7.7 pacing lever (owner-locked): the "เบิ้ม" skills + denser fields (17/19/21)
  // raised raw kill THROUGHPUT ~1.5×, so killGoal is scaled ~1.5× (16+8n → 24+12n) to
  // hold per-zone CLEAR TIME in the M6/M7 ballpark — difficulty comes from the
  // aggressive belt + survivor-retaliation, NOT the quota. xpPerKill + goldPerKill are
  // divided by the SAME 1.5 below, so per-zone XP/gold (leveling trajectory,
  // class-change-at-s5, potion-sink %s, the map3 wall) are PRESERVED EXACTLY (24+12n =
  // 1.5×(16+8n), so the product killGoal×perKill is byte-identical to the M6 baseline)
  // — same methodology as the M6 task-4 density retune (sim-verified, balance-m7 "M7.7").
  // ASURA override (endgame v1): stages ≥ 31 use a FLAT quota (ASURA_KILLGOAL) so zone-advance
  // pace feels like maps 4-6 instead of the 396-504-kill grind the base curve would impose; the
  // long-tail "climb every zone once" proof is the SEPARATE asura.zoneStoneGoal counter. Identity
  // for n < 31 → s1-30 zone-unlock pace is BYTE-IDENTICAL.
  killGoal: (n: number): number => (n >= ASURA_STAGE_BASE ? ASURA_KILLGOAL : 24 + n * 12),
  // M4 tune: HP scaling exponent 1.23 -> 1.20. `heroAtk` is ADDITIVE
  // (base*(1+per*level)) while enemy/boss HP is GEOMETRIC, so the atk level (and
  // its geometric cost) needed to keep pace grows super-linearly with stage — a
  // wall is structurally unavoidable. 1.20 is identical at stage 1 (exp 0) and
  // only bends the LATE curve down, buying ~1 extra smooth stage and lowering the
  // wall's height without touching the early-game feel. Same base is reused for
  // bossHp, so the boss-power target (rec = bossHp / divisor) softens in lockstep.
  // M7.9: the geometric base is UNCHANGED (s1-15 byte-identical); the s16-30 overlay
  // (enemyHpDamp / enemyAtkDamp, identity for the frozen bands) damps only the deep
  // frontier — see the overlay block above CONFIG for the rationale + curve values.
  // ASURA overlay (endgame v1): `asuraEnemyHpMult`/`asuraEnemyAtkMult` are 1 for every
  // stage < 31, so s1-30 is BYTE-IDENTICAL; they only bend the depth-laddered asura band
  // (s31-40) per the owner's +8/+9/+10 gate. See the overlay block near the damps above.
  enemyHp: (n: number): number =>
    Math.round(25 * dpow(1.2, n - 1) * enemyHpDamp(n) * asuraEnemyHpMult(n)),
  enemyAtk: (n: number): number =>
    Math.round(6 * dpow(1.19, n - 1) * enemyAtkDamp(n) * asuraEnemyAtkMult(n)),
  bossHp: (n: number): number => Math.round(25 * dpow(1.2, n - 1) * 16),
  bossAtk: (n: number): number => Math.round(6 * dpow(1.19, n - 1) * 2.1),
  // M4 tune: gold/kill was purely linear (5 + 2n) while upgrade costs are
  // geometric, so late stages starved and the wall spiked. A gentle 1.05^(n-1)
  // multiplier keeps stage 1-3 values effectively unchanged (7, 9, 12 vs 7, 9,
  // 11) but lets income track the cost curve deeper, converting the old stage-8
  // stall into a comfortable stage and pushing the hard stall out to stage 9.
  // M6 hunt-density retune: base coeffs are the old (5 + 2n) divided by the 1.6×
  // killGoal factor (≈ 3.125 + 1.25n) so gold-per-ZONE = killGoal × goldPerKill is
  // preserved — income trajectory and the depth-scaled potion-sink %s are unchanged.
  goldPerKill: (n: number): number =>
    Math.round(((3.125 + n * 1.25) / 1.5) * dpow(1.05, n - 1)),
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

  // ---- depth PLANE / y-at-spawn (R4 Wave A "engine-owned deterministic y") ----
  // The engine assigns each entity a deterministic ground-plane depth row at spawn
  // (`Entity.planeY`, systems/plane.ts) — the world-y OFFSET (relative to the ground line,
  // 0 = on the line) it sits at for its depth. These knobs are the PORT of
  // render/worldDepth/{depthBand,depthAssign} constants so the value reproduces the render
  // depth every client would otherwise compute (bandFar/bandNear ≡ DEPTH_OFFSET_FAR/NEAR;
  // formationDepth ≡ HERO_SOLO_DEPTH; heroBandMin/Max ≡ HERO_BAND_MIN/MAX). Wave A is
  // BEHAVIOUR-NEUTRAL: `planeY` is unused by combat/movement/targeting and by render placement
  // (render keeps its own depth); it is new deterministic sim state that Wave-B render will read
  // in place of recomputing depth, and the R4-R5 x/y milestone will move entities along.
  // A parity test pins these to the render constants — keep them in lock-step, never diverge.
  plane: {
    /** World-y offset at depth d=0 (far/upstage row, raised toward the horizon). ≡ DEPTH_OFFSET_FAR. */
    bandFar: -24,
    /** World-y offset at depth d=1 (near/downstage row, dropped toward the camera). ≡ DEPTH_OFFSET_NEAR. */
    bandNear: 40,
    /** Party depth-fan band endpoints (a party spreads slot 0..last across [min,max]). ≡ HERO_BAND_MIN/MAX. */
    heroBandMin: 0.45,
    heroBandMax: 0.85,
    /**
     * Per-class hero FORMATION depth (0..1) — the resting plane row each class stands on when
     * SOLO. Class-INDEPENDENT today (render draws every solo hero on the single 0.65 solo row,
     * so all four equal it → behaviour-neutral); kept per-class as the R4-R5 hook to spread the
     * classes onto distinct rows later. ≡ HERO_SOLO_DEPTH.
     */
    formationDepth: {
      swordsman: 0.65,
      archer: 0.65,
      mage: 0.65,
      ninja: 0.65,
    } as Record<HeroClass, number>,
    /**
     * Plane-ease speed (world-y units/sec) for the R4-R5 true x/y movement milestone — entities
     * will EASE toward their target plane row instead of snapping. UNUSED this wave (`planeY` is
     * assigned once at spawn and never moved); a placeholder tunable so the knob exists early.
     */
    ySpeed: 120,
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

  // ---- archer BARRAGE (tier-2 ultimate) drop pattern (M7.7) ----
  // The FIELD-WIDE counterpart of `arrowRainOffsets` (length MUST equal the barrage
  // skill's `targets` = 13). Same NO-RNG contract: `dx` spans ~±420 around the cluster
  // centroid so the 13 drops BLANKET the whole ~900px field (a screen-wide barrage),
  // and `ry` staggers spawn height so drops land across several frames. Deterministic
  // because the table is constant. Reuses the rainArrow fall — no new ProjectileKind.
  barrageOffsets: [
    { dx: -420, ry: 0 },
    { dx: -350, ry: 40 },
    { dx: -280, ry: 14 },
    { dx: -210, ry: 52 },
    { dx: -140, ry: 24 },
    { dx: -70, ry: 60 },
    { dx: 0, ry: 8 },
    { dx: 70, ry: 48 },
    { dx: 140, ry: 20 },
    { dx: 210, ry: 56 },
    { dx: 280, ry: 12 },
    { dx: 350, ry: 44 },
    { dx: 420, ry: 30 },
  ] as const,

  // ---- archer STORM (tier-3 skill-4 "พายุธนูถล่มต่อเนื่อง ~4 วิ") drop pattern (M7.9) ----
  // A SUSTAINED barrage: 20 drops whose LANDINGS SPREAD over ~4s of real time. Same
  // NO-RNG contract as the tables above (length MUST equal archer_storm's `targets` =
  // 20). Reuses the rainArrow fall — NO new ProjectileKind (footgun #6). The ~4s window
  // is engineered PURELY through spawn-height stagger (`ry`): a taller `ry` spawns the
  // drop higher, so it falls LONGER before landing. At the skill's projSpeed 260 the
  // fall-time delta ≈ ry/260 s, so the ry ramp 0 -> 1045 gives a ≈4.0s first-to-last
  // landing window (same trick barrage/arrowRain use, just a bigger table + a MUCH
  // taller stagger). `dx` spans ~±430 so the storm blankets the whole ~900px field.
  // Deterministic (constant table). Verified in the grand-expansion suite's window test.
  stormOffsets: [
    { dx: -430, ry: 0 },
    { dx: 380, ry: 55 },
    { dx: -300, ry: 110 },
    { dx: 250, ry: 165 },
    { dx: -170, ry: 220 },
    { dx: 120, ry: 275 },
    { dx: -40, ry: 330 },
    { dx: 60, ry: 385 },
    { dx: -220, ry: 440 },
    { dx: 300, ry: 495 },
    { dx: -360, ry: 550 },
    { dx: 420, ry: 605 },
    { dx: -110, ry: 660 },
    { dx: 180, ry: 715 },
    { dx: -260, ry: 770 },
    { dx: 340, ry: 825 },
    { dx: -400, ry: 880 },
    { dx: 0, ry: 935 },
    { dx: 230, ry: 990 },
    { dx: -150, ry: 1045 },
  ] as const,

  // ---- mage APOCALYPSE (tier-3 skill-4 "วันสิ้นโลก") meteor-volley pattern (M7.9) ----
  // Several METEOR-kind drops (length MUST equal mage_apocalypse's `targets` = 8) on a
  // FIXED offset table, staggered by spawn height so the volley lands over a window (the
  // meteor counterpart of `stormOffsets`). REUSES the existing meteor ProjectileKind —
  // the skill stays `kind:"meteor"` and the skill code spawns MANY when `targets > 0`
  // (NO new SkillKind, NO new ProjectileKind — footgun #6). `dx` scatters the impacts
  // around the nearest-target centroid; `ry` spreads the landings (at projSpeed 360 the
  // ry ramp 0 -> 980 gives a ≈2.7s volley window). Deterministic (constant table).
  //
  // FIELD-WIDE spread (owner buff 2026-07-08 "ระเบิดทั่ว map"): dx spans −650..+640 with
  // every gap ≤ 230 so at the skill's radius 200 the blasts tile the field with NO dead
  // gap; from any centroid inside the spawn band (0.22–0.98 × fieldWidth 900) the volley
  // covers the ENTIRE band. Deliberately calibrated so a LONE boss still eats exactly 3
  // of the 8 meteors (|dx| < 200: −80/60/190 — same count as the old ±300 table at r150):
  // this is a field-clear buff, NOT a stealth single-target/boss buff.
  apocalypseOffsets: [
    { dx: -650, ry: 0 },
    { dx: 420, ry: 140 },
    { dx: -250, ry: 280 },
    { dx: 640, ry: 420 },
    { dx: -80, ry: 560 },
    { dx: 190, ry: 700 },
    { dx: -450, ry: 840 },
    { dx: 60, ry: 980 },
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

  // ---- ninja dash primitive + skill tunables (SAVE v18, docs/ninja-design.md §1/§3) ----
  // The `dash` reposition (systems/dash.ts) is fully DETERMINISTIC — fixed offsets, NO RNG
  // (the seeded stream stays wave-composition only) and NO wall-clock. Every ninja skill that
  // repositions (เงาพริบ / เงาสังหาร / พันเงานิรันดร์) reads these knobs so the sim can sweep them.
  ninja: {
    // A dash lands this far past the target on the FAR side (blink "through" it), inside the
    // dagger's short reach (70) so the follow-up strike connects. Sized under `range` 70.
    dashLandGap: 18,
    // Max hop distance for the single SHADOW-BLINK (เงาพริบ) — a short teleport, NOT a
    // field-wide leap. The chain (เงาสังหาร) + ult (พันเงานิรันดร์) pass Infinity (unbounded)
    // so they genuinely blink across the whole field; skill cast `range` gates reachability.
    dashMaxReach: 300,
    // TWIN FANG (คมเงาคู่) r`radius` splash: neighbours of the primary take this fraction of a hit.
    twinSplashFrac: 0.6,
    // NOTE: the DASH-EVADE tunables moved OUT of here into the per-class `EVADE_TUNING` table
    // (below HERO_TYPES) when the archer opted into the capability — ninja's numbers are carried
    // there byte-for-byte. `dashLandGap` stays here (it is a dash-PRIMITIVE constant, class-agnostic).
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
    // M7.9 "Grand Expansion": raised 60 → 90 to head-room the s16-30 content. The
    // xp curve (`xpToLevel`, geometric ×1.12/level) is a function of `level`, so it
    // extends to L90 automatically and is LEFT UNCHANGED — raising the ceiling does
    // NOT move any level-up cost for L1-59, so s1-15 leveling stays byte-identical.
    // (A gentler late-curve retune belongs to the later s16-30 rebalance wave.)
    levelCap: 90,
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
    // M7.7: divided by the same 1.5× killGoal factor as the M6 ÷1.6 before it, so
    // xp-per-ZONE = killGoal × xpPerKill is preserved EXACTLY ((6+2n)/1.5 = 4 + 4n/3;
    // 24+12n = 1.5×(16+8n), so the product is byte-identical) — the leveling trajectory
    // (level-at-stage, class-change beat, map3 power wall) is unchanged despite the
    // harder-hitting skills + denser field.
    xpPerKill: (n: number): number => 4 + (n * 4) / 3,
    // XP granted per BOSS kill — a chunky milestone reward (a level or more).
    xpPerBossKill: (n: number): number => 80 + n * 25,
    // XP needed to advance FROM `level` TO `level+1`. Strictly increasing; gentle
    // geometric growth so the hero keeps leveling deep into the run (reaching
    // ~L40+ by S10) rather than stalling at a hard cap mid-game.
    xpToLevel: (level: number): number => Math.round(30 * dpow(1.12, level - 1)),
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
      // Ninja (SAVE v18, docs/ninja-design.md §2): DEX-highest (its damage + speed stat),
      // low VIT (thin body). Total 20 — the same budget band as archer (20) / mage (19).
      ninja: { str: 5, dex: 8, int: 3, vit: 4 },
    } satisfies Record<HeroClass, HeroStats>,
    // ---- auto-allocate v2 ratios (M7.7 "Auto-allocate v2") ----
    // Auto-allocate no longer DUMPS every point into the class primary (which left
    // the squishy ranged classes wall-deep in deaths at the map3 frontier — the
    // dump-primary sim showed the archer drowning: s11→s15 farm deaths 12→87, s15
    // clear ~306s from the death-respawn loop). Instead each class targets a FIXED
    // ratio: the distributor gives each next point to the ratio stat FARTHEST BELOW
    // its target, measured as stats[s]/weight[s] against the hero's CURRENT stats
    // (deterministic tie-break by the fixed str→dex→int→vit order). This converges to
    // the ratio, self-corrects around manual allocations + differing class bases, and
    // needs NO persisted counter. Off-ratio (weight-absent) + capped stats drop out;
    // if every ratio stat is capped the points stay unspent (old room≤0 behaviour).
    //
    // The RATIOS below are SIM-CHOSEN, not the ROADMAP draft — the M7.7-world sim
    // (denser fields + เบิ้ม skills) overruled the 3/2:1/2:1 draft (see the sweep table
    // in docs/balance-m7.md "Auto-allocate v2"). Verdict per class:
    //  - swordsman 4 STR : 1 VIT : 1 INT — the VIT trickle already collapsed the melee's
    //    boss-gate death loop (dump-primary: 183 deaths / 162 boss wipes → 24 / 2). The
    //    owner then asked for a small INT share to ease mana-potion dependency ("มี INT
    //    เพิ่มหน่อย", 2026-07-07): swapping the 4:1 for 4:1:1 HALVES mana-potion burn
    //    (44 → 20 /run, −55%) while farm-zone deaths s1-s14 stay ~identical (the 4:1 → 4:1:1
    //    sweep moved s11-14 farm deaths 0/1/4/3 → 0/1/2/3) at only ~+2% s15 clear time. The
    //    smaller 8:2:1 share gave NO mana relief (still 44/run — INT too diluted), so 4:1:1
    //    is the pick. STR stays the 4/6 majority, so the class's damage identity holds.
    //  - archer 4 DEX : 1 INT — the earlier sweep DISPROVED a VIT share (DEX is damage AND
    //    atk-speed, so diverting to VIT strictly lowered throughput → longer exposure → MORE
    //    deaths; every VIT share regressed, pure DEX was the DEX-vs-VIT optimum). INT is the
    //    exception the owner wanted: the archer was mana-STARVED (114 potions/run cut into
    //    arrow-rain uptime), so a 1/5 INT share RESTORES skill uptime — the recovered AoE DPS
    //    offsets the small DEX loss, so mana-potion burn HALVES (114 → 50 /run, −56%) with
    //    farm deaths FLAT (261 → 266) and s15 clear actually a touch FASTER (315 → 272s).
    //    8:1 gave only −20% (91/run), so 4:1 is the pick. DEX stays the 4/5 majority.
    //  - mage 3 INT : 1 VIT — INT is damage AND the mana pool/regen that fuels the
    //    skill-uptime the caster SURVIVES on, so the mage's safety scales with INT, not
    //    HP: 3:1 (20 deaths / 0 boss wipes) beat both 2:1 (43 / 26) and dump-primary
    //    (50 / 34). A light VIT third adds a little floor without starving mana. (Unchanged
    //    by the 2026-07-07 INT pass — the mage already has all the INT it can use.)
    // The primary/damage stat stays the MAJORITY for every class, so no single build is
    // trivialised and the leveling→power trajectory (class-change s5, s15 soft-wall) holds.
    // Sweepable: the sim reads this table directly.
    autoAllocRatio: {
      swordsman: { str: 4, vit: 1, int: 1 },
      archer: { dex: 4, int: 1 },
      mage: { int: 3, vit: 1 },
      // Ninja SIM ratio (SAVE v18) — OVERRULES the draft 3 DEX : 1 VIT (docs/ninja-design.md §2).
      // Mirrors the sword's 4:1:1 shape: DEX the 4/6 damage+tempo MAJORITY, a VIT third to floor
      // the thin melee body (a range-70 melee eats the aggressive belt — dropping VIT to 4 DEX:1
      // INT reached s30 only 4/5; the VIT third buys consistency, exactly like the sword), and an
      // INT third to deepen the mana pool. INT is sized at 1/6 (not 1/5) deliberately: 1/5 INT
      // (3:1:1 or 4:1) drifts mana burn to ~94 pot/run — near the mage's comfort — while 1/6 keeps
      // it at ~114 in the MARTIAL pressure band the pacing rule wants. Sweep in docs/balance-ninja.md.
      ninja: { dex: 4, vit: 1, int: 1 },
    } as Record<HeroClass, Partial<Record<StatKey, number>>>,
  },

  // ---- mana (M5 "mana + skill framework v2", 86d3jv7m3) ----
  // Skills cost mana AND keep cooldowns (GDD: both). The pool + regen scale off
  // INT above the class base (`stats.base[cls].int`), giving the mage — whose
  // PRIMARY is int, so auto-allocate funnels every point into it — a real caster
  // identity (a deep pool + fast regen it can sustain multiple skills on), while
  // the str/dex classes live on the flat base pool + base regen and must be
  // economical with their one signature cast. CRITICAL (idle guarantee): base
  // regen alone MUST sustain each class's SIGNATURE skill at ~its cooldown
  // cadence, so a mana-starved hero never hard-stalls — a skipped skill is fine,
  // basic attacks (which cost NO mana) always continue and keep banking kills/XP.
  // NO RNG (deterministic). Sim-tuned — see docs/balance-m5.md.
  mana: {
    base: 60, // flat pool every class starts with (before INT scaling)
    perIntPoint: 3.5, // +max mana per INT point above the class base
    // Base regen is sized to sustain each class's SIGNATURE cast (idle guarantee)
    // with only a THIN margin — so a str/dex class (flat base regen) is genuinely
    // mana-gated on its EXTRA skills and can't spam its whole kit (that's the DPS
    // cut mana is meant to impose). The mage's INT-fed regen lifts it clear of the
    // gate, so it sustains its full kit — the caster identity.
    baseRegen: 7, // mana/sec every class regenerates (sustains the signature cast)
    // M7.7: cut 0.15 → 0.06 so MANA governs pacing (owner-locked). The mage's INT
    // pool keeps its sustain IDENTITY — it still sustains signature + frost-nova
    // indefinitely (~10 mana/s < its ~12-14 regen at the frontier) — but the full
    // heavy kit (adding the ~8-9 mana/s CATACLYSM) now EXCEEDS regen, so continuous
    // spam drains even the mage's deep pool → mana potions become a real gold sink
    // for all three classes (str/dex classes, on the flat pool, drain in seconds).
    // The signature-cast guarantee is untouched (baseRegen alone sustains it).
    regenPerIntPoint: 0.05, // +mana/sec per INT point above base (caster identity)
    // ---- M7.9 "Grand Expansion" tier-3 mana-pool bonus ----
    // Tier 3 grants a FLAT pool bump (systems/stats `heroMaxMana`, tier 3 only). A str/dex
    // class sits on the flat base pool (60 + a small INT-share contribution); this bonus is
    // what makes the grander tier-3 skill-4 castable and deepens the reservoir that a mana
    // potion refills (potion restore = restoreFrac × MAX mana).
    // Mana relief pass (owner request 2026-07-08, "มานาใช้เยอะไป ซื้อยามานาจนตังหมด"): raised
    // 90 → 170. This is a DELIBERATELY ASYMMETRIC lever — an ADDITIVE bump is a large % of the
    // shallow str/dex pools (~250 → ~330, +30% restore/potion) but a tiny % of the mage's deep
    // INT-fed pool (~615 → ~695, +13%), so it relieves the flat-pool classes the owner flagged
    // while leaving the mage ~unchanged (sim: mage 94 → 87 pot/run, −7%). Tier-3 ONLY — heroes
    // are tier 1/2 through s15, so s1-15 stays byte-identical. See docs/balance-m79.md
    // "Mana relief pass". The INT-fed mage already has the deepest pool; this lifts it in step.
    tier3PoolBonus: 170,
  },

  // ---- auto-cast slots (M5 "skill framework v2") ----
  // Up to `max` skills can sit in auto-cast slots; a slot at index i only fires
  // once the hero reaches `unlockLevels[i]`. Auto-cast walks the slots IN ORDER
  // (deterministic priority) and casts each slotted skill that is learned, off
  // cooldown, and affordable. The player assigns skills to slots (setAutoSlot
  // intent); slot 0 defaults to the class signature so a fresh hero auto-casts it.
  autoSlots: {
    // M7.9 "Grand Expansion": raised 3 -> 4 (a tier-3 FOURTH slot). The array LENGTH a
    // hero actually holds is tier-scoped (`autoSlotCapacity`): tiers 1-2 keep the
    // historical 3-slot loadout (persisted saves stay byte-identical — slot 3 exists
    // only for a tier-3 hero), so this bump changes NOTHING for a pre-tier-3 save.
    max: 4,
    // Level thresholds that unlock slot 0 / 1 / 2 / 3 (length MUST equal `max`).
    unlockLevels: [1, 15, 30, 40] as const,
    // TIER required to unlock each slot (length MUST equal `max`). The 4th slot (index
    // 3) is gated behind tier 3 AS WELL AS level 40 — `unlockedAutoSlotCount(level,
    // tier)` requires BOTH. Tiers 1-2 therefore only ever see 3 usable slots (unchanged).
    tierRequired: [1, 1, 1, 3] as const,
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
    // M7 gear DEF axis weight in the combat-power scalar. Small: DEF is flat
    // per-hit mitigation, not a big HOF mover, but it must register (monotonic).
    defWeight: 3,
  },

  // ---- gear / drops (M7 "ของดรอปและ Gear", ROADMAP M7) ----
  // Equipped weapon/armor apply FLAT atk/def/hp (systems/stats `equip*Of`).
  // Stats live in `config/items.ts` (pure TS; never the DB). A no-gear hero
  // contributes 0 on every axis, so unarmored combat is byte-identical to pre-M7
  // (the balance-m6 curves are untouched — docs/balance-m7.md). DEF is FLAT
  // per-hit mitigation applied in systems/damage; a hit is floored so armor can
  // never make a hero unkillable. Sim-swept.
  gear: {
    /** A mitigated hero hit never drops below this many points (armor floor). */
    minDamage: 1,
  },

  // ---- class advancement / evolution (M5 "ปลดคลาส evolution", 86d3jv7m3) ----
  // A second power axis on top of levels: the player advances the hero to tier 2,
  // granting a PERMANENT atk/hp multiplier (systems/stats tierAtkMult/tierHpMult).
  // PLAYER-TRIGGERED (evolveHero intent) but the TRIGGER is now the class-change
  // QUEST (M5 task 5, `quest` below): the old gold cost is GONE — quest EFFORT
  // replaces it. Requirement: tier 1 AND the class-change quest is COMPLETE
  // (systems/quests `isQuestComplete`); the quest is itself only offerable at
  // `levelRequired`, so the level gate still times the beat. Rejected (no-op) if
  // unmet or already tier 2. Single path in M5. NO RNG (deterministic).
  //
  // ECONOMY NOTE (task 5): removing the gold cost leaves NO gold sink until M6/M7
  // (NPC potions, marketplace) — gold accumulates freely by design; the pacing
  // that the gold gate used to add is now carried entirely by the quest objectives.
  evolution: {
    // Level gate — the class-change quest is auto-offered here (mid-run milestone).
    levelRequired: 15,
    // Permanent tier-2 multipliers. With the ±15% M4 budget gone (full rebaseline),
    // evolution can carry REAL offense: a meaningful atk + hp jump that helps the
    // solo hero break the boss gate. Sim-tuned per class — see docs/balance-m5.md.
    atkMult: 1.35,
    hpMult: 1.5,
    // ---- M7.9 "Grand Expansion" tier-3 class advancement ----
    // The SECOND evolution: tier 2 -> tier 3 (จอมอัศวิน/ราชันพราน/อาร์คเมจ). Gated by
    // the tier-3 quest (kills in map3 + a REPEAT map2-boss kill, no refine condition —
    // see systems/quests). The tier-3 multipliers compound MULTIPLICATIVELY on top of
    // the tier-2 ones (systems/stats `tierAtkMult`/`tierHpMult`): tier 3 effective atk =
    // atkMult × tier3.atkMult, hp = hpMult × tier3.hpMult. This is the designed POWER
    // SPIKE that breaks the s15 wall -> beat the s15 boss -> enter map4. Level gate 40
    // (needs the L90 cap headroom from the world foundation). First-pass numbers; the
    // s16-30 rebalance wave will sim-tune them.
    tier3: {
      levelRequired: 40,
      atkMult: 1.6,
      hpMult: 1.7,
    },
  },

  // ---- class-change quest (M5 "เปลี่ยนคลาสผ่านเควส" v1, ROADMAP task 5) ----
  // The tier-1 -> tier-2 class change is gated by a lean QUEST instead of gold.
  // Auto-offered at level >= evolution.levelRequired while tier 1; the player
  // accepts (acceptQuest intent), objectives then count deterministically from the
  // hero's own kills / boss defeats (systems/quests, driven by combat — NO RNG, no
  // wall-clock), and completing them makes the class change available. Numbers are
  // sim-tuned so completion lands on the same mid-game beat the old ~level-15 gold
  // gate did (see docs/balance-m5.md "Class-change quest timing"). Same objective
  // numbers for every class in v1; per-class quest IDS (systems/quests
  // `classChangeQuestId`) let M8's full quest system diverge them later.
  quest: {
    classChange: {
      // Enemy kills to bank after accepting (the grind portion of the effort gate).
      kills: 60,
      // Boss defeats required (a stage-clear milestone — proves real progress).
      bossKills: 1,
    },
    // ---- M7.9 "Grand Expansion" tier-3 (class-3) quest — REDESIGN (owner "option ข", 2026-07-08) ----
    // The tier-2 -> tier-3 evolution key (offered at level >= evolution.tier3.
    // levelRequired while tier 2). REDESIGNED to tie into the NEW M7.9 frontier instead
    // of backtracking to the map2 boss: a SINGLE kill objective, MAP-SCOPED to the
    // ICE-TUNDRA FRONTIER field map4 zone 1 (s16, "ทุ่งหน้าด่านทุนดรา"). NO boss objective
    // (removes the confusing map2 backtrack) + NO refine-level condition (owner).
    //
    // Accepting the quest PREVIEWS map4 zone 1 (ONLY zone 1 — the world-unlock system
    // grants deterministic quest-derived access there, systems/world `questGrantsZoneAccess`;
    // zones 2+ and the boss room stay gated behind the s15 boss kill). A tier-2 Lv40 hero
    // fast-travels into the frontier, banks the kills as a genuine (dangerous) expedition,
    // then evolves — the atk×1.6/hp×1.7 spike that breaks the s15 wall. After tier-3 the
    // hero returns, beats the s15 boss, and the NORMAL unlock takes over (the grant is not
    // a persisted unlock — see systems/world). Same numbers per class in this pass;
    // per-class quest IDS (`tier3QuestId`) let a later pass diverge them.
    //
    // `kills` is SIM-TUNED (docs/balance-m79.md "Tier-3 quest redesign"): map4 s16 mobs are
    // far tougher than map3's (the old count was 120 in map3), so the count scales DOWN to a
    // serious-but-fair frontier gate a tier-2 hero can bank without a permanent stall.
    //
    // ---- M7.9b tier-3 quest BOSS objective (owner 2026-07-08, "fight the MAP4 boss") ----
    // A SECOND objective now follows the kill grind: defeat the map4 boss (a QUEST-SCALED
    // "young" Glacial Sovereign). The real s20 Sovereign (bossVariety[20]: hp×0.7/atk×0.62)
    // is tier-3-tuned and provably unbeatable at tier 2, so while the tier-3 quest is the
    // ACTIVE reason for boss-room access (tier-2 hero, quest held, boss objective pending —
    // systems/quests.isTier3QuestBossFight) the Sovereign spawns with these gentler scales
    // instead (systems/boss.startBossFight → makeBoss override). It KEEPS the CHARGE mechanic
    // + telegraphs (teaching the s20 fight early) — only its hp/atk soften. A tier-3 hero (or
    // anyone post-quest) entering that room later gets the REAL s20 boss: the override keys off
    // the QUEST STATE, never hero tier alone. Scales are on the SAME base-curve basis as the
    // bossVariety row (× bossHp(20)/bossAtk(20)); SIM-TUNED (docs/balance-m79.md "Tier-3 quest
    // boss") so every class needs a real, multi-attempt-tolerant fight the squishiest tier-2
    // Lv40 (archer) survives (the charge hit = round(atk×charge.hitMult 1.6) stays well under
    // the archer's ~1000 tier-2 HP). Access to the boss room EXTENDS the quest's derived,
    // never-persisted grant (systems/world.questGrantsZoneAccess) once the kills are banked;
    // zones 2-5 stay locked and beating the young Sovereign does NOT unlock map5 (the hero
    // still returns to beat the REAL s15 boss for the persisted map4 unlock).
    tier3: {
      // Kills to bank in the map4-zone-1 frontier field (the FIRST objective).
      kills: 90,
      // Boss defeats required in map4 — the young Glacial Sovereign (the SECOND objective).
      bossKills: 1,
      killMapId: "map4",
      // Quest-scaled young-Sovereign hp/atk (× the s20 base curve; softer than the real
      // bossVariety[20] 0.7/0.62 so a tier-2 Lv40 hero can win it in a real fight).
      bossHpScale: 0.58,
      bossAtkScale: 0.5,
    },
  },

  // ---- M8 MAIN quest line (Wave A, design doc §1 "ห่อ goal-ladder เดิม") ----
  // The main line is a CHAPTER CHAIN, one chapter per world map. A chapter is a PURE
  // DERIVATION of existing progression (`systems/mainQuest.isChapterComplete`) — it is
  // "complete" once that map's boss is cleared (the NEXT map's first zone is persist-
  // unlocked; the LAST map keys off `bossBest[bossStageId]`). So there is NO second
  // progression source of truth (the game's worst bug class): only the CLAIMED-reward
  // set persists (`hero.mainClaimed`). Rewards are gold / refine stones / potions ONLY —
  // NEVER power items (owner taste). `id` is the i18n + claim key (quest.main.<id>).
  // ORDER MUST match `world.maps` (chapter i ↔ map i). First-pass numbers; sim-tunable.
  mainQuest: {
    chapters: [
      { id: "chapter_map1", mapId: "map1", reward: { gold: 400, materials: 15 } },
      { id: "chapter_map2", mapId: "map2", reward: { gold: 900, materials: 30, hpPotion: 5 } },
      { id: "chapter_map3", mapId: "map3", reward: { gold: 1800, materials: 60, manaPotion: 5 } },
      { id: "chapter_map4", mapId: "map4", reward: { gold: 3200, materials: 100, hpPotion: 8 } },
      { id: "chapter_map5", mapId: "map5", reward: { gold: 5200, materials: 150, manaPotion: 8 } },
      { id: "chapter_map6", mapId: "map6", reward: { gold: 8000, materials: 220, hpPotion: 10, manaPotion: 10 } },
    ],
  },

  // ---- M8 DAILY quests (Wave A, design doc §2 "presence ไม่ใช่ optimal-play") ----
  // A per-hero roster of `rosterSize` daily quests, CHOSEN SERVER-SIDE (seeded from the
  // serverDay + user material — the engine never reads calendar time, keeping purity) and
  // fed in via the `setDailies` intent. Each catalog entry is a "presence" objective: it
  // gives a reason to come back WITHOUT FOMO (no streak-punish, no power/gate reward — all
  // rewards are gold / stones / potions ONLY, owner taste). The engine COUNTS progress at
  // the emission choke points + validates claims client-side (server re-validates). `id` is
  // the i18n + claim key (quest.daily.<id>). Content scales by adding a catalog entry + i18n
  // key — no logic change. First-pass numbers; sim-tunable.
  dailyQuests: {
    /** How many dailies a hero holds at once (echoes the 3 auto-cast slots — design §2). */
    rosterSize: 3,
    catalog: {
      daily_kill: { type: "killAnywhere", target: 120, reward: { gold: 350 } },
      daily_refine: { type: "refineOnce", target: 1, reward: { materials: 40 } },
      daily_potions: { type: "buyPotions", target: 10, reward: { gold: 250 } },
      daily_spend: { type: "spendGold", target: 2500, reward: { materials: 30 } },
      daily_boss: { type: "clearAnyBoss", target: 1, reward: { gold: 600, hpPotion: 3 } },
    },
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

  // ---- boss variety roster (M7.9 "Grand Expansion" behavior wave) ----
  // A per-boss-room table keyed by the room's content stage (the map's `bossStageId`).
  // Live stats derive from the parametric `bossHp/bossAtk` curves via `makeBoss`,
  // then multiply by per-boss `hpScale`/`atkScale`. Maps 1-3 stay IDENTITY (1) so the
  // OLD fights are byte-identical. The maps-4-6 bosses take a FIRST-PASS softening
  // below 1: the raw curve past the old s15 wall is far too steep for even a max
  // tier-3 hero (sim-verified: an L90 t3 hero in full t10+10 gear wipes on the raw
  // s25/s30 boss), and the added signature mechanic stacks MORE pressure on top, so
  // these scales bring the fights into "hard but breachable by a well-geared+refined
  // tier-3 hero" — the design's soft-wall (s30 breachable, not a hard cliff). The
  // PRECISE s16-30 curve/scale tuning is the NEXT rebalance wave; these are sane
  // first-pass numbers (sim smoke green — see docs/balance-m7 follow-up).
  // `behaviors` drives the mechanics in systems/boss.ts: every boss keeps the base
  // `slam`+`enrage` kit; maps 4-6 LAYER one signature mechanic:
  //   map4 s20 = CHARGE, map5 s25 = SUMMON, map6 s30 = FIELD HAZARD.
  // Bosses s5/s10/s15 omit the new tags, so `updateBoss`'s classic path is unchanged
  // for them (byte-identical). Mechanic tunables live in `bossBehavior` below.
  // `EnemyKind` is not imported here — the summon add-kind list lives in
  // `bossBehavior` as plain strings, cast in systems/boss.ts.
  bossVariety: {
    // Existing bosses (maps 1-3) — Slam + Enrage only, IDENTITY scale (UNCHANGED).
    5: { theme: "map1", hpScale: 1, atkScale: 1, behaviors: ["slam", "enrage"] },
    10: { theme: "map2", hpScale: 1, atkScale: 1, behaviors: ["slam", "enrage"] },
    15: { theme: "map3", hpScale: 1, atkScale: 1, behaviors: ["slam", "enrage"] },
    // New bosses (maps 4-6) — base kit + one signature mechanic. M7.9 s16-30 rebalance
    // wave (docs/balance-m79.md): the first-pass scales were tuned for the MAGE (ranged
    // burst + apocalypse) and walled the melee/archer — sword s20 3/5, s25 0/5; archer
    // s20 1/5 (848 wipes) — because the signature mechanic (charge/summon) stacks lethal
    // pressure the two non-caster classes can't kite. Softened atk (the wipe driver) more
    // than hp, so the fights stay LONG (real DPS checks) but survivable-without-perfect-
    // play at the intended gear band (t7/t8 @ s20, t8/t9 @ s25). s30 stays the hard
    // soft-wall (breachable only by a t9/t10-refined tier-3 hero — verified BOSSISO=1).
    20: { theme: "ice-tundra", hpScale: 0.7, atkScale: 0.62, behaviors: ["slam", "enrage", "charge"] },
    25: { theme: "desert-ruins", hpScale: 0.3, atkScale: 0.4, behaviors: ["slam", "enrage", "summon"] },
    30: { theme: "hell-city", hpScale: 0.24, atkScale: 0.4, behaviors: ["slam", "enrage", "hazard"] },
  } as Record<number, { theme: string; hpScale: number; atkScale: number; behaviors: string[] }>,

  // ---- boss signature-mechanic tunables (M7.9 behavior wave) ----
  // DETERMINISTIC: no RNG-stream draws — fixed timing / HP-threshold / offset tables
  // (the seeded stream stays wave-composition only). First-pass numbers; the s16-30
  // rebalance wave tunes them. CHARGE + HAZARD are CHANNELED (the boss's Slam +
  // normal attack pause while it winds up / acts); SUMMON is instantaneous (layers on
  // top of the base kit). All drive systems/boss.ts.
  bossBehavior: {
    // CHARGE (map4 s20): telegraph a dash at the hero's current x, then rush and hit
    // every hero within `hitRange` of the landing point for `hitMult × atk`. The
    // target x locks at telegraph time (a fair, positional read).
    charge: {
      cd: 8.0, // seconds between charges (idle → windup, at engage range)
      cdEnraged: 5.0,
      telegraph: 0.85, // wind-up before the dash launches
      dashSpeed: 460, // px/s during the rush (fast — the "heavy" read)
      stopGap: 40, // the dash stops this far in front of the locked target x
      // M7.9 rebalance: 95 → 78. The charge locks the landing on the hero's x at
      // telegraph time; a wide hit zone caught the RANGED classes even at standoff
      // (archer s20 3/5). A tighter zone rewards not standing on the marked x — the
      // ranged classes can drift clear, the melee (who must be adjacent) still eats it.
      hitRange: 78, // heroes within this of the landing point take the hit
      // M7.9 rebalance: 2.4 → 1.6. At s20 boss atk (softened to atkScale 0.68) a 2.4×
      // charge one-to-two-shot the melee/archer (who MUST close), turning the fight into
      // a coin-flip (sword 3/5, archer 1/5). 1.6× keeps the charge a scary telegraphed
      // spike (~2× a normal hit) that punishes standing in it, but a full-HP tier-3
      // hero survives one and can react — the fight becomes a DPS check, not a lottery.
      hitMult: 1.6, // charge damage = round(atk × this)
    },
    // SUMMON (map5 s25): at each descending HP fraction, spawn ONE wave of adds that
    // flow through the normal enemy list (pooled render views key by entity id). Adds
    // are engaged-on-spawn + hunt the hero, and JOIN the boss-phase target set so the
    // hero can kill them. Instantaneous (does not pause the boss's base kit).
    summon: {
      // M7.9 rebalance: 2 waves ([0.6,0.3]) → 1 wave ([0.45]). The s25 boss's adds join
      // the boss-phase target set AND hunt the hero, so a solo squishy took boss + add
      // pressure at once and never out-DPS'd the second wave (sword 0/5). One mid-fight
      // wave keeps the "clear the adds or get overwhelmed" beat without a compounding
      // second swarm — the fight stays a hard DPS/priority check the melee can win.
      thresholds: [0.45], // fire when boss.hp ≤ maxHp × this (1 wave)
      // M7.9 rebalance: ["fast","normal"] (2 adds) → ["normal"] (1 add). During the
      // ~35-40s the SINGLE-TARGET archer needs to down the s25 boss, two hunting adds
      // stacked enough extra hits to wipe it (archer s25 boss 1/5). One add keeps the
      // "handle the summon" beat without out-damaging the squishy classes' HP pool.
      addKinds: ["normal"], // fixed composition per wave (cast to EnemyKind); 1 add
      spawnSpacing: 70, // px between adds (first add sits this far behind the boss)
    },
    // FIELD HAZARD (map6 s30): a telegraphed arena-wide danger wave the hero must
    // out-heal / out-DPS. A WARN window (telegraph) then a STRIKE window that ticks
    // damage to EVERY alive hero (position-independent — the arena is the threat).
    hazard: {
      cd: 8.5, // seconds between hazard channels
      cdEnraged: 5.5,
      telegraph: 1.3, // arena-wide warning window before the strike
      duration: 1.0, // strike-window length
      tickInterval: 0.3, // seconds between damage ticks during the strike
      tickMult: 0.3, // per-tick damage to every hero = round(atk × this)
    },
  },

  // ---- WORLD BOSS "เสี่ยจ๋อง" (hourly world boss — engine wave) ----
  // An hourly PARTY-GATED world boss. It spawns at the TOP OF EVERY HOUR in ONE
  // deterministically-chosen FARM zone of map1 (`worldBossZoneFor` over the windowId),
  // lives `lifetimeMs`, then despawns. The CLIENT computes the wall-clock schedule
  // (`worldBossPhaseAt`) and injects the `spawnWorldBoss` FrameInput while the player
  // stands in the chosen zone — the engine never reads a wall clock. The boss REUSES the
  // enemy pipeline (targeting/hits, systems/targeting getTargets + combat findById) and
  // the M7.9 boss-mechanic machinery (systems/boss.updateBossEntity), themed via the
  // `worldBoss` marker. Rewards are SERVER-claimed — the engine grants NO xp/gold and the
  // kill NEVER counts toward killGoal/zoneKills/quests; it emits only `worldBossDefeated`.
  //
  // AGGRO = PASSIVE-until-attacked (owner rule "never farms newbies"): map1 is where NEW
  // players roam, so the boss stands idle at the spawn edge and does NOT approach/attack
  // until a hero has DAMAGED it (hp < maxHp). A cautious/idle player is never farmed; an
  // auto-hunting hero that swings at it engages it (that is on the player).
  //
  // TUNING — BALANCE-WAVE (docs/balance-worldboss.md; WORLDBOSS=1 sim mode, DETERMINISTIC —
  // the isolated boss fight draws no RNG). Set DIRECTLY (not off the s5 `bossHp` curve).
  //  - `hp` (1.9M) is the SOLO GATE. A key sim finding overturned the first-pass "solo dies →
  //    boss despawns" plan: `updateWorldBossAI` is SKIPPED while `traveling`, so a solo hero's
  //    death → auto-return round-trip (town is map1 too) keeps it continuously traveling and
  //    the boss NEVER despawns — a solo just loses ~4.7 s/death and grinds on. So the gate is
  //    a pure HP/uptime wall: a maxed L90 t10+10 SWORD and ARCHER can't out-DPS 1.9M in 15 min
  //    (they chunk ~77-99% and survive with potions — a wall, not an instakill, ~16-46 deaths).
  //  - IRREDUCIBLE LEAK (owner-flagged): a maxed L90 MAGE (high-DPS ranged, evades slam and
  //    kites charge) still finishes at ~13 min. NO hp keeps a 2p party viable AND stops the
  //    mage — party total DPS is only ~1.75× a maxed solo's, so the two targets are partly
  //    mutually exclusive. Fully gating the mage needs a STRUCTURAL fix (min-2-heroes-to-damage,
  //    a game-engine-specialist change), not a knob. Accepted + documented.
  //  - `atk` (800) + slam ×2.2 / charge ×2.2 are the SINGLE-TARGET gate: they concentrate on the
  //    lone solo hero but a party ROTATES the aggro (front hero tanks/dies/revives-in-place while
  //    the backline DPSes untouched) — the structural party advantage. `hazard` ×0.10 is kept LOW
  //    on purpose: it's ARENA-WIDE (hits every hero at once) so a high tick would wipe a whole
  //    party during a channel; the gate rides slam/charge, not hazard.
  //  - Party pacing (Lv60 t8+6): 2p ~12.5 min, 3p ~9.8 min, 6p ~4.6 min; it MELTS with power —
  //    endgame parties (Lv80-90) 3p ~6 min / 6p ~3 min. The "~3-6 min for 2-3p" aspiration only
  //    holds for endgame parties; a Lv50-70 2-3p runs 8-12 min (still a one-window clear). This
  //    is the flip side of the HP wall that gates the solo — see the doc's tradeoff table.
  //
  // MECHANICS (3, telegraphed): base `slam`+`enrage` + `charge` (dodgeable dash — drift off
  // the marked x) + `hazard` (arena-wide channel — a party out-heals/out-DPSes it). SUMMON
  // is deliberately OMITTED: its adds flow into `state.enemies` and would pollute the farm
  // kill-quota (killGoal/zoneKills) — kept out by design. Windups are a touch LONGER than
  // the s20/s30 boss (open-field dodging). All DETERMINISTIC (fixed timing tables — NO RNG
  // stream draw, NO loot-counter tick, so the mob/loot sequences stay byte-identical with a
  // world boss present). Mirrors CONFIG.boss / CONFIG.bossBehavior shape so
  // systems/boss.updateBossEntity runs it unmodified.
  worldBoss: {
    periodMs: 3_600_000, // spawns at the top of every hour
    preAnnounceMs: 300_000, // 5-min pre-announce window before the hour
    lifetimeMs: 900_000, // lives 15 min from spawn, then despawns
    mapId: "map1", // one of map1's farm zones (chosen per-window by worldBossZoneFor)
    hp: 1_900_000, // balance-tuned (docs/balance-worldboss.md); see the block comment
    atk: 800, // dangerous-but-survivable for a maxed hero w/ potions (map1 passive-until-hit)
    // The 3 telegraphed mechanics (reuse the M7.9 machinery). NO "summon" (adds would
    // pollute the farm kill-quota). Cast to BossBehavior[] in makeWorldBoss.
    behaviors: ["slam", "enrage", "charge", "hazard"] as string[],
    // Movement + slam/enrage tuning (CONFIG.boss shape). Longer telegraphs than the deep
    // bosses so an open-field party can read + react.
    boss: {
      y: 190,
      initialCd: 1.5,
      initialSkillCd: 6,
      moveSpeed: 40,
      engageExtra: 20, // engageX = frontHeroX + clash + this
      enrageThreshold: 0.25, // enrage below this HP fraction
      slamMult: 2.2, // balance-tuned up from 1.7: the single-target gate that a party rotates but a solo can't escape
      slamCdEnraged: 4.5,
      slamCdNormal: 7,
      telegraphEnraged: 0.9,
      telegraphNormal: 1.3, // slightly longer than the s20/s30 boss (open-field dodge)
      attackCdEnraged: 0.9,
      attackCdNormal: 1.3,
    },
    // Signature-mechanic tuning (CONFIG.bossBehavior shape — charge + hazard only).
    bossBehavior: {
      charge: {
        cd: 9.0,
        cdEnraged: 6.0,
        telegraph: 1.1, // longer wind-up than the s20 boss (0.85) — fair open-field read
        dashSpeed: 460,
        stopGap: 40,
        hitRange: 78,
        hitMult: 2.2, // balance-tuned up from 1.6: reaches the ranged solo (dashes to target); single-target so a party rotates it
      },
      hazard: {
        cd: 10.0,
        cdEnraged: 6.5,
        telegraph: 1.6, // longer warn window than the s30 boss (1.3)
        duration: 1.2,
        tickInterval: 0.3,
        tickMult: 0.10, // balance-tuned DOWN from 0.3: arena-wide, so kept low to not simultaneously wipe a party (the gate is single-target slam/charge, NOT the shared hazard)
      },
    },
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
  /**
   * NINJA dagger DOUBLE-HIT (SAVE v18): a melee BASIC attack lands this many hits per
   * swing (default/absent = 1, so the sword/existing melee path is byte-identical). Each
   * hit deals `multiHitMult` × the rolled atk (`~0.55`), so the dagger trades the shortest
   * reach in the game for a rapid two-strike combo. Deterministic (no RNG).
   */
  multiHit?: number;
  /** Per-hit fraction of ATK for a `multiHit` basic attack (absent = 1). */
  multiHitMult?: number;
  /**
   * DASH-EVADE capability ("แนวๆ นินจา", 2026-07-08): when true, an AUTO-play hero of this class
   * uses its dash to SLIP OUT of a mob swarm under pressure (systems/combat `tryDashEvade`, tuned
   * per-class by `EVADE_TUNING[cls]`) instead of standing/cornered trading until dead. Gated as a
   * CAPABILITY (not a class check) so any class can opt in — held by the NINJA (belt-dweller relief)
   * and the ARCHER (solo death-spiral emergency escape). Absent/false = the class never auto-evades
   * (byte-identical movement — swordsman / mage).
   */
  dashEvade?: boolean;
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
    // NINJA-STYLE DASH-EVADE ("แนวๆ นินจา", owner-approved 2026-07-08) — the ROOT fix for the
    // archer solo death-spiral. The archer is RANGED and already kites (target-relative servo);
    // the evade is the EMERGENCY blink when melee actually CLOSES / corners it (a small radius +
    // hp/burst gate, ARCHER-tuned in `EVADE_TUNING.archer`), NOT a constant hop fighting the kite.
    // It blinks toward open ground away from the pack, then the kite servo re-engages next step.
    // (Reuses `dashHeroTo` → the heroDashed event + shadowDash fx fire; the violet streak on an
    // archer is an ACCEPTED v1 quirk — render polish later.)
    dashEvade: true,
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
  // NINJA (นินจา, SAVE v18) — DEX-primary short-range melee bruiser. SIM-TUNED (ninja balance
  // wave, docs/balance-ninja.md); overrules the docs/ninja-design.md §1/§8 draft where the sim
  // proved a value unviable. Identity:
  //   - `range` 70 = the SHORTEST reach in the game (sword 96) — trades reach for tempo.
  //   - `atkSpeed` 0.36 = the FASTEST base cadence by far (sword 0.5 / archer 0.72 / mage 1.15).
  //     NINJA FEEL RETUNE (2026-07-08): 0.45→0.36 for more/faster swings (owner "ตีไวๆ").
  //   - `multiHit` 2 × `multiHitMult` 0.44 = the dagger DOUBLE-HIT. multiHitMult 0.55→0.44 the
  //     SAME retune × 0.8, so per-second basic DPS is IDENTICAL (0.44/0.36 = 0.55/0.45 = 11/9) —
  //     more, smaller number-pops for the same power. EFFECTIVE boss DPS stays ~+6% over sword
  //     in BOSSISO (raw ~+22% basic offset by short-range repositioning + a mana-gated kit).
  //   - DASH-EVADE (`dashEvade: true`): under AUTO, a swarmed ninja blinks OUT of the belt
  //     (systems/combat + `EVADE_TUNING.ninja`) — the mobility relief for the friction FLAG 2.
  //   - `hpMult` 1.35 = squishier than the sword TANK (1.5), tougher than the ranged classes
  //     (archer 1.0 / mage 0.95). OVERRULES the draft 1.15: a 1.15 range-70 melee death-spirals
  //     the aggressive frontier (a squishy MELEE can't kite the belt like the archer does at
  //     350) — draft = 723 deaths, walls s15/s16, never reaches tier 3. 1.35 keeps the "thinner
  //     than the tank" identity while reaching the s30 soft-wall (deaths ~560, archer hard-mode
  //     band). See docs/balance-ninja.md "hpMult overrule".
  // DEX drives both its ATK (PRIMARY_STAT) and the universal atk-speed factor (stats.ts).
  ninja: {
    offset: 30,
    attack: "melee",
    range: 70,
    dmgMult: 1.0,
    hpMult: 1.35,
    projSpeed: 0,
    aoe: 0,
    multiHit: 2,
    // NINJA FEEL RETUNE (2026-07-08, owner: "ตีไวๆ เลขเด้งเยอะๆ ดาเมจประมาณนี้") — FASTER
    // cadence at IDENTICAL per-second basic DPS. atkSpeed 0.45→0.36 and multiHitMult 0.55→0.44
    // are BOTH the shipped values × 0.8, so the DPS-driving ratio multiHitMult/atkSpeed is
    // preserved EXACTLY: 0.55/0.45 = 0.44/0.36 = 11/9. Basic DPS = multiHit × multiHitMult /
    // atkSpeed = 2 × 0.44 / 0.36 = 2.4̄ = 2 × 0.55 / 0.45 (unchanged) — the hero just swings
    // 25% more often for ~25% smaller per-hit numbers (more floating damage pops, same power).
    // Skills are UNTOUCHED (eternal owner-locked). See docs/balance-ninja.md.
    atkSpeed: 0.36,
    multiHitMult: 0.44,
    dashEvade: true,
  },
};

/**
 * DASH-EVADE tuning per class ("แนวๆ นินจา" auto swarm-escape, systems/combat `tryDashEvade`).
 * A class opts IN via `HeroType.dashEvade: true`; the numbers below shape WHEN it blinks and HOW
 * far. Only classes with a `dashEvade` capability appear here — a lookup miss (sword/mage) simply
 * never evades (the capability guard short-circuits first), so their movement stays byte-identical.
 *
 * FULLY DETERMINISTIC — no RNG (the seeded stream is wave-composition only), no wall-clock: the
 * trigger reads only shared state (hp / enemy positions) + per-hero transient counters ticked by
 * fixed dt, so it evolves identically on every lockstep client. Sweepable by the balance-sim.
 */
export interface EvadeTuning {
  /** Count ENGAGED enemies within this world-x radius of the hero — the "swarm/crowded" measure. */
  radius: number;
  /** Fire only when at least this many engaged foes are inside `radius` (a real crowd). */
  minEnemies: number;
  /** Fire when hp fraction drops below this… */
  hpFrac: number;
  /** …OR when the hero LOST at least this fraction of maxHp within `hpWindowSec` (a burst). */
  hpLossFrac: number;
  /** Rolling window (s) over which the hp-loss burst is measured (a periodic snapshot). */
  hpWindowSec: number;
  /** Minimum seconds between evades (own transient counter) — never dash-spams. */
  cooldownSec: number;
  /** The evade hop DISTANCE cap (passed as `dashHeroTo` maxReach), clamped to the walkable field. */
  maxReach: number;
}

export const EVADE_TUNING: Partial<Record<HeroClass, EvadeTuning>> = {
  // NINJA — carried BYTE-FOR-BYTE from the retired `CONFIG.ninja.evade` (the ninja sim stays
  // byte-identical). A range-70 melee that STANDS in the belt; it evades a real 3-mob crowd.
  ninja: {
    radius: 95,
    minEnemies: 3,
    hpFrac: 0.55,
    hpLossFrac: 0.18,
    hpWindowSec: 0.8,
    cooldownSec: 2.2,
    maxReach: 280,
  },
  // ARCHER ("แนวๆ นินจา" solo death-spiral fix, 2026-07-08) — EMERGENCY escape, NOT a constant hop.
  // The archer holds at range 350 and kites, so evade must trigger ONLY when melee has genuinely
  // breached the kite and is cornering the squishy (hpMult 1.0) hero. SIM-TUNED (docs/balance-m79
  // "Party feel pack"): a first cut (radius 82 / min 2 / hpFrac 0.5 / cd 3.2) OVERDELIVERED into a
  // near-free class; these conservative values keep the FARM friction meaningful (potions still
  // ~94/run vs 214 baseline, ~54 farm deaths/5-seeds vs 181 — the spiral hotspots s15/s26-30 are
  // SMOOTHED, not erased) while breaking the spiral at its root. Emergency gates:
  //   - radius 78: TIGHT (< ninja 95) — foes must be right on top of it, not merely nearby, so the
  //     kite servo owns the normal spacing and evade never fights it.
  //   - minEnemies 3: a REAL crowd has breached the kite (the spiral is a woken survivor-pack, not
  //     one or two stragglers the kite already handles).
  //   - hpFrac 0.4 / hpLossFrac 0.16: a real danger floor OR a sharp burst (it cannot trade hits).
  //   - maxReach 300: a DECISIVE slip that clears the pack AND re-opens a near-full kite gap, so the
  //     servo immediately re-establishes standoff after the blink (composes with kiting).
  //   - cooldownSec 4.5: LONG — after one blink the kite carries it; a panic button, not a movement
  //     mode, so it must not re-fire while the servo is already walking the hero clear.
  // NOTE (owner flag): the evade also fires vs the s30 field-hazard boss adds, so the RANGED archer
  // now kites+blinks that (already 0/5, unbeatable) frontier boss indefinitely instead of wiping
  // ~199×/5-seeds — a positive side effect of the capability, NOT a boss-balance change (boss curves
  // untouched, still 0/5). A boss-phase suppression was deliberately NOT added (it would perturb the
  // ninja's byte-identical boss-phase movement). See the report.
  archer: {
    radius: 78,
    minEnemies: 3,
    hpFrac: 0.4,
    hpLossFrac: 0.16,
    hpWindowSec: 0.8,
    cooldownSec: 4.5,
    maxReach: 300,
  },
};

/**
 * Canonical class list. Pre-pivot this was the stage-by-stage hero UNLOCK order;
 * post-pivot the player picks ONE base class at creation (hero-unlock progression
 * removed). Retained as the authoritative ordered class list — the server's
 * known-classes enum and the evolution cost index both key off it.
 */
export const SLOT_ORDER: readonly HeroClass[] = ["swordsman", "archer", "mage", "ninja"];

/**
 * Each class's PRIMARY (damage-scaling) base stat, and the auto-allocate target
 * (M5 "Base stats"). Mirrors the attack kind: melee→str, ranged→dex, magic→int.
 * The class's `heroAtk` scales off this stat; off-affinity damage stats are inert.
 */
export const PRIMARY_STAT: Record<HeroClass, StatKey> = {
  swordsman: "str",
  archer: "dex",
  mage: "int",
  // Ninja is a DEX melee class (SAVE v18): DEX drives its dagger ATK (like the archer) AND
  // the universal atk-speed factor, so allocation funnels DEX for both damage + tempo.
  ninja: "dex",
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

/**
 * How a skill resolves (M5 "skill framework v2"). All reuse EXISTING combat
 * mechanics — no new ProjectileKind is introduced (footgun #6):
 *  - `nova`   : instant AoE centred on the HERO (swordsman whirl).
 *  - `strike` : instant AoE centred on the nearest in-range target's x (a ground
 *               slam / frost burst — the ranged counterpart of `nova`).
 *  - `meteor` : a single falling point-projectile AoE (mage meteor).
 *  - `rain`   : many small falling point-projectiles over the cluster (arrow rain).
 *  - `bolt`   : a single high-damage HOMING arrow at the nearest target (nuke).
 *  - `buff`   : a self ATK buff for a duration (no damage; war-cry).
 */
// NINJA (SAVE v18) kinds reuse EXISTING combat mechanics + the `dash` reposition
// primitive (systems/dash.ts) — NO new ProjectileKind (the dash is a hero move, not a
// projectile; the render-crash footgun #6 only bites new ProjectileKind/render-mapped
// unions, and render does NOT map over SkillKind). Deterministic (fixed offsets, no RNG):
//  - `dash`        : blink THROUGH the nearest in-range target + one strike (เงาพริบ).
//  - `multistrike` : stationary `targets` rapid hits on the nearest foe + an r`radius`
//                    splash at `CONFIG.ninja.twinSplashFrac` (คมเงาคู่).
//  - `chaindash`   : chain-dash up to `targets` distinct foes across the field, one strike
//                    each (เงาสังหาร — the tier-2 signature ultimate).
//  - `shadowstorm` : blink to the enemy centroid, then strike EVERY field target (พันเงา-
//                    นิรันดร์ — the tier-3 skill-4; time-freeze spectacle is render/timeDirector's
//                    job, keyed off the `skillCast` event, so the engine emits no new event).
export type SkillKind =
  | "nova"
  | "strike"
  | "meteor"
  | "rain"
  | "bolt"
  | "buff"
  | "dash"
  | "multistrike"
  | "chaindash"
  | "shadowstorm";

export interface SkillType {
  /** Unique, class-namespaced id (the key into `SKILLS`). */
  id: string;
  cls: HeroClass;
  /** Hero TIER required to have learned this skill (1 = base kit, 2 = evolution,
   * 3 = M7.9 grand-expansion tier-3 skill-4). */
  tier: 1 | 2 | 3;
  /** Hero LEVEL required to have learned it (unlock-by-level within the tier). */
  unlockLevel: number;
  kind: SkillKind;
  /** Mana cost to cast. */
  cost: number;
  cd: number;
  /** AoE radius: nova/strike blast, meteor blast, per-rain-drop splash (0 = none). */
  radius: number;
  /** Damage multiplier on heroAtk (PER falling arrow for `rain`; 0 for `buff`). */
  mult: number;
  /** For `rain` this is the NUMBER OF DROPS; 0 otherwise. */
  targets: number;
  /** Skill projectile speed (rain-drop / meteor / bolt fall); 0 for instant kinds. */
  projSpeed: number;
  /** Cast/guard range — the farthest a target may be for the skill to fire. */
  range: number;
  /** ATK buff multiplier for `buff` skills (1 = none). */
  buffMult: number;
  /** ATK buff duration in seconds for `buff` skills (0 = none). */
  buffDuration: number;
}

/**
 * The SKILL CATALOG (M5 "skill framework v2"): per class, a kit of skills
 * unlocked by LEVEL within a TIER. The signature skill of each class (whirl /
 * arrow rain / meteor) is kept as skill #1 with its established identity + fx —
 * its numbers are unchanged from the solo rebaseline. Each class gains one new
 * tier-1 skill (a distinct role using existing mechanics) and one tier-2 skill
 * (an evolution reward). All numbers here are sim-tuned — see docs/balance-m5.md.
 *
 * The mage's pool/regen (INT-scaled) lets it sustain several skills; the str/dex
 * classes run mostly their signature (base regen sustains it) and dip into their
 * extra skills opportunistically.
 */
// M7.7 "Skill Spectacle & World Heat" (owner-locked 2026-07-06): skills เบิ้ม —
// bigger radius + damage, cooldowns stay short, and MANA is the pacing governor
// ("ยิงรัวได้แต่ถังแห้งเร็ว"). Three clear layers per class:
//   (a) SIGNATURE spam — bigger radius/mult than M7, cheap-ish mana, short cd; base
//       regen still sustains it at ~its cadence (the M5 no-hard-stall rule: cost/cd
//       ≤ baseRegen 7/s for every signature, so a mana-broke hero still casts it).
//   (b) UTILITY (warcry / powershot / frostnova) — kept distinct in role, NOT
//       nuke-ified: a steroid, a single-target boss nuke, a cheap sustained clear.
//   (c) TIER-2 ULTIMATE — effectively FIELD-WIDE (radius/coverage spanning the ~900px
//       field): quake shockwave (strike r460), barrage blanket (rain, 13 wide drops),
//       cataclysm sky-fall (meteor r460). Big mana cost so the POOL gates them; cd
//       moderate (owner: not long). No new SkillKind / ProjectileKind (footgun #6) —
//       barrage reuses the rainArrow fall (a WIDE offset table, `barrageOffsets`).
// The full kit's summed cost/cd EXCEEDS each class's regen post-evolution, so
// continuous spam drains the pool (mana potions become a real sink) — sim-tuned,
// see docs/balance-m7.md "M7.7". All deterministic (fixed offset tables, no RNG).
const SKILL_LIST = [
  // ---- swordsman (in-the-swarm brawler) ----
  // Signature: WHIRL SLASH — instant AoE spin around the swordsman. Bigger + cheaper
  // + faster than M7 (r95→150, mult 2.2→3.2, cost 24→18, cd 8→5): the melee brawler
  // spins through the swarm. cost/cd = 3.6/s ≤ baseRegen (sustained on the flat pool).
  {
    id: "sword_whirl", cls: "swordsman", tier: 1, unlockLevel: 1, kind: "nova",
    cost: 18, cd: 5, radius: 115, mult: 3.2, targets: 0, projSpeed: 0, range: 115,
    buffMult: 1, buffDuration: 0,
  },
  // WAR CRY — self ATK buff (steroid; utility, NOT a nuke). Guarded on a nearby foe.
  {
    id: "sword_warcry", cls: "swordsman", tier: 1, unlockLevel: 8, kind: "buff",
    cost: 20, cd: 16, radius: 0, mult: 0, targets: 0, projSpeed: 0, range: 260,
    buffMult: 1.5, buffDuration: 6,
  },
  // EARTHQUAKE (tier-2 ULTIMATE) — a FIELD-WIDE ground shockwave (r460 spans the ~900px
  // field). Heavy mult, moderate cd. cost 50 nearly EMPTIES the flat 60 pool (a str
  // class allocates str, never int, so its pool stays at base 60 — the ultimate MUST be
  // affordable from 60, so it's a big gate but castable): after a quake the whirl skips
  // until regen refills, and continuous full-kit spam drains the pool → mana potions.
  {
    id: "sword_quake", cls: "swordsman", tier: 2, unlockLevel: 15, kind: "strike",
    cost: 50, cd: 10, radius: 460, mult: 6.5, targets: 0, projSpeed: 0, range: 500,
    buffMult: 1, buffDuration: 0,
  },
  // SKYFALL BLADE (tier-3 skill-4 "ดาบฟ้าผ่าสนาม") — a FIELD-WIDE sky-strike: an instant
  // AoE (reuses the `strike` quake/field mechanism, r500 spans the ~900px field) at a
  // grander mult than the quake. The time-freeze/flash beat is timeDirector/render's
  // job — the engine only emits the skillCast event + the damage. Learned at tier 3 + level
  // 40. Mana relief pass (owner 2026-07-08): cost 120 → 80. At 120 sword burned ~198 mana
  // pot/run (owner "ซื้อยามานาจนตังหมด"); skyfall was its dominant drain (8.6 mana/s on a
  // 14s cd). 80 (+ the deeper tier3PoolBonus 170) roughly HALVES that (sim: 198 → 103/run,
  // −48%) while staying ≥ the tier-2 quake (50) and a real cost — mana stays a sink, not
  // irrelevant. Tier-3 skill-4 only (auto-slot 4, tier-gated) → s1-15 byte-identical.
  {
    id: "sword_skyfall", cls: "swordsman", tier: 3, unlockLevel: 40, kind: "strike",
    cost: 80, cd: 14, radius: 500, mult: 10.0, targets: 0, projSpeed: 0, range: 540,
    buffMult: 1, buffDuration: 0,
  },

  // ---- archer (zone artillery) ----
  // Signature: ARROW RAIN — 9 drops fall over the cluster. Bigger per-drop radius +
  // damage than M7 (r44→70, mult 0.5→0.85), cheaper + faster (cost 24→20, cd 7→5):
  // the artillery barrage-lite. cost/cd = 4.0/s ≤ baseRegen (sustained on the flat pool).
  {
    id: "archer_rain", cls: "archer", tier: 1, unlockLevel: 1, kind: "rain",
    cost: 20, cd: 6, radius: 46, mult: 0.9, targets: 9, projSpeed: 900, range: 760,
    buffMult: 1, buffDuration: 0,
  },
  // POWER SHOT — a single high-damage homing arrow (utility single-target nuke; the
  // archer's answer to a lone boss, where its rain AoE barely lands).
  {
    id: "archer_powershot", cls: "archer", tier: 1, unlockLevel: 8, kind: "bolt",
    cost: 26, cd: 8, radius: 0, mult: 7.0, targets: 0, projSpeed: 1100, range: 700,
    buffMult: 1, buffDuration: 0,
  },
  // BARRAGE (tier-2 ULTIMATE) — a FIELD-WIDE blanket: 13 drops on the WIDE
  // `barrageOffsets` table (~±420 spread ≈ the whole field), each a small AoE.
  // Reuses the rainArrow fall (no new kind). cost 50 nearly empties the flat 60 pool
  // (dex class = base pool), so it's a hard gate but castable — see sword_quake.
  {
    id: "archer_barrage", cls: "archer", tier: 2, unlockLevel: 15, kind: "rain",
    cost: 50, cd: 10, radius: 80, mult: 1.0, targets: 13, projSpeed: 950, range: 820,
    buffMult: 1, buffDuration: 0,
  },
  // STORM (tier-3 skill-4 "พายุธนูถล่มต่อเนื่อง ~4 วิ") — a SUSTAINED storm: 20 rain drops
  // whose LANDINGS SPREAD over ~4s of real time via spawn-height stagger (`stormOffsets`,
  // a wide 20-row table with a TALL ry ramp). Reuses the rainArrow fall — NO new
  // ProjectileKind. The DELIBERATELY slow projSpeed (260) is what stretches the ry
  // stagger into the ~4s window (see stormOffsets). Learned at tier 3 + level 40. `targets`
  // MUST equal stormOffsets.length. Cost history: 120 (launch) → 90 (M7.9 archer friction
  // pass) → 45 (mana relief pass, owner 2026-07-08). Archer was the HIGHEST burner (210
  // pot/run) and — unlike sword — its other big drains (barrage/powershot) fire from L8/L15,
  // so cutting them would break the s1-15 byte-identical gate; storm (the only tier-3-safe
  // archer cost) + the deeper tier3PoolBonus 170 carry the relief (sim: 210 → 112/run, −47%;
  // storm deaths also fell 478 → 360 as the sustained barrage stopped starving powershot).
  {
    id: "archer_storm", cls: "archer", tier: 3, unlockLevel: 40, kind: "rain",
    cost: 45, cd: 13, radius: 95, mult: 2.0, targets: 20, projSpeed: 260, range: 900,
    buffMult: 1, buffDuration: 0,
  },

  // ---- mage (heavy nuker) ----
  // Signature: METEOR — a single falling AoE nuke. Bigger + cheaper + faster than M7
  // (r90→130, mult 5.5→7.0, cost 40→36, cd 10→6): the nuker's bread-and-butter.
  // cost/cd = 6.0/s ≤ baseRegen (sustained on the flat pool — no hard stall).
  {
    id: "mage_meteor", cls: "mage", tier: 1, unlockLevel: 1, kind: "meteor",
    cost: 36, cd: 6, radius: 130, mult: 7.0, targets: 0, projSpeed: 560, range: 330,
    buffMult: 1, buffDuration: 0,
  },
  // FROST NOVA — a cheap, fast, short-cd AoE burst (utility sustained clear between
  // meteors; the mage's INT-fed regen keeps signature+frost up — its sustain identity).
  {
    id: "mage_frostnova", cls: "mage", tier: 1, unlockLevel: 8, kind: "strike",
    cost: 22, cd: 5, radius: 110, mult: 2.2, targets: 0, projSpeed: 0, range: 340,
    buffMult: 1, buffDuration: 0,
  },
  // CATACLYSM (tier-2 ULTIMATE) — a FIELD-WIDE sky-fall (r460 darkens the sky over the
  // ~900px field). The heaviest nuke in the game; big mana gate, moderate cd.
  {
    id: "mage_cataclysm", cls: "mage", tier: 2, unlockLevel: 15, kind: "meteor",
    cost: 90, cd: 11, radius: 460, mult: 13.0, targets: 0, projSpeed: 560, range: 500,
    buffMult: 1, buffDuration: 0,
  },
  // APOCALYPSE (tier-3 skill-4 "วันสิ้นโลก") — a METEOR VOLLEY: 8 meteor-kind drops on the
  // fixed `apocalypseOffsets` table, staggered by spawn height so they rain down over a
  // window. Reuses the meteor kind — the skill stays `kind:"meteor"` and the skill code
  // spawns MANY when `targets > 0` (NO new SkillKind / ProjectileKind — footgun #6).
  // `targets` MUST equal apocalypseOffsets.length. cost 120 gates it (the mage's deep
  // INT pool affords it, but continuous spam still drains). Learned at tier 3 + level 40.
  // radius 150 -> 200 (owner field-wide buff 2026-07-08): pairs with the widened
  // apocalypseOffsets so the 8 blasts tile the whole spawn band; the offset table is
  // calibrated to keep the lone-boss hit count at 3/8 (see apocalypseOffsets comment).
  {
    id: "mage_apocalypse", cls: "mage", tier: 3, unlockLevel: 40, kind: "meteor",
    cost: 120, cd: 16, radius: 200, mult: 8.0, targets: 8, projSpeed: 360, range: 520,
    buffMult: 1, buffDuration: 0,
  },

  // ---- ninja (นินจา, SAVE v18 — blink assassin) ----
  // SIM-TUNED (ninja balance wave, docs/balance-ninja.md) under the owner-approved shape. Mana
  // sits in the MARTIAL band (sword/archer neighbourhood ~114 pot/run, above the mage's ~87) —
  // the ninja "feels" its mana per the pacing-governor rule but is NOT bankrupted. Unlike the
  // sword (whose field-wide quake/skyfall + strong basics do most of the clearing), the ninja
  // is SKILL-RELIANT for clear (single-target basics), so its whole kit is spammed — costs are
  // tuned down from the draft so that reliance lands in-band, not at the draft's 341 pot/run.
  // All DETERMINISTIC (fixed offsets, `dash` primitive; NO RNG, NO new ProjectileKind).
  //
  // Signature: SHADOW BLINK (เงาพริบ) — a `dash` THROUGH the nearest in-range target + one
  // strike. cost/cd = 5.0/s ≤ baseRegen 7 so the flat pool sustains it (the M5 no-hard-stall
  // signature guarantee), like the sword whirl / archer rain / mage meteor.
  {
    id: "ninja_dashstrike", cls: "ninja", tier: 1, unlockLevel: 1, kind: "dash",
    cost: 16, cd: 4, radius: 0, mult: 1.8, targets: 0, projSpeed: 0, range: 260,
    buffMult: 1, buffDuration: 0,
  },
  // TWIN FANG (คมเงาคู่, Lv6) — a stationary `targets`-hit flurry on the nearest foe + an
  // r120 splash at `ninja.twinSplashFrac` (0.6) to its neighbours: single-target burst with a
  // real cleave. Utility, but sized up from the draft (r80/0.5, cd 8) toward a sustained clear
  // tool — the ninja has NO AoE signature (sword/archer/mage all do), so twinfang + massacre
  // carry its field clear vs the dense killGoal fields.
  {
    id: "ninja_twinfang", cls: "ninja", tier: 1, unlockLevel: 6, kind: "multistrike",
    cost: 20, cd: 7, radius: 120, mult: 0.6, targets: 5, projSpeed: 0, range: 110,
    buffMult: 1, buffDuration: 0,
  },
  // SHADOW MASSACRE (เงาสังหาร, tier-2 ULTIMATE) — the class SIGNATURE: a CHAIN of `targets`
  // (10) dashes that blink the ninja to each nearest un-hit foe across the whole field, one
  // strike each. cost 40 — CRITICAL FIX: the draft's 90 was UNCASTABLE from a DEX ninja's flat
  // 60 pool (its tier-2 ult never fired all game; the other classes' tier-2 ults cost ≤50 for
  // exactly this reason). 40 is affordable from the base pool AND from the tier-2 pool with the
  // 4:1:1 INT share, so it actually fires in the auto-cast rotation. `range` = per-hop chain
  // reach. Reuses the `dash` primitive — no projectile. See docs/balance-ninja.md "massacre mana".
  {
    id: "ninja_massacre", cls: "ninja", tier: 2, unlockLevel: 15, kind: "chaindash",
    cost: 40, cd: 12, radius: 0, mult: 2.0, targets: 10, projSpeed: 0, range: 320,
    buffMult: 1, buffDuration: 0,
  },
  // ETERNAL SHADOWS (พันเงานิรันดร์, tier-3 skill-4) — the real body blinks to the enemy
  // centroid, then shadow clones strike EVERY target on the field ×mult. Field-wide (ignores
  // radius gating — iterates all targets). The จอสลัว + time-freeze spectacle is render/
  // timeDirector's job, keyed off the `skillCast` event (reuses skyDarken etc.) — the engine
  // emits NO new spectacle event. REWORKED from the draft (cost 170 / cd 45 / mult 2.2): at cd
  // 45 it barely fired, so the ninja had no tier-3 deep-farm clear engine and death-spiralled
  // map5-6. cost 72 / cd 14 / mult 9.0 puts it in the other skill-4 band (skyfall 80/14, storm
  // 45/13, apoc 120/16) — a real field-clear that breaks the deep spiral. Single-target boss
  // contribution stays modest (9× / 14s = 0.64×/s < skyfall's 0.71×/s), so eternal is a FARM
  // tool, not a boss nuke — the ninja leans on basics vs bosses. Learned at tier 3 + level 40
  // (auto-slot 4, tier-gated) → s1-15 has no ninja skill-4.
  {
    id: "ninja_eternal", cls: "ninja", tier: 3, unlockLevel: 40, kind: "shadowstorm",
    cost: 72, cd: 14, radius: 500, mult: 9.0, targets: 0, projSpeed: 0, range: 900,
    buffMult: 1, buffDuration: 0,
  },
] as const satisfies readonly SkillType[];

/** The skill catalog, keyed by id (the single source of truth for skill tuning). */
export const SKILLS: Record<string, SkillType> = Object.fromEntries(
  SKILL_LIST.map((s) => [s.id, s]),
);

/** Ordered skill-id list per class (signature first, then by unlock). */
export const CLASS_SKILLS: Record<HeroClass, string[]> = {
  swordsman: SKILL_LIST.filter((s) => s.cls === "swordsman").map((s) => s.id),
  archer: SKILL_LIST.filter((s) => s.cls === "archer").map((s) => s.id),
  mage: SKILL_LIST.filter((s) => s.cls === "mage").map((s) => s.id),
  ninja: SKILL_LIST.filter((s) => s.cls === "ninja").map((s) => s.id),
};

/** Each class's SIGNATURE skill id (slot-0 default; the HOF/combat-power skill). */
export const SIGNATURE_SKILL: Record<HeroClass, string> = {
  swordsman: "sword_whirl",
  archer: "archer_rain",
  mage: "mage_meteor",
  ninja: "ninja_dashstrike",
};

/**
 * Back-compat alias: the per-class SIGNATURE skill def. Render + the combat-power
 * metric read a class's signature tuning through this (radius / projSpeed / cd /
 * mult), unchanged from before the catalog existed.
 */
export const SKILL_TYPES: Record<HeroClass, SkillType> = {
  swordsman: SKILLS[SIGNATURE_SKILL.swordsman],
  archer: SKILLS[SIGNATURE_SKILL.archer],
  mage: SKILLS[SIGNATURE_SKILL.mage],
  ninja: SKILLS[SIGNATURE_SKILL.ninja],
};
