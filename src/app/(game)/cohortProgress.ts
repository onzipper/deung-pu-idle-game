/**
 * M8 party — cohort PROGRESSION-INTEGRITY primitive (owner live bug, SEVERE: partying
 * with a deep player at zone 36 permanently unlocked all zones for a fresh account).
 *
 * PURE module: no DOM / React / Pixi / relay import, headlessly unit-testable exactly
 * like `cohortWallet.ts` (its economy-integrity sibling).
 *
 * ── Why any of this exists ─────────────────────────────────────────────────────────
 * `SharedCohortSave` (`partyHandshake.ts`) seeds a cohort's `location` / `unlockedZones`
 * / `stage` / `zoneKills` / `lastFarmZone` / `bossBest` / `levelCapAt` from ONE member
 * (the seed authority) — by design, so every client's rebuilt `GameState` is byte-
 * identical (design §4). That is fine for LIVE gameplay (visiting a friend's deep zone
 * mid-party is the intended co-op feel), but `GameClient.serialize()` used to persist
 * these SHARED fields straight off the live cohort state — so a fresh account partying
 * with a zone-36 friend got the friend's `unlockedZones` written into ITS OWN save row,
 * and `extractSoloState` (cohort → solo) rebuilds from that SAME shared slice, so the
 * leak survived leaving the party too. `asuraEssence`/`asuraZoneKills`/`asuraSigils`/
 * `tomePages`/`tomeUnlocked` have the INVERSE bug — they aren't part of
 * `SharedCohortSave` at all, so `buildCohortState`'s `initGameState(seed)` (no save arg)
 * resets them to 0/empty for the cohort's live-state duration; persisting THAT would be
 * a silent progress WIPE rather than a leak, same fix shape either way.
 *
 * ── The fix (mirrors `cohortWallet.ts`'s wallet split, but SIMPLER) ─────────────────
 * Unlike gold/materials/consumables (a divisible economy quantity with meaningful
 * per-head drift-splitting), world-unlock progress is NOT divisible or additively
 * attributable to one member of a shared cohort sim — there is no principled way to
 * say "these particular zone-kills were MINE". So the safe v1 fix FREEZES each member's
 * own `ProgressSlice` at the moment they join (or re-join, on a re-seed) a cohort:
 * every SAVE payload while active substitutes this frozen snapshot for the live shared
 * fields (via `applyProgressSlice` onto a throwaway shallow-cloned save-view — NEVER the
 * live cohort `state`, which would desync the lockstep sim), and leaving the cohort
 * restores it verbatim. Genuinely visiting a deep zone mid-party is unaffected (the
 * live `state` — and thus HUD/rendering — is untouched); only what gets WRITTEN TO DISK
 * for MY OWN character no longer includes anyone else's world progress. A session spent
 * personally re-clearing zones inside a cohort does not (yet) credit the individual
 * member's own unlock progress on save — a known limitation of this v1, matching the
 * "numbers TBD" framing `partyHandshake.ts`'s module doc already carries for cohort
 * economy; a real per-member unlock-crediting scheme is future work, not solved here.
 */

import { CONFIG, TOME_ALL_PAGES, zoneAt } from "@/engine";
import type { BossClearBest, GameState, WorldLocation } from "@/engine";
import { splitField } from "./cohortWallet";

/** The world-progression fields a member's OWN persisted save must reflect, frozen at
 * cohort-join time — never the live (shared, possibly a deep friend's) cohort state. */
export interface ProgressSlice {
  stage: number;
  location: WorldLocation;
  unlockedZones: Record<string, number>;
  lastFarmZone: WorldLocation;
  zoneKills: Record<string, number>;
  bossBest: Record<number, BossClearBest>;
  levelCapAt: number | null;
  asuraEssence: number;
  asuraZoneKills: Record<string, number>;
  asuraSigils: number;
  tomePages: number;
  tomeUnlocked: boolean;
}

/** Deep-copy the world-progression fields off a live `GameState` — every nested
 * record/object is cloned so the slice never aliases live state (same convention as
 * `cohortWallet.ts`'s `walletSliceFrom`). */
