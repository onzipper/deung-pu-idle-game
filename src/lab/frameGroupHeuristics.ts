/**
 * Naming-based heuristics for picking a "walk-like" / "idle-like" frame
 * group out of the FULL asset library (`@/lab/frames`'s `groups` map) — used
 * by experiments ⑤ playground and ⑥ town preview, both of which need TWO
 * frame sets at once and so can't rely on `LabScreen`'s single shared
 * group-picker dropdown (that only ever hands `createScene` one `FrameSet`).
 * Pure, no Pixi/React import — trivially unit-testable in isolation, though
 * this task's own headless coverage lives inline in the two experiments'
 * describe blocks (both are thin wrappers over this).
 */

/** Picks the group with the MOST frames among keys matching `pattern`,
 * excluding `excludeKey` (so idle-heuristic calls can't re-pick the group
 * already claimed as the walk group). `null` if nothing matches. */
export function pickGroupByPattern(
  groups: Record<string, string[]>,
  pattern: RegExp,
  excludeKey?: string | null,
): string | null {
  let best: string | null = null;
  let bestCount = -1;
  for (const key of Object.keys(groups)) {
    if (excludeKey && key === excludeKey) continue;
    if (!pattern.test(key)) continue;
    const count = groups[key]?.length ?? 0;
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/** The group with the most frames overall (any name) — the last-resort
 * fallback when no name-based match exists and there's more than one group
 * to choose from. */
function pickMostFramesOverall(groups: Record<string, string[]>): string | null {
  const keys = Object.keys(groups);
  if (keys.length === 0) return null;
  return keys.reduce((best, k) => ((groups[k]?.length ?? 0) > (groups[best]?.length ?? 0) ? k : best), keys[0]);
}

/**
 * Experiment ⑤ playground's "which group looks like walking" heuristic:
 * a name containing "walk" or "stand" with the most frames; if none match
 * and there's exactly one group loaded, that's the fallback ("the only
 * set"); if none match and there are several groups, fall back to whichever
 * has the most frames overall (a reasonable generalization of "the only
 * set" when there's ambiguity instead of a single candidate).
 */
export function pickWalkGroupKey(groups: Record<string, string[]>): string | null {
  const keys = Object.keys(groups);
  if (keys.length === 0) return null;
  const matched = pickGroupByPattern(groups, /walk|stand/i);
  if (matched) return matched;
  if (keys.length === 1) return keys[0];
  return pickMostFramesOverall(groups);
}

/** The idle/sit counterpart — a name containing "idle" or "sit", excluding
 * whatever was already picked as the walk group. `null` means "no separate
 * idle set" (the caller falls back to freezing the walk set's first frame). */
export function pickIdleGroupKey(
  groups: Record<string, string[]>,
  excludeKey: string | null,
): string | null {
  return pickGroupByPattern(groups, /idle|sit/i, excludeKey);
}

/** Experiment ⑥ town preview's split — mirrors `townLlama.ts`'s own two file
 * sets by NAME rather than by fixed filenames, since the lab library can
 * hold anything the owner uploaded. */
export function pickSitGroupKey(groups: Record<string, string[]>): string | null {
  return pickGroupByPattern(groups, /sit/i);
}

export function pickStandGroupKey(groups: Record<string, string[]>): string | null {
  return pickGroupByPattern(groups, /stand/i);
}
