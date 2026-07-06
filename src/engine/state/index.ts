/**
 * Game state + save schema.
 *
 * `GameState` is the live, per-step simulation state (entities, timers, RNG
 * cursor). `SaveData` is the persisted subset (progress + economy) written to
 * MySQL. They are intentionally different: transient runtime arrays (heroes,
 * enemies, projectiles) are never saved — they are rebuilt from progress on load.
 *
 * M5 Character Pivot: the persisted model is a SINGLE character (chosen class +
 * level/xp/tier); the purchasable upgrade lines are gone. The live `heroes` array
 * is KEPT (it becomes the M8 party engine) but holds exactly one hero.
 */

import { CONFIG } from "@/engine/config";
import { emptyEquipped, type EquippedGear } from "@/engine/config/items";
import { clamp } from "@/engine/core/math";
import { splitmix32 } from "@/engine/core/hash";
import { makeHero, defaultAutoSlots } from "@/engine/entities";
import type {
  Hero,
  Enemy,
  Boss,
  Projectile,
  HeroClass,
  HeroStats,
  HeroQuest,
  SkillId,
  ShopItemId,
  ConsumableCounts,
  BotSettings,
  WorldLocation,
} from "@/engine/entities";
import { emptyConsumables } from "@/engine/systems/consumables";
import { defaultBotSettings, normalizeBotSettings } from "@/engine/systems/bots";
import { classChangeQuestFor } from "@/engine/systems/quests";
import { baseStats, heroMaxHpOf, heroMaxManaOf } from "@/engine/systems/stats";
import {
  firstFarmLocation,
  farmLocationForStage,
  unlockUpTo,
  zoneAt,
  type TravelState,
} from "@/engine/systems/world";
import type { GameEvent } from "@/engine/state/events";
import { SAVE_VERSION } from "@/engine/state/version";

export * from "@/engine/state/events";

/** High-level flow phase (POC PHASE). Boss/victory transitions land in Phase B. */
export type Phase = "battle" | "boss" | "victory";

