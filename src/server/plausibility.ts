/**
 * M7.95 Wave 2b — anti-cheat re-derive (the M5 "server re-validates progress" debt).
 *
 * `judgePlausibility` is a PURE, unit-testable verdict: given a character's headline
 * stats (server-derived — level/power/goldEarned) and the REAL elapsed play time
 * (server wall-clock `createdAt → now` + the `onlineSeconds` accumulator), it decides
 * whether those numbers are physically achievable under the game's own rate curves.
 * Implausible characters are marked `suspect=true` and hidden from the Hall of Fame
 * boards (the /api/hof query already filters `suspect=false`). We NEVER block a save
 * or gameplay — a cheater keeps playing, they just don't get honored (rule: server
 * authority is for monetization/anti-cheat, not for punishing the client mid-frame).
 *
 * DESIGN PRINCIPLE — false positives are worse than false negatives. Every ceiling
 * below is the THEORETICAL MAXIMUM of the fastest class at the deepest band, applied
 * across the ENTIRE playtime (already a large over-grant, since early play is far
 * slower), and THEN multiplied by an explicit ×2 plausibility margin. A legitimate
 * player can never approach these; only a hand-edited save trips them.
 *
 * Every ceiling is DERIVED FROM `CONFIG` (the engine curves) or cited from
 * `docs/balance-m79.md` (the corrected post-fix tables), so a future balance pass can
 * re-derive them by re-running the sim and updating the two cited constants
 * (`FASTEST_S30_CLEAR_SEC`, `GOLD_CEILING_STAGE`) — nothing else is hand-authored.
 *
 * ── Recovery semantics (level/gold latch; power can regress) ──────────────────────
 * `level` and `goldEarned` are MONOTONIC (they never decrease), so a jump past their
 * ceiling was never legitimately earned — "once flagged on those, stay flagged".
 * `power` CAN legitimately regress (unequip gear / a refine breaks), so a power flag
 * may recover if a later save is back within bounds.
 *
 * The DB carries only a boolean `suspect` column (W2a schema — not extended here), so
 * we cannot persist WHICH axis latched. We therefore:
 *   - recompute the verdict from scratch every save (pure current-snapshot judgement);
 *   - RECOVER (true→false) only when the current snapshot is fully clean — a clean
 *     snapshot after a power spike is a legitimate regression;
 *   - guarantee level/gold PERMANENCE via monotonic RE-DETECTION: because those values
 *     never decrease and the ceilings sit at 2× the theoretical maximum, a value that
 *     ever tripped a ceiling keeps tripping it on every subsequent save — right up
 *     until enough real wall-time has elapsed that the value is indistinguishable from
 *     legitimate play. The unforgeable, wall-clock-based `levelCapAt` check (below) is
 *     the hard backstop for the top of the level board and does NOT trust onlineSeconds.
 * A dedicated `suspectReasons` column (future wave) would make level/gold latching
 * unconditional; it is a documented limitation, not a correctness gap for the boards.
 */

import {
  CONFIG,
  ITEM_TEMPLATES,
  baseStats,
  primaryStat,
  emptyEquipped,
  type EquippedGear,
  type HeroClass,
  type CharacterSave,
} from "@/engine";
import { REFINE } from "@/engine/config/refine";
import { powerFromSaveAndGear } from "@/server/characters";

// ── Tunable ceiling sources ──────────────────────────────────────────────────

/** Explicit plausibility margin: we only flag a value that exceeds 2× the
 *  theoretical maximum. Generous by design (false positives are worse). */
export const PLAUSIBILITY_MARGIN = 2;

/**
 * Upper-bound XP throughput (XP/second), used as if sustained from level 1.
 *
 * Derivation (docs/balance-m79.md + CONFIG): the deepest sustained farm is s30, where
 * a full zone is `killGoal(30)` kills at `xpPerKill(30)` XP each, cleared in the
 * fastest-class time `FASTEST_S30_CLEAR_SEC`. That is the PEAK sustained rate:
 *   384 kills × 44 XP / 416 s ≈ 40.6 XP/s.
 * We set the ceiling to ~3× that (120) to absorb AoE-ultimate burst spikes and boss
 * XP, BEFORE the additional ×2 margin. Applying a deep-stage peak across the WHOLE
 * journey (early stages give a fraction of this) is itself a large over-grant, so the
 * effective headroom over a real player is far more than the nominal ×2.
 */
export const MAX_XP_PER_SEC = 120;

/** The endgame band whose farm rates set the gold/xp ceilings (docs/balance-m79.md). */
export const GOLD_CEILING_STAGE = 30;

/**
 * Fastest recorded s30 farm-zone clear (seconds) — swordsman, docs/balance-m79.md
 * "Farm-zone clear time" table (416 s). The single doc-sourced timing constant; a
 * rebalance re-derives it from the new sim table.
 */
export const FASTEST_S30_CLEAR_SEC = 416;