export function progressSliceFrom(state: GameState): ProgressSlice {
  return {
    stage: state.stage,
    location: { ...state.location },
    unlockedZones: { ...state.unlockedZones },
    lastFarmZone: { ...state.lastFarmZone },
    zoneKills: { ...state.zoneKills },
    bossBest: Object.fromEntries(Object.entries(state.bossBest).map(([k, v]) => [k, { ...v }])),
    levelCapAt: state.levelCapAt,
    asuraEssence: state.asuraEssence,
    asuraZoneKills: { ...state.asuraZoneKills },
    asuraSigils: state.asuraSigils,
    tomePages: state.tomePages,
    tomeUnlocked: state.tomeUnlocked,
  };
}

/**
 * Overwrite a `GameState`-shaped object's progression fields with a frozen `slice` —
 * used by `GameClient.serialize()` on a THROWAWAY shallow-cloned save-view (never the
 * live cohort `state` — mutating that would desync the lockstep sim across clients) and
 * by `collapseToSolo()` on the freshly-built (now exclusively mine, no longer shared)
 * solo `GameState`. Also recomputes `kills` (the live battlefield counter, not part of
 * `ProgressSlice`) to match the restored `zoneKills`/`location` pair — `initGameState`'s
 * own derivation (`zoneKills[mapId:zoneIdx] ?? 0`), so a restored location's in-progress
 * kill count is consistent rather than stale from whatever zone the cohort was standing
 * in. Mutates `target` in place; never touches `slice`.
 */
export function applyProgressSlice(
  target: Pick<
    GameState,
    | "stage"
    | "location"
    | "unlockedZones"
    | "lastFarmZone"
    | "zoneKills"
    | "bossBest"
    | "levelCapAt"
    | "asuraEssence"
    | "asuraZoneKills"
    | "asuraSigils"
    | "tomePages"
    | "tomeUnlocked"
    | "kills"
  >,
  slice: ProgressSlice,
): void {
  target.stage = slice.stage;
  target.location = { ...slice.location };
  target.unlockedZones = { ...slice.unlockedZones };
  target.lastFarmZone = { ...slice.lastFarmZone };
  target.zoneKills = { ...slice.zoneKills };
  target.bossBest = Object.fromEntries(Object.entries(slice.bossBest).map(([k, v]) => [k, { ...v }]));
  target.levelCapAt = slice.levelCapAt;
  target.asuraEssence = slice.asuraEssence;
  target.asuraZoneKills = { ...slice.asuraZoneKills };
  target.asuraSigils = slice.asuraSigils;
  target.tomePages = slice.tomePages;
  target.tomeUnlocked = slice.tomeUnlocked;
  target.kills = slice.zoneKills[`${slice.location.mapId}:${slice.location.zoneIdx}`] ?? 0;
}

/**
 * Owner bug batch B ("zone-unlock gauge reset + kills farmed in a cohort lost"): a
 * zoneKills map that FOLDS the live current-zone battlefield counter into the persisted
 * `zoneKills` record. The engine only stashes `state.kills` back into `zoneKills` on zone
 * LEAVE (a farm zone; `world.ts`'s `arriveAtZone`, key `"<mapId>:<zoneIdx>"`), so while
 * standing in a farm zone the in-progress count lives ONLY in `state.kills`. Folding it in
 * (via `max`, so a boss/town zone — where `kills` is 0/unrelated and no `zoneKills` entry
 * exists — is left untouched) gives a snapshot that reflects real progress this instant.
 * Never mutates `state`.
 */
export function liveZoneKills(
  state: Pick<GameState, "zoneKills" | "location" | "kills">,
): Record<string, number> {
  const out = { ...state.zoneKills };
  const key = `${state.location.mapId}:${state.location.zoneIdx}`;
  if (state.kills > (out[key] ?? 0)) out[key] = state.kills;
  return out;
}

