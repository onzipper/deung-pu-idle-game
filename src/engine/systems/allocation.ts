/**
 * Base-stat allocation (M5 "Base stats", 86d3jv7m3).
 *
 * Two paths, both deterministic (NO RNG — the seeded stream stays reserved for
 * wave composition):
 *
 *  - MANUAL: the `allocateStat` FrameInput intent spends unspent `statPoints` into
 *    one stat, applied once per drained input (a click allocates exactly once, at
 *    any speed — same semantics as `evolveHero`). Guarded against negative /
 *    non-integer amounts, over-spend, and the per-stat cap. Emits a `statAllocated`
 *    event ONLY on manual allocation (UI feedback; render draws nothing from it).
 *
 *  - AUTO (v2, M7.7): when the UI-owned `autoAllocate` toggle is on, every hero's
 *    unspent points are distributed toward its class RATIO
 *    (`CONFIG.stats.autoAllocRatio`) — each point to the ratio stat farthest below
 *    its target — so an idle player never drowns in unspent points AND the squishy
 *    ranged classes bank the VIT that breaks the map3 frontier wall. Emits NO event
 *    (silent, mirrors auto-cast). See `autoAllocateStats` for the distributor.
 *
 * Allocating VIT recomputes max HP and heals by the added headroom (a level-up /
 * evolution style feel-good bump); the other stats change derived atk/atk-speed on
 * read, so they need no state fix-up.
 */

import { CONFIG } from "@/engine/config";
import { heroMaxHpOf, heroMaxManaOf } from "@/engine/systems/stats";
import type { Hero, StatKey } from "@/engine/entities";
import type { GameState } from "@/engine/state";
import type { FrameInput } from "@/engine/core/step";

/** Fixed stat order — the deterministic tie-break for the auto-allocate v2 ratio. */
const STAT_ORDER: readonly StatKey[] = ["str", "dex", "int", "vit"];

/** Re-derive max HP after a vit change and heal by the added headroom. */
function refreshMaxHp(hero: Hero): void {
  const newMax = heroMaxHpOf(hero);
  hero.hp += newMax - hero.maxHp;
  hero.maxHp = newMax;
}

/** Re-derive max mana after an int change and top up by the added headroom. */
function refreshMaxMana(hero: Hero): void {
  const newMax = heroMaxManaOf(hero);
  hero.mana += newMax - hero.maxMana;
  hero.maxMana = newMax;
}

/** Apply the derived-stat fix-up for a stat that changed (vit → HP, int → mana). */
function refreshDerived(hero: Hero, stat: StatKey): void {
  if (stat === "vit") refreshMaxHp(hero);
  else if (stat === "int") refreshMaxMana(hero);
}

/**
 * Spend `amount` unspent points into `hero.stats[stat]`. Returns false (no-op) if
 * the hero is missing, the amount is not a positive integer, it exceeds the
 * unspent pool, or it would breach `CONFIG.stats.cap`. On success emits a
 * `statAllocated` event (manual-only feedback).
 */
export function allocateStat(
  state: GameState,
  hero: Hero | undefined,
  stat: StatKey,
  amount: number,
): boolean {
  if (!hero) return false;
  if (!Number.isInteger(amount) || amount <= 0) return false;
  if (amount > hero.statPoints) return false;
  if (hero.stats[stat] + amount > CONFIG.stats.cap) return false;

  hero.statPoints -= amount;
  hero.stats[stat] += amount;
  refreshDerived(hero, stat);

  state.events.push({ type: "statAllocated", id: hero.id, stat, amount });
  return true;
}

/**
 * Auto-allocate v2 (M7.7): distribute every hero's unspent points toward its class
 * RATIO (`CONFIG.stats.autoAllocRatio[cls]`) instead of dumping them all into the
 * primary. Each point goes to the ratio stat FARTHEST BELOW its target — the one
 * minimising `stats[s] / weight[s]` against the hero's CURRENT stats — with a
 * deterministic tie-break by the fixed str→dex→int→vit order. This self-corrects
 * around manual allocations + differing class bases and converges to the ratio, so
 * it needs no persisted counter. A capped stat (`CONFIG.stats.cap`) drops out of the
 * distribution; if every ratio stat is capped the points stay unspent (mirrors the
 * old room≤0 behaviour). Silent (no event). Idempotent once points are drained.
 *
 * NO RNG (deterministic) — the seeded stream stays wave-composition-only. The
 * per-point loop is O(points × |ratio stats|); statPoints is at most a few hundred,
 * so this is cheap. Derived pools (vit→HP, int→mana) are re-derived ONCE per changed
 * stat at the end (`refreshMaxHp/Mana` recompute from the final stat value, so a
 * single call heals/tops-up by the whole added headroom — identical to per-point).
 */
export function autoAllocateStats(state: GameState): void {
  const cap = CONFIG.stats.cap;
  for (const hero of state.heroes) {
    // M8 party P1b: gate on the PER-HERO config (was the global `state.autoAllocate`)
    // so each cohort member's auto-allocate is independent + deterministic. Solo mirrors
    // the global onto heroes[0].config, so a 1-hero run is byte-identical.
    if (!hero.config.autoAllocate) continue;
    if (hero.statPoints <= 0) continue;
    const ratio = CONFIG.stats.autoAllocRatio[hero.cls];
    // The ratio stats with a positive weight, in the fixed tie-break order.
    const stats = STAT_ORDER.filter((s) => (ratio[s] ?? 0) > 0);
    if (stats.length === 0) continue;

    const changed = new Set<StatKey>();
    while (hero.statPoints > 0) {
      // Pick the ratio stat with room that is farthest below its target
      // (min stats[s]/weight[s]); STAT_ORDER iteration order breaks ties.
      let pick: StatKey | null = null;
      let best = Infinity;
      for (const s of stats) {
        if (hero.stats[s] >= cap) continue;
        const score = hero.stats[s] / (ratio[s] as number);
        if (score < best) {
          best = score;
          pick = s;
        }
      }
      if (pick === null) break; // every ratio stat capped → leave points unspent
      hero.stats[pick] += 1;
      hero.statPoints -= 1;
      changed.add(pick);
    }
    for (const s of changed) refreshDerived(hero, s);
  }
}

/**
 * Per-step allocation pass: apply each hero's manual `allocateStat` intent (from its
 * own input lane) first, then per-hero auto-allocate. Called from `step()`.
 *
 * M8 party P1b: `lanes[i].allocateStat` routes to `heroes[i]` — solo (one lane / one
 * hero) is the old `state.heroes[0]` path, byte-identical. Each `allocateStat` is a
 * batch map (M7.9 stat-tap-fix — see `FrameInput.allocateStat`'s doc): several stats
 * (or several taps on the SAME stat, pre-summed by the UI store) queued in one real
 * frame must ALL apply, not last-wins. Applied in the fixed str/dex/int/vit order for
 * determinism; each entry goes through the same guarded `allocateStat()` — a rejected
 * entry (invalid amount / over-spend / cap breach) no-ops just that entry. Auto-allocate
 * is now per-hero (config-gated) inside `autoAllocateStats`.
 */
export function processStatAllocation(state: GameState, lanes: FrameInput[]): void {
  for (let i = 0; i < state.heroes.length; i++) {
    const alloc = (lanes[i] ?? {}).allocateStat;
    if (!alloc) continue;
    for (const stat of STAT_ORDER) {
      const amount = alloc[stat];
      if (amount !== undefined) allocateStat(state, state.heroes[i], stat, amount);
    }
  }
  autoAllocateStats(state);
}
