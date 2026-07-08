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
import type { BotSettings, HeroClass, HeroConfig, ShopItemId, StatKey, WorldLocation } from "@/engine/entities";
import type { GearSlot } from "@/engine/config/items";
import { equipItem } from "@/engine/systems/gear";
import { applyHeroConfig, syncPrimaryHeroConfig } from "@/engine/systems/heroConfig";
import { setShadowed } from "@/engine/systems/shadow";
import { creditGold } from "@/engine/systems/economy";
import { onBotTownArrival, setBotSettings, updateBots } from "@/engine/systems/bots";
import {
  applyReturnScroll,
  applyWarpScroll,
  buyShopItem,
  processConsumables,
  tickConsumableCds,
} from "@/engine/systems/consumables";
import {
  advanceDailyProgress,
  claimDaily,
  setHeroDailies,
} from "@/engine/systems/dailyQuests";
import { claimMainReward } from "@/engine/systems/mainQuest";
import { updateAnchor } from "@/engine/systems/movement";
import { applyManualCommand, tickTownManualWalk } from "@/engine/systems/manual";
import { updateSpawns } from "@/engine/systems/hunt";
import { processSkills, setAutoSlot } from "@/engine/systems/skills";
import { startBossFight, updateBoss } from "@/engine/systems/boss";
import {
  applyWorldBossSpawnIntents,
  updateWorldBossAI,
  tickWorldBossLifetime,
  sweepWorldBossPresence,
  resolveWorldBossDeath,
} from "@/engine/systems/worldBoss";
import { applyAsuraHotZone, craftLegendary, grantAsuraSigil } from "@/engine/systems/asura";
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
  /**
   * M8 Wave A — install / refresh this hero's DAILY-quest roster (server-chosen, seeded
   * from serverDay + user material). A NEW `serverDay` resets the roster; the same day is
   * an idempotent reconcile (matching quests keep progress). Per-hero (lane i → heroes[i]).
   * The engine never computes calendar time — the server owns the day. Applied once per
   * drained input.
   */
  setDailies?: { serverDay: number; questIds: string[] };
  /**
   * M8 Wave A — claim a COMPLETED daily quest's reward by its catalog id. No-op unless the
   * hero holds that daily, it's met, and it isn't already claimed. Grants gold/stones/
   * potions + emits `questReward`. Server re-validates (day + unique constraint). Per-hero
   * (lane i → heroes[i]). Applied once per drained input.
   */
  claimDaily?: string;
  /**
   * M8 Wave A — claim a COMPLETED main-quest chapter's reward by its chapter id. No-op
   * unless the chapter is derived-complete (its map's boss beaten) and not already in
   * `hero.mainClaimed`. Grants gold/stones/potions + emits `questReward`. Per-hero (lane
   * i → heroes[i]). Applied once per drained input.
   */
  claimMainReward?: string;
  /**
   * M8 Wave A — a SERVER-CONFIRMED refine attempt just completed (the "refine result"
   * signal). Advances the "refineOnce" daily. The engine never rolls/prices a refine
   * (server-authoritative), so this is the only clean signal that a refine happened; the
   * gold + material costs still arrive via `goldCredit` / `materialsDelta`. Lead economy
   * (lane 0). Applied once per drained input.
   */
  refined?: boolean;
  /**
   * M8 "วาปหาเพื่อน" warp scroll (SAVE v17) — consume one held scroll to begin a fast-travel
   * channel to `target`. The engine enforces ZONE LEGALITY only (target must be an already-
   * unlocked, non-boss zone — warp NEVER grants access; the party "is my friend there" check
   * is UI/server's job). Same guards/semantics as `fastTravel` (rejected → `fastTravelBlocked`;
   * NOT damage-cancellable; death cancels). The scroll is spent only when the channel starts.
   * NEVER used by the bot. Lead navigation (lane 0). Applied once per drained input.
   */
  useWarpScroll?: WorldLocation;
  /**
   * M8 party P1b — the REPLICATED per-hero config change. In a cohort every client
   * replays the same `setHeroConfig` intent so each member's automation
   * (`autoCast` / `autoAllocate` / `autoHunt` / auto-potions + thresholds) is part
   * of the deterministic shared state (design §2 — the store-mirror pattern desyncs
   * a shared sim). Merged onto THIS lane's hero via the single `applyHeroConfig`
   * writer. In the SOLO fast path the store-fed globals mirror onto `heroes[0]`
   * instead (`syncPrimaryHeroConfig`), so solo callers never need this. Applied once
   * per drained input.
   */
  setHeroConfig?: Partial<HeroConfig>;
  /**
   * M8 party P2 — the REPLICATED shadow-body toggle for THIS lane's hero ("ร่างเงา",
   * design §9). The ROOM (relay), NOT a player, emits this on the slot's own lane: it
   * synthesizes `{ value: true }` when the owner disconnects past grace (or was offline
   * at cohort formation) and `{ value: false }` on reconnect; every client applies it
   * identically so `Hero.shadowed` is deterministic shared state. Applied FIRST each
   * step (before the lane policy reads the flags) and, uniquely, NOT gated by the
   * shadow policy — otherwise a shadow could never be lifted. Solo-guarded (no-op at one
   * hero). Applied once per drained input.
   */
  setShadowed?: { value: boolean };
  /**
   * WORLD BOSS "เสี่ยจ๋อง" spawn (hourly world boss — engine wave). The CLIENT computes the
   * wall-clock schedule (`worldBossPhaseAt` — the engine never reads a clock) and injects
   * this while the player stands in the chosen zone. The engine spawns the boss iff the
   * current location is `CONFIG.worldBoss.mapId` + the window's chosen farm zone
   * (`worldBossZoneFor`), in the BATTLE phase, and no boss for this `windowId` was already
   * spawned/handled this session (IDEMPOTENT — in a cohort several members may inject it;
   * the ordered lanes make first-wins deterministic). `remainingSeconds` seeds a
   * deterministic lifetime countdown (decremented per FIXED_DT step; reaching 0 despawns
   * it — as does leaving the zone). Applied from every lane in slot order.
   */
  spawnWorldBoss?: { windowId: number; remainingSeconds: number };
  /**
   * ดินแดนอสูร (ASURA) daily HOT-ZONE (endgame v1). The CLIENT computes the Asia/Bangkok day-key
   * off its wall clock (the engine never reads a clock — same split as `spawnWorldBoss`) and
   * injects it here; the engine resolves the day's hot asura zone deterministically
   * (`asuraHotZoneFor`, FNV over the day-key) and stores it, applying a reward multiplier to
   * xp/gold/stone earned IN that zone. STICKY — re-injected on zone beats, not every step. A
   * negative/non-finite `dayKey` clears the hot zone. Lead intent (lane 0); idempotent. Applied
   * once per drained input.
   */
  setAsuraHotZone?: { dayKey: number };
  /**
   * ดินแดนอสูร daily z10 ตราอสูร SIGIL claim (endgame v1.3). Banks `CONFIG.asura.tome.sigilPerClaim`
   * sigils (like `asuraEssence`, a plain count). The SERVER stamps the Bangkok day so it fires ONCE
   * per day (client-authoritative v1 — the engine just holds the count). Lead lane 0. Applied once
   * per drained input.
   */
  claimAsuraSigil?: boolean;
  /**
   * ดินแดนอสูร "ตำราตำนาน" LEGENDARY craft (endgame v1.2/v1.3). The engine VALIDATES + CONSUMES only
   * the counts it owns (tome unlocked + essence/sigils/gold/materials; the 10 ศิลาโซน are a permanent
   * gate) and emits `legendaryCraftRequested { cls, templateId }`; the SERVER then consumes the t10
   * class weapon + MINTS the bind-on-craft legendary (item-instance ledger — the refine/goldCredit
   * split). A blocked craft emits `legendaryCraftBlocked { reason }`. `cls` defaults to the solo
   * hero's class. Lead lane 0. Applied once per drained input.
   */
  craftLegendary?: boolean | { cls?: HeroClass };
}

