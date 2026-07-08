/**
 * M8 party — cohort ECONOMY-INTEGRITY primitives (personal-wallet virtualization,
 * deterministic drop assignment, replicated per-hero config diffing).
 *
 * PURE module: no DOM / React / Pixi / relay import (both type imports below are
 * erased at runtime), so it is headlessly unit-testable exactly like
 * `buildFrameInput.ts` / `partyHandshake.ts`.
 *
 * ── Why any of this exists ─────────────────────────────────────────────────────────
 * A cohort's `GameState` economy scalars (`gold`/`goldEarned`/`materials`/
 * `consumables`/`lootSalt`/`lootCounter`) are SHARED — seeded from the seed authority
 * (`partyHandshake.ts`'s `SharedCohortSave`) and advanced identically on every client
 * by the deterministic lockstep sim. Taken naively that means (a) my pre-cohort solo
 * wallet is discarded on join, (b) my save row + HUD adopt the authority's numbers,
 * and (c) every `itemDrop`/`stoneDrop` — which carries NO hero attribution — is minted
 * by ALL N clients = N× duplication. This module virtualizes a PERSONAL wallet on top
 * of the shared pot and deterministically assigns each drop to exactly one member,
 * WITHOUT ever writing into the live cohort `state` (that would desync the sim). It
 * only shapes save payloads, HUD snapshots, and the post-collapse solo state.
 */

import type { BotSettings, GameState, HeroConfig } from "@/engine";

/** The mutable-economy slice a member privately owns a view of, on top of the shared
 * cohort pot. `consumables` is an open record (the engine's `ConsumableCounts` is a
 * fixed-key `Record<string, number>` today — treating it structurally keeps this immune
 * to catalog additions). */
export interface WalletSlice {
  gold: number;
  goldEarned: number;
  materials: number;
  consumables: Record<string, number>;
}

/** Snapshot the wallet fields off a live `GameState` — every field deep-copied so the
 * slice never aliases live state (the consumables record is cloned). */
export function walletSliceFrom(state: GameState): WalletSlice {
  return {
    gold: state.gold,
    goldEarned: state.goldEarned,
    materials: state.materials,
    consumables: { ...state.consumables },
  };
}

/** One shared-pot field's personal value: my pre-cohort base PLUS my equal-mean-field
 * share of the pot's drift since I joined (`trunc` toward zero), clamped >= 0. */
function splitField(base: number, sharedBase: number, sharedNow: number, size: number): number {
  return Math.max(0, base + Math.trunc((sharedNow - sharedBase) / size));
}

/**
 * Compute MY personal wallet from the shared cohort pot.
 *
 * EQUAL MEAN-FIELD SPLIT (owner-approved v1; tune later): for gold, materials, and each
 * consumable key, my value = `base[k] + trunc((sharedNow[k] − sharedBase[k]) / size)`,
 * clamped >= 0. `base` is my wallet AT THE MOMENT I joined (my pre-cohort solo wallet,
 * or the settled value from a prior cohort on re-seed); `sharedBase` is the shared pot
 * at that same moment; `sharedNow` is the shared pot now. Rationale: nobody loses their
 * pre-cohort wallet, the pot's collective drift (earnings AND spends) is divided per
 * head so nothing is double-counted, and the seed authority is treated symmetrically
 * (its own contribution already lives in `sharedBase`, so it too only takes a 1/size
 * share of subsequent drift). `Math.trunc` (toward zero) makes a negative drift — the
 * pot being spent, e.g. potions/refines — split the same magnitude-wise as a positive
 * one; the outer `max(0, …)` guards a member whose base was smaller than their share of
 * a large spend from going negative.
 *
 * `goldEarned` is special: it is a MONOTONIC lifetime counter the server's plausibility
 * guard reads, so its drift is floored at 0 (`base.goldEarned + max(0, floor(drift/size))`)
 * — it can only ever increase, never decrease, even if the shared `goldEarned` somehow
 * regressed.
 *
 * `size` is the cohort headcount; callers pass `state.heroes.length` (== cohort size by
 * construction, and race-free vs. slot-list bookkeeping). Guarded to >= 1.
 *
 * NEVER mutates its inputs and NEVER touches the live cohort `state`.
 */
