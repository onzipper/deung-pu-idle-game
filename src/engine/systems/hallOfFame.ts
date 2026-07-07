/**
 * Hall of Fame stats (M7.95 Wave 1 — engine/SAVE side).
 *
 * Three write-only, deterministic observers the HOF boards read from (the server
 * ranks characters across accounts; the UI draws the panel). NONE of these feed
 * back into gameplay — they only WATCH `step()` — so the sim stays byte-identical.
 *
 * TIME MODEL (determinism): the engine has no `Date` access mid-step (see
 * engine/README + the `lastSeen` server-stamp pattern). So:
 *  - a DURATION (`seconds`) is measured by DETERMINISTIC step counting — the delta
 *    of `state.time` (a sum of FIXED_DT) between fight start and the boss's death.
 *  - the achievement MOMENT (`at`, ISO-less epoch-ms) is left UNSTAMPED (0) by the
 *    engine and stamped by the client/server at the next save, EXACTLY like
 *    `SaveData.lastSeen` (engine emits 0; server writes the wall-clock). `at === 0`
 *    therefore means "achieved, not yet stamped" — a real epoch-ms is always > 0.
 */

import type { GameState } from "@/engine/state";

/** Sentinel `at` value: achieved but not yet wall-clock-stamped (mirrors `lastSeen`). */
export const HOF_UNSTAMPED = 0;

/** A best boss-clear record for one boss stage (M7.95). */
export interface BossClearBest {
  /** Fight duration in seconds — deterministic step counting (start→death). */
  seconds: number;
  /**
   * Epoch-ms of when this best was achieved, or `HOF_UNSTAMPED` (0) until the save
   * boundary stamps it (the engine has no wall-clock — same as `lastSeen`).
   */
  at: number;
}

/** The read surface the server/UI HOF waves consume (M7.95). */
export interface HallOfFameStats {
  /** Lifetime gold ever earned (never decremented by spending). */
  goldEarned: number;
  /** Best (lowest) clear time per boss stage (s5/s10/…), keyed by stage number. */
  bossBest: Record<number, BossClearBest>;
  /** Epoch-ms the hero first hit `levelCap` (0 = reached-unstamped), or null if never. */
  levelCapAt: number | null;
}

/**
 * Record a boss-clear duration for `stage`, keeping only the FASTEST. Called from
 * `onBossKilled` with the deterministic fight duration. A new best is stamped
 * `at: HOF_UNSTAMPED` for the save boundary to fill in.
 */
export function recordBossClear(state: GameState, stage: number, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  const prev = state.bossBest[stage];
  if (!prev || seconds < prev.seconds) {
    state.bossBest[stage] = { seconds, at: HOF_UNSTAMPED };
  }
}

/**
 * Note that the hero has reached `levelCap` (the HOF tiebreaker). Records ONCE
 * (first crossing); `HOF_UNSTAMPED` (0) until the save boundary stamps the epoch-ms.
 */
export function markLevelCap(state: GameState): void {
  if (state.levelCapAt === null) state.levelCapAt = HOF_UNSTAMPED;
}

/** Read the Hall of Fame stats off a live state (server/UI snapshot source). */
export function hallOfFame(state: GameState): HallOfFameStats {
  return {
    goldEarned: state.goldEarned,
    bossBest: cloneBossBest(state.bossBest),
    levelCapAt: state.levelCapAt,
  };
}

/** Deep-copy a bossBest map (fresh record objects — never share nested refs). */
export function cloneBossBest(
  src: Record<number, BossClearBest> | undefined,
): Record<number, BossClearBest> {
  const out: Record<number, BossClearBest> = {};
  if (!src) return out;
  for (const [k, v] of Object.entries(src)) {
    out[Number(k)] = { seconds: v.seconds, at: v.at };
  }
  return out;
}
