/**
 * Public engine API.
 *
 * `render/`, `ui/`, and `server/` import ONLY from here — never reach into
 * engine internals. This keeps the pure-simulation boundary intact.
 */

export * from "@/engine/core/loop";
export * from "@/engine/core/rng";
export * from "@/engine/core/math";
export * from "@/engine/core/dmath";
export * from "@/engine/core/hash";
export * from "@/engine/core/step";
export * from "@/engine/config";
// M7 gear catalog + drop tables (config/items is NOT re-exported by config/index —
// it's a pinned contract module). render/ui read templates + the EquippedGear type
// through here; the server imports it directly (@/engine/config/items).
export * from "@/engine/config/items";
// M7.6 ตีบวก (Refine) tunables + pure derivations (config/refine is NOT re-exported
// by config/index — like config/items it's a standalone contract module). The UI
// reads REFINE + cost/salvage/success helpers to draw the refine cabinet; the
// server imports it directly to gate/roll refines. The engine never ROLLS a refine.
export * from "@/engine/config/refine";
export * from "@/engine/entities";
export * from "@/engine/state";
export * from "@/engine/state/version";
// Incoming-save payload zod schema (SAVE-shape boundary contract). Colocated with
// the SaveData shape so a future SAVE_VERSION bump is one self-contained engine
// edit; the server layer (src/server/save.ts) only IMPORTS it.
export * from "@/engine/state/saveSchema";

// Derived-stat helpers and positional queries the render/ui layers need
// (e.g. team power for the boss hint, target lists for drawing).
export * from "@/engine/systems/stats";
export * from "@/engine/systems/targeting";

// Class-advancement (evolution) helpers: `canEvolveHero` lets the UI derive a
// per-hero `canEvolve` flag for its snapshot; `evolveHero` is applied only through
// `step()` via the `evolveHero` FrameInput intent.
export { canEvolveHero, evolveHero } from "@/engine/systems/evolution";

// Class-change quest (M5 task 5) read helpers: the UI derives the quest affordance
// (offer / accepted progress / complete) from these pure reads. `acceptQuest` is
// applied only through `step()` via the `acceptQuest` FrameInput intent (internal).
export {
  classChangeQuestFor,
  classChangeQuestId,
  isClassChangeQuestOffered,
  isQuestComplete,
  // M7.9 "Grand Expansion" tier-3 quest reads (the UI derives the tier-2 -> tier-3
  // affordance from these): the per-class tier-3 quest def/id, the tier -> quest
  // resolver, and the general (tier-aware) offer predicate.
  tier3QuestFor,
  tier3QuestId,
  evolutionQuestFor,
  isEvolutionQuestOffered,
  // M7.9b tier-3 quest BOSS objective: the UI surfaces the "challenge the young Sovereign"
  // affordance from `isTier3BossObjectiveActive` (kill objective banked, boss pending).
  isTier3BossObjectiveActive,
  // M8 "party feel pack": QUEST-boss (evolution exam) detection — drives the party HP
  // headcount scale in startBossFight (STAGE bosses stay melty; exams don't).
  isQuestBossFight,
  isClassChangeBossFight,
} from "@/engine/systems/quests";

// M8 Wave A — MAIN quest line reads (the UI's chapter tracker derives from these; the
// claim itself goes through `step()` via the `claimMainReward` intent). `mainQuestChapters`
// is the per-chapter view; `isMainChapterComplete` / `completedChapterIds` are the pure
// progression derivations the v17 migration + UI share. NOTE (handoff): `ui/goalLadder.ts`
// should later re-export the chapter derivation from HERE to avoid a second source of truth.
export {
  mainQuestChapters,
  mainChapterDefs,
  isMainChapterComplete,
  completedChapterIds,
  type MainChapterView,
  type MainChapterDef,
} from "@/engine/systems/mainQuest";

// M8 Wave A — DAILY quest reads (the UI's daily panel derives from these; setDailies /
// claimDaily go through `step()` intents). `dailyDef` resolves a catalog entry; `isDailyComplete`
// is the pure claim-affordance read. The roster lives on `hero.dailies` (entities `HeroDailies`).
export { dailyDef, isDailyComplete, type DailyDef } from "@/engine/systems/dailyQuests";

// M8 Wave A — the shared quest-reward shape (main + daily rewards). The grant itself is
// engine-internal (choke point `grantQuestReward`), applied only through claim intents.
export { type QuestReward } from "@/engine/systems/questRewards";

// Read-only boss-hint data for the UI panel. The sim itself is driven only
// through `step(state, input)`; systems are not part of the public surface.
export { bossHint, type BossHint } from "@/engine/systems/boss";

// WORLD BOSS "เสี่ยจ๋อง" (hourly world boss — engine wave). The CLIENT computes the
// wall-clock schedule from these PURE reads (the engine never reads a clock) and injects
// the `spawnWorldBoss` FrameInput while the player stands in the chosen zone; the spawn/
// despawn/kill logic is engine-internal (driven through `step()`), so only the schedule
// reads + knobs are public. `WORLD_BOSS` = the CONFIG.worldBoss knobs.
export {
  WORLD_BOSS,
  worldBossWindowId,
  worldBossPhaseAt,
  worldBossZoneFor,
  worldBossFarmZones,
  worldBossLocationFor,
  type WorldBossPhase,
} from "@/engine/systems/worldBoss";