/**
 * Upper-bound gold throughput (gold/second), used as if sustained from level 1.
 * = (gold from a full s30 farm zone + the boss reward) / fastest s30 clear.
 * ≈ (384 × 111 + 650) / 416 ≈ 104 gold/s. Same over-grant logic as XP (a deep-stage
 * peak applied across the whole run), before the ×2 margin.
 */
export const MAX_GOLD_PER_SEC =
  (CONFIG.killGoal(GOLD_CEILING_STAGE) * CONFIG.goldPerKill(GOLD_CEILING_STAGE) +
    CONFIG.goldPerBoss(GOLD_CEILING_STAGE)) /
  FASTEST_S30_CLEAR_SEC;

/**
 * Effective play seconds credited per wall-second, used ONLY by the levelCapAt
 * backstop (which never trusts onlineSeconds). One wall-second yields at most one
 * online second PLUS the per-day offline-idle allowance (`offlineCapHours`/24 of a
 * second), so the accumulated effective play can grow at most this fast vs the
 * unforgeable server clock. Generous (it assumes 24/7 presence + full offline cap).
 */
export const MAX_EFFECTIVE_PLAY_PER_WALL = 1 + CONFIG.offlineCapHours / 24;

// ── Level → minimum play seconds (from the engine XP curve) ───────────────────

const LEVEL_CAP = CONFIG.leveling.levelCap;

/** Cumulative XP required to REACH each level (index = level; level 1 = 0), summed
 *  from the engine's own `xpToLevel` curve (rule 4: the engine is the rules authority). */
const CUMULATIVE_XP: number[] = (() => {
  const arr: number[] = new Array(LEVEL_CAP + 1).fill(0);
  let sum = 0;
  for (let l = 1; l < LEVEL_CAP; l++) {
    sum += CONFIG.leveling.xpToLevel(l);
    arr[l + 1] = sum;
  }
  return arr;
})();

/** Cumulative XP needed to reach `level` (clamped to [1, cap]). */
export function cumulativeXpToLevel(level: number): number {
  const l = Math.max(1, Math.min(LEVEL_CAP, Math.floor(level)));
  return CUMULATIVE_XP[l];
}

/** Earliest possible seconds of play to reach `level` at the max XP throughput. */
export function minPlaySecondsForLevel(level: number): number {
  return cumulativeXpToLevel(level) / MAX_XP_PER_SEC;
}

// ── Power ceiling (a fully-maxed hero at a given level) ───────────────────────

/** Highest-ATK weapon a class can equip (weapons are class-locked). */
function bestWeaponFor(cls: HeroClass): string | null {
  let best: string | null = null;
  let bestAtk = -1;
  for (const t of Object.values(ITEM_TEMPLATES)) {
    if (t.slot !== "weapon") continue;
    if (t.classReq !== null && t.classReq !== cls) continue;
    const atk = t.stats.atk ?? 0;
    if (atk > bestAtk) {
      bestAtk = atk;
      best = t.id;
    }
  }
  return best;
}

/** Highest def+hp armor a class can equip (universal or class-matched). */
function bestArmorFor(cls: HeroClass): string | null {
  let best: string | null = null;
  let bestSum = -1;
  for (const t of Object.values(ITEM_TEMPLATES)) {
    if (t.slot !== "armor") continue;
    if (t.classReq !== null && t.classReq !== cls) continue;
    const sum = (t.stats.def ?? 0) + (t.stats.hp ?? 0);
    if (sum > bestSum) {
      bestSum = sum;
      best = t.id;
    }
  }
  return best;
}

/**
 * The maximum combat power a LEGITIMATE hero of `cls` could have at `level`: tier 3,
 * every earned stat point poured into the primary damage stat, and the best possible
 * gear (top-tier weapon + armor at the +10 refine ceiling). Computed via the SAME
 * `powerFromSaveAndGear` / `makeHero` path the leaderboard uses (rule 4), so the
 * ceiling and the ranked value are the same one authority.
 */
export function maxPowerForLevel(cls: HeroClass, level: number): number {
  const lvl = Math.max(1, Math.floor(level));
  const stats = baseStats(cls);
  const prim = primaryStat(cls);
  const earned = Math.max(0, (lvl - 1) * CONFIG.stats.pointsPerLevel);
  stats[prim] = Math.min(CONFIG.stats.cap, stats[prim] + earned);

  const equipped: EquippedGear = {
    weapon: bestWeaponFor(cls),
    armor: bestArmorFor(cls),
    refine: { weapon: REFINE.maxRefine, armor: REFINE.maxRefine },
  };
  const hero: CharacterSave = {
    cls,
    level: lvl,
    xp: 0,
    tier: 3,
    statPoints: 0,
    stats,
  } as CharacterSave;
  return powerFromSaveAndGear(hero, equipped ?? emptyEquipped());
}

// ── The verdict ───────────────────────────────────────────────────────────────