/** Live simulation state — rebuilt each session, never persisted wholesale. */
export interface GameState {
  /** Accumulated simulated time in seconds (sum of FIXED_DT steps). */
  time: number;
  stage: number;
  phase: Phase;
  wave: number;
  kills: number;
  gold: number;
  /** The player's chosen base class (M5). Drives which hero is spawned. */
  heroClass: HeroClass;
  autoCast: boolean;
  /**
   * UI-owned toggle (mirrors `autoCast`): when true, each hero's unspent stat
   * points are auto-allocated into its class primary stat every step. Read off
   * the store onto state each frame; never part of `FrameInput`, never persisted.
   */
  autoAllocate: boolean;
  /**
   * UI-owned toggle (M6, mirrors `autoCast`): after a death respawn in town,
   * auto-walk back to the last farmed zone ("auto กลับไปฟาร์ม"). When off the
   * hero waits in town ("รอที่เมือง"). Read off the store onto state each frame;
   * never part of `FrameInput`, never persisted. Defaults ON (and the offline
   * replay forces it on) so idle never stalls.
   */
  autoReturn: boolean;
  /**
   * Current world position (M6 "World & Town"): which map + zone the hero is in.
   * The zone's KIND + content stage are derived from CONFIG.world
   * (systems/world.ts `zoneAt`). `state.stage` mirrors the current zone's stage.
   */
  location: WorldLocation;
  /**
   * Per-map count of unlocked zones (M6): a zone is unlocked iff
   * `zoneIdx < unlockedZones[mapId]`. Persisted (SAVE v8).
   */
  unlockedZones: Record<string, number>;
  /**
   * The last FARM zone occupied (M6) — the death auto-return target. Persisted.
   */
  lastFarmZone: WorldLocation;
  /**
   * In-flight walk between zones (M6), or null. Transient (a fixed-dt timer);
   * NEVER persisted — a reload resumes standing in `location`.
   */
  traveling: TravelState | null;
  /**
   * Idle-automation bot settings (M7.5). Engine-PERSISTED (SAVE v11) — unlike the
   * UI-mirrored autoReturn toggle — so the automation survives a reload. Both bots
   * OFF by default (baseline parity). See systems/bots.ts.
   */
  bot: BotSettings;
  /**
   * Auto-hunt toggle (M6.6): when true (default), the hero AUTO-ACQUIRES new
   * hunt targets (chases + initiates attacks on idle/passive mobs) exactly like
   * before this toggle existed. When false, OUTSIDE the boss phase, the hero may
   * not chase/initiate — but an enemy already ENGAGED on the hero (fighting it)
   * remains a valid retaliation target, so toggling off mid-swarm finishes off
   * current attackers then idles. The boss phase always ignores this flag.
   * Engine-persisted (SAVE v12; unlike the UI-mirrored `autoCast`/`autoAllocate`).
   */
  autoHunt: boolean;
  /**
   * An in-flight idle-bot town trip's purpose (M7.5), or null. Set when a bot trip
   * begins; consumed by `onBotTownArrival` (restock + `townArrived` + auto-return).
   * Transient — NEVER persisted.
   */
  botPending: { restock: boolean; sell: boolean } | null;
  /**
   * A SELL trip's in-town dwell (M7.5 anti-warp-loop fix), or null. While
   * non-null the bot stands in town waiting for the client's async sell to
   * shrink the fed `inventoryCount` below the cap (then returns early) or for
   * the timer to run out (then returns and latches `sellTripWatermark`).
   * `lastCount` tracks the fed count between ticks: any DECREASE = the sell is
   * making progress (a big pre-cap bag sells in several 100-item chunks), so
   * the timer RESETS instead of giving up mid-sweep. Transient — NEVER persisted.
   */
  botDwell: { timer: number; lastCount: number | null } | null;
  /**
   * The fed `inventoryCount` at which the last sell trip GAVE UP (dwell timeout with
   * the bag still full), or null. Suppresses new sell trips until the count drops
   * below it (something actually sold) or the bot settings change — without it a
   * rules-match-nothing auto-sell warp-loops town trips forever. Transient — NEVER
   * persisted (a reload retries once, which is fine).
   */
  sellTripWatermark: number | null;
  /**
   * An in-flight FAST-TRAVEL channel (M7.5), or null. The hero stands still while it
   * counts down; damage cancels it, completion warps to the target's gate-side x.
   * `lastHp` tracks the hero's HP to detect a mid-channel hit. Transient — NEVER
   * persisted (a reload resumes standing in `location`).
   */
  fastTravelCast: {
    targetMapId: string;
    targetZoneIdx: number;
    timer: number;
    lastHp: number;
  } | null;
  /**
   * Held NPC-consumable stack counts (M6 "เมืองหลัก"). Persisted (SAVE v9).
   */
  consumables: ConsumableCounts;
  /**
   * Per-type consumable-use cooldown timers (seconds), keyed by item id. A
   * missing/<=0 entry means ready. Transient runtime state (ticked by
   * systems/consumables `tickConsumableCds`; reset on zone arrival); NEVER
   * persisted — same tier as `Hero.skillCds`.
   */
  consumableCds: Partial<Record<ShopItemId, number>>;
  /**
   * UI-owned auto-use toggles + thresholds (M6, mirror `autoCast`): auto hp/mana
   * potion when the pool drops below the fraction threshold. Read off the store
   * onto state each frame; never part of `FrameInput`, never persisted. Defaults
   * from CONFIG.shop.autoDefaults (auto ON so idle play sustains without setup).
   */
  autoHpPotion: boolean;
  autoManaPotion: boolean;
  /** Auto hp-potion fires below this fraction of MAX HP (0..1). */
  autoHpThreshold: number;
  /** Auto mana-potion fires below this fraction of MAX MANA (0..1). */
  autoManaThreshold: number;
  /**
   * Live heroes. Solo gameplay keeps exactly one here (the chosen class); the
   * array + formation machinery is retained for the M8 party of up to `maxHeroes`.
   */
  heroes: Hero[];
  enemies: Enemy[];
  boss: Boss | null;
  projectiles: Projectile[];
  /** Formation anchor x the team advances toward. */
  anchorX: number;
  /**
   * Legacy wave gap (M6 "สนามล่ามอน" retired the march-model wave scheduler). Kept
   * on the state as an inert field so the boss/flow resets that still touch it
   * compile; the hunting spawn pool uses `spawnCd`/`spawnBurst` instead.
   */
  waveGap: number;
  /**
   * Hunting spawn pool (M6 "สนามล่ามอน"). `spawnCd` counts down to the next
   * respawn; `spawnBurst` (set on a farm-zone arrival) fills the field to
   * `maxAlive` in one step; `spawnPaused` freezes spawns (tests inject their own
   * mobs). All transient — the battlefield is never persisted.
   */
  spawnCd: number;
  spawnBurst: boolean;
  spawnPaused: boolean;
  /** True once the kill goal is met and the boss can be challenged. */
  bossReady: boolean;
  /** RNG stream cursor, persisted so a reload continues deterministically. */
  rngState: number;
  /** Monotonic id source for entities/projectiles. */
  nextId: number;
  /**
   * M7 drop-roll salt: a per-save constant that decorrelates one character's drop
   * stream from another's. Combined with `lootCounter` in a STATELESS hash (core/
   * hash.ts) — NEVER the wave RNG. Persisted (SAVE v10) so rolls are stable across
   * a reload; a fresh (save-less) start seeds it from the init seed.
   */
  lootSalt: number;
  /**
   * M7 drop-roll counter: monotonic, one tick per kill-roll. The value used for a
   * roll is that roll's `rollId` (server claim key `${characterId}:${rollId}`).
   * Persisted (SAVE v10) so an offline replay reproduces the same rolls and a
   * reload never re-rolls a claimed drop (idempotency covers retries).
   */
  lootCounter: number;
  /**
   * Per-step event buffer for render/audio juice. Cleared at the START of each
   * `step()`, filled during the step, drained by the outside layers after it.
   * Deterministic, one-way (engine never reads it), and NEVER persisted.
   */
  events: GameEvent[];
}