// M7.95 "Hall of Fame" read surface: the server ranks characters + the UI draws the
// board from `hallOfFame(state)` (lifetime gold / best boss clears / level-cap
// timestamp). The counters are engine-internal write-only observers, updated only
// through `step()`; only the pure read + its types are public.
export {
  hallOfFame,
  HOF_UNSTAMPED,
  type HallOfFameStats,
  type BossClearBest,
} from "@/engine/systems/hallOfFame";

// World / zone read helpers (M6 "World & Town"): the UI derives the current
// map/zone label + walk-arrow (adjacent/locked) affordances from these pure
// reads. Navigation itself happens ONLY through `step()` intents
// (`walkToZone` / `challengeBoss` / `advanceStage`), so the mutators stay internal.
export {
  zoneAt,
  worldNav,
  isZoneUnlocked,
  // M7.9 tier-3 quest preview (owner "option ข"): `questGrantsZoneAccess` is the pure
  // derived grant (map4 z1 while the tier-3 quest is held); `effectiveUnlockedZones` is
  // the count map with the grant folded in — the UI builds its zone/fast-travel snapshot
  // off THIS (a clean extension of the `unlockedZones` read path) so the preview zone
  // surfaces without a persisted unlock.
  questGrantsZoneAccess,
  effectiveUnlockedZones,
  // Tier-3 frontier GATE (owner rule 2026-07-07 "ห้ามข้ามแมพ"): `tier3FrontierLocked` is the UI
  // read for "quest held but the tundra grant isn't enterable yet" (map3 boss room not
  // persist-unlocked) — the quest card shows "ไต่แมพ 3 ให้ถึงประตูบอสก่อน" and guide-me routes to
  // `deepestUnlockedFarm` (the player's real progression frontier) instead of warping to map4.
  tier3FrontierLocked,
  deepestUnlockedFarm,
  // "Quest leads" routing (M7.95): the single derivation every idle-automation path
  // (death auto-return, bot town-trip return, auto-advance guard) uses to prefer the
  // active evolution quest's granted frontier over the ordinary lastFarmZone.
  botFarmTarget,
  firstFarmLocation,
  type Zone,
  type WorldNav,
  type ZoneNeighbor,
} from "@/engine/systems/world";

// ดินแดนอสูร (ASURA) hard-map reads (endgame v1). The UI gates the asura warp tab on
// `isAsuraUnlocked` (persist gate after the s30 boss — the tier3GateCleared precedent), reads the
// depth band (`asuraRefineBandForStage`) for the "+8/+9/+10" hint, and computes the daily hot zone
// off `asuraHotZoneFor` (client-side, from the Bangkok day-key) to inject the `setAsuraHotZone`
// intent. The elite / essence / counter mutations are engine-internal (driven through `step()`),
// so only the pure reads + the map id are public.
export {
  ASURA_MAP_ID,
  isAsuraStage,
  isAsuraLocation,
  isAsuraUnlocked,
  asuraRefineBandForStage,
  asuraHotZoneFor,
  asuraRewardMult,
  asuraZoneKey,
  // "ตำราตำนาน" secret tome + legendary craft (endgame v1.3) PURE reads — the UI's tome checklist
  // + craft affordance derive from these; the mutators (grantAsuraSigil / craftLegendary /
  // foundTomePage) are engine-internal (driven only through `step()` intents).
  tomePagesFound,
  hasAllZoneStones,
  canCraftLegendary,
  craftBlockReason,
  TOME_ALL_PAGES,
  TOME_PAGE_COUNT,
  PAGE_ELITE,
  PAGE_DEPTH_1,
  PAGE_DEPTH_2,
} from "@/engine/systems/asura";

// NPC shop / consumables read helpers (M6 "เมืองหลัก"): the UI derives shop prices
// (stage-scaled) + potion quick-use affordances from these pure reads. The
// mutators (buy / use / return-scroll) happen ONLY through `step()` intents, so
// they stay internal.
export {
  SHOP_ITEMS,
  shopPriceAt,
  shopStageOf,
  canUseConsumable,
  emptyConsumables,
} from "@/engine/systems/consumables";

// Idle-bot settings (M7.5): the UI derives its bot-config form defaults from these
// pure reads. The bots run ONLY through `step()` (deterministic, engine-side); the
// mutator is the `setBotSettings` FrameInput intent, so it stays internal.
export { defaultBotSettings, normalizeBotSettings } from "@/engine/systems/bots";
// M8 party (owner 2026-07-08): the bot's restock/sell "want a town trip" predicate,
// extracted PURE so `GameClient`'s cohort branch can evaluate it against MY
// virtualized wallet slice (not the raw shared state) to decide whether to leave the
// cohort and do the trip solo — see `systems/bots.ts`'s `wantsBotTownTrip` doc.
export {
  wantsBotTownTrip,
  type BotRestockConsumables,
  type BotTripWant,
} from "@/engine/systems/bots";

// Town NPC anchors (M6 town NPCs phase 2): the ENGINE owns the geometry (CONFIG.townNpcs)
// so render derives its rigs from `townNpcConfig` and phase-3 UI gates tap-to-talk on the
// pure `npcInRange(state, id)` read — the layer rule holds (engine never imports render).
export { npcInRange, townNpcConfig, type TownNpcAnchor } from "@/engine/systems/townNpcs";

// Skill-kit read helpers (M5 skill framework v2): the UI derives its per-skill
// button state (learned/ready/affordable) and auto-slot state from these pure
// reads. Casting / slot assignment happen ONLY through `step()` intents
// (`castSkills` / `setAutoSlots`), so the mutators stay internal.
export {
  learnedSkills,
  unlockedAutoSlotCount,
  isSkillLearned,
  canCastSkill,
  skillCdOf,
} from "@/engine/systems/skills";
