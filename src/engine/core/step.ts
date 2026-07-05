/**
 * The single fixed-timestep transition: `step(state, input) -> state`.
 *
 * Advances exactly one `FIXED_DT`. Callers use `drainAccumulator` to decide how
 * many steps to run per frame (speed multiplier = more steps, never a bigger
 * dt). Deterministic given `(state, input)` and the RNG cursor in state.
 *
 * The systems run in the POC's update order. `step` MUTATES and returns the same
 * `state` object — the transformation is the mutation; there is no hidden I/O,
 * no wall-clock read, and randomness comes only from the seeded RNG rebuilt from
 * `state.rngState` each step.
 */

import { FIXED_DT } from "@/engine/core/loop";
import { createRng } from "@/engine/core/rng";
import type { GameState } from "@/engine/state";
import type { ShopItemId, StatKey, WorldLocation } from "@/engine/entities";
import {
  applyReturnScroll,
  buyShopItem,
  processConsumables,
  tickConsumableCds,
} from "@/engine/systems/consumables";
import { updateAnchor } from "@/engine/systems/movement";
import { updateWaveSpawns } from "@/engine/systems/waves";
import { processSkills, setAutoSlot } from "@/engine/systems/skills";
import { startBossFight, updateBoss } from "@/engine/systems/boss";
import { evolveHero } from "@/engine/systems/evolution";
import { acceptQuest } from "@/engine/systems/quests";
import { processStatAllocation } from "@/engine/systems/allocation";
import {
  advanceToNextMap,
  checkZoneUnlock,
  enterBossRoom,
  updateTransit,
  walkToZone,
  zoneAt,
} from "@/engine/systems/world";
import {
  decayHeroTimers,
  updateEnemies,
  updateHeroes,
  updateProjectiles,
  resolveDeaths,
} from "@/engine/systems/combat";

/** A manual skill cast: cast `skillId` on the hero at `slot` (0 = solo hero). */
export interface CastSkillInput {
  slot: number;
  skillId: string;
}

/** Assign an auto-cast slot for the solo hero (M5 skill framework v2). */
export interface SetAutoSlotInput {
  slot: number;
  /** Skill id to place in the slot, or null to clear it. */
  skillId: string | null;
}

/** Per-step player input. Every field is optional; omit for a pure idle step. */
export interface FrameInput {
  /**
   * Manual skill casts this step (M5): each names a hero slot + a specific skill
   * id, subject to the cooldown / mana / range guards. Applied once per drained
   * input (a click casts exactly once, at any speed).
   */
  castSkills?: CastSkillInput[];
  /**
   * Auto-cast slot assignments for the solo hero (M5). Honoured across phases; a
   * no-op for a locked slot or an unlearned skill. Applied once per drained input.
   */
  setAutoSlots?: SetAutoSlotInput[];
  /**
   * Walk to an adjacent, unlocked zone (M6 "World & Town"). The primary
   * navigation intent (walk arrows). No-op while traveling, mid boss fight, dead,
   * or if the target isn't adjacent + unlocked. Applied once per drained input.
   */
  walkToZone?: WorldLocation;
  /**
   * Walk INTO the current map's boss room (M6 — the "เข้าห้องบอส" action). A
   * convenience wrapper over `walkToZone` valid at the last farm zone once the
   * boss room is unlocked. (Pre-M6 this began the boss fight directly.)
   */
  challengeBoss?: boolean;
  /**
   * From a boss-room VICTORY, walk into the next MAP's first zone (M6). A
   * convenience wrapper over `walkToZone`. (Pre-M6 this advanced the stage.)
   */
  advanceStage?: boolean;
  /**
   * Evolve the hero at this slot index (M5 class advancement). Honoured across
   * phases; a no-op if the hero is already tier 2 or its class-change quest is not
   * complete. Applied once per drained input (a click evolves exactly once).
   */
  evolveHero?: number;
  /**
   * Accept the class-change quest for the hero at this slot index (M5 task 5).
   * Honoured across phases; a no-op unless the quest is offerable (tier 1, level
   * gate met, none active). Applied once per drained input (a click accepts once).
   */
  acceptQuest?: number;
  /**
   * Allocate `amount` unspent base-stat points into `stat` for the solo hero (M5
   * "Base stats"). Honoured across phases; a no-op if the amount is invalid,
   * exceeds the unspent pool, or breaches the cap. Applied once per drained input
   * (a click allocates exactly once, at any speed — like `evolveHero`).
   */
  allocateStat?: { stat: StatKey; amount: number };
  /**
   * Buy `qty` (default 1) of an NPC-shop consumable (M6 "เมืองหลัก"). ONLY valid
   * while standing in the TOWN zone (the NPC is there — GDD); a no-op elsewhere,
   * when unaffordable, or when the stack is full. Applied once per drained input.
   */
  buyShopItem?: { item: ShopItemId; qty?: number };
  /**
   * Manual quick-use of a potion (`hpPotion` / `manaPotion`) on the solo hero
   * (M6). A no-op for the scroll, a dead hero, an empty stack, on cooldown, or at
   * a full pool. Applied once per drained input (a tap uses exactly one).
   */
  useConsumable?: ShopItemId;
  /**
   * Use a return scroll: teleport to town from anywhere (M6). Consumes one
   * (instant); a no-op if none held or already in town. Applied once per drained
   * input (a tap teleports once).
   */
  useReturnScroll?: boolean;
}

