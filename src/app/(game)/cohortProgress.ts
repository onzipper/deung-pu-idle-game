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

import type { BossClearBest, GameState, WorldLocation } from "@/engine";

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
 * Owner bug batch B: settle MY personal zone-unlock progress from the shared cohort pot.
 * Semantics = FULL CREDIT PER PERSON — a kill made inside a cohort is one shared event all
 * present members participated in (playing solo would credit the same kill in full;
 * `zoneKills` only ever unlocks zones, never mints economy, so there is no dupe risk, and
 * dividing per-head would make partying strictly WORSE than solo for unlocking). So each
 * key's settled value = my FROZEN base (`base.zoneKills`) PLUS the shared pot's full delta
 * since I joined (`max(0, sharedNow[k] − sharedBase[k])`, floored so a re-seed / regression
 * never subtracts), over the UNION of every key. Every other `ProgressSlice` field
 * (`unlockedZones`/`stage`/`bossBest`/…) stays FROZEN — the accumulated kills unlock the
 * zone themselves once I'm back solo, via `applyProgressSlice`. Never mutates its inputs.
 */
export function settleProgressSlice(
  base: ProgressSlice,
  sharedBaseZK: Record<string, number>,
  sharedNowZK: Record<string, number>,
): ProgressSlice {
  const zoneKills: Record<string, number> = {};
  const keys = new Set<string>([
    ...Object.keys(base.zoneKills),
    ...Object.keys(sharedBaseZK),
    ...Object.keys(sharedNowZK),
  ]);
  for (const k of keys) {
    const accrued = Math.max(0, (sharedNowZK[k] ?? 0) - (sharedBaseZK[k] ?? 0));
    zoneKills[k] = (base.zoneKills[k] ?? 0) + accrued;
  }
  return { ...base, zoneKills };
}