/**
 * M8 party P1b — the multi-hero input shape. `step()` accepts EITHER a single
 * `FrameInput` (the SOLO / lane-0 fast path — every existing call site stays
 * byte-for-byte unchanged) OR an ARRAY of per-hero lanes, one `FrameInput` per party
 * slot: `lanes[i]` drives `heroes[i]`. This is the on-wire `TurnInput` contract for
 * the P3-P4 lockstep layer — a room collects one lane per player per turn and calls
 * `step(state, lanes)` for each of the turn's 6 sub-steps (an absent/idle lane is
 * `{}`; a short array is padded with idle lanes).
 *
 * Routing (see `step()`):
 *  - PER-HERO intents route to `heroes[i]` from `lanes[i]`: `setAutoSlots` /
 *    `allocateStat` / `moveTo` / `attackTarget` / `cancelCommand` / `useConsumable` /
 *    `equip` / `setHeroConfig` (and `setAutoHunt` for i≥1). Intents that already
 *    embed an explicit hero index (`castSkills[].slot`, `acceptQuest`, `evolveHero`)
 *    are applied from every lane by that embedded index.
 *  - `setShadowed` (M8 P2) is a PER-HERO lane intent too, but ROOM-synthesized (not
 *    player-issued) and applied BEFORE the shadow lane policy — a shadowed lane has all
 *    its OTHER intents dropped, but `setShadowed` still lands so the room can unshadow.
 *  - SHARED-ZONE intents are read from LANE 0 only (the navigation/economy "lead" —
 *    design §3 makes zone travel a cohort-level action): `walkToZone` /
 *    `challengeBoss` / `advanceStage` / `fastTravel` / `buyShopItem` /
 *    `useReturnScroll` / `goldCredit` / `materialsDelta` / `setBotSettings` /
 *    `inventoryCount`, plus lane-0 `setAutoHunt` (persisted global).
 */