export function virtualWallet(
  base: WalletSlice,
  sharedBase: WalletSlice,
  sharedNow: WalletSlice,
  cohortSize: number,
): WalletSlice {
  const size = Math.max(1, cohortSize);
  const consumables: Record<string, number> = {};
  const keys = new Set<string>([
    ...Object.keys(base.consumables),
    ...Object.keys(sharedBase.consumables),
    ...Object.keys(sharedNow.consumables),
  ]);
  for (const k of keys) {
    consumables[k] = splitField(
      base.consumables[k] ?? 0,
      sharedBase.consumables[k] ?? 0,
      sharedNow.consumables[k] ?? 0,
      size,
    );
  }
  return {
    gold: splitField(base.gold, sharedBase.gold, sharedNow.gold, size),
    goldEarned:
      base.goldEarned + Math.max(0, Math.floor((sharedNow.goldEarned - sharedBase.goldEarned) / size)),
    materials: splitField(base.materials, sharedBase.materials, sharedNow.materials, size),
    consumables,
  };
}

/** FNV-1a 32-bit hash of a string (deterministic, no RNG) — the basis for drop
 * assignment. `Math.imul` keeps the multiply in 32-bit space on every engine. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministically assign a drop to exactly ONE cohort member: `fnv1a(rollId) % size`,
 * returning that member's `state.heroes[]` index. Identical on every client (the cohort
 * state — and thus `size` and every hero's array index — is byte-identical by lockstep,
 * and `rollId` comes from the shared sim), so the buffering guard (mint the drop only
 * when the assigned index === my own cohort index) partitions drops perfectly: every
 * drop is minted once, by its assignee, with no cross-client coordination. Drops rotate
 * ~uniformly across members over many rolls. A member whose client is closed at that
 * instant forfeits that drop — the same acceptance the solo offline path already makes.
 */
export function dropAssignedIndex(rollId: string, cohortSize: number): number {
  if (cohortSize <= 1) return 0;
  return fnv1a32(rollId) % cohortSize;
}

/** The store-fed automation preferences the desired `HeroConfig` derives from — the
 * exact set the SOLO frame loop + `syncPrimaryHeroConfig` mirror onto `heroes[0]`. */
export interface AutomationPrefs {
  autoHunt: boolean;
  autoCast: boolean;
  autoAllocate: boolean;
  autoHpPotion: boolean;
  autoManaPotion: boolean;
  autoHpThreshold: number;
  autoManaThreshold: number;
  // Idle-bot settings, per hero (2026-07-09 "ตั้งค่าบอทเป็นของใครของมัน"). Sourced from the
  // store's `bot` block overlaid with the client-local `setBotSettings` wish latch (below).
  enabled: boolean;
  sellTripEnabled: boolean;
  hpPotionTarget: number;
  mpPotionTarget: number;
  scrollReserve: number;
  goldReserve: number;
}

/**
 * The `HeroConfig` I WANT my cohort hero to have this frame — the byte-for-byte same
 * recipe the solo path uses (`GameClient`'s per-frame flag block + `syncPrimaryHeroConfig`):
 * every sub-behavior is ANDed against the bot MASTER switch (`autoHunt`), the master and
 * the thresholds pass through raw. Feeding this through the replicated `setHeroConfig`
 * lane intent (see `heroConfigDiff`) is what makes mid-cohort settings toggles actually
 * take effect (solo's global mirror no-ops at `heroes.length >= 2`).
 */
export function desiredHeroConfig(p: AutomationPrefs): HeroConfig {
  const botOn = p.autoHunt;
  return {
    autoCast: botOn && p.autoCast,
    autoAllocate: botOn && p.autoAllocate,
    autoHunt: p.autoHunt,
    autoHpPotion: botOn && p.autoHpPotion,
    autoManaPotion: botOn && p.autoManaPotion,
    autoHpThreshold: p.autoHpThreshold,
    autoManaThreshold: p.autoManaThreshold,
    // Idle-bot settings pass through RAW (NOT ANDed with the master switch) — the SOLO
    // mirror (`syncPrimaryHeroConfig`) copies `state.bot` verbatim, so a cohort member's
    // config must too, or the leave-decision / post-collapse solo bot would behave differently.
    enabled: p.enabled,
    sellTripEnabled: p.sellTripEnabled,
    hpPotionTarget: p.hpPotionTarget,
    mpPotionTarget: p.mpPotionTarget,
    scrollReserve: p.scrollReserve,
    goldReserve: p.goldReserve,
  };
}

