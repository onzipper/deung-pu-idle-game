/**
 * Public engine API.
 *
 * `render/`, `ui/`, and `server/` import ONLY from here — never reach into
 * engine internals. This keeps the pure-simulation boundary intact.
 */

export * from "@/engine/core/loop";
export * from "@/engine/core/rng";
export * from "@/engine/core/math";
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
} from "@/engine/systems/quests";

// Read-only boss-hint data for the UI panel. The sim itself is driven only
// through `step(state, input)`; systems are not part of the public surface.
export { bossHint, type BossHint } from "@/engine/systems/boss";

// World / zone read helpers (M6 "World & Town"): the UI derives the current
// map/zone label + walk-arrow (adjacent/locked) affordances from these pure
// reads. Navigation itself happens ONLY through `step()` intents
// (`walkToZone` / `challengeBoss` / `advanceStage`), so the mutators stay internal.
export {
  zoneAt,
  worldNav,
  isZoneUnlocked,
  firstFarmLocation,
  type Zone,
  type WorldNav,
  type ZoneNeighbor,
} from "@/engine/systems/world";

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