/**
 * Persisted save shape. Keep this small and JSON-serialisable — it goes into
 * `save_states.data`. Anything derivable from these fields is NOT stored.
 */
/** The single active character's progression (M5). */
export interface CharacterSave {
  /** Chosen base class. */
  cls: HeroClass;
  level: number;
  xp: number;
  /** Class-advancement tier (1 = base, 2 = evolved). */
  tier: 1 | 2;
  /** Unspent base-stat points (M5 "Base stats", SAVE v5). */
  statPoints: number;
  /** Allocated base-stat block (absolute values, M5 "Base stats", SAVE v5). */
  stats: HeroStats;
  /** Current mana (M5 "mana", SAVE v6). Clamped to the derived pool on load. */
  mana: number;
  /**
   * Auto-cast slot loadout (M5 skill framework v2, SAVE v6): skill id per slot,
   * or null. Learned skills are DERIVED from level/tier (not persisted); only the
   * player's slot assignments are saved.
   */
  autoSlots: (SkillId | null)[];
  /**
   * Active class-change quest (M5 task 5, SAVE v7), or null. Only an ACCEPTED,
   * unfinished quest is meaningful to persist; an un-accepted offer is derived
   * (re-offered on load), and a tier-2 hero has consumed its quest (null).
   */
  quest: HeroQuest | null;
}

export interface SaveData {
  version: number;
  /** Content stage of the current zone (M6: mirrors `zoneAt(location).stage`). */
  stage: number;
  gold: number;
  /** The single active character (M5 — replaces the team's `unlocked`/`heroes`). */
  hero: CharacterSave;
  /** Current world position (M6 "World & Town", SAVE v8). */
  location: WorldLocation;
  /** Per-map unlocked-zone counts (M6, SAVE v8). */
  unlockedZones: Record<string, number>;
  /** Death auto-return target — the last farmed zone (M6, SAVE v8). */
  lastFarmZone: WorldLocation;
  /** Held NPC-consumable stack counts (M6 "เมืองหลัก", SAVE v9). Non-tradable,
   * fungible COUNTS (not M7 item-instances — see entities `ShopItemId`). */
  consumables: ConsumableCounts;
  /** Idle-automation bot settings (M7.5, SAVE v11). Engine-persisted (both bots OFF
   * by default). See entities `BotSettings` + systems/bots.ts. */
  bot: BotSettings;
  /** Auto-hunt toggle (M6.6, SAVE v12). Engine-persisted (default true). See
   * `GameState.autoHunt` for the behaviour contract. */
  autoHunt: boolean;
  /**
   * Equipped gear loadout (M7, SAVE v10): weapon/armor templateId or null. A SIM
   * CACHE — the DB `ItemInstance` ledger is authoritative (docs/persistence-m7.md),
   * so the boot payload's server-resolved loadout WINS on load; this persisted copy
   * lets an offline/pre-boot session still compute geared power.
   */
  equipped: EquippedGear;
  /** M7 drop-roll salt (SAVE v10) — decorrelates the drop stream per character. */
  lootSalt: number;
  /** M7 monotonic drop-roll counter (SAVE v10) — anti-dupe rollId source. */
  lootCounter: number;
  /** Server-set wall-clock of last save, for offline idle. */
  lastSeen: number;
}