export function step(state: GameState, input: FrameInput = {}): GameState {
  const rng = createRng(state.rngState);

  // Drop last step's events before this step fills them (one-way render/audio
  // buffer). Clear-in-place keeps the array identity stable and allocation-light.
  state.events.length = 0;

  // Tick per-type consumable-use cooldowns (M6) — unconditional so a cooldown
  // counts down in every phase (town / travel / battle).
  tickConsumableCds(state);

  // --- discrete player actions (valid across phases) ---
  if (input.acceptQuest !== undefined) acceptQuest(state, input.acceptQuest);
  if (input.evolveHero !== undefined) evolveHero(state, input.evolveHero);
  // Auto-cast slot assignment (M5 skill framework v2) — solo hero (slot 0).
  if (input.setAutoSlots) {
    for (const a of input.setAutoSlots) setAutoSlot(state, state.heroes[0], a.slot, a.skillId);
  }
  // Manual + auto base-stat allocation (M5 "Base stats"). Runs in all phases so a
  // player can spend points between stages (victory) and auto-allocate keeps up
  // with boss-kill level-ups; before the victory early-return below.
  processStatAllocation(state, input.allocateStat);

  // --- NPC shop / consumables (M6 "เมืองหลัก") ---
  // Buy is town-only (checked inside); the return scroll teleports before the walk
  // intents below so a scroll+walk in the same frame resolves scroll-first.
  if (input.buyShopItem) buyShopItem(state, input.buyShopItem.item, input.buyShopItem.qty ?? 1);
  if (input.useReturnScroll) applyReturnScroll(state);

  // --- world navigation (M6 "World & Town") ---
  if (input.walkToZone) walkToZone(state, input.walkToZone);
  if (input.challengeBoss) enterBossRoom(state);
  if (input.advanceStage) advanceToNextMap(state);

  // While walking between zones the sim only ticks the transit (no combat/waves).
  // On arrival at a BOSS ROOM, start the boss fight (world stays free of a boss
  // import — see systems/world.ts header).
  if (state.traveling) {
    const arrived = updateTransit(state);
    if (arrived?.kind === "boss") startBossFight(state);
    state.time += FIXED_DT;
    state.rngState = rng.state();
    return state;
  }

  // Town is a safe hub: no spawns, no combat. Still tick timers (mana regen /
  // buff decay) so a stop in town isn't a dead zone for the caster resource.
  if (zoneAt(state.location).kind === "town") {
    decayHeroTimers(state);
    state.time += FIXED_DT;
    state.rngState = rng.state();
    return state;
  }

  // Victory pauses the sim (a boss-room win). Navigation above (advanceStage) may
  // already have started a walk out of it.
  if (state.phase === "victory") {
    state.rngState = rng.state();
    return state;
  }

  decayHeroTimers(state);
  // Consumables (M6): a manual quick-use then threshold-gated auto-use, BEFORE
  // skills so a mana potion this step can fund a cast the same step.
  processConsumables(state, input.useConsumable);
  processSkills(state, input); // manual casts + guarded auto-cast
  updateAnchor(state);
  updateWaveSpawns(state, rng);
  updateEnemies(state); // no-op during the boss phase (field is cleared)
  if (state.phase === "boss") updateBoss(state);
  updateHeroes(state);
  updateProjectiles(state);
  resolveDeaths(state); // enemy kills / boss kill / death->town respawn / bossReady
  checkZoneUnlock(state); // farm-zone quota met -> unlock the next zone (M6)

  state.time += FIXED_DT;
  state.rngState = rng.state();
  return state;
}