export type PartyInput = FrameInput[];

export function step(state: GameState, input: FrameInput | PartyInput = {}): GameState {
  const rng = createRng(state.rngState);

  // M8 party P1b — normalise to per-hero input lanes. A single `FrameInput` is the
  // SOLO / lane-0 fast path (`lanes = [input]`), so every existing call site is
  // byte-identical; an array is the cohort's per-slot lanes (`lanes[i]` → `heroes[i]`).
  const rawLanes: PartyInput = Array.isArray(input) ? input : [input];

  // Drop last step's events before this step fills them (one-way render/audio
  // buffer). Clear-in-place keeps the array identity stable and allocation-light.
  state.events.length = 0;

  // Reset each hero's transient COMBAT AIM (render-only facing observer). The
  // combat/skill pass re-derives it deterministically this step; clearing it
  // here means town/travel/victory steps (which never reach that pass) leave it
  // `null`, so the renderer falls back to velocity-based facing while merely
  // walking. Pure state derivation — no effect on the sim (byte-identical).
  for (const h of state.heroes) h.aimX = null;

  // M8 party P2 — SHADOW-BODY lane policy ("ร่างเงา", design §9). Apply the room-
  // replicated `setShadowed` transitions FIRST (solo-guarded, and NOT itself gated by
  // the policy so a shadow can always be lifted), so the lane policy below reads the
  // up-to-date flags — the `heroShadowed` render event is emitted here.
  for (let i = 0; i < state.heroes.length; i++) {
    const sh = (rawLanes[i] ?? {}).setShadowed;
    if (sh !== undefined) setShadowed(state, i, sh.value);
  }
  // Then NEUTRALIZE each shadowed hero's lane: replace it with an idle `{}` so a stale
  // or haunted client cannot inject manual/lead intents (moveTo / attackTarget / cancel
  // / castSkills / useConsumable / allocateStat / claims / equip / setHeroConfig / …)
  // onto a taken-over body — it plays on purely through the autonomous systems with its
  // FROZEN config. No shadow anywhere (always true for solo) ⇒ `lanes === rawLanes`, so
  // the solo + normal-cohort paths stay byte-identical (no per-lane reallocation).
  const lanes: PartyInput = state.heroes.some((h) => h.shadowed)
    ? rawLanes.map((l, i) => (state.heroes[i]?.shadowed ? {} : l))
    : rawLanes;
  const primary: FrameInput = lanes[0] ?? {};
  /** This step's lane for hero `i` (idle `{}` when the array is short). */
  const laneFor = (i: number): FrameInput => lanes[i] ?? {};

  // M8 party P1b — establish each hero's automation config BEFORE any system reads it
  // (auto-allocate below, then auto-potion/auto-cast/auto-hunt in the battle pass).
  // Cohort lanes' replicated `setHeroConfig` first (canonical shared state), then the
  // SOLO store-mirror (single-hero only, so a cohort is never overwritten by a global).
  for (let i = 0; i < state.heroes.length; i++) {
    const cfg = laneFor(i).setHeroConfig;
    if (cfg) applyHeroConfig(state.heroes[i], cfg);
  }
  syncPrimaryHeroConfig(state);

  // Tick per-type consumable-use cooldowns (M6) — unconditional so a cooldown
  // counts down in every phase (town / travel / battle).
  tickConsumableCds(state);

  // --- discrete player actions (valid across phases) ---
  // Hero-addressed intents (`acceptQuest`/`evolveHero` embed the hero index): apply
  // from EVERY lane by that embedded index — solo (one lane) is the old single call.
  for (const lane of lanes) {
    if (lane.acceptQuest !== undefined) acceptQuest(state, lane.acceptQuest);
    if (lane.evolveHero !== undefined) evolveHero(state, lane.evolveHero);
  }
  // M8 Wave A quest intents — PER-HERO (lane i → heroes[i], like setAutoSlots). setDailies
  // runs first so a fresh roster this frame can start counting; then the two claims.
  for (let i = 0; i < state.heroes.length; i++) {
    const lane = laneFor(i);
    if (lane.setDailies) setHeroDailies(state.heroes[i], lane.setDailies.serverDay, lane.setDailies.questIds);
    if (lane.claimDaily !== undefined) claimDaily(state, i, lane.claimDaily);
    if (lane.claimMainReward !== undefined) claimMainReward(state, i, lane.claimMainReward);
  }
  // M8 Wave A — a server-confirmed refine completed this frame (lead economy, lane 0):
  // advance the "refineOnce" daily (inert until a roster exists).
  if (primary.refined) advanceDailyProgress(state, "refineOnce", 1);
  // Idle-bot settings update (M7.5) — merged + clamped onto the persisted state.bot.
  // Bot is the LEAD/local player's automation (lane 0).
  if (primary.setBotSettings) setBotSettings(state, primary.setBotSettings);
  // Auto-hunt toggle (M6.6): lane 0 sets the persisted global (mirrored onto
  // heroes[0].config above); a cohort member (i≥1) sets its OWN hero's config.
  if (primary.setAutoHunt !== undefined) state.autoHunt = primary.setAutoHunt;
  for (let i = 1; i < state.heroes.length; i++) {
    const v = laneFor(i).setAutoHunt;
    if (v !== undefined) applyHeroConfig(state.heroes[i], { autoHunt: v });
  }
  // ดินแดนอสูร daily HOT ZONE (endgame v1): resolve the day's hot asura zone from the client's
  // day-key (lead lane 0). Applied here (before the early returns) so `state.asuraHotZone` is
  // always current; the reward multiplier is read in `resolveDeaths`. Dormant/idempotent otherwise.
  if (primary.setAsuraHotZone) applyAsuraHotZone(state, primary.setAsuraHotZone.dayKey);
  // ดินแดนอสูร "ตำราตำนาน" (endgame v1.3, lead lane 0): a daily z10 sigil claim (server-day-stamped),
  // then the legendary craft (validates + consumes the engine-owned counts, emits the mint request).
  if (primary.claimAsuraSigil) grantAsuraSigil(state);
  if (primary.craftLegendary) {
    craftLegendary(state, typeof primary.craftLegendary === "object" ? primary.craftLegendary.cls : undefined);
  }
  // Equip / unequip gear (M7) — per hero from its own lane; validated inside equipItem.
  // `refineLevel` (M7.6) is the server-decided +N (default 0).
  for (let i = 0; i < state.heroes.length; i++) {
    const eq = laneFor(i).equip;
    if (eq) equipItem(state, state.heroes[i], eq.slot, eq.templateId, eq.refineLevel);
  }
  // Material counter delta (M7.6 ตีบวก) — server-confirmed salvage(+)/refine(−). Lead
  // player's economy (lane 0; each cohort client owns its own materials → its own save).
  if (primary.materialsDelta !== undefined && Number.isFinite(primary.materialsDelta)) {
    state.materials = Math.max(0, Math.floor(state.materials + primary.materialsDelta));
  }
  // Auto-cast slot assignment (M5 skill framework v2) — per hero from its own lane.
  for (let i = 0; i < state.heroes.length; i++) {
    const sets = laneFor(i).setAutoSlots;
    if (sets) for (const a of sets) setAutoSlot(state, state.heroes[i], a.slot, a.skillId);
  }
  // Manual + auto base-stat allocation (M5 "Base stats"). Runs in all phases so a
  // player can spend points between stages (victory) and auto-allocate keeps up
  // with boss-kill level-ups; before the victory early-return below. Per-hero via lanes.
  processStatAllocation(state, lanes);

  // --- NPC shop / consumables (M6 "เมืองหลัก") --- lead/local economy (lane 0).
  // Buy is town-only (checked inside); the return scroll teleports before the walk
  // intents below so a scroll+walk in the same frame resolves scroll-first.
  if (primary.buyShopItem) buyShopItem(state, primary.buyShopItem.item, primary.buyShopItem.qty ?? 1);
  if (primary.useReturnScroll) applyReturnScroll(state);
  // Server-confirmed gold delta (M7.5 NPC-sale credit, M7.6 ตีบวก refine cost
  // debit — see FrameInput.goldCredit contract). SIGNED since M7.6: a refine
  // attempt's gold cost arrives as a negative delta; floored at 0 so a stale/
  // out-of-order client application can never drive gold negative.
  if (primary.goldCredit !== undefined && Number.isFinite(primary.goldCredit) && primary.goldCredit !== 0) {
    const delta = Math.floor(primary.goldCredit);
    // A POSITIVE credit (NPC sale) funnels through creditGold so it also banks the
    // M7.95 lifetime `goldEarned` total; a NEGATIVE delta (refine cost) only debits
    // spendable gold (floored at 0) and must NEVER decrease the earned total.
    if (delta > 0) creditGold(state, delta);
    else {
      state.gold = Math.max(0, state.gold + delta);
      // M8 Wave A: a NEGATIVE goldCredit is gold SPENT at the NPC (a refine cost) — count
      // it toward the "spendGold" daily (inert until a roster exists). Shop-purchase spends
      // are counted at their own site (buyShopItem).
      advanceDailyProgress(state, "spendGold", -delta);
    }
  }

  // --- world navigation (M6 "World & Town") --- cohort-level (lead, lane 0; design §3).
  // Fast travel (M7.5): begins a channel here; only completes (in tickFastTravel,
  // after combat) if the hero isn't hit. A bot trip may also START here (updateBots,
  // farm-zone only) and set `traveling` before the walk intents below run.
  if (primary.fastTravel) startFastTravel(state, primary.fastTravel);
  // M8 "วาปหาเพื่อน" warp scroll (SAVE v17): consume a scroll + start the same fast-travel
  // channel to an already-unlocked zone (lead navigation, lane 0). NEVER a bot path.
  if (primary.useWarpScroll) applyWarpScroll(state, primary.useWarpScroll);
  updateBots(state, primary.inventoryCount);
  if (primary.walkToZone) walkToZone(state, primary.walkToZone);
  if (primary.challengeBoss) enterBossRoom(state);
  if (primary.advanceStage) advanceToNextMap(state);

  // While walking between zones the sim only ticks the transit (no combat/waves).
  // On arrival at a BOSS ROOM, start the boss fight (world stays free of a boss
  // import — see systems/world.ts header). A bot trip arriving in TOWN restocks +
  // emits townArrived + begins the auto-return (systems/bots), NOT the generic
  // death/scroll auto-return branch.
  if (state.traveling) {
    const arrived = updateTransit(state);
    if (arrived?.kind === "boss") startBossFight(state);
    if (arrived?.kind === "town" && state.botPending) onBotTownArrival(state);
    // WORLD BOSS "เสี่ยจ๋อง": its 15-min lifetime is a wall-clock window, so the despawn clock
    // keeps ticking WHILE the local player travels (combat AI stays paused) — a death/return
    // round-trip must not freeze it alive past its hour. Dormant (no boss) → no-op.
    tickWorldBossLifetime(state);
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
    // Manual play in town (UAT round-3 bug): this early return used to skip the
    // command intents entirely, so tap-to-move AND the phase-3 tap-an-NPC-to-
    // approach were dead in town (the bot could walk — updateBots runs above and
    // drives hero.x directly — but the player couldn't). Apply the intents, then
    // the walk-only slice (no combat in the safe hub); botWalk/channeling keep
    // priority inside tickTownManualWalk.
    applyManualCommand(state, lanes);
    tickTownManualWalk(state);
    tickFastTravel(state);
    // WORLD BOSS "เสี่ยจ๋อง": retire it if we're standing in town (its zone was left). The
    // town branch never takes a battle step, so `updateWorldBossAI`'s zone-leave despawn
    // never fires here — without this a death → auto-return-to-town leaves the boss active
    // and the renderer draws it IN TOWN (owner live bug 1, 2026-07-08). Dormant → no-op.
    sweepWorldBossPresence(state);
    state.time += FIXED_DT;
    state.rngState = rng.state();
    return state;
  }

  // Victory pauses the sim (a boss-room win). Navigation above (advanceStage) may
  // already have started a walk out of it.
  if (state.phase === "victory") {
    // Same bug class as the 2026-07-06 town early-return above: a fast-travel
    // intent is ACCEPTED by the navigation block (channel starts, cast bar shows)
    // but the countdown lives in tickFastTravel BELOW this return — a warp tapped
    // on the victory screen spun forever (owner live report, 2026-07-08). Victory
    // is combat-free so the channel just counts down; arrival (`arriveAtZone`)
    // already resets `phase` to "battle", dismissing the victory pause.
    tickFastTravel(state);
    // WORLD BOSS "เสี่ยจ๋อง": the victory pause is not "battle", so retire a lingering boss
    // here too (same rationale as the town branch — this branch never takes a battle step).
    sweepWorldBossPresence(state);
    state.rngState = rng.state();
    return state;
  }

  decayHeroTimers(state);
  // Consumables (M6): a manual quick-use then threshold-gated auto-use, BEFORE
  // skills so a mana potion this step can fund a cast the same step.
  processConsumables(state, lanes);
  // Manual play (M7.8): apply this frame's moveTo / attackTarget / cancelCommand
  // onto each hero's transient command slot (never persisted). updateHeroes honours
  // it below; the boss phase's forced combat overrides it. Runs before skills/
  // movement so a fresh command steers THIS step's hunt. Per-hero via lanes.
  applyManualCommand(state, lanes);
  // Fast-travel channel (M7.5): while channeling the hero stands still — skip its
  // offense (skills + auto-hunt movement/attacks) so it doesn't wander off and
  // re-engage mobs. Enemies + projectiles still resolve, so a mob CAN reach + hit
  // the hero and cancel the warp (checked in tickFastTravel below).
  const channeling = state.fastTravelCast !== null;
  if (!channeling) processSkills(state, lanes); // manual casts + guarded auto-cast
  updateAnchor(state);
  // WORLD BOSS "เสี่ยจ๋อง": apply this step's spawn intents (all lanes, first-wins) BEFORE
  // combat so a freshly-spawned boss is targetable this same step. Dormant with no intent.
  applyWorldBossSpawnIntents(state, lanes);
  updateSpawns(state, rng); // maintain the farm zone's mob pool (M6 "สนามล่ามอน")
  updateEnemies(state); // no-op during the boss phase (field is cleared)
  if (state.phase === "boss") updateBoss(state);
  updateWorldBossAI(state); // world boss despawn/countdown + movement/mechanics (battle only)
  if (!channeling) updateHeroes(state);
  updateProjectiles(state);
  resolveDeaths(state); // enemy kills / boss kill / death->town respawn / bossReady
  resolveWorldBossDeath(state); // world boss death -> worldBossDefeated (no xp/gold/quota)
  const unlockedNextFarm = checkZoneUnlock(state); // farm-zone quota met -> unlock next (M6)
  maybeAutoAdvance(state, unlockedNextFarm); // frontier-only auto walk into the fresh zone
  // Fast-travel channel tick (M7.5): after combat so this step's damage cancels it;
  // completion warps to the target zone's gate-side x.
  tickFastTravel(state);

  state.time += FIXED_DT;
  state.rngState = rng.state();
  return state;
}