/**
 * Diff a desired `HeroConfig` against my hero's CURRENT config. Returns the FULL desired
 * config to send as `setHeroConfig` when ANY field differs, or `null` when they already
 * match (nothing to replicate this turn). Sending the whole object (not a minimal patch)
 * keeps the replicated intent self-contained + idempotent — replaying it on every client
 * lands the identical config regardless of each client's prior lane history.
 */
export function heroConfigDiff(desired: HeroConfig, current: HeroConfig | undefined): HeroConfig | null {
  if (!current) return desired;
  const changed =
    desired.autoCast !== current.autoCast ||
    desired.autoAllocate !== current.autoAllocate ||
    desired.autoHunt !== current.autoHunt ||
    desired.autoHpPotion !== current.autoHpPotion ||
    desired.autoManaPotion !== current.autoManaPotion ||
    desired.autoHpThreshold !== current.autoHpThreshold ||
    desired.autoManaThreshold !== current.autoManaThreshold ||
    // Idle-bot settings (2026-07-09) — any one differing re-emits the full config.
    desired.enabled !== current.enabled ||
    desired.sellTripEnabled !== current.sellTripEnabled ||
    desired.hpPotionTarget !== current.hpPotionTarget ||
    desired.mpPotionTarget !== current.mpPotionTarget ||
    desired.scrollReserve !== current.scrollReserve ||
    desired.goldReserve !== current.goldReserve;
  return changed ? desired : null;
}

/**
 * Owner bug batch A #2 ("bot master toggle dead in a cohort"): a CLIENT-LOCAL "wish latch"
 * for MY hero's `autoHunt` master switch. `store.autoHunt` in a cohort is a mirror of the
 * SHARED, lane-0-owned `state.autoHunt` (part of `SharedCohortSave`) — it never reflects a
 * member's own toggle, so feeding it straight into `desiredHeroConfig` makes the
 * `heroConfigDiff` perpetually null and the toggle does nothing. Instead: when the player
 * taps the master, we LATCH the pressed value here and feed it (`wish ?? store.autoHunt`)
 * into `desiredHeroConfig`, so a real `setHeroConfig` diff is emitted and replicated on my
 * lane. The latch releases the moment my hero's own replicated `config.autoHunt` confirms
 * the wish landed — after that we fall back to the store mirror again (no perpetual
 * override). We flip NO store value optimistically (that would race the next
 * `syncFromEngine` snapshot overwrite and self-revert).
 *
 * `prevWish`  — the currently latched wish (or `null` = none).
 * `pendingSetAutoHunt` — a freshly-drained `FrameInput.setAutoHunt` this frame (a `boolean`
 *   when the player toggled, else `null`/`undefined`). Last-wins: a new toggle supersedes
 *   any still-latched prior wish (rapid off→on lands "on").
 * `heroConfigAutoHunt` — my hero's CURRENT replicated `config.autoHunt`.
 *
 * PURE — reads no state, writes nothing; the caller owns the `prevWish` storage.
 */
export function nextAutoHuntWish(
  prevWish: boolean | null,
  pendingSetAutoHunt: boolean | null | undefined,
  heroConfigAutoHunt: boolean,
): boolean | null {
  const wish = typeof pendingSetAutoHunt === "boolean" ? pendingSetAutoHunt : prevWish;
  if (wish !== null && heroConfigAutoHunt === wish) return null; // config caught up — release
  return wish;
}