/**
 * The SHARED cohort-pot progression fields `settleProgressSlice` measures a member's
 * personal share against. `zoneKills` IS part of `SharedCohortSave` (seeded from the
 * authority), so its baseline is the authority's deep counts; the asura/tome fields are
 * NOT in the shared save, so `buildCohortState` rebuilds them at 0/empty — their baseline
 * is therefore always 0 and the pot grows from 0 as the cohort farms asura. Captured off
 * the freshly-built cohort state at join (as `sharedBase`) and off the live state now
 * (as `sharedNow`). */
export interface SharedProgress {
  zoneKills: Record<string, number>;
  asuraEssence: number;
  asuraZoneKills: Record<string, number>;
  tomePages: number;
}

/** Snapshot the shared-progression fields off a live/built `GameState` — `zoneKills` folds
 * the in-progress current-zone counter (`liveZoneKills`) so a kill made THIS frame counts;
 * the asura record is deep-copied so the struct never aliases live state. */
export function sharedProgressFrom(
  state: Pick<GameState, "zoneKills" | "location" | "kills" | "asuraEssence" | "asuraZoneKills" | "tomePages">,
): SharedProgress {
  return {
    zoneKills: liveZoneKills(state),
    asuraEssence: state.asuraEssence,
    asuraZoneKills: { ...state.asuraZoneKills },
    tomePages: state.tomePages,
  };
}

/** FULL-CREDIT union of a record field: my frozen base PLUS the shared pot's full delta per
 * key since I joined (`max(0, now − base)`, floored so a re-seed / regression never
 * subtracts), over the UNION of every key. Used for both `zoneKills` and `asuraZoneKills`
 * (pure GATE counters — they only ever unlock zones / mint ศิลาโซน once, never divisible
 * economy, so per-head splitting would make partying strictly WORSE than solo). */
function unionFullCredit(
  baseM: Record<string, number>,
  sharedBaseM: Record<string, number>,
  sharedNowM: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const keys = new Set<string>([
    ...Object.keys(baseM),
    ...Object.keys(sharedBaseM),
    ...Object.keys(sharedNowM),
  ]);
  for (const k of keys) {
    out[k] = (baseM[k] ?? 0) + Math.max(0, (sharedNowM[k] ?? 0) - (sharedBaseM[k] ?? 0));
  }
  return out;
}

/**
 * Owner bug batch B (+ 2026-07-09 asura per-member accounting): settle MY personal
 * progression from the shared cohort pot. Per-field semantics, each chosen so partying is
 * never worse than solo and no shared economy is duplicated N×:
 *
 *  - `zoneKills` / `asuraZoneKills`: FULL CREDIT PER PERSON (`unionFullCredit`). Pure GATE
 *    counters (unlock a zone / earn a ศิลาโซน once) — dividing per head would strand a
 *    partied player, and there is nothing to duplicate.
 *  - `asuraEssence`: EQUAL MEAN-FIELD SPLIT (`splitField`, the exact recipe the wallet uses
 *    for gold/materials) — a SPENDABLE economy quantity (12/craft), so full credit to every
 *    member would mint it ×N. `max(0, base + trunc(drift/size))`.
 *  - `tomePages`: bitmask OR (`base | sharedNow`) — idempotent; every member present at a
 *    page's milestone banks that page. `tomeUnlocked` LATCHES: my frozen base OR the settled
 *    pages being complete (`TOME_ALL_PAGES`).
 *  - `asuraSigils`: `base + sigilClaims × sigilPerClaim` — NOT a drift split. Each z10 daily
 *    claim is server-ledgered once/day/character, so a member's own claim count (tracked
 *    client-side, incremented only after the server POST succeeds) is authoritative; the
 *    shared pot's sigil value is meaningless here.
 *
 * Every other `ProgressSlice` field (`unlockedZones`/`stage`/`bossBest`/…) stays FROZEN —
 * the accumulated `zoneKills` unlock the zones themselves once I'm back solo (via
 * `applyProgressSlice` + the engine's own `checkZoneUnlock`, and `deriveUnlockedZones` for
 * the live cohort DISPLAY). `size` is the cohort headcount (guarded >= 1). Never mutates
 * its inputs.
 */