/**
 * (Re)build the live hero(es) for the current `heroClass`, PRESERVING per-hero
 * level/xp/tier across a battlefield reset (a stage advance never wipes
 * progression). Solo: rebuilds the single chosen-class hero. The loop is written
 * to scale back up to a party (M8) — a slot keeps whoever occupied it before.
 */
export function initHeroes(state: GameState): void {
  const prev = state.heroes[0];
  state.heroes = [
    makeHero(
      state.nextId++,
      state.heroClass,
      prev?.level ?? 1,
      prev?.xp ?? 0,
      prev?.tier ?? 1,
      prev?.statPoints,
      prev ? { ...prev.stats } : undefined,
      // A battlefield reset (stage advance) refills mana to full; the auto-slot
      // loadout (player config) is preserved across the reset.
      undefined,
      prev ? [...prev.autoSlots] : undefined,
      // Quest progress MUST survive a stage reset — the boss-defeat objective
      // completes as the stage clears, then nextStage rebuilds the hero.
      prev ? cloneQuest(prev.quest) : null,
      // Equipped gear (M7) survives a battlefield reset (stage advance) — makeHero
      // folds its armor HP into the rebuilt hero's max HP.
      prev ? { weapon: prev.equipped.weapon, armor: prev.equipped.armor } : emptyEquipped(),
    ),
  ];
}

/** Deep-copy a hero quest (so a rebuilt hero never shares the progress array). */
function cloneQuest(q: HeroQuest | null): HeroQuest | null {
  return q ? { id: q.id, accepted: q.accepted, progress: [...q.progress] } : null;
}

/**
 * Construct a live `GameState` from a seed and (optionally) a loaded save.
 * A save restores stage / gold / chosen class / character progression; the
 * battlefield always starts fresh at wave 0 of the saved stage.
 */
