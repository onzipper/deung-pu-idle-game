/**
 * M7.5 Inventory UX overhaul — pure stat-delta computation for the inventory
 * detail card ("compare vs currently-equipped same-slot item, green/red per
 * stat"). No React/fetch/engine-config coupling (the caller passes plain stat
 * blocks pulled from `ITEM_TEMPLATES`), headlessly testable.
 */

export interface StatBlock {
  atk?: number;
  def?: number;
  hp?: number;
}

export type StatDeltaKey = "atk" | "def" | "hp";

export interface StatDeltaEntry {
  key: StatDeltaKey;
  candidate: number;
  equipped: number;
  /** candidate - equipped. Positive = upgrade (render green), negative = downgrade (red). */
  delta: number;
}

const STAT_KEYS: readonly StatDeltaKey[] = ["atk", "def", "hp"];

/**
 * Per-stat delta of `candidate` vs `equipped` (or vs an empty slot when
 * `equipped` is null — every candidate stat then reads as a full upgrade).
 * Only stats present (non-zero) on EITHER side are returned, so a weapon
 * comparison never shows a meaningless "DEF +0 / +0" row.
 */
export function computeStatDelta(
  candidate: StatBlock,
  equipped: StatBlock | null,
): StatDeltaEntry[] {
  const entries: StatDeltaEntry[] = [];
  for (const key of STAT_KEYS) {
    const c = candidate[key] ?? 0;
    const e = equipped?.[key] ?? 0;
    if (c === 0 && e === 0) continue;
    entries.push({ key, candidate: c, equipped: e, delta: c - e });
  }
  return entries;
}
