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
import type { BotSettings, ShopItemId, StatKey, WorldLocation } from "@/engine/entities";
import type { GearSlot } from "@/engine/config/items";
import { equipItem } from "@/engine/systems/gear";
import { creditGold } from "@/engine/systems/economy";
import { onBotTownArrival, setBotSettings, updateBots } from "@/engine/systems/bots";
import {
  applyReturnScroll,
  buyShopItem,
  processConsumables,
  tickConsumableCds,
} from "@/engine/systems/consumables";
import { updateAnchor } from "@/engine/systems/movement";
import { applyManualCommand } from "@/engine/systems/manual";
import { updateSpawns } from "@/engine/systems/waves";
import { processSkills, setAutoSlot } from "@/engine/systems/skills";
import { startBossFight, updateBoss } from "@/engine/systems/boss";
import { evolveHero } from "@/engine/systems/evolution";
import { acceptQuest } from "@/engine/systems/quests";
import { processStatAllocation } from "@/engine/systems/allocation";
import {
  advanceToNextMap,
  checkZoneUnlock,
  enterBossRoom,
  maybeAutoAdvance,
  startFastTravel,
  tickFastTravel,
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
   * Allocate unspent base-stat points into one or more stats for the solo hero
   * (M5 "Base stats", batch shape since the M7.9 stat-tap-fix). A map of stat ->
   * amount, applied entry-by-entry (fixed str/dex/int/vit order for determinism)
   * through the same guarded `allocateStat()` as before — an invalid amount, an
   * over-spend, or a cap breach on ANY one entry is a no-op for just that entry
   * (the others still apply). This lets several taps queued within one dropped/
   * slow real frame (mobile, dense fields) all land instead of last-wins
   * silently dropping one — see `PendingInput.allocateStat`'s doc in
   * `ui/store/gameStore.ts`. Applied once per drained input, at any speed.
   */
  allocateStat?: Partial<Record<StatKey, number>>;
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
  /**
   * Equip (or, with `templateId: null`, UNEQUIP) a gear slot on the solo hero
   * (M7). Validated for template existence + slot + classReq (a mismatch is a
   * no-op); OWNERSHIP is server-enforced (the engine trusts the id). Honoured
   * across phases; applied once per drained input (a click equips exactly once).
   * `refineLevel` (M7.6 ตีบวก, default 0) is the SERVER-decided refine of the
   * equipped instance — clamped + consumed into stats/power (the engine never
   * rolls it). Re-equipping the same template at a NEW +N re-derives its stats.
   */
  equip?: { slot: GearSlot; templateId: string | null; refineLevel?: number };
  /**
   * Apply a SIGNED delta to the material counter (M7.6 ตีบวก), floored at 0.
   * Materials transactions (salvage grants +, refine spends −) are decided
   * SERVER-side (like `goldCredit`); this reflects a server-confirmed change into
   * the client sim so display/save stay in step. Persisted (SAVE v14). Non-finite
   * values are ignored. Applied once per drained input.
   */
  materialsDelta?: number;
  /**
   * Update the idle-bot settings (M7.5) — merged over the current settings and
   * clamped. Applied once per drained input. The engine persists `state.bot`
   * (SAVE v11), so this is how the UI changes the automation config.
   */
  setBotSettings?: Partial<BotSettings>;
  /**
   * Current INVENTORY item count (M7.5), fed by the client every frame (the engine
   * knows nothing about item instances). The sell-trip bot triggers when this hits
   * `INVENTORY_CAP`. Transient — read this step only, never persisted.
   */
  inventoryCount?: number;
  /**
   * Begin a FAST-TRAVEL channel to any UNLOCKED, non-boss zone (M7.5). Valid only
   * with no engaged/aggro mob on the hero; a short damage-cancellable channel then
   * an instant, FREE hop to the zone's gate-side x. Rejected intents emit
   * `fastTravelBlocked`. Applied once per drained input.
   */
  fastTravel?: WorldLocation;
  /**
   * A SERVER-confirmed, SIGNED gold delta, applied once per drained input:
   * positive from an NPC sale (M7.5, the sell endpoint's `totalGold`), negative
   * from a M7.6 ตีบวก refine attempt's gold cost (the engine never rolls or
   * prices a refine — server-authoritative, `config/refine.ts`'s `refineCost`).
   * Trusted the same way as the rest of the client-simmed economy — the
   * ItemEvent ledger (price/cost recorded server-side at the time) is the audit
   * trail for later server re-derivation, so a spoofed credit is detectable
   * after the fact. Non-finite values are ignored; the result floors at 0.
   */
  goldCredit?: number;
  /**
   * Set the auto-hunt toggle (M6.6): whether the hero auto-acquires NEW hunt
   * targets outside the boss phase (see `GameState.autoHunt`). Applied once per
   * drained input. Engine-persisted (SAVE v12) — unlike the UI-mirrored toggles
   * (`autoCast`/`autoAllocate`/…), the player's choice survives a reload.
   */
  setAutoHunt?: boolean;
  /**
   * Manual play (M7.8): TAP-THE-GROUND move order. The solo hero walks to `x`
   * (clamped to the zone's walkable bounds), IGNORING huntable targets — it does
   * NOT drop aggro (mobs already engaged keep attacking). Arrival (within
   * `CONFIG.manual.arriveEps`) completes the command; auto-hunt (AUTO on) then
   * resumes or the hero idles (AUTO off). Overridden by the boss phase's forced
   * combat. Transient command state — NEVER persisted. Applied once per drained
   * input; a later command this frame replaces it.
   */
  moveTo?: { x: number };
  /**
   * Manual play (M7.8): TAP-A-MONSTER attack order. The solo hero closes to attack
   * range and fights the target `id` until it dies (target gone -> command
   * complete) or the command is cancelled/replaced — overriding the auto/hunt
   * target (engages even with AUTO off). An INVALID / dead / despawned id is
   * ignored gracefully (clears nothing). Overridden by the boss phase's forced
   * combat. Transient — NEVER persisted. Applied once per drained input.
   */
  attackTarget?: { id: number };
  /**
   * Manual play (M7.8): clear any active manual command (move/attack), returning
   * the hero to AUTO (auto-hunt) / idle per the AUTO-hunt toggle. Emits
   * `commandCancelled` only if a command was actually cleared. Applied once per
   * drained input.
   */
  cancelCommand?: boolean;
}