export interface PlausibilityInput {
  cls: HeroClass;
  /** Server-derived hero level (from the migrated save). */
  level: number;
  /** Server-derived combat power (stats + DB gear + refine). */
  power: number;
  /** Server-derived lifetime gold earned (from the migrated save). */
  goldEarned: number;
  /** The onlineSeconds AFK accumulator (plausible in-session gaps only). */
  onlineSeconds: number;
  /** Character row `createdAt` (server-stamped at creation — unforgeable). */
  createdAt: Date;
  /** Server wall-clock now. */
  now: Date;
  /** Server-stamped first-at-cap time, or null (level board tiebreak / this check). */
  levelCapAt: Date | null;
}

export interface PlausibilityVerdict {
  suspect: boolean;
  /** Human-readable audit reasons (empty when plausible). */
  reasons: string[];
}

/** Wall-clock elapsed seconds between two dates (never negative). */
function wallSeconds(from: Date, to: Date): number {
  const s = (to.getTime() - from.getTime()) / 1000;
  return Number.isFinite(s) && s > 0 ? s : 0;
}

/**
 * Generous effective play seconds: the onlineSeconds accumulator PLUS an offline-idle
 * credit. The credit is `min(wallElapsed, days × offlineCap)` — i.e. we grant the full
 * per-day offline-idle allowance on top of measured online time, regardless of actual
 * absences. Deliberately over-generous (offline + online can double-count) so the
 * level/gold ceilings never touch a real player.
 */
export function effectivePlaySeconds(input: {
  onlineSeconds: number;
  createdAt: Date;
  now: Date;
}): number {
  const wall = wallSeconds(input.createdAt, input.now);
  const days = Math.max(1, Math.ceil(wall / 86400));
  const offlineBudget = days * CONFIG.offlineCapHours * 3600;
  const offlineCredit = Math.min(wall, offlineBudget);
  const online = Math.max(0, input.onlineSeconds || 0);
  return online + offlineCredit;
}

/**
 * Judge whether a character's headline stats are plausible for its real elapsed play
 * time. Pure + deterministic — the single anti-cheat authority, unit-tested directly.
 * `prevSuspect` is used only to detect (and audit) a recovery transition; the verdict
 * itself is recomputed from the current snapshot (see recovery semantics in the header).
 */
export function judgePlausibility(
  input: PlausibilityInput,
  prevSuspect = false,
): PlausibilityVerdict {
  const reasons: string[] = [];
  const play = effectivePlaySeconds(input);

  // 1. Level vs playtime — earliest arrival at this level (×2 margin).
  const minLevelSec = minPlaySecondsForLevel(input.level);
  if (input.level > 1 && play * PLAUSIBILITY_MARGIN < minLevelSec) {
    reasons.push(
      `level ${input.level} needs ≥${Math.round(minLevelSec)}s play (have ~${Math.round(play)}s)`,
    );
  }

  // 2. Lifetime gold vs playtime — deepest-band farm rate × play (×2 margin).
  const maxGold = MAX_GOLD_PER_SEC * play * PLAUSIBILITY_MARGIN;
  if (input.goldEarned > maxGold) {
    reasons.push(
      `goldEarned ${input.goldEarned} > ceiling ${Math.round(maxGold)} for ~${Math.round(play)}s play`,
    );
  }

  // 3. Power vs level — a fully-maxed tier-3 t10+10 hero at this level (×2 margin).
  const maxPower = maxPowerForLevel(input.cls, input.level);
  if (input.power > maxPower * PLAUSIBILITY_MARGIN) {
    reasons.push(`power ${input.power} > ceiling ${Math.round(maxPower * PLAUSIBILITY_MARGIN)} at level ${input.level}`);
  }

  // 4. levelCapAt sanity — the UNFORGEABLE backstop for the top of the level board.
  // Uses only server-stamped wall time (createdAt → levelCapAt), never onlineSeconds:
  // even at the max effective-play-per-wall rate, reaching the cap can't beat the
  // earliest-possible cap time (×2 margin).
  if (input.level >= LEVEL_CAP && input.levelCapAt) {
    const wallToCap = wallSeconds(input.createdAt, input.levelCapAt);
    const effectiveAtCap = wallToCap * MAX_EFFECTIVE_PLAY_PER_WALL;
    const minCapSec = minPlaySecondsForLevel(LEVEL_CAP);
    if (effectiveAtCap * PLAUSIBILITY_MARGIN < minCapSec) {
      reasons.push(
        `levelCapAt only ${Math.round(wallToCap)}s after creation; cap needs ≥${Math.round(minCapSec)}s play`,
      );
    }
  }

  const suspect = reasons.length > 0;
  if (prevSuspect && !suspect) {
    // Recovery transition (power regressed back within bounds) — audit only.
    reasons.push("(recovered: current snapshot within bounds)");
  }
  return { suspect, reasons };
}