export function settleProgressSlice(
  base: ProgressSlice,
  sharedBase: SharedProgress,
  sharedNow: SharedProgress,
  cohortSize: number,
  sigilClaims: number,
): ProgressSlice {
  const size = Math.max(1, cohortSize);
  const tomePages = base.tomePages | sharedNow.tomePages;
  return {
    ...base,
    zoneKills: unionFullCredit(base.zoneKills, sharedBase.zoneKills, sharedNow.zoneKills),
    asuraZoneKills: unionFullCredit(base.asuraZoneKills, sharedBase.asuraZoneKills, sharedNow.asuraZoneKills),
    asuraEssence: splitField(base.asuraEssence, sharedBase.asuraEssence, sharedNow.asuraEssence, size),
    asuraSigils: base.asuraSigils + Math.max(0, sigilClaims) * CONFIG.asura.tome.sigilPerClaim,
    tomePages,
    tomeUnlocked: base.tomeUnlocked || (tomePages & TOME_ALL_PAGES) === TOME_ALL_PAGES,
  };
}

/**
 * Owner live bug FIX 4 (2026-07-09, cohort case A z38 / B z31): derive MY OWN per-member
 * unlocked-zone counts for the live cohort DISPLAY, so a member sees their own gauge /
 * walk-arrows / GoalLadder — not the shared authority's (a fresh member partying at a deep
 * friend's zone used to see the friend's unlocks, walk forward, then get engine-rejected on
 * collapse). PURE mirror of the engine's `checkZoneUnlock` (world.ts): starting from my
 * FROZEN persist-unlock base (`slice.unlockedZones` — the quest PREVIEW grant is deliberately
 * NOT folded in, so a not-persist-unlocked map4 never cascades), cascade each map's count
 * forward one zone at a time while the current FRONTIER farm zone's settled `zoneKills` has
 * met `killGoal(stage)`. Mirrors the engine's exact rules:
 *   - only a FARM frontier unlocks its neighbour (a town/boss frontier stops the cascade);
 *   - the boss ROOM is unlocked once the last farm zone's quota is met (the engine bumps the
 *     count to `bossIdx+1` there too) — but the cascade then STOPS: crossing to the NEXT map
 *     requires a boss KILL, which is not purely derivable, so we are CONSERVATIVE and never
 *     derive-unlock across a map boundary (`checkZoneUnlock` returns false for a cross-map
 *     next zone as well).
 * Never mutates its input. Idempotent (re-running on the result is a fixed point).
 */
export function deriveUnlockedZones(slice: ProgressSlice): Record<string, number> {
  const out: Record<string, number> = { ...slice.unlockedZones };
  for (const mapId of Object.keys(out)) {
    let count = out[mapId] ?? 0;
    // Cascade forward within THIS map only. `count` strictly increases or we break, so this
    // terminates (once `count` exceeds the map's zones `zoneAt` no longer matches).
    while (count > 0) {
      const frontierIdx = count - 1;
      const frontier = zoneAt({ mapId, zoneIdx: frontierIdx });
      // `zoneAt` falls back to the FIRST farm for an unknown location — reject that (the
      // resolved zone must be exactly the one asked for).
      if (frontier.mapId !== mapId || frontier.zoneIdx !== frontierIdx) break;
      if (frontier.kind !== "farm") break; // only a FARM frontier unlocks its neighbour
      if ((slice.zoneKills[`${mapId}:${frontierIdx}`] ?? 0) < CONFIG.killGoal(frontier.stage)) break;
      const nextIdx = count;
      const next = zoneAt({ mapId, zoneIdx: nextIdx });
      if (next.mapId !== mapId || next.zoneIdx !== nextIdx) break; // no next zone in this map
      count = nextIdx + 1;
      out[mapId] = count;
      if (next.kind !== "farm") break; // boss room unlocked — a boss KILL opens the next map
    }
  }
  return out;
}