export function initGameState(seed: number, save?: SaveData): GameState {
  const heroClass: HeroClass = save?.hero.cls ?? "swordsman";

  // World position (M6). A save restores its location; a fresh start begins in the
  // first farm zone (map1, stage 1). `state.stage` is DERIVED from the location's
  // zone, so combat scaling always matches the zone the hero stands in.
  const location: WorldLocation = save?.location ?? firstFarmLocation();
  const stage = zoneAt(location).stage;
  const lastFarmZone: WorldLocation =
    save?.lastFarmZone ??
    (zoneAt(location).kind === "farm" ? location : farmLocationForStage(stage));
  const unlockedZones: Record<string, number> = save?.unlockedZones
    ? { ...save.unlockedZones }
    : unlockUpTo(location);

  const state: GameState = {
    time: 0,
    stage,
    phase: "battle",
    wave: 0,
    kills: 0,
    gold: save?.gold ?? 0,
    heroClass,
    autoCast: false,
    autoAllocate: false,
    // Defaults ON (design: "auto กลับไปฟาร์ม" on by default); GameClient mirrors
    // the store toggle onto this each frame, and the offline replay forces it on.
    autoReturn: true,
    location: { mapId: location.mapId, zoneIdx: location.zoneIdx },
    unlockedZones,
    lastFarmZone: { mapId: lastFarmZone.mapId, zoneIdx: lastFarmZone.zoneIdx },
    traveling: null,
    // Idle bots (M7.5, SAVE v11): restore persisted settings, else defaults (OFF).
    bot: save?.bot ? normalizeBotSettings(save.bot) : defaultBotSettings(),
    // Auto-hunt toggle (M6.6, SAVE v12): restore the persisted flag, else default ON
    // (unchanged behaviour for a fresh/pre-v12 start).
    autoHunt: typeof save?.autoHunt === "boolean" ? save.autoHunt : true,
    botPending: null,
    botDwell: null,
    sellTripWatermark: null,
    fastTravelCast: null,
    // NPC consumables (M6, SAVE v9): restore saved stacks, else empty. Use-cooldowns
    // are transient (rebuilt empty). Auto-use toggles/thresholds seed from config
    // (GameClient mirrors the store's live values onto these each frame).
    consumables: save?.consumables
      ? { ...save.consumables }
      : emptyConsumables(),
    consumableCds: {},
    autoHpPotion: CONFIG.shop.autoDefaults.hpPotion,
    autoManaPotion: CONFIG.shop.autoDefaults.manaPotion,
    autoHpThreshold: CONFIG.shop.autoDefaults.hpThreshold,
    autoManaThreshold: CONFIG.shop.autoDefaults.manaThreshold,
    heroes: [],
    enemies: [],
    boss: null,
    projectiles: [],
    anchorX: CONFIG.baseAnchor,
    waveGap: CONFIG.firstWaveGap,
    // Hunting spawn pool (M6): burst-fill the field on the first battle step of a
    // farm zone (a fresh start / loaded save both begin in one).
    spawnCd: CONFIG.hunt.initialGap,
    spawnBurst: true,
    spawnPaused: false,
    bossReady: false,
    rngState: seed >>> 0,
    nextId: 1,
    // M7 drop rolls (SAVE v10). A loaded save restores its salt + counter so rolls
    // are stable/monotonic across a reload; a fresh start seeds the salt from the
    // init seed (persisted on first save). Defensive `??` covers a save built
    // without the v10 fields (e.g. a raw pre-v10 literal handed to initGameState).
    lootSalt:
      typeof save?.lootSalt === "number" && Number.isFinite(save.lootSalt)
        ? save.lootSalt >>> 0
        : splitmix32(seed >>> 0),
    lootCounter: Math.max(0, Math.floor(save?.lootCounter ?? 0)),
    events: [],
  };
  initHeroes(state);
  // Restore per-character level/xp/tier from the save (M5). `initHeroes` built a
  // level-1 hero; overlay the saved progression and re-derive max HP.
  if (save) {
    const h = state.heroes[0];
    h.level = clamp(save.hero.level, 1, CONFIG.leveling.levelCap);
    h.xp = Math.max(0, save.hero.xp);
    h.tier = save.hero.tier === 2 ? 2 : 1;
    // Restore allocated base stats (M5 "Base stats"). A well-formed v5 save always
    // carries them (migrate backfills older shapes); default defensively to the
    // class base if a field is somehow absent.
    const base = baseStats(h.cls);
    h.stats = {
      str: Math.max(0, save.hero.stats?.str ?? base.str),
      dex: Math.max(0, save.hero.stats?.dex ?? base.dex),
      int: Math.max(0, save.hero.stats?.int ?? base.int),
      vit: Math.max(0, save.hero.stats?.vit ?? base.vit),
    };
    h.statPoints = Math.max(0, save.hero.statPoints ?? 0);
    // Restore equipped gear (M7, SAVE v10) BEFORE deriving max HP so armor HP is
    // folded in. The DB ledger is authoritative (boot payload overrides this cache
    // upstream); a missing/foreign field defaults to an empty loadout.
    h.equipped = {
      weapon: typeof save.equipped?.weapon === "string" ? save.equipped.weapon : null,
      armor: typeof save.equipped?.armor === "string" ? save.equipped.armor : null,
    };
    h.maxHp = heroMaxHpOf(h);
    h.hp = h.maxHp;
    // Restore mana pool + auto-slot loadout (M5 "mana + skill framework v2",
    // SAVE v6). maxMana is derived from int; current mana is clamped into it.
    h.maxMana = heroMaxManaOf(h);
    h.mana = clamp(save.hero.mana ?? h.maxMana, 0, h.maxMana);
    h.autoSlots = normalizeAutoSlots(h.cls, save.hero.autoSlots);
    // Restore the class-change quest (M5 task 5, SAVE v7). A tier-2 hero has no
    // quest; a saved accepted quest is validated against the current class def
    // (unknown/foreign or un-accepted -> re-offer by leaving it null).
    h.quest = normalizeHeroQuest(h.cls, h.tier, save.hero.quest);
  }
  return state;
}

