/**
 * M8 party P4b — pure `PendingInput` -> `FrameInput` builder, shared by the SOLO loop
 * and the cohort turn scheduler so BOTH construct my lane identically.
 *
 * Lives in its own module (rather than inside `GameClient.tsx`) purely so it stays unit-
 * testable WITHOUT dragging the Pixi renderer / audio / React graph into a headless test.
 * Both its type imports are ERASED at runtime, so this module has zero runtime deps.
 *
 * `myHeroIndex` is my position in `state.heroes[]` (0 for solo; my cohort array index
 * otherwise). Intents that EMBED an explicit hero index — `castSkills[].slot`,
 * `evolveHero`, `acceptQuest` (the store hardcodes these to 0, since the HUD always
 * treats "my hero" as index 0) — are REMAPPED to `myHeroIndex`, because `step()` applies
 * each lane's embedded index against `state.heroes[<that index>]` from EVERY lane (see
 * `engine/core/step.ts`'s routing). Without the remap a non-index-0 member's manual cast /
 * evolve / quest-accept would target `heroes[0]` (the OTHER player). `setAutoSlots[].slot`
 * is an AUTO-CAST slot (0-2), NOT a hero index — left untouched. For `myHeroIndex === 0`
 * the output deep-equals the legacy solo literal (the remap is the identity there).
 */

import type { FrameInput } from "@/engine";
import type { PendingInput } from "@/ui/store/gameStore";

export function buildFrameInput(
  pending: PendingInput,
  inventoryCount: number,
  myHeroIndex: number,
): FrameInput {
  return {
    castSkills: pending.castSkills.length
      ? pending.castSkills.map((c) => ({ ...c, slot: myHeroIndex }))
      : undefined,
    setAutoSlots: pending.setAutoSlots.length ? pending.setAutoSlots : undefined,
    challengeBoss: pending.challengeBoss || undefined,
    advanceStage: pending.advanceStage || undefined,
    walkToZone: pending.walkToZone ?? undefined,
    evolveHero: pending.evolveHero !== null ? myHeroIndex : undefined,
    acceptQuest: pending.acceptQuest !== null ? myHeroIndex : undefined,
    // M7.9 stat-tap-fix: a per-stat batch map (accumulated by the store, not last-wins),
    // passed straight through; the engine applies every entry in one step().
    allocateStat: pending.allocateStat ?? undefined,
    buyShopItem: pending.buyShopItem ?? undefined,
    useConsumable: pending.useConsumable ?? undefined,
    useReturnScroll: pending.useReturnScroll || undefined,
    equip: pending.equip ?? undefined,
    setBotSettings: pending.setBotSettings ?? undefined,
    setAutoHunt: pending.setAutoHunt ?? undefined,
    fastTravel: pending.fastTravel ?? undefined,
    goldCredit: pending.goldCredit ?? undefined,
    // M7.6 ตีบวก: signed material-counter delta (salvage +, refine −).
    materialsDelta: pending.materialsDelta ?? undefined,
    // M7.5: the sell-trip bot's trigger — the engine knows nothing about item instances,
    // so the client feeds this transient count every frame.
    inventoryCount,
    // M7.8 Manual Play: RO-style tap-to-move / tap-to-attack.
    moveTo: pending.moveTo ?? undefined,
    attackTarget: pending.attackTarget ?? undefined,
    cancelCommand: pending.cancelCommand || undefined,
    // M8 quest Wave C: daily-roster install/reconcile, daily/main claim intents, warp scroll.
    setDailies: pending.setDailies ?? undefined,
    claimDaily: pending.claimDaily ?? undefined,
    claimMainReward: pending.claimMainReward ?? undefined,
    useWarpScroll: pending.useWarpScroll ?? undefined,
    // World boss "เสี่ยจ๋อง": GameClient's own schedule check queues this (never a
    // direct player action) while standing in the window's boss zone — plain
    // passthrough, no hero-index remap needed (it's location-based, not per-hero).
    spawnWorldBoss: pending.spawnWorldBoss ?? undefined,
    // World boss "เสี่ยจ๋อง" SHARED-HP sync (M8.6): same "GameClient's own schedule/network
    // check queues this" shape as `spawnWorldBoss` above — plain passthrough. The engine
    // reads it from LANE 0 only (`step()`'s `primary.syncWorldBoss`), so only the cohort
    // AUTHORITY's client actually lands one (see `ui/worldBoss/schedule.ts`'s dedup doc);
    // a non-authority member never queues this field in the first place.
    syncWorldBoss: pending.syncWorldBoss ?? undefined,
    // ดินแดนอสูร daily hot zone: same "GameClient's own schedule check queues this"
    // shape as `spawnWorldBoss` above — plain passthrough, location-based not per-hero.
    setAsuraHotZone: pending.setAsuraHotZone ?? undefined,
    // "ตำราตำนาน" secret tome + legendary craft (endgame v1.3): both queued ONLY after
    // their respective server POST confirms (`ui/asura/tomeFlow.ts`) — plain passthrough,
    // no hero-index remap needed (solo-hero-scoped, `craftLegendary` defaults its own `cls`
    // engine-side to `state.heroes[0].cls`).
    claimAsuraSigil: pending.claimAsuraSigil || undefined,
    craftLegendary: pending.craftLegendary || undefined,
  };
}

/**
 * The `FrameInput` fields that CHANGE the shared zone/location. In a cohort these must
 * NEVER apply to the shared sim (design §3: a zone change makes you LEAVE the cohort and
 * roam solo). `challengeBoss` is DELIBERATELY EXCLUDED — co-op boss entry is a shared
 * cohort action that stays on lane 0. Shared by the pre-tick interception (reads
 * `PendingInput`) and the defense-in-depth lane sanitizer (reads assembled `FrameInput`).
 */
const ZONE_CHANGE_KEYS = [
  "fastTravel",
  "walkToZone",
  "useWarpScroll",
  "useReturnScroll",
  "advanceStage",
] as const;

/**
 * True when a peeked/drained `PendingInput` carries ANY zone-change intent — the signal
 * for GameClient to collapse the cohort to solo BEFORE this frame's solo path applies the
 * move (fix B). `useReturnScroll`/`advanceStage` are booleans; the rest are nullable.
 */
export function hasZoneChangeIntent(pending: PendingInput): boolean {
  return (
    pending.fastTravel != null ||
    pending.walkToZone != null ||
    pending.useWarpScroll != null ||
    pending.useReturnScroll ||
    pending.advanceStage
  );
}

/**
 * Defense-in-depth (fix B): strip every zone-change field from ALL cohort lanes before
 * `step()` — identical code on every client ⇒ identical shared state. My own client never
 * emits these in a lane after the pre-tick interception, but a stale/older peer build
 * could. Only clones a lane that actually carries one (the common no-op case returns the
 * SAME array reference — allocation-light, so a clean cohort tick is unaffected).
 */
export function sanitizeLanes(lanes: FrameInput[]): FrameInput[] {
  let dirty = false;
  const out = lanes.map((lane) => {
    if (!ZONE_CHANGE_KEYS.some((k) => lane[k] != null)) return lane;
    dirty = true;
    const copy = { ...lane };
    for (const k of ZONE_CHANGE_KEYS) delete copy[k];
    return copy;
  });
  return dirty ? out : lanes;
}
