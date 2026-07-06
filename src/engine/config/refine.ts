/**
 * M7.6 "ตีบวก" (Refine, RO-style) — the sweepable tunables + pure derivations.
 *
 * CONTRACT / DETERMINISM (CLAUDE.md):
 *  - The ENGINE NEVER ROLLS a refine. The success/degrade/BREAK roll is
 *    SERVER-AUTHORITATIVE (anti-cheat — a later wave owns it). This module only
 *    (a) EXPOSES the tunable table the server + UI read, and (b) CONSUMES a
 *    server-decided `refineLevel` into item stats (`refinedStat`) — a pure,
 *    deterministic function of `(baseStat, level)`, NO RNG (the seeded stream is
 *    wave-composition-only).
 *  - All numbers here are sim-VALIDATED balance levers (M7.6 refine sweep,
 *    docs/balance-m7.md "Refine (M7.6)"): a `REFINE=sweep GEAR=1` run of the
 *    balance harness over bonus {.06,.08,.10}, the +8-10 success band (draft vs a
 *    harsher .35/.25/.15), and the gold cost scalar (draft vs ×2) — all excursions
 *    were REJECTED, the draft holds every gate (s15 boss 0/15 even under aggressive
 *    refining, class change s5, materials a real sink, break-loss ~1% of drops).
 *
 * STAT-BONUS SHAPE (chosen): a refine multiplies the item's FLAT stat block by
 * `(1 + level * statBonusPerRefine)`. This folds through the EXISTING flat-
 * additive equip pipeline (systems/stats `equip*Of`, combatPower) with ZERO
 * structural change, and it tier-SCALES naturally (a +10 boosts a t6 weapon's 22
 * atk far more in absolute terms than a t1's 3 atk) while staying monotonic and
 * integer-deterministic. A +0 item is byte-identical to pre-M7.6 (level 0 → ×1).
 */

import type { ItemRarity } from "@/engine/config/items";

/** Fail semantics for a refine ATTEMPT at a given target +level. */
export type RefineFailMode = "safe" | "degrade" | "break";

export const REFINE = {
  /** Refine ceiling (RO: +0..+10). */
  maxRefine: 10,
  /**
   * Per-refine-LEVEL stat multiplier increment. A +N item's stats are
   * `base * (1 + N * statBonusPerRefine)`. Draft 0.08 → +10 ≈ +80% of the item's
   * flat block (a big, felt reward that still can't out-scale the level/stat curve
   * enough to break the s15 wall — the flat gear block is a minority of hero atk at
   * depth). Sim-swept.
   */
  statBonusPerRefine: 0.08,
  /**
   * Success chance for an ATTEMPT that targets +level (index 1..maxRefine = going
   * from level-1 to level). +1-3 always succeed (1.0); +4-10 decline in two bands.
   * DRAFT (sim-tuned later): +4-7 = .85/.75/.65/.55, +8-10 = .45/.35/.25.
   */
  successChance: {
    1: 1.0, 2: 1.0, 3: 1.0,
    4: 0.85, 5: 0.75, 6: 0.65, 7: 0.55,
    8: 0.45, 9: 0.35, 10: 0.25,
  } as Record<number, number>,
  /**
   * On FAIL, what happens to the item, by target +level band:
   *  - +1-3  "safe"    : no loss (materials/gold are still consumed).
   *  - +4-7  "degrade" : the item drops ONE refine level.
   *  - +8-10 "break"   : the item is DESTROYED (server emits ItemEvent "destroyed").
   */
  failBands: { safeMax: 3, degradeMax: 7 } as const,
  /**
   * Salvage yield (materials granted for destroying an item), by tier × rarity.
   * `round(tier * rarityMult)` — deeper/rarer gear is worth more feedstock. DRAFT.
   */
  salvageRarityMult: { common: 1, rare: 2, epic: 4 } as Record<ItemRarity, number>,
  /**
   * Refine COST to attempt a target +level on a tier-`t` item: materials + gold,
   * both scaling by tier and target level. DRAFT — a sink the refine-sim tunes so
   * salvage feedstock ↔ refine cost ↔ break loss keep material inflation in check.
   */
  cost: {
    /** materials = round(tier * targetLevel * materialsPerTierLevel). */
    materialsPerTierLevel: 1,
    /** gold = round(tier^2 * targetLevel * goldPerTier2Level). */
    goldPerTier2Level: 5,
  },
} as const;

/** Clamp any (possibly-hostile) value to a valid integer refine level [0, max]. */
export function clampRefine(level: number | undefined): number {
  if (typeof level !== "number" || !Number.isFinite(level) || level <= 0) return 0;
  return Math.min(REFINE.maxRefine, Math.floor(level));
}

/**
 * Apply a refine level to one flat stat value (deterministic, integer output).
 * `level 0` returns `base` unchanged (round-trip exact for an unrefined item).
 */
export function refinedStat(base: number, level: number): number {
  if (!base) return 0;
  return Math.round(base * (1 + clampRefine(level) * REFINE.statBonusPerRefine));
}

/** Success chance for an attempt TARGETING +level (out-of-range → 0). */
export function successChanceForLevel(targetLevel: number): number {
  return REFINE.successChance[targetLevel] ?? 0;
}

/** Fail semantics for an attempt TARGETING +level. */
export function failModeForLevel(targetLevel: number): RefineFailMode {
  if (targetLevel <= REFINE.failBands.safeMax) return "safe";
  if (targetLevel <= REFINE.failBands.degradeMax) return "degrade";
  return "break";
}

/** Materials granted for salvaging a tier-`tier`, `rarity` item. */
export function salvageYield(tier: number, rarity: ItemRarity): number {
  return Math.round(tier * REFINE.salvageRarityMult[rarity]);
}

/** Refine cost (materials + gold) to attempt `targetLevel` on a tier-`tier` item. */
export function refineCost(
  tier: number,
  targetLevel: number,
): { materials: number; gold: number } {
  return {
    materials: Math.round(tier * targetLevel * REFINE.cost.materialsPerTierLevel),
    gold: Math.round(tier * tier * targetLevel * REFINE.cost.goldPerTier2Level),
  };
}