/**
 * The bot MASTER SWITCH's HUD-facing value: MY OWN hero's `config.autoHunt` — NOT the
 * shared, lane-0-owned legacy `state.autoHunt` field (owner live bug: "leader's toggle
 * flips everyone, member can't toggle self").
 *
 * ── Root cause ──────────────────────────────────────────────────────────────────────
 * `buildSnapshot` used to read `autoHunt: state.autoHunt` — a SINGLE shared `GameState`
 * scalar every cohort client sees identically (it's part of `SharedCohortSave`, seeded
 * from the authority). That value fed `store.autoHunt`, which in turn fed BOTH the
 * toggle button's own on/off DISPLAY and (via `desiredHeroConfig`) every member's
 * REPLICATED `setHeroConfig` diff every single frame. So: the party leader's toggle
 * wrote the shared field (`step()`'s `primary.setAutoHunt` — lane 0 only), which every
 * OTHER client's next `buildSnapshot` echoed back as "MY" `store.autoHunt`, which their
 * own `desiredHeroConfig` then dutifully replicated onto THEIR hero — silently
 * overwriting a member's real preference with the leader's ("leader's toggle flips
 * everyone"). Symmetrically, a non-lead member's own toggle correctly flipped THEIR
 * hero's config via the engine's `i>=1` `setAutoHunt` branch, but their button's
 * DISPLAY (and the next frame's `desiredHeroConfig` input) was still driven by the
 * untouched shared field, which immediately replicated the STALE value right back onto
 * their own hero the very next turn ("member can't toggle self" — a self-reverting
 * toggle).
 *
 * ── The fix ─────────────────────────────────────────────────────────────────────────
 * `heroes[0]` is "my hero" by the convention `buildSnapshot`'s caller already
 * establishes everywhere else in a cohort (the snapshot state's `heroes` array is
 * reordered so index 0 is always mine — see `GameClient.tsx`'s per-frame UI-sync doc).
 * Reading `heroes[0].config.autoHunt` instead makes the toggle, its display, and the
 * `desiredHeroConfig` replication input all agree on MY OWN hero's real automation
 * state, independent of every other member's. In SOLO this is byte-identical to the old
 * read (`syncPrimaryHeroConfig` keeps `heroes[0].config.autoHunt === state.autoHunt` in
 * lockstep every step). Falls back to `state.autoHunt` only for a defensively-shaped
 * input with no heroes at all (never a real `GameState`).
 */
export function myAutoHuntDisplay(state: Pick<GameState, "heroes" | "autoHunt">): boolean {
  return state.heroes[0]?.config.autoHunt ?? state.autoHunt;
}

/**
 * Bot-settings client-local WISH LATCH (2026-07-09 "ตั้งค่าบอทเป็นของใครของมัน") — the
 * `setBotSettings`-panel analogue of `nextAutoHuntWish`. In a cohort every BotSettingsSection
 * switch fires a `setBotSettings` intent that `step()` applied lane-0-only (leader) / dead
 * (member) — and the HUD's `store.bot` mirrors MY hero's replicated `config`, so feeding it
 * straight into `desiredHeroConfig` makes the `heroConfigDiff` perpetually null (the panel does
 * nothing). Instead we latch each pressed FIELD here and feed it (overlaid on `store.bot`) into
 * `desiredHeroConfig`, so a real per-hero `setHeroConfig` diff is emitted and replicated on MY
 * lane. Each field releases the moment my hero's own `config` confirms the wished value landed.
 *
 * `prevWish`     — the currently latched partial wish (or `null`).
 * `pendingPatch` — a freshly-drained `FrameInput.setBotSettings` this frame (or `null`/undefined).
 *                  Last-wins PER FIELD: a new patch field supersedes a still-latched prior one.
 * `currentConfig`— my hero's CURRENT replicated config (its bot fields confirm/release wishes).
 *
 * PURE — reads no state, writes nothing; the caller owns the `prevWish` storage.
 */
export function nextBotSettingsWish(
  prevWish: Partial<BotSettings> | null,
  pendingPatch: Partial<BotSettings> | null | undefined,
  currentConfig: HeroConfig | undefined,
): Partial<BotSettings> | null {
  const merged: Partial<BotSettings> = { ...(prevWish ?? {}), ...(pendingPatch ?? {}) };
  const out: Partial<BotSettings> = {};
  const keep = <K extends keyof BotSettings>(k: K): void => {
    const v = merged[k];
    if (v === undefined) return;
    if (currentConfig && currentConfig[k] === v) return; // config caught up — release this field
    out[k] = v;
  };
  keep("enabled");
  keep("sellTripEnabled");
  keep("hpPotionTarget");
  keep("mpPotionTarget");
  keep("scrollReserve");
  keep("goldReserve");
  return Object.keys(out).length > 0 ? out : null;
}

/** Extract the six `BotSettings` fields off a `HeroConfig` (config is structurally a superset).
 * Used to (a) show MY hero's own bot settings in the HUD snapshot and (b) overlay them onto the
 * SaveData / post-collapse solo `state.bot` so a cohort member persists/keeps their own config. */
export function botSettingsFrom(config: HeroConfig | undefined, fallback: BotSettings): BotSettings {
  if (!config) return { ...fallback };
  return {
    enabled: config.enabled,
    sellTripEnabled: config.sellTripEnabled,
    hpPotionTarget: config.hpPotionTarget,
    mpPotionTarget: config.mpPotionTarget,
    scrollReserve: config.scrollReserve,
    goldReserve: config.goldReserve,
  };
}