/**
 * Validate a saved class-change quest against the hero's current class def
 * (SAVE v7). A tier-2 hero holds no quest; a foreign/unknown id or an
 * un-accepted offer normalises to null (the UI re-offers a fresh quest); a valid
 * accepted quest keeps its progress (clamped non-negative, per-objective length).
 */
function normalizeHeroQuest(
  cls: HeroClass,
  tier: 1 | 2,
  saved: HeroQuest | null | undefined,
): HeroQuest | null {
  if (tier === 2 || !saved || saved.accepted !== true) return null;
  const def = classChangeQuestFor(cls);
  if (saved.id !== def.id) return null;
  const progress = def.objectives.map((_, i) => {
    const v = Array.isArray(saved.progress) ? saved.progress[i] : undefined;
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  });
  return { id: def.id, accepted: true, progress };
}

/**
 * Coerce a saved auto-slot array to the current `autoSlots.max` length, dropping
 * unknown/foreign skill ids. A missing/short array is backfilled from the class
 * default (signature in slot 0). Defensive — a well-formed v6 save is exact.
 */
function normalizeAutoSlots(
  cls: HeroClass,
  saved: (SkillId | null)[] | undefined,
): (SkillId | null)[] {
  const fallback = defaultAutoSlots(cls);
  if (!Array.isArray(saved)) return fallback;
  const out: (SkillId | null)[] = new Array(CONFIG.autoSlots.max).fill(null);
  for (let i = 0; i < out.length; i++) {
    const id = saved[i];
    out[i] = typeof id === "string" || id === null ? (id ?? null) : fallback[i];
  }
  return out;
}

/**
 * Serialise a live `GameState` down to the persisted `SaveData` subset — the
 * inverse of `initGameState(seed, save)`. Only progress + economy are kept
 * (transient battlefield arrays rebuild on load). `lastSeen` is server-owned
 * (offline-idle anti-cheat), so it is emitted as 0 for the server to overwrite.
 */
export function toSaveData(state: GameState): SaveData {
  const h = state.heroes[0];
  return {
    version: SAVE_VERSION,
    stage: state.stage,
    gold: state.gold,
    // World position (M6, SAVE v8). `traveling` is transient — a reload resumes
    // standing in `location` (mid-walk is not persisted).
    location: { mapId: state.location.mapId, zoneIdx: state.location.zoneIdx },
    unlockedZones: { ...state.unlockedZones },
    lastFarmZone: { mapId: state.lastFarmZone.mapId, zoneIdx: state.lastFarmZone.zoneIdx },
    // NPC consumable stacks (M6, SAVE v9). Use-cooldowns + auto-use toggles are
    // transient/UI-owned — not persisted.
    consumables: { ...state.consumables },
    // Idle bot settings (M7.5, SAVE v11). Engine-persisted (both bots OFF default).
    bot: { ...state.bot },
    // Auto-hunt toggle (M6.6, SAVE v12). Engine-persisted (default true).
    autoHunt: state.autoHunt,
    // Equipped gear cache (M7, SAVE v10). Authoritative copy is the DB item ledger
    // (boot payload wins on load); this persists the loadout for offline power.
    equipped: { weapon: h.equipped.weapon, armor: h.equipped.armor },
    hero: {
      cls: h.cls,
      level: h.level,
      xp: h.xp,
      tier: h.tier,
      statPoints: h.statPoints,
      stats: { ...h.stats },
      // Persist current mana (cheap resource snapshot) + the auto-slot loadout
      // (player config). Learned skills derive from level/tier — not persisted.
      mana: h.mana,
      autoSlots: [...h.autoSlots],
      // Persist the class-change quest (M5 task 5) — only an accepted, unfinished
      // quest is meaningful; null otherwise (offer is re-derived, tier 2 consumed).
      quest: h.quest ? { id: h.quest.id, accepted: h.quest.accepted, progress: [...h.quest.progress] } : null,
    },
    // M7 drop-roll bookkeeping (SAVE v10): monotonic counter + per-save salt.
    lootCounter: state.lootCounter,
    lootSalt: state.lootSalt,
    lastSeen: 0,
  };
}