export function step(state: GameState, input: FrameInput = {}): GameState {
  const rng = createRng(state.rngState);

  // Drop last step's events before this step fills them (one-way render/audio
  // buffer). Clear-in-place keeps the array identity stable and allocation-light.
  state.events.length = 0;

  // Reset each hero's transient COMBAT AIM (render-only facing observer). The
  // combat/skill pass re-derives it deterministically this step; clearing it
  // here means town/travel/victory steps (which never reach that pass) leave it
  // `null`, so the renderer falls back to velocity-based facing while merely
  // walking. Pure state derivation — no effect on the sim (byte-identical).
  for (const h of state.heroes) h.aimX = null;

  // Tick per-type consumable-use cooldowns (M6) — unconditional so a cooldown
  // counts down in every phase (town / travel / battle).
  tickConsumableCds(state);

  // --- discrete player actions (valid across phases) ---
  if (input.acceptQuest !== undefined) acceptQuest(state, input.acceptQuest);
  if (input.evolveHero !== undefined) evolveHero(state, input.evolveHero);
  // Idle-bot settings update (M7.5) — merged + clamped onto the persisted state.bot.
  if (input.setBotSettings) setBotSettings(state, input.setBotSettings);
  // Auto-hunt toggle (M6.6) — engine-persisted (SAVE v12); see FrameInput.setAutoHunt.
  if (input.setAutoHunt !== undefined) state.autoHunt = input.setAutoHunt;
  // Equip / unequip gear on the solo hero (M7) — validated inside equipItem.
  // `refineLevel` (M7.6) is the server-decided +N (default 0).
  if (input.equip) {
    equipItem(
      state,
      state.heroes[0],
      input.equip.slot,
      input.equip.templateId,
      input.equip.refineLevel,
    );
  }
  // Material counter delta (M7.6 ตีบวก) — server-confirmed salvage(+)/refine(−).
  if (input.materialsDelta !== undefined && Number.isFinite(input.materialsDelta)) {
    state.materials = Math.max(0, Math.floor(state.materials + input.materialsDelta));
  }
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
  // Server-confirmed gold delta (M7.5 NPC-sale credit, M7.6 ตีบวก refine cost
  // debit — see FrameInput.goldCredit contract). SIGNED since M7.6: a refine
  // attempt's gold cost arrives as a negative delta; floored at 0 so a stale/
  // out-of-order client application can never drive gold negative.
  if (input.goldCredit !== undefined && Number.isFinite(input.goldCredit) && input.goldCredit !== 0) {
    const delta = Math.floor(input.goldCredit);
    // A POSITIVE credit (NPC sale) funnels through creditGold so it also banks the
    // M7.95 lifetime `goldEarned` total; a NEGATIVE delta (refine cost) only debits
    // spendable gold (floored at 0) and must NEVER decrease the earned total.
    if (delta > 0) creditGold(state, delta);
    else state.gold = Math.max(0, state.gold + delta);
  }

  // --- world navigation (M6 "World & Town") ---
  // Fast travel (M7.5): begins a channel here; only completes (in tickFastTravel,
  // after combat) if the hero isn't hit. A bot trip may also START here (updateBots,
  // farm-zone only) and set `traveling` before the walk intents below run.
  if (input.fastTravel) startFastTravel(state, input.fastTravel);
  updateBots(state, input.inventoryCount);
  if (input.walkToZone) walkToZone(state, input.walkToZone);
  if (input.challengeBoss) enterBossRoom(state);
  if (input.advanceStage) advanceToNextMap(state);

  // While walking between zones the sim only ticks the transit (no combat/waves).
  // On arrival at a BOSS ROOM, start the boss fight (world stays free of a boss
  // import — see systems/world.ts header). A bot trip arriving in TOWN restocks +
  // emits townArrived + begins the auto-return (systems/bots), NOT the generic
  // death/scroll auto-return branch.
  if (state.traveling) {
    const arrived = updateTransit(state);
    if (arrived?.kind === "boss") startBossFight(state);
    if (arrived?.kind === "town" && state.botPending) onBotTownArrival(state);
    state.time += FIXED_DT;
    state.rngState = rng.state();
    return state;
  }

  // Town is a safe hub: no spawns, no combat. Still tick timers (mana regen /
  // buff decay) so a stop in town isn't a dead zone for the caster resource —
  // and the FAST-TRAVEL channel must tick here too (2026-07-06 bug: this early
  // return skipped tickFastTravel, so a warp STARTED IN TOWN never completed —
  // portal spinning forever). Town is damage-free, so it only counts down.
  if (zoneAt(state.location).kind === "town") {
    decayHeroTimers(state);
    tickFastTravel(state);
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
  // Manual play (M7.8): apply this frame's moveTo / attackTarget / cancelCommand
  // onto the solo hero's transient command slot (never persisted). updateHeroes
  // honours it below; the boss phase's forced combat overrides it. Runs before
  // skills/movement so a fresh command steers THIS step's hunt.
  applyManualCommand(state, input);
  // Fast-travel channel (M7.5): while channeling the hero stands still — skip its
  // offense (skills + auto-hunt movement/attacks) so it doesn't wander off and
  // re-engage mobs. Enemies + projectiles still resolve, so a mob CAN reach + hit
  // the hero and cancel the warp (checked in tickFastTravel below).
  const channeling = state.fastTravelCast !== null;
  if (!channeling) processSkills(state, input); // manual casts + guarded auto-cast
  updateAnchor(state);
  updateSpawns(state, rng); // maintain the farm zone's mob pool (M6 "สนามล่ามอน")
  updateEnemies(state); // no-op during the boss phase (field is cleared)
  if (state.phase === "boss") updateBoss(state);
  if (!channeling) updateHeroes(state);
  updateProjectiles(state);
  resolveDeaths(state); // enemy kills / boss kill / death->town respawn / bossReady
  checkZoneUnlock(state); // farm-zone quota met -> unlock the next zone (M6)
  maybeAutoAdvance(state); // toggle-gated auto walk into the next unlocked farm zone
  // Fast-travel channel tick (M7.5): after combat so this step's damage cancels it;
  // completion warps to the target zone's gate-side x.
  tickFastTravel(state);

  state.time += FIXED_DT;
  state.rngState = rng.state();
  return state;
}
