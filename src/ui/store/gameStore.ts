/**
 * Zustand store — the bridge from engine to React HUD.
 *
 * CRITICAL: never put per-frame simulation state in here. React re-renders on
 * every store change; syncing 60 Hz would tank performance. The engine loop
 * pushes a THROTTLED snapshot (~10 Hz, see CONFIG.uiSyncHz) of only the fields
 * the HUD shows (gold, stage/kills, heroes, boss hint, upgrade levels).
 *
 * This store also holds the PLAYER -> ENGINE direction of the seam:
 *  - `autoCast` / `autoAllocate` / `autoReturn` / `autoHpPotion` / `autoManaPotion`
 *    are plain UI-owned state, not part of `FrameInput` (the engine reads e.g.
 *    `state.autoCast` directly) — the loop reads these fields straight off the
 *    store every frame and applies them; no queueing needed. (The player-facing
 *    1x/2x/3x speed selector was removed in M6.7 — `GameClient`'s loop always
 *    drains exactly 1 fixed sub-step per real frame now; the engine's own
 *    `drainAccumulator(acc, dt, speed)` still accepts a speed multiplier for the
 *    sim/balance harness and tests, it's just never driven above 1 from the UI.)
 *  - Discrete one-shot actions (cast skill, buy upgrade, challenge boss, advance
 *    stage) map 1:1 onto `FrameInput` fields. React must NEVER call into the
 *    engine directly, so these are pushed into `pendingInput` and drained by the
 *    integration loop once per real frame (via `drainPendingInput()`), which
 *    clears the queue and hands the result to `step()`. This guarantees a click
 *    is applied exactly once even when a speed multiplier runs multiple fixed
 *    sub-steps within the same frame.
 */

import { create } from "zustand";
import { CONFIG, defaultBotSettings, townNpcConfig } from "@/engine";
import type {
  BossHint,
  BotSettings,
  ConsumableCounts,
  DailyObjectiveType,
  EquippedGear,
  GearSlot,
  HeroClass,
  HeroStats,
  ItemRarity,
  Phase,
  QuestReward,
  ShopItemId,
  StatKey,
  TownNpcId,
  WorldLocation,
  ZoneKind,
} from "@/engine";
import {
  applyRefineLevelChange,
  mergeClaimedItems,
  removeInstanceId,
  removeSoldItems,
} from "@/ui/gear/inventoryOps";
import type { InventoryItem, ItemInstanceWire, SellItemResultWire } from "@/ui/gear/types";
import { ingestAnnouncements } from "@/ui/announcements/queue";
import type { AnnouncementEntry, AnnouncementWire } from "@/ui/announcements/types";
import {
  capChatMessages,
  nextUnreadCount,
  type ChatMessage,
  type RawChatEntry,
} from "@/ui/chat/chatMessages";
import type { PartyWire } from "@/ui/friends/types";
import { nextSmithTripStep, type SmithTripPhase } from "@/ui/world/smithTrip";
import {
  nextGateTripStep,
  type GateTripPhase,
  type GateTripTarget,
} from "@/ui/world/gateTrip";

/**
 * A single learned skill's HUD state (M5 skill framework v2). Precomputed by the
 * snapshot builder so the store carries only display-ready values (no engine
 * logic runs in React).
 */
export interface SkillSummary {
  /** Engine skill id (key into the `content.skills.<id>` i18n + `SKILL_ICONS`). */
  id: string;
  /** Remaining cooldown, seconds (0 = ready). */
  cd: number;
  /** The skill's full cooldown, seconds (for the CSS sweep duration). */
  maxCd: number;
  /** Mana cost to cast. */
  cost: number;
  /** Off cooldown AND mana-affordable AND the hero is alive (castable now). */
  ready: boolean;
  /** Mana-affordable right now (drives the disabled/greyed cost readout). */
  affordable: boolean;
  /** Which auto-cast slot index this skill occupies, or null (not slotted). */
  autoSlot: number | null;
}

/**
 * Evolution-quest state (M5 task 5, generalized M7.9 to also cover the tier-2
 * -> tier-3 quest) for the SkillBar quest flow. `null` when not applicable
 * (tier 3 — fully evolved, no quest left — or the hero is below its next
 * evolution's level gate with no active quest — the bar shows the final-form
 * badge / locked hint from `tier`/`level` instead). Precomputed by the
 * snapshot builder (engine reads only).
 */
export interface HeroQuestSummary {
  /** The quest is available to accept now (tier < 3, level gate met, not yet taken). */
  offered: boolean;
  /** The quest has been accepted and is tracking objectives. */
  accepted: boolean;
  /** All objectives met — the class change is available (the evolve affordance). */
  complete: boolean;
  /** Enemy-kill objective progress + goal (compact "n/N" readout). */
  kills: number;
  killGoal: number;
  /** Boss-defeat objective satisfied (✓/✗). */
  bossDone: boolean;
  /**
   * Map scope of each objective (owner-approved quest UX upgrade), straight
   * off `QuestObjective.mapId` — `null` means the objective counts ANYWHERE
   * (the tier-1 class-change quest's kill/boss objectives). The tier-3 quest
   * scopes kills to `"map3"` and the boss re-kill to `"map2"`. Drives the
   * full quest card's per-objective location line + the "พาไปเลย" guide
   * button's fast-travel target (`ui/questGuide.ts`). */
  killMapId: string | null;
  bossMapId: string | null;
  /**
   * M7.9b tier-3 quest boss objective: true iff this quest is the tier-3
   * "young Glacial Sovereign" quest, the kill objective is banked, and the
   * boss objective is still pending — straight off the engine's
   * `isTier3BossObjectiveActive(state)` (same one-way "engine computes, store
   * just carries it" pattern as `canEvolve`). Drives the quest card's "⚔
   * ท้าบอส" challenge button (`GoalLadder.tsx`'s `ClassQuestCard`), which
   * queues the same `challengeBoss` intent as the regular boss rung — the
   * engine's `enterBossRoom` picks the quest-boss path over the normal one.
   * Location-independent by design (see the engine doc); the UI button only
   * additionally guards traveling/channeling/dead, same as other one-shot
   * actions.
   */
  bossChallengeActive: boolean;
}

/**
 * M8 quest Wave C — one MAIN-quest chapter's display state, precomputed by
 * the snapshot builder from the engine's `mainQuestChapters(state)` read
 * plus its static `reward` (looked up once from `mainChapterDefs()` by id —
 * same one-way "engine computes/resolves, store just carries it" pattern as
 * `HeroQuestSummary`). Drives both the Quest Board panel's main-line tracker
 * and the goal card's compact "บทที่ N" line.
 */
export interface MainChapterSummary {
  id: string;
  mapId: string;
  complete: boolean;
  claimed: boolean;
  claimable: boolean;
  reward: QuestReward;
}

/**
 * M8 quest Wave C — one DAILY-quest roster slot's display state, precomputed
 * by the snapshot builder: `type`/`target`/`reward` resolved once from the
 * engine's `dailyDef(id)` catalog read, `progress`/`claimed` straight off
 * `hero.dailies.quests`, `complete` derived (`progress >= target`). Drives
 * the Quest Board panel's daily rows.
 */
export interface DailyQuestSummary {
  id: string;
  type: DailyObjectiveType;
  progress: number;
  target: number;
  claimed: boolean;
  complete: boolean;
  reward: QuestReward;
}

/** M8 quest Wave C — today's daily roster (server-day label + up to
 * `CONFIG.dailyQuests.rosterSize` slots), the Quest Board panel's daily
 * section source. */
export interface DailyBoardSummary {
  serverDay: number;
  quests: DailyQuestSummary[];
}

/** Per-hero HUD summary (subset of the engine `Hero` entity). */
export interface HeroSummary {
  cls: HeroClass;
  hp: number;
  maxHp: number;
  /** Current world x position (M7.8 manual play already reads this off the
   * live engine `state` in `GameClient.tsx`'s `hitTestPointer` seam — this is
   * the SAME value at throttled ~10Hz precision, added for `gateTrip.ts`'s
   * arrival check, owner UX round 2026-07-09). Not used for anything
   * frame-precise; a ~40px arrival radius easily absorbs the throttle. */
  x: number;
  /**
   * SIGNATURE skill cooldown remaining, seconds (0 = ready). Kept for the
   * onboarding "you cast a skill" detector (`ui/onboarding`); the full per-skill
   * kit lives in `skills` below.
   */
  skillCd: number;
  /** War Cry ATK buff (`hero.atkBuffMult`/`atkBuffTimer`, engine skill
   * `sword_warcry` — applies to every living hero, not just the caster).
   * `atkBuffTimer` is the raw remaining seconds (0 = no buff active); the
   * HUD chip (`SkillBar.tsx`) interpolates its own smooth countdown between
   * throttled snapshots off this value, same convention as `skillCd`. */
  atkBuffMult: number;
  atkBuffTimer: number;
  /** Current mana + pool (M5 "mana"). Drives the mana bar. */
  mana: number;
  maxMana: number;
  /** The learned skill kit (M5 skill framework v2), ordered signature-first. */
  skills: SkillSummary[];
  /** Auto-cast slot loadout: skill id per slot, or null (empty). */
  autoSlots: (string | null)[];
  /** How many auto-cast slots are unlocked at this hero's level. */
  unlockedSlots: number;
  dead: boolean;
  /** Hero level (M5), 1..`CONFIG.leveling.levelCap`. */
  level: number;
  /** Progress toward the NEXT level, precomputed 0..1 float (never the raw
   * xp/curve numbers — see `GameClient.tsx`'s `buildSnapshot`, which keeps the
   * xp-curve math (`CONFIG.leveling.xpToLevel`) out of the throttled store).
   * `1` once at `levelCap` (nothing left to progress toward). */
  xpProgress: number;
  /** `true` once the hero is at `CONFIG.leveling.levelCap` — the store never
   * ships the cap number itself, just this precomputed flag (same "no raw
   * curve math in the store" rule as `xpProgress`). */
  atLevelCap: boolean;
  /** Class-advancement tier. 1 = base, 2 = evolved, 3 = M7.9 grand-expansion tier 3. */
  tier: 1 | 2 | 3;
  /** Precomputed `canEvolveHero(state, hero)` read (tier < 3, active evolution
   * quest complete) — the store never runs engine logic itself, just carries
   * this one-way display flag (same pattern as `atLevelCap`). */
  canEvolve: boolean;
  /** Evolution quest state (M5 task 5; M7.9 also covers tier 2 -> 3) driving
   * the quest affordance, or null (tier 3 / below the level gate — see
   * `HeroQuestSummary`). */
  quest: HeroQuestSummary | null;
  /** Unspent base-stat points (M5 "Base stats") — drives the stat-panel badge. */
  statPoints: number;
  /** Allocated base-stat block (absolute values), for the +stat readouts. */
  stats: HeroStats;
  /** This hero's class primary (auto-allocate target) — for the panel's hint. */
  primaryStat: StatKey;
  /** Precomputed `combatPower(hero)` read ("พลังต่อสู้") — same one-way display
   * pattern as `canEvolve`: the engine computes it, the store just carries it. */
  combatPower: number;
  /** M7 Gear & Drops: the hero's currently-equipped weapon/armor templateIds,
   * read straight off the engine `Hero.equipped` (the sim's own authoritative
   * loadout — distinct from the DB-hydrated `inventory` slice below, which
   * tracks ownership/equippedSlot for the panel's per-item badges; the two
   * stay in sync because the equip flow writes the DB THEN queues the engine
   * intent, see `GameClient.tsx`). */
  equipped: EquippedGear;
  /** Manual play (M7.8): whether this hero currently has an active move/attack
   * command (`hero.command != null`) — drives the "✕ ยกเลิกคำสั่ง" cancel chip.
   * Read-only display flag, same one-way pattern as `canEvolve`. */
  hasCommand: boolean;
}

/** One adjacent zone's walk-arrow state (M6 "World & Town"). */
export interface NavNeighborSummary {
  mapId: string;
  zoneIdx: number;
  kind: ZoneKind;
  /** Unlocked (walkable) — a locked neighbor shows a lock + reason. */
  unlocked: boolean;
}

/** Current-location + walk-arrow affordances for the HUD (M6). Precomputed by the
 * snapshot builder from the engine's `worldNav` read (no engine logic in React). */
export interface WorldNavSummary {
  mapId: string;
  zoneIdx: number;
  kind: ZoneKind;
  /** Content stage of the current zone (for the "stage N" readout). */
  stage: number;
  /** Walking between zones — arrows disabled, current-zone label reads "traveling". */
  traveling: boolean;
  left: NavNeighborSummary | null;
  right: NavNeighborSummary | null;
}

/** NPC shop + consumable display state (M6 "เมืองหลัก"). Precomputed by the
 * snapshot builder so the store carries only display-ready values. */
export interface ShopSummary {
  /** Held stack counts of each consumable. */
  counts: ConsumableCounts;
  /** Stage-scaled unit price of each item (by the player's farming depth). */
  prices: Record<ShopItemId, number>;
  /** Max held per item (the buy button greys at the cap). */
  stackCap: number;
  /** Quick-use readiness for the two potions (alive, in stock, off cd, not full). */
  ready: { hpPotion: boolean; manaPotion: boolean };
  /** Remaining per-type use cooldown, seconds (0 = off cooldown) — drives the
   * SkillBar-style sweep overlay on the potion buttons. */
  cds: { hpPotion: number; manaPotion: number };
  /** Each potion's full cooldown, seconds (for the CSS sweep duration) —
   * `CONFIG.shop.items.<item>.cooldown`, mirrored here for display only. */
  maxCds: { hpPotion: number; manaPotion: number };
}

/**
 * Town NPCs phase 3 (final; extended M8 quest Wave C): which of the three
 * named town actors currently has its dialog panel open (`ShopPanel` for
 * pahpu / `RefinePanel` for lungdueng / `QuestBoardPanel` for elder), or
 * `null`. Deliberately a single-panel field (only one NPC dialog can be open
 * at once — "one mental model per feature") owned by the store so BOTH the
 * tap-to-talk pointer handler (`GameClient.tsx`, has no React state of its
 * own) and the refine dock shortcut (`RefineButton.tsx`) can open it, and
 * `TownNpcPanelHost.tsx` can auto-close it the instant the live snapshot's
 * `npcInRange` says the hero has walked out of range. */
export type TownPanelId = "pahpu" | "lungdueng" | "board";

/** The throttled snapshot shape pushed by the integration loop. */
export interface EngineSnapshot {
  gold: number;
  stage: number;
  kills: number;
  killGoal: number;
  phase: Phase;
  bossReady: boolean;
  bossHint: BossHint;
  heroes: HeroSummary[];
  /** World position + walk-arrow state (M6 "World & Town"). */
  world: WorldNavSummary;
  /** NPC shop + consumable state (M6 "เมืองหลัก"). */
  shop: ShopSummary;
  /** Idle-bot settings (M7.5, engine-persisted SAVE v11) — read-only display
   * source for `BotSettingsSection.tsx` (it dispatches CHANGES via the
   * `setBotSettings` intent and reads the current values back from here,
   * never shadow-owning the config itself). */
  bot: BotSettings;
  /** Auto-hunt flag (M7.5, engine-persisted SAVE v12) — read-only display
   * source for the HUD AUTO button (changes go via the `setAutoHunt` intent). */
  autoHunt: boolean;
  /** Per-map unlocked-zone counts (M6 SAVE v8 field), surfaced for the M7.5
   * fast-travel picker's lock/unlock read (`isZoneUnlockedUi`). */
  unlockedZones: Record<string, number>;
  /** M7.6 ตีบวก material counter (`state.materials`, SAVE v14) — read straight
   * off the engine, same throttled-display pattern as `gold` (server-owned
   * transactions; the engine just carries the count, see `HudState.materials`'s
   * doc). */
  materials: number;
  /** Town NPCs phase 3 (final): per-NPC "is the solo hero within talk range"
   * read, straight off the engine's pure `npcInRange(state, id)` — see
   * `GameClient.tsx`'s `buildSnapshot`. Drives the tap-to-talk pointer flow's
   * approach-vs-talk branch is decided LIVE off engine state (not this
   * throttled copy), but this is what the HUD (`TownNpcPanelHost.tsx`'s
   * auto-close watch, `RefineButton.tsx`'s dock shortcut) reads every sync. */
  npcInRange: Record<TownNpcId, boolean>;
  /** Tier-3 frontier GATE (owner rule 2026-07-07 "ห้ามข้ามแมพ") — read straight
   * off the engine's pure `tier3FrontierLocked(state)`: the solo hero holds
   * the tier-3 quest but the tundra grant isn't enterable yet (map3's boss
   * room not persist-unlocked). Drives the quest card's locked kill-row copy
   * (`GoalLadder.tsx`'s `ClassQuestCard`) and the guide-me gated branch
   * (`ui/questGuide.ts`). Always `false` outside that one narrow window. */
  tier3FrontierLocked: boolean;
  /** The solo hero's deepest PERSIST-unlocked farm zone — read straight off
   * the engine's pure `deepestUnlockedFarm(state)`, the player's REAL
   * progression frontier. Guide-me routes here while `tier3FrontierLocked`
   * (map4 z1 isn't actually walkable yet), same one-way "engine computes, store
   * just carries it" pattern as `npcInRange`. */
  deepestUnlockedFarm: WorldLocation;
  /** M8 quest Wave C — the solo hero's main-quest chapter chain, precomputed
   * off `mainQuestChapters(state)` + each chapter's static reward. Drives the
   * Quest Board panel's main-line section + the goal card's "บทที่ N" line. */
  mainChapters: MainChapterSummary[];
  /** M8 quest Wave C — the solo hero's today daily-quest roster, precomputed
   * off `hero.dailies` + the `dailyDef` catalog. Drives the Quest Board
   * panel's daily section (the `!` badge on ผู้ใหญ่บ้าน is a render-only read,
   * not this store slice — see `GameRenderer.ts`). */
  dailies: DailyBoardSummary;
  /** ดินแดนอสูร (ASURA) endgame v1 accrual (SAVE v19) — straight throttled reads off
   * `state.asuraEssence` (lifetime แก่นอสูร count) + `state.asuraZoneKills` (per-zone
   * "asura:idx" -> LIFETIME kill count, ศิลาโซน progress toward `CONFIG.asura.zoneStoneGoal`).
   * Accrual-only display in v1 (no craft menu reads these yet) — mysterious tone, never
   * spelled out as a recipe ingredient anywhere in the UI. */
  asuraEssence: number;
  asuraZoneKills: Record<string, number>;
  /** ดินแดนอสูร daily HOT ZONE — the throttled read of `state.asuraHotZone` (the resolved
   * farm-DEPTH index 0..9, or `null` before `GameClient.tsx` has injected today's day-key /
   * off-map). Drives `AsuraHotZoneBanner.tsx`'s chip while standing in asura. */
  asuraHotZoneIdx: number | null;
  /** "ตำราตำนาน" secret-quest tome progress (endgame v1.3) — straight throttled reads off
   * `tomePagesFound(state)` (0..3) + `state.tomeUnlocked` (latches permanently once all 3
   * pages are found). Drives ลุงดึ๋ง's lore-dialog breadcrumb (`RefinePanel.tsx`) and the
   * main-menu tome button's visibility (`AsuraTomeButton.tsx`). */
  tomePagesFound: number;
  tomeUnlocked: boolean;
  /** ตราอสูร sigil count — `state.asuraSigils`, banked by the daily z10 `claimAsuraSigil`
   * intent. Drives the tome checklist's sigil row. */
  asuraSigils: number;
  /** Whether every asura farm zone has reached `CONFIG.asura.zoneStoneGoal` (the PERMANENT
   * "climb every zone once" craft gate) — straight read of `hasAllZoneStones(state)`. */
  hasAllZoneStones: boolean;
  /** Pure craft-affordance read off `canCraftLegendary(state)` — the tome panel's CRAFT
   * button enable/disable (the t10-weapon requirement is a separate, server-side check). */
  canCraftLegendary: boolean;
  /** The first unmet ENGINE-owned craft precondition, or `null` once satisfied — see
   * `craftBlockReason`'s doc. Drives the tome panel's inline block-reason copy. */
  craftBlockReason: "locked" | "essence" | "sigils" | "stones" | "gold" | "materials" | null;
}

/** One-shot player intents, accumulated between drains. Mirrors `FrameInput`. */
export interface PendingInput {
  /** Manual skill casts this frame (M5): hero slot + specific skill id. */
  castSkills: { slot: number; skillId: string }[];
  /** Auto-cast slot assignments this frame (M5), solo hero (slot 0). */
  setAutoSlots: { slot: number; skillId: string | null }[];
  challengeBoss: boolean;
  advanceStage: boolean;
  /** Walk to an adjacent unlocked zone (M6), or `null` (last-wins per frame — a
   * single arrow tap starts exactly one walk). */
  walkToZone: WorldLocation | null;
  /** Hero slot index to evolve (M5), or `null` (last-wins per frame — a big
   * one-way purchase never needs to queue more than one per frame). */
  evolveHero: number | null;
  /** Hero slot index to accept the class-change quest for (M5 task 5), or `null`
   * (last-wins per frame — a single tap accepts once). */
  acceptQuest: number | null;
  /** Base-stat allocation for the solo hero (M5, batch shape since the M7.9
   * stat-tap-fix), or `null`. A per-stat map, ACCUMULATED across same-frame
   * calls (not last-wins) — several taps in one real frame (low-fps mobile,
   * dense fields) all sum onto their own stat instead of the last tap silently
   * dropping an earlier one; taps on DIFFERENT stats in the same frame also all
   * survive (see `allocateStat`'s action doc below). The engine applies each
   * entry through the same guarded `allocateStat()` (cap/over-spend no-op per
   * entry). */
  allocateStat: Partial<Record<StatKey, number>> | null;
  /** Buy an NPC-shop item (M6), or `null` (last-wins per frame). Town-only —
   * the engine no-ops it elsewhere / when unaffordable / at the stack cap. */
  buyShopItem: { item: ShopItemId; qty: number } | null;
  /** Manual quick-use of a potion (M6), or `null` (last-wins per frame). */
  useConsumable: ShopItemId | null;
  /** Use a return scroll to teleport to town (M6, once per frame). */
  useReturnScroll: boolean;
  /** Equip (or, with `templateId: null`, unequip) a gear slot on the solo hero
   * (M7), or `null` (last-wins per frame — a tap equips exactly once). Queued
   * ONLY after the `/api/items/equip`|`/api/items/unequip` POST already
   * succeeded server-side (see `InventoryPanel.tsx`) — this keeps the sim's
   * applied stats and the server's item ledger from ever disagreeing.
   * `refineLevel` (M7.6 ตีบวก, optional — default +0) lets a refine on the
   * CURRENTLY-equipped item re-send the same slot/template at its new +level
   * so the sim's applied stats stay current (see `ui/gear/refineFlow.ts`). */
  equip: { slot: GearSlot; templateId: string | null; refineLevel?: number } | null;
  /** Idle-bot settings patch (M7.5), or `null`. Same-frame calls MERGE (not
   * last-wins) so toggling two fields in one tick never drops one of them —
   * the engine's own `setBotSettings` intent handler already merges onto
   * `state.bot`, so pre-merging here just keeps a multi-field UI form (the
   * settings section) from racing itself within a frame. */
  setBotSettings: Partial<BotSettings> | null;
  /** Fast-travel target (M7.5), or `null` (last-wins per frame — a tap
   * channels to exactly one target; the engine no-ops it if blocked). */
  fastTravel: WorldLocation | null;
  /** Server-confirmed NPC-sale gold to credit (M7.5). SUMMED across same-frame
   * calls (not last-wins) — a bulk sell + an overlapping manual sell in the
   * same tick must never drop one credit. `null`/`0` = nothing pending. */
  goldCredit: number | null;
  /** Auto-hunt toggle (M7.5), or `null` (last-wins per frame). Engine-persisted
   * (SAVE v12) — the HUD button queues this and reads the current value back
   * from the snapshot's `autoHunt`, never shadow-owning it. */
  setAutoHunt: boolean | null;
  /** Signed material-counter delta (M7.6 ตีบวก): หินเสริมพลัง stone claims grant
   * +, refine spends −, decided SERVER-side. SUMMED across same-frame calls
   * (not last-wins) — same pattern as `goldCredit`, since a stone-claim credit
   * and an overlapping single refine in the same tick must never drop one.
   * `null`/`0` = nothing pending. */
  materialsDelta: number | null;
  /** Manual play (M7.8): tap-the-ground move order, or `null` (last-wins per
   * frame — a tap walks to exactly one x; the engine clamps it to the zone's
   * walkable bounds). */
  moveTo: { x: number } | null;
  /** Manual play (M7.8): tap-a-monster attack order, or `null` (last-wins per
   * frame). An invalid/dead/despawned id is a no-op engine-side. */
  attackTarget: { id: number } | null;
  /** Manual play (M7.8): cancel the solo hero's active move/attack command,
   * once per frame. */
  cancelCommand: boolean;
  /** M8 quest Wave C — install/refresh today's daily roster (from a save
   * GET/POST response's `dailies` field), or `null` (last-wins per frame —
   * every response carries the FULL current roster, so a same-frame refeed
   * never needs to merge). Idempotent same-day on the engine side. */
  setDailies: { serverDay: number; questIds: string[] } | null;
  /** M8 quest Wave C — claim a completed daily's reward by catalog id (queued
   * ONLY after the `/api/quest/daily/claim` POST confirms — refine-flow
   * pattern), or `null` (last-wins per frame — a tap claims exactly one). */
  claimDaily: string | null;
  /** M8 quest Wave C — claim a completed main-chapter's reward by chapter id
   * (a PURE engine intent, no server round trip — design doc §5), or `null`
   * (last-wins per frame). */
  claimMainReward: string | null;
  /** M8 "วาปหาเพื่อน" warp scroll — consume one held scroll to fast-travel to
   * `target` (queued from the Friends panel's per-member warp button), or
   * `null` (last-wins per frame; the engine no-ops it if blocked/illegal). */
  useWarpScroll: WorldLocation | null;
  /** World boss "เสี่ยจ๋อง" spawn intent (queued by `GameClient.tsx`'s own schedule
   * check, never a direct player action — last-wins per frame). The engine's own
   * `trySpawnWorldBoss` is idempotent per windowId, so a repeat is a safe no-op.
   * `hp` (SHARED-HP client driver, M8.6): the server-authoritative pool level fetched
   * from `GET /api/worldboss/state` on zone-entry, seeding a fresh spawn/re-entry at the
   * REAL shared value instead of full hp — optional (undefined while the fetch hasn't
   * resolved yet; the engine falls back to full hp, backward-compatible). */
  spawnWorldBoss: { windowId: number; remainingSeconds: number; hp?: number } | null;
  /** World boss "เสี่ยจ๋อง" SHARED-HP sync (M8.6) — queued by `GameClient.tsx`'s own
   * damage-report round trip (`POST /api/worldboss/damage`'s response), never a direct
   * player action (last-wins per frame). The engine's `applyWorldBossSync` only ever
   * clamps hp DOWNWARD and is a no-op for a stale/foreign windowId, so a repeat/late
   * delivery is always safe. */
  syncWorldBoss: { windowId: number; hp: number } | null;
  /** ดินแดนอสูร daily HOT-ZONE day-key (queued by `GameClient.tsx`'s own schedule
   * check while standing in asura — never a direct player action, last-wins per
   * frame). The engine resolves the zone deterministically off this — see
   * `PendingInput.spawnWorldBoss`'s doc for the same idempotent-intent shape. */
  setAsuraHotZone: { dayKey: number } | null;
  /** "ตำราตำนาน" daily ตราอสูร claim (endgame v1.3) — queued ONLY after the server
   * confirms the daily claim (`ui/asura/tomeFlow.ts`), once per frame. The engine's
   * own `grantAsuraSigil` is a plain add (no per-day guard — the SERVER stamps the
   * day so a repeat client call is rejected before this is ever queued). */
  claimAsuraSigil: boolean;
  /** "ตำราตำนาน" legendary craft request — queued ONLY after `POST /api/asura/craft`
   * confirms the t10-weapon consumption + mint (`ui/asura/tomeFlow.ts`). The engine
   * validates + consumes essence/sigils/gold/materials for the solo hero's own class
   * (`craftLegendary(state)` defaults `cls` to `state.heroes[0].cls`). */
  craftLegendary: boolean;
}

function emptyPendingInput(): PendingInput {
  return {
    castSkills: [],
    setAutoSlots: [],
    challengeBoss: false,
    advanceStage: false,
    walkToZone: null,
    evolveHero: null,
    acceptQuest: null,
    allocateStat: null,
    buyShopItem: null,
    useConsumable: null,
    useReturnScroll: false,
    equip: null,
    setBotSettings: null,
    fastTravel: null,
    goldCredit: null,
    setAutoHunt: null,
    materialsDelta: null,
    moveTo: null,
    attackTarget: null,
    cancelCommand: false,
    setDailies: null,
    claimDaily: null,
    claimMainReward: null,
    useWarpScroll: null,
    spawnWorldBoss: null,
    syncWorldBoss: null,
    setAsuraHotZone: null,
    claimAsuraSigil: false,
    craftLegendary: false,
  };
}

/** localStorage key for the sound preference. This is a CLIENT PREFERENCE,
 * not game progress — it intentionally never goes through `SaveData`/the
 * server (see `src/engine/state/version.ts`'s save-versioning rule, which
 * only applies to actual save data).
 *
 * The store field itself always INITIALISES to `false` (sound on), even in
 * the browser — reading `localStorage` synchronously at module-init time
 * would make the server-rendered HTML and the first client render disagree
 * whenever a returning player had muted, causing a React hydration mismatch.
 * `readStoredSoundMuted()` is instead called from a mount-only `useEffect`
 * (see `SoundToggle.tsx`) that applies the persisted value AFTER hydration. */
const SOUND_MUTED_STORAGE_KEY = "ddp-sound-muted";

export function readStoredSoundMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SOUND_MUTED_STORAGE_KEY) === "1";
  } catch {
    return false; // storage blocked (private mode/quota) — default to sound on
  }
}

function writeSoundMuted(muted: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SOUND_MUTED_STORAGE_KEY, muted ? "1" : "0");
  } catch {
    /* storage blocked — the toggle still works for this tab/session */
  }
}

/** localStorage key for the ghost-presence "show other players" preference (ghost-
 *  presence Wave 2). Same UI-owned client-preference tier as `SOUND_MUTED_STORAGE_KEY`
 *  — NOT `SaveData`. Default ON: absence of the key reads as visible. */
const GHOSTS_VISIBLE_STORAGE_KEY = "ddp-ghosts-visible";

export function readStoredGhostsVisible(): boolean {
  if (typeof window === "undefined") return true;
  try {
    // Default ON — only an explicit "0" disables (any other value / unset = visible).
    return window.localStorage.getItem(GHOSTS_VISIBLE_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeGhostsVisible(visible: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GHOSTS_VISIBLE_STORAGE_KEY, visible ? "1" : "0");
  } catch {
    /* storage blocked — the toggle still works for this tab/session */
  }
}

/** localStorage keys for the "โลกมีมิติ" world-depth settings wave (W6, promoted
 *  lab experiment ⑨ — see `docs/`/plan `lab-proud-tiger.md`). Same UI-owned
 *  client-preference tier as `GHOSTS_VISIBLE_STORAGE_KEY` above — NOT `SaveData`,
 *  purely cosmetic/render (never touches the sim). Default ON for all three:
 *  absence of the key reads as enabled, same "only an explicit '0' disables"
 *  convention as ghosts. Three separate keys/fields (not one bundle) because each
 *  drives an independently-toggleable renderer flag via `setWorldFx`. */
const WORLD_DEPTH_STORAGE_KEY = "ddp-world-depth";
const WORLD_CAMERA_STORAGE_KEY = "ddp-world-camera";
const WORLD_ATMOSPHERE_STORAGE_KEY = "ddp-world-atmosphere";

export function readStoredWorldDepthOn(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(WORLD_DEPTH_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeWorldDepthOn(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORLD_DEPTH_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* storage blocked — the toggle still works for this tab/session */
  }
}

export function readStoredWorldCameraOn(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(WORLD_CAMERA_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeWorldCameraOn(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORLD_CAMERA_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* storage blocked — the toggle still works for this tab/session */
  }
}

export function readStoredWorldAtmosphereOn(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(WORLD_ATMOSPHERE_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeWorldAtmosphereOn(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORLD_ATMOSPHERE_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* storage blocked — the toggle still works for this tab/session */
  }
}

/** localStorage key for the FTUE-completed flag. Same client-preference
 * pattern as `SOUND_MUTED_STORAGE_KEY` above: UI-owned, not `SaveData`.
 * M5+: fold into server save (cross-device sync) — until then this is a
 * per-browser flag, same tier as the sound preference.
 *
 * Unlike `soundMuted` (default false is safe pre-hydration either way), the
 * FTUE flag's SAFE default is `true` ("already completed") so a
 * server-rendered page never flashes the onboarding overlay before the real
 * persisted value is read post-hydration (see `readStoredFtueCompleted`). */
const FTUE_STORAGE_KEY = "ddp-ftue-completed";

export function readStoredFtueCompleted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(FTUE_STORAGE_KEY) === "1";
  } catch {
    return true; // storage blocked — never force onboarding on a broken store
  }
}

function writeFtueCompleted(completed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FTUE_STORAGE_KEY, completed ? "1" : "0");
  } catch {
    /* storage blocked — onboarding just won't persist across reloads */
  }
}

/** localStorage key for contextual-tip "seen" ids (M4.8 card A) — same
 * client-preference tier as `FTUE_STORAGE_KEY`: a flat array of tip ids
 * already shown, so each `CONTEXTUAL_TIPS` entry (`src/ui/onboarding/tips.ts`)
 * fires at most once ever, across reloads.
 * // M5+: fold into server save (cross-device sync). */
const TIPS_SEEN_STORAGE_KEY = "ddp-tips-seen";

export function readStoredSeenTips(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TIPS_SEEN_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return []; // storage blocked/corrupt — tips just replay this session
  }
}

/** Appends `id` to `seen` (no-op if already present) and persists the result.
 * Returns the new array so the caller can update its own in-memory copy
 * without a redundant `readStoredSeenTips()` round-trip. */
export function writeSeenTip(id: string, seen: readonly string[]): string[] {
  const next = seen.includes(id) ? seen.slice() : [...seen, id];
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(TIPS_SEEN_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage blocked — this tip just won't persist across reloads */
    }
  }
  return next;
}

/** localStorage key for the "what's new" patch-notes modal's last-
 * acknowledged release id (UAT task) — same client-preference tier as
 * `TIPS_SEEN_STORAGE_KEY` above, but a single scalar (not a set) since only
 * "have you seen at least up to the LATEST release" matters (see
 * `resolvePatchNotesDecision` in `ui/patchNotes.ts`).
 * // M5+: fold into server save (cross-device sync). */
const PATCH_NOTES_SEEN_STORAGE_KEY = "ddp-seen-patch.v1";

export function readStoredSeenPatchNotes(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PATCH_NOTES_SEEN_STORAGE_KEY);
  } catch {
    return null; // storage blocked/corrupt — treat as "never seen" this session
  }
}

export function writeSeenPatchNotes(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PATCH_NOTES_SEEN_STORAGE_KEY, id);
  } catch {
    /* storage blocked — this just won't persist across reloads */
  }
}

/** localStorage-persisted auto-dispose rules (M7.5, extended M7.7 for
 * salvage-by-rarity, extended again M7.9 "option A" for a real epic toggle;
 * salvage RETIRED 2026-07-08 — see `AutoSellAction`'s doc) — same
 * client-preference tier as `soundMuted`/`ftueCompleted`: UI-owned, not
 * `SaveData` (the RULES aren't game progress; the bot's ENGINE-side config,
 * `BotSettings`, is the thing that's actually save-persisted). Owner-locked
 * defaults: common "sell", rare "sell", epic "off" (existing players see NO
 * behavior change — epic used to be hard-locked never-dispose), keep-guard ON
 * for common/rare (epic's own "กันของดี" protection is FORCED ON regardless of
 * this flag, see `ui/gear/autoSell.ts`'s `isGuarded`). SAME storage key as the
 * old v1.1 boolean shape — deliberately NOT bumped, so `readStoredAutoSellRules`
 * migrates old `{sellCommon, sellRare}` booleans → `"sell"/"off"` in place
 * rather than resetting every existing player's preference. */
const AUTO_SELL_STORAGE_KEY = "ddp-auto-sell-rules.v2";

/** Per-rarity disposal action (M7.7 — replaces the old two booleans). Owner
 * request 2026-07-08 (หินเสริมพลัง final wave): salvage is RETIRED — refine
 * stones now drop directly from mobs, so this is a plain off/sell toggle
 * (was a 3-way "off"|"sell"|"salvage" through M7.7-M7.9). A previously-
 * persisted `"salvage"` value (localStorage OR `Character.uiConfig`) simply
 * fails `isAutoSellAction` below and falls back to this rarity's default —
 * NOT migrated to `"sell"`, per owner spec. */
export type AutoSellAction = "off" | "sell";

export interface StoredAutoSellRules {
  common: AutoSellAction;
  rare: AutoSellAction;
  /** M7.9 "option A" — epic's own real toggle, default "off" (keep). */
  epic: AutoSellAction;
  keepBetterStat: boolean;
}

const DEFAULT_AUTO_SELL_RULES: StoredAutoSellRules = {
  common: "sell",
  rare: "sell", // catalog rarity tracks tier: t3-5 = all rare (see ui/gear/autoSell.ts)
  epic: "off", // owner default: keep, no behavior change for existing players
  keepBetterStat: true,
};

function isAutoSellAction(v: unknown): v is AutoSellAction {
  return v === "off" || v === "sell";
}

/** Migrates one rarity field from either shape: v2 action string (preferred),
 * v1.1 boolean (`true` → "sell", `false` → "off"), or missing/corrupt → the
 * default. */
function migrateAction(
  actionField: unknown,
  boolField: unknown,
  fallback: AutoSellAction,
): AutoSellAction {
  if (isAutoSellAction(actionField)) return actionField;
  if (typeof boolField === "boolean") return boolField ? "sell" : "off";
  return fallback;
}

export function readStoredAutoSellRules(): StoredAutoSellRules {
  if (typeof window === "undefined") return DEFAULT_AUTO_SELL_RULES;
  try {
    const raw = window.localStorage.getItem(AUTO_SELL_STORAGE_KEY);
    if (!raw) return DEFAULT_AUTO_SELL_RULES;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_AUTO_SELL_RULES;
    // Loosely typed so both the v1.1 boolean shape and the v2 action shape
    // read from the same key without a cast-away-safety hack.
    const p = parsed as {
      common?: unknown;
      rare?: unknown;
      epic?: unknown;
      sellCommon?: unknown;
      sellRare?: unknown;
      keepBetterStat?: unknown;
    };
    return {
      common: migrateAction(p.common, p.sellCommon, DEFAULT_AUTO_SELL_RULES.common),
      rare: migrateAction(p.rare, p.sellRare, DEFAULT_AUTO_SELL_RULES.rare),
      // No pre-v3 boolean shape existed for epic (it was hard-locked, no field
      // at all) — a missing/corrupt value always falls back to "off".
      epic: migrateAction(p.epic, undefined, DEFAULT_AUTO_SELL_RULES.epic),
      keepBetterStat:
        typeof p.keepBetterStat === "boolean"
          ? p.keepBetterStat
          : DEFAULT_AUTO_SELL_RULES.keepBetterStat,
    };
  } catch {
    return DEFAULT_AUTO_SELL_RULES; // storage blocked/corrupt — safe defaults
  }
}

/** M7.5 auto-equip preference (client-side executor toggle, same tier as the
 * auto-sell rules). Default ON — idle players expect the hero to wear its best
 * gear without babysitting (autoAllocate/auto-potion default ON for the same
 * reason). */
const AUTO_EQUIP_STORAGE_KEY = "ddp-auto-equip";

export function readStoredAutoEquip(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(AUTO_EQUIP_STORAGE_KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

function writeAutoEquip(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTO_EQUIP_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* storage blocked — this session's preference just won't persist */
  }
}

/** One-shot snapshot of the two ENGINE-PERSISTED bot sub-flags
 * (`bot.enabled`/`bot.sellTripEnabled`) captured at the moment the master
 * switch (`toggleBotMaster`) turns OFF, so they can be restored exactly when
 * it turns back ON — see that action's doc for why this can't be a per-frame
 * mirror like `autoCast`/etc (those aren't persisted; these two ARE, via
 * `state.bot`/SAVE v11). Persisted to localStorage (not just in-memory) so a
 * reload while the master is off doesn't lose the "what to restore" memory —
 * same client-preference tier as `soundMuted`. */
const BOT_MASTER_SNAPSHOT_KEY = "ddp-bot-master-snapshot";

interface BotMasterSnapshot {
  enabled: boolean;
  sellTripEnabled: boolean;
}

function readBotMasterSnapshot(): BotMasterSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BOT_MASTER_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as { enabled?: unknown; sellTripEnabled?: unknown };
    if (typeof p.enabled !== "boolean" || typeof p.sellTripEnabled !== "boolean") {
      return null;
    }
    return { enabled: p.enabled, sellTripEnabled: p.sellTripEnabled };
  } catch {
    return null; // storage blocked/corrupt — restore is a no-op, safe default
  }
}

/** `null` clears the snapshot (consumed by a successful restore). */
function writeBotMasterSnapshot(snap: BotMasterSnapshot | null): void {
  if (typeof window === "undefined") return;
  try {
    if (snap) window.localStorage.setItem(BOT_MASTER_SNAPSHOT_KEY, JSON.stringify(snap));
    else window.localStorage.removeItem(BOT_MASTER_SNAPSHOT_KEY);
  } catch {
    /* storage blocked — the snapshot just won't survive a reload */
  }
}

function writeAutoSellRules(rules: StoredAutoSellRules): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTO_SELL_STORAGE_KEY, JSON.stringify(rules));
  } catch {
    /* storage blocked — this session's rules just won't persist across reloads */
  }
}

/**
 * Cross-device UI/automation config (owner request 2026-07-07). The browser-
 * localStorage-owned automation PREFERENCES that used to reset on a phone↔PC
 * switch; now persisted PER CHARACTER server-side (`Character.uiConfig`, see
 * `src/server/uiConfig.ts`) so they FOLLOW THE CHARACTER. This is the exact set
 * of fields synced — deliberately EXCLUDING the engine-persisted config (bot
 * targets / gold reserve, SAVE v11; autoHunt, SAVE v12), whose single source of
 * truth stays the engine save blob.
 *
 * localStorage stays as a WRITE-THROUGH offline fallback (this unified key +
 * the legacy per-feature keys), so nothing regresses if the boot API fails: on
 * boot the client hydrates from localStorage first, then the SERVER value (when
 * present) WINS and is written through so any late mount-effect hydration reads
 * the fresh value.
 */
export interface UiConfig {
  autoCast: boolean;
  autoAllocate: boolean;
  autoReturn: boolean;
  autoAdvance: boolean;
  autoHpPotion: boolean;
  autoManaPotion: boolean;
  autoHpThreshold: number;
  autoManaThreshold: number;
  autoSellCommon: AutoSellAction;
  autoSellRare: AutoSellAction;
  autoSellEpic: AutoSellAction;
  autoSellKeepBetterStat: boolean;
  autoEquip: boolean;
}

const UI_CONFIG_STORAGE_KEY = "ddp-ui-config.v1";

/** Read the write-through localStorage mirror (offline fallback), or null if
 * absent/blocked/corrupt. Loosely narrowed — an unknown key is dropped, a
 * missing/mistyped field is omitted so `hydrateUiConfig`'s merge keeps the
 * current default for it. */
export function readStoredUiConfig(): Partial<UiConfig> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(UI_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    const out: Partial<UiConfig> = {};
    if (typeof p.autoCast === "boolean") out.autoCast = p.autoCast;
    if (typeof p.autoAllocate === "boolean") out.autoAllocate = p.autoAllocate;
    if (typeof p.autoReturn === "boolean") out.autoReturn = p.autoReturn;
    if (typeof p.autoAdvance === "boolean") out.autoAdvance = p.autoAdvance;
    if (typeof p.autoHpPotion === "boolean") out.autoHpPotion = p.autoHpPotion;
    if (typeof p.autoManaPotion === "boolean") out.autoManaPotion = p.autoManaPotion;
    if (typeof p.autoHpThreshold === "number" && Number.isFinite(p.autoHpThreshold))
      out.autoHpThreshold = p.autoHpThreshold;
    if (typeof p.autoManaThreshold === "number" && Number.isFinite(p.autoManaThreshold))
      out.autoManaThreshold = p.autoManaThreshold;
    if (isAutoSellAction(p.autoSellCommon)) out.autoSellCommon = p.autoSellCommon;
    if (isAutoSellAction(p.autoSellRare)) out.autoSellRare = p.autoSellRare;
    if (isAutoSellAction(p.autoSellEpic)) out.autoSellEpic = p.autoSellEpic;
    if (typeof p.autoSellKeepBetterStat === "boolean")
      out.autoSellKeepBetterStat = p.autoSellKeepBetterStat;
    if (typeof p.autoEquip === "boolean") out.autoEquip = p.autoEquip;
    return out;
  } catch {
    return null; // storage blocked/corrupt — server value / defaults still apply
  }
}

export function writeUiConfig(cfg: UiConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(UI_CONFIG_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* storage blocked — the config just won't survive offline across reloads */
  }
}

/** Build the current uiConfig snapshot from the store — the exact object the
 * autosave POST body carries and the write-through mirror stores. */
export function selectUiConfig(s: UiConfig): UiConfig {
  return {
    autoCast: s.autoCast,
    autoAllocate: s.autoAllocate,
    autoReturn: s.autoReturn,
    autoAdvance: s.autoAdvance,
    autoHpPotion: s.autoHpPotion,
    autoManaPotion: s.autoManaPotion,
    autoHpThreshold: s.autoHpThreshold,
    autoManaThreshold: s.autoManaThreshold,
    autoSellCommon: s.autoSellCommon,
    autoSellRare: s.autoSellRare,
    autoSellEpic: s.autoSellEpic,
    autoSellKeepBetterStat: s.autoSellKeepBetterStat,
    autoEquip: s.autoEquip,
  };
}

const emptyBossHint: BossHint = {
  stage: 1,
  bossHp: 0,
  bossAtk: 0,
  recommendedPower: 0,
  teamPower: 0,
  ready: false,
};

const emptyShop: ShopSummary = {
  counts: { hpPotion: 0, manaPotion: 0, returnScroll: 0, warpScroll: 0 },
  prices: {
    hpPotion: CONFIG.shop.items.hpPotion.basePrice,
    manaPotion: CONFIG.shop.items.manaPotion.basePrice,
    returnScroll: CONFIG.shop.items.returnScroll.basePrice,
    warpScroll: CONFIG.shop.items.warpScroll.basePrice,
  },
  stackCap: CONFIG.shop.stackCap,
  ready: { hpPotion: false, manaPotion: false },
  cds: { hpPotion: 0, manaPotion: 0 },
  maxCds: {
    hpPotion: CONFIG.shop.items.hpPotion.cooldown,
    manaPotion: CONFIG.shop.items.manaPotion.cooldown,
  },
};

/** One drop-feed toast entry (M7 juice, `DropFeed.tsx`) — pushed only for a
 * FRESH mint (`status: "minted"` in a claim result), never for an idempotent
 * "existing" reclaim, so a claim-retry never re-toasts the same drop. */
export interface DropFeedEntry {
  id: string;
  templateId: string;
  rarity: ItemRarity;
}

/** Cap on live toasts (oldest drop first out) — a burst of kills shouldn't
 * pile up an unbounded stack. */
const MAX_DROP_FEED = 4;

/** One หินเสริมพลัง (enhancement-stone) drop toast (`DropFeed.tsx`'s
 * `StoneToast`) — pushed straight off the raw `stoneDrop` engine event (NOT
 * gated on the server claim confirming, unlike `DropFeedEntry` above): a
 * stone has no rarity/identity worth waiting on a round-trip for, it's purely
 * "you just picked some up" juice. One entry per event, uncoalesced — capped
 * the same "oldest out first" way as `dropFeed` so a dense field can't pile up
 * an unbounded stack. */
export interface StoneFeedEntry {
  id: string;
  qty: number;
}

const MAX_STONE_FEED = 3;
let stoneFeedSeq = 0;
let dropFeedSeq = 0;

/** A generic one-line notice toast (M7.5) — same tier/shape as `DropFeedEntry`
 * but for plain i18n-keyed messages (fast-travel blocked reasons, auto-sell
 * trip results) rather than an item mint. `messageKey` resolves against the
 * `notices` message namespace; `params` feeds ICU vars. */
export interface NoticeEntry {
  id: string;
  messageKey: string;
  params?: Record<string, string | number>;
}

const MAX_NOTICES = 3;
let noticeSeq = 0;

/** Wave 3 "global chat" — a plain incrementing id for the React key (the relay never
 *  hands us one; `${charId}:${t}` could collide within the same ms). Module-level like
 *  `noticeSeq`/`dropFeedSeq` above. */
let chatMsgSeq = 0;

/** In-flight fast-travel channel UI state (M7.5), or `null`. `key` bumps on
 * every NEW channel start so the CSS progress-bar animation restarts even if
 * the target zone is the same as a previous (blocked/completed) attempt. */
export interface FastTravelChannelState {
  key: number;
  mapId: string;
  zoneIdx: number;
}

/**
 * M8 party P4b — the lockstep cohort HUD chip's state (`ui/party/CohortStatus.tsx`),
 * pushed by `GameClient.tsx`'s `PartySession`/`PartyHandshake` wiring (never per-frame
 * — only on an actual transition, same low-frequency cadence as `fastTravelChannel`).
 * `"solo"` covers BOTH "not in a party" and "in a party but alone in my zone" — the
 * chip renders nothing for it either way (no cohort, no lockstep overhead).
 */
export type CohortStatusState =
  | { kind: "solo" }
  | { kind: "connecting" }
  /** Actively lockstep-ticking with `names` (other cohort members' display names). */
  | { kind: "active"; names: string[] }
  /** A cohort member's turn lane hasn't arrived in ~2s — the sim is paused for them. */
  | { kind: "waiting" }
  | { kind: "reconnecting" };

/**
 * M8 party Wave 3 "signal chip" (docs/ghost-presence-design.md) — the network-quality
 * popover's data, pushed by `GameClient.tsx` at ~1Hz (RTT itself is EMA-smoothed off a
 * ~5s ping/pong cadence, see `app/(game)/cohortNet.ts#emaRtt`). Distinct from
 * `cohortStatus` (which drives whether the chip renders at all / its pulsing state) —
 * this only carries the DETAIL shown in the tap-to-open popover, so it can lag a beat
 * behind a status transition without any visible glitch. */
export interface CohortNetMember {
  /** The member's PARTY TICKET slot (0..5) — never a userId/cuid. */
  slot: number;
  /** Resolved display name, or `null` if not yet known (see `resolveMemberDisplayName`). */
  name: string | null;
  /** `myIssueTurn - theirLastReceivedExecuteTurn` (see `CohortTurnEngine#perSlotLag`) —
   *  the popover multiplies by `TURN_MS` for a "Nms behind" display figure. */
  lagTurns: number;
  shadowed: boolean;
}

export interface CohortNetState {
  /** EMA-smoothed round-trip to the relay over the PARTY socket, or `null` before the
   *  first pong lands. */
  rttMs: number | null;
  /** The ticket slot the chip should visually call out while `cohortStatus.kind ===
   *  "waiting"` (the laggiest member) — `null` outside that state. */
  waitingOnSlot: number | null;
  /** Every OTHER live cohort member (never includes me) — empty while solo. */
  perMember: CohortNetMember[];
}

/**
 * World boss "เสี่ยจ๋อง" (hourly world boss) HUD status — display-ready, pushed by
 * `GameClient.tsx`'s per-frame schedule check (`ui/worldBoss/schedule.ts`'s
 * `deriveWorldBossStatus`/`sameWorldBossStatus`) on TRANSITIONS only, same low-
 * frequency idiom as `cohortStatus`. `"idle"` = nothing to show (the overwhelming
 * common case — the banner renders nothing). `secondsLeft` refreshes at ~1Hz (the
 * ceil-second granularity naturally gates the store push without a separate
 * throttle timer). `"activeHere"` = the boss's chosen farm zone for this window IS
 * my current location ("found it!") — a distinct accent tone from plain `"active"`.
 * `"defeated"` (FIX 2, 2026-07-09 live round) = the SHARED server hp pool for this
 * window is already dead AND I still have an unclaimed reward for it — takes
 * priority over `"active"`/`"activeHere"` (see `deriveWorldBossStatus`'s doc);
 * once claimed (or if I never participated) the window quietly falls back to
 * `"idle"` rather than lingering on a stale countdown.
 */
export type WorldBossStatus =
  | { kind: "idle" }
  | { kind: "pre"; secondsLeft: number }
  | { kind: "active"; secondsLeft: number }
  | { kind: "activeHere"; secondsLeft: number }
  | { kind: "defeated"; secondsLeft: number };

/** M7.9 server-wide high-refine announcement feed — session-memory (in-
 * process, NOT localStorage) dedup set. Module-level like `dropFeedSeq`
 * above (a plain implementation detail of the ingest action, not something
 * that itself needs to trigger a re-render), owned exclusively by
 * `ingestAnnouncementFeed`. */
let seenAnnouncementIds = new Set<string>();
/** Cap on the queued-but-not-yet-shown announcements — a burst of high
 * rolls across the server shouldn't grow this unboundedly (oldest kept,
 * matching the feed's own LIMIT 10). */
const MAX_ANNOUNCEMENT_QUEUE = 10;

export interface HudState {
  // ---- throttled engine snapshot (~CONFIG.uiSyncHz) ----
  gold: number;
  stage: number;
  kills: number;
  killGoal: number;
  phase: Phase;
  bossReady: boolean;
  bossHint: BossHint;
  heroes: HeroSummary[];
  /** World position + walk-arrow state (M6 "World & Town"). */
  world: WorldNavSummary;
  /** NPC shop + consumable state (M6 "เมืองหลัก"). */
  shop: ShopSummary;
  /** Idle-bot settings (M7.5, engine-persisted SAVE v11) — see
   * `EngineSnapshot.bot`'s doc. */
  bot: BotSettings;
  /** Auto-hunt flag (M7.5, SAVE v12) — HUD AUTO button display source. */
  autoHunt: boolean;
  /** Per-map unlocked-zone counts (M6 SAVE v8), for the fast-travel picker. */
  unlockedZones: Record<string, number>;
  /** M7.6 ตีบวก material counter — see `EngineSnapshot.materials`'s doc. */
  materials: number;
  /** Town NPCs phase 3 (final) — see `EngineSnapshot.npcInRange`'s doc. */
  npcInRange: Record<TownNpcId, boolean>;
  /** Tier-3 frontier gate — see `EngineSnapshot.tier3FrontierLocked`'s doc. */
  tier3FrontierLocked: boolean;
  /** The hero's real progression frontier — see `EngineSnapshot.deepestUnlockedFarm`'s doc. */
  deepestUnlockedFarm: WorldLocation;
  /** M8 quest Wave C main-chapter tracker — see `EngineSnapshot.mainChapters`'s doc. */
  mainChapters: MainChapterSummary[];
  /** M8 quest Wave C daily roster — see `EngineSnapshot.dailies`'s doc. */
  dailies: DailyBoardSummary;
  /** ดินแดนอสูร accrual (SAVE v19) — see `EngineSnapshot.asuraEssence`'s doc. */
  asuraEssence: number;
  asuraZoneKills: Record<string, number>;
  /** ดินแดนอสูร daily hot zone — see `EngineSnapshot.asuraHotZoneIdx`'s doc. */
  asuraHotZoneIdx: number | null;
  /** "ตำราตำนาน" tome progress — see `EngineSnapshot.tomePagesFound`'s doc. */
  tomePagesFound: number;
  tomeUnlocked: boolean;
  asuraSigils: number;
  hasAllZoneStones: boolean;
  canCraftLegendary: boolean;
  craftBlockReason: "locked" | "essence" | "sigils" | "stones" | "gold" | "materials" | null;
  /** UI-owned one-shot celebration flag (NOT part of the throttled snapshot — flipped
   * directly off the `tomeAssembled` engine EVENT, same "store action, not a raw `useState`
   * setter in an effect" shape as `patchNotesVisible`). `AsuraTomeAssembledModal.tsx` shows
   * the reveal dialog while true; the acknowledge button clears it. Never persisted (a
   * missed celebration on a fresh tab is a non-issue — the tome button itself stays visible
   * forever once `tomeUnlocked`). */
  tomeAssembledCelebration: boolean;

  // ---- Town NPCs phase 3 (final): tap-again-to-talk panel gating ----
  /** Which NPC's dialog is currently open, or `null` — see `TownPanelId`'s
   * doc. Set by the tap-to-talk pointer flow (`GameClient.tsx`) or the refine
   * dock shortcut (`RefineButton.tsx`); auto-cleared by `TownNpcPanelHost.tsx`
   * the instant the throttled snapshot says the hero left that NPC's range
   * (or left town outright). */
  activeTownPanel: TownPanelId | null;

  /**
   * Owner UX round (2026-07-09) — "ปุ่มตีบวก works from anywhere": the
   * in-flight "smith trip" `RefineButton.tsx` kicks off when pressed away
   * from ลุงดึ๋ง's talk range. `"idle"` = no trip in flight (the common
   * case). `"traveling"` = a fast-travel-to-town channel was queued (button
   * pressed outside town); `"walking"` = standing in town, walking toward
   * his anchor. `SmithTripWatcher.tsx` advances this off the throttled
   * snapshot via `advanceSmithTrip` — see `ui/world/smithTrip.ts`'s pure
   * transition function for the actual logic. Session-only (does NOT need
   * to survive a reload, per the task brief) — never part of `SaveData`. */
  smithTrip: SmithTripPhase;

  /**
   * Owner UX round (2026-07-09) — "เดินไปที่ประตูก่อน แล้วค่อยวาป": an open-gate
   * tap arms this instead of firing `walkToZone` immediately — see
   * `ui/world/gateTrip.ts`'s pure transition function. `"idle"` = no trip in
   * flight; `"walking"` = a `moveTo` toward the gate's own anchor x is in
   * flight, `GateTripWatcher.tsx` advancing it off the throttled snapshot via
   * `advanceGateTrip`. Session-only, never part of `SaveData` (same as
   * `smithTrip`). Mutually exclusive with `smithTrip` (starting one cancels
   * the other — a player can only be walking toward one destination). */
  gateTrip: GateTripPhase;
  /** The armed trip's remembered gate x / destination zone / origin zone /
   * arm timestamp — `null` while `gateTrip === "idle"`. See
   * `GateTripTarget`'s doc. */
  gateTripTarget: GateTripTarget | null;

  // ---- M7 Gear & Drops: DB-hydrated inventory + drop-feed juice ----
  /** The active character's owned item instances (DB-authoritative — see
   * `docs/persistence-m7.md`), seeded from the `/api/save` boot payload's
   * `inventory` field and kept in sync by the claim/equip flows in
   * `GameClient.tsx` / `InventoryPanel.tsx`. NOT part of the throttled engine
   * snapshot (`syncFromEngine` never touches it) — it's its own, much
   * lower-frequency, network-driven slice. */
  inventory: InventoryItem[];
  /** Live drop-notification toasts (M7 juice), oldest-first, capped at
   * `MAX_DROP_FEED`. Pushed only for a freshly-minted claim result. */
  dropFeed: DropFeedEntry[];
  /** Live หินเสริมพลัง stone-drop toasts, oldest-first, capped at
   * `MAX_STONE_FEED` — see `StoneFeedEntry`'s doc. */
  stoneFeed: StoneFeedEntry[];
  /** Template ids owned at BOOT (M7.5 "NEW" badge baseline) — a template not in
   * this set is "new this session" for the WHOLE session (see
   * `ui/gear/inventoryOps.ts`'s `isNewTemplate`). Set once by `GameClient.tsx`
   * after the boot hydration fetch; never mutated afterward. */
  sessionKnownTemplateIds: string[];
  /** Generic one-line notice toasts (M7.5 — fast-travel blocked reasons,
   * auto-sell trip results), oldest-first, capped at `MAX_NOTICES`. */
  notices: NoticeEntry[];
  /** In-flight fast-travel channel (M7.5), or `null` — drives the progress
   * indicator. Set on `fastTravelCastStart`, cleared on `fastTravelArrive` /
   * `fastTravelBlocked` (see `GameClient.tsx`'s frame-event handling). */
  fastTravelChannel: FastTravelChannelState | null;

  // ---- M8 party P4b — lockstep cohort (relay-driven, not the throttled engine
  // snapshot) ----
  /** My party membership (from the ONE friends poll, `useFriendsPoll.ts` pushes this
   * via `setParty` — same "push into the store, GameClient subscribes" idiom as
   * `updateReloadRequested`). `null` = not in a party (or a guest — a guest's poll
   * never reaches the branch that calls `setParty`). `GameClient.tsx`'s `PartySession`
   * is fully dormant (zero ticket fetch) whenever this is `null`. */
  party: PartyWire | null;
  /** The lockstep cohort HUD chip's state — see `CohortStatusState`'s doc. */
  cohortStatus: CohortStatusState;
  /** Wave 3 signal-chip popover detail — see `CohortNetState`'s doc. */
  cohortNet: CohortNetState;
  /** World boss "เสี่ยจ๋อง" countdown-banner state — see `WorldBossStatus`'s doc. */
  worldBossStatus: WorldBossStatus;

  // ---- Wave 3 "global chat" (docs/ghost-presence-design.md) — carried over the
  // SEPARATE world socket (`presence/worldSession.ts`), never the party/lockstep one.
  // Pure parse/prune/unread math lives in `ui/chat/chatMessages.ts`; this store only
  // holds the resulting state + the fire-once send intent. ----
  /** Newest-last, capped to `CHAT_MAX_MESSAGES` — the panel prunes to the 30-min window
   *  at RENDER time (`pruneToWindow`), so the store itself never needs a background
   *  timer. Works for guests too (server allows guest chat, no moderation v1). */
  chatMessages: ChatMessage[];
  /** Unread count while the panel is closed (`nextUnreadCount`) — cleared to 0 on open. */
  chatUnread: number;
  /** Chat panel open/closed — ALSO gates whether `GameClient.tsx` keeps the world socket
   *  open for chat alone when `ghostsVisible` is off (see `syncWorldSessionActive`). */
  chatOpen: boolean;

  // ---- HOF seasonal rewards (owner-approved docs/hof-rewards-design.md) ----
  /** MY OWN chosen title (already localized, via `ui/hof/titles.ts`) + champion
   *  aura flag while SOLO — `GameClient.tsx` refreshes this off `GET
   *  /api/hof/rewards` on every town arrival and feeds it into the
   *  `renderer.setHeroSocialBadges` seam for hero id `state.heroes[0].id`. In a
   *  cohort, per-member badges instead come straight off the friends-poll
   *  `party` rows (already carry `title`/`champion`) — this field is unused
   *  there. `null` before the first fetch resolves. */
  mySocialBadge: { title: string | null; champion: boolean } | null;

  // ---- M7.9 server-wide high-refine announcement feed (no websockets — the
  // feed is polled off the existing autosave/boot response, see
  // `GameClient.tsx`) ----
  /** This client's OWN active characterId (from the boot/`activeCharacterId`
   * field), or `null` pre-boot. Used ONLY to self-exclude a landing from the
   * banner queue (the refiner already gets the local refine-juice
   * celebration) — never a trust boundary, purely a display filter. */
  myCharacterId: string | null;
  /** Queued-but-not-yet-shown announcements, oldest-first — `AnnouncementBanner.tsx`
   * always displays `announcementQueue[0]` and shifts it off after its
   * display timer. Capped at `MAX_ANNOUNCEMENT_QUEUE`. */
  announcementQueue: AnnouncementEntry[];

  // ---- mid-session "new patch deployed" banner (owner-approved feature) —
  // see `ui/updateBanner.ts` for the pure decision logic + `UpdateBanner.tsx`
  // for the presentation. Transport is the existing autosave/boot save-route
  // responses (no extra requests, no websockets — see `@/server/buildId`). ----
  /** The server's build id, as read off the latest `/api/save` response
   * (GET at boot, POST on the autosave cadence), or `null` before the first
   * one has landed. Compared against this client's own inlined
   * `CLIENT_BUILD_ID` by `resolveUpdateBannerDecision`. */
  serverBuildId: string | null;
  /** Dismiss bookkeeping for the update banner — `null`/`null` if never
   * dismissed. Scoped to the SPECIFIC mismatched server build id so a NEWER
   * deploy landing during the cooldown always shows immediately (see
   * `resolveUpdateBannerDecision`'s doc). */
  updateBannerDismissedAt: number | null;
  updateBannerDismissedForId: string | null;
  /** One-shot intent (same "the UI dispatches, `GameClient`'s loop drains it"
   * shape as `pendingInput`, generalized to this app-level browser action):
   * flipped by the update banner's button tap; `GameClient.tsx` subscribes to
   * this transition to flush a final save (via the SAME sendBeacon path used
   * on tab-hide) and THEN `location.reload()` — never reload without the
   * flush. Never reset back to `false` (the page reloads immediately after). */
  updateReloadRequested: boolean;

  // ---- M7.5→M7.7 auto-dispose rules (localStorage-persisted UI preference,
  // same tier as `soundMuted` — see `readStoredAutoSellRules`'s doc comment) ----
  autoSellCommon: AutoSellAction;
  autoSellRare: AutoSellAction;
  /** M7.9 "option A" — epic's own real toggle (default "off" = keep). */
  autoSellEpic: AutoSellAction;
  autoSellKeepBetterStat: boolean;
  /** M7.5 auto-equip executor toggle (localStorage-persisted, default ON). */
  autoEquip: boolean;

  // ---- plain UI-owned state the integration loop reads directly every frame ----
  autoCast: boolean;
  /** Auto-allocate base-stat points into the class primary stat (M5 "Base
   * stats"). UI-owned like `autoCast`: the loop copies it onto `state.autoAllocate`
   * every frame; not part of `FrameInput`, never persisted. */
  autoAllocate: boolean;
  /** Auto-walk back to the last farmed zone after a death respawn ("auto กลับไป
   * ฟาร์ม", M6). UI-owned like `autoCast`: the loop copies it onto
   * `state.autoReturn` every frame; not part of `FrameInput`, never persisted.
   * Defaults ON (design). */
  autoReturn: boolean;
  /** Auto next-zone toggle (2026-07-07, mirrors autoReturn): quota met ->
   * auto-walk into the next unlocked FARM zone (never a boss room). */
  autoAdvance: boolean;
  /** Auto-use hp/mana potions below a threshold (M6). UI-owned like `autoCast`:
   * the loop copies these onto `state.autoHpPotion`/`state.autoManaPotion` +
   * thresholds every frame; not part of `FrameInput`, never persisted. Default ON
   * (idle sustain works without setup). Thresholds are fractions of the max pool. */
  autoHpPotion: boolean;
  autoManaPotion: boolean;
  autoHpThreshold: number;
  autoManaThreshold: number;
  /** M7.9 stat-tap-fix: base-stat points optimistically already queued
   * (`allocateStat` calls not yet reflected by a throttled snapshot), keyed by
   * stat. The panel renders `statPoints - sum(this)` and `stats[stat] +
   * this[stat]` so a tap shows an instant result instead of waiting up to
   * ~100ms for the next `CONFIG.uiSyncHz` sync (see `StatPanel.tsx`). Cleared
   * wholesale on every `syncFromEngine` call — safe because the integration
   * loop always drains + steps pending input in the SAME real frame, well
   * before that frame's (possible) sync, so by the time any snapshot lands the
   * engine has already applied every tap queued up to that point; nothing
   * queued after a sync is touched until the NEXT sync clears it. */
  optimisticStatSpend: Partial<Record<StatKey, number>>;
  /** Client-side sound preference (persisted to localStorage, NOT SaveData —
   * see `SOUND_MUTED_STORAGE_KEY`'s comment). The integration loop reads this
   * every frame and applies it to the `AudioController`, same pattern as
   * `autoCast`/`autoAllocate`. */
  soundMuted: boolean;
  /** Ghost-presence "show other players in the world" preference (Wave 2), persisted to
   * localStorage (NOT SaveData — see `GHOSTS_VISIBLE_STORAGE_KEY`). Default ON. The
   * integration loop reads it to drive the world socket + ghost layer; toggling OFF
   * disconnects the socket and clears ghosts. Purely cosmetic/render — never touches the
   * sim (the One Rule, docs/ghost-presence-design.md §2). */
  ghostsVisible: boolean;

  // ---- "โลกมีมิติ" world-depth settings wave (W6, promoted lab experiment ⑨) —
  // persisted to localStorage (NOT SaveData, see `WORLD_DEPTH_STORAGE_KEY` etc.),
  // same tier/pattern as `ghostsVisible` above. Default ON for all three.
  // `GameClient.tsx`'s loop reads these and calls `renderer.setWorldFx({depth:
  // worldDepthOn, terrain: worldDepthOn, camera: worldCameraOn, atmosphere:
  // worldAtmosphereOn})` — purely cosmetic/render, never touches the sim. ----
  /** Depth band (mobs/heroes/ghosts scale+layer by distance) + the polygon
   *  terrain ground layer — ONE switch for both (they read as a single visual
   *  concept to a player, "one mental model per feature"). */
  worldDepthOn: boolean;
  /** Living follow-zoom camera (1.06 in combat, eases to 1.0 idle). */
  worldCameraOn: boolean;
  /** Day/night tint + weather + critters. */
  worldAtmosphereOn: boolean;

  // ---- onboarding/FTUE (M4.8) — see src/ui/onboarding/steps.ts for the
  // data-driven step registry and pure trigger/advance logic; this store
  // only holds the session/persisted PROGRESS through that registry. ----
  /** `true` once the throttled snapshot has synced at least once — the
   * fresh-save heuristic (`isFreshSave` in `onboarding/steps.ts`) is only
   * meaningful AFTER the real engine/save state has arrived (the store's
   * hardcoded initial values would otherwise look "fresh" even for a
   * returning player for one instant). */
  hasSyncedOnce: boolean;
  /** Persisted flag (localStorage, mirrors `soundMuted`'s pattern —
   * M5+: fold into server save). Defaults `true` pre-hydration so SSR never
   * flashes the overlay; corrected post-mount via `setFtueCompleted`. */
  ftueCompleted: boolean;
  /** `-1` = onboarding not running (either finished/skipped, or not yet
   * gated-in); `0..N-1` = index into `ONBOARDING_STEPS` currently shown. */
  onboardingStepIndex: number;

  /** "What's new" patch-notes modal (UAT task) — same store-owned pattern as
   * `onboardingStepIndex` (a plain store action flips this, never a raw
   * component `useState` setter called from inside an effect — keeps
   * `usePatchNotes.ts`'s gate-in effect clean of the
   * `react-hooks/set-state-in-effect` lint rule). See `ui/patchNotes.ts` for
   * the pure decision logic that decides when to flip it. */
  patchNotesVisible: boolean;

  // ---- intent queue: drained by the integration loop into FrameInput ----
  pendingInput: PendingInput;

  /** Bulk-apply a throttled snapshot from the engine. */
  syncFromEngine: (snapshot: EngineSnapshot) => void;

  toggleAutoCast: () => void;
  toggleAutoAllocate: () => void;
  /** Toggle death auto-return (M6 "auto กลับไปฟาร์ม" / "รอที่เมือง"). */
  toggleAutoReturn: () => void;
  toggleAutoAdvance: () => void;
  /** Toggle auto hp/mana potion use (M6). */
  toggleAutoHpPotion: () => void;
  toggleAutoManaPotion: () => void;
  /** Set an auto-use threshold (fraction of the max pool, clamped 0.05..0.95). */
  setAutoHpThreshold: (frac: number) => void;
  setAutoManaThreshold: (frac: number) => void;
  toggleSound: () => void;
  /** Mount-effect-only: apply the persisted preference once, post-hydration
   * (see `soundMuted`'s doc comment). Does NOT re-persist (avoids a
   * redundant localStorage write on every mount). */
  setSoundMuted: (muted: boolean) => void;
  /** Toggle the ghost-presence layer (persists). */
  toggleGhostsVisible: () => void;
  /** Mount-effect-only: apply the persisted ghost preference post-hydration (mirrors
   * `setSoundMuted`; does NOT re-persist). */
  setGhostsVisible: (visible: boolean) => void;

  /** Toggle the "โลกมีมิติ" depth-band + terrain layer (persists). */
  toggleWorldDepthOn: () => void;
  /** Mount-effect-only: apply the persisted preference once, post-hydration
   *  (mirrors `setGhostsVisible`; does NOT re-persist). */
  setWorldDepthOn: (on: boolean) => void;
  /** Toggle the "โลกมีมิติ" living camera (persists). */
  toggleWorldCameraOn: () => void;
  setWorldCameraOn: (on: boolean) => void;
  /** Toggle the "โลกมีมิติ" day/night + weather atmosphere (persists). */
  toggleWorldAtmosphereOn: () => void;
  setWorldAtmosphereOn: (on: boolean) => void;

  /** Onboarding-controller-only: begin the FTUE at step 0. Callers must have
   * already checked `!ftueCompleted && hasSyncedOnce && isFreshSave(...)`. */
  startOnboarding: () => void;
  /** Jump to a specific step index (used by the pure resolver's result). */
  setOnboardingStepIndex: (index: number) => void;
  /** Finish (naturally or via skip-all) — persists so it never shows again. */
  completeOnboarding: () => void;
  /** Mount-effect-only sync of the persisted flag (see `ftueCompleted` doc). */
  setFtueCompleted: (completed: boolean) => void;
  /** Codex-only ("ดูบทช่วยสอนอีกครั้ง"): un-persists completion and jumps
   * straight to step 0 — unlike `startOnboarding`, this bypasses
   * `useOnboardingController`'s one-shot gate (which only fires once per
   * mount) since the overlay renders directly off `onboardingStepIndex`. */
  resetOnboarding: () => void;

  /** `usePatchNotes.ts`-only: show the modal (gate already resolved to "show"). */
  showPatchNotes: () => void;
  /** Acknowledge button: hides the modal (persistence is the caller's job via
   * `writeSeenPatchNotes`, same "the hook owns localStorage, the store just
   * carries the visible flag" split as `ftueCompleted`/`setFtueCompleted`). */
  dismissPatchNotes: () => void;

  /** Fired off the `tomeAssembled` engine event: opens the celebratory reveal modal. */
  showTomeAssembledCelebration: () => void;
  /** Acknowledge button on the reveal modal. */
  dismissTomeAssembledCelebration: () => void;

  /** Queue a manual cast of `skillId` for the solo hero (deduped by skill id;
   * consumed on next drain — a click casts exactly once at any speed). */
  castSkill: (skillId: string) => void;
  /** Queue an auto-cast slot assignment for the solo hero (last-wins per slot). */
  setAutoSlot: (slot: number, skillId: string | null) => void;
  challengeBoss: () => void;
  advanceStage: () => void;
  /** Queue a walk to an adjacent unlocked zone (M6, last-wins per frame) — the
   * engine no-ops it if the target isn't adjacent + unlocked or the hero is busy. */
  walkToZone: (target: WorldLocation) => void;
  /** Queue an evolve attempt for hero slot `i` (last-wins per frame, same as
   * `buyUpgrade`) — the engine no-ops it if requirements aren't met. */
  evolveHero: (slot: number) => void;
  /** Queue accepting the class-change quest for hero slot `i` (last-wins per
   * frame) — the engine no-ops it unless the quest is offerable. */
  acceptQuest: (slot: number) => void;
  /** Queue a base-stat allocation for the solo hero (M7.9 stat-tap-fix:
   * ACCUMULATES onto the pending batch — same-stat taps sum, different-stat
   * taps all survive within one real frame) — the engine no-ops an invalid/
   * over-cap/over-spend amount per-entry. Also bumps `optimisticStatSpend` so
   * the panel can render the spend instantly, before the next throttled
   * snapshot confirms it (see that field's doc). */
  allocateStat: (stat: StatKey, amount: number) => void;
  /** Queue an NPC-shop buy (M6, town-only, last-wins per frame). */
  buyShopItem: (item: ShopItemId, qty: number) => void;
  /** Queue a potion quick-use (M6, last-wins per frame). */
  useConsumable: (item: ShopItemId) => void;
  /** Queue a return-scroll teleport (M6, once per frame). */
  useReturnScroll: () => void;
  /** Queue an equip/unequip intent for the solo hero (M7, once per frame) —
   * call ONLY after the corresponding `/api/items/*` POST already succeeded
   * (see `InventoryPanel.tsx`'s equip flow doc). `refineLevel` (M7.6, optional)
   * re-derives stats for the SAME slot/template at a new +level. */
  queueEquip: (slot: GearSlot, templateId: string | null, refineLevel?: number) => void;
  /** Queue an idle-bot settings patch (M7.5, merges across same-frame calls —
   * see `PendingInput.setBotSettings`'s doc). */
  setBotSettings: (patch: Partial<BotSettings>) => void;
  /** Queue the auto-hunt toggle intent (M7.5; last-wins per frame). */
  queueSetAutoHunt: (on: boolean) => void;
  /** Bot MASTER switch (owner UX consolidation, 2026-07-07) — ONE toggle that
   * gates every automation sub-behavior at once. Deliberately reuses `autoHunt`
   * as the switch's own on/off value (no new persisted field: `autoHunt` IS
   * "is the bot on") — `GameClient.tsx` gates every OTHER transient auto-*
   * flag (autoCast/autoAllocate/autoReturn/autoAdvance/auto-potion) against
   * this same field every frame, which is safe because those aren't
   * persisted (turning the master back on just resumes reading whatever the
   * player already had those sub-toggles set to).
   *
   * The two ENGINE-PERSISTED bot sub-flags (`bot.enabled`/`bot.sellTripEnabled`,
   * SAVE v11) can't use that per-frame trick (they'd permanently overwrite the
   * player's real preference the instant the master goes off — there's no
   * second copy of "what the player actually wants" once the mirrored field
   * itself is zeroed every frame). So this action instead: on OFF, snapshots
   * their CURRENT values (`writeBotMasterSnapshot`) then queues a real
   * `setBotSettings` patch forcing them both false (a genuine committed
   * change, exactly like a manual toggle click); on ON, reads the snapshot
   * back and queues it as the restore patch. Also queues the matching
   * `setAutoHunt`. This guarantees "OFF = zero automation" covers bot town
   * trips too, while "ON = each sub-behavior runs per its own setting"
   * restores exactly what the player had. */
  toggleBotMaster: () => void;
  /** Queue a fast-travel channel start (M7.5, last-wins per frame) — the
   * engine no-ops/rejects (`fastTravelBlocked`) an invalid/locked/aggro'd
   * attempt. */
  queueFastTravel: (target: WorldLocation) => void;
  /** Queue a server-confirmed gold credit from an NPC sale (M7.5, SUMS across
   * same-frame calls — see `PendingInput.goldCredit`'s doc). Also used by
   * `ui/gear/refineFlow.ts` for a refine's (negative) gold cost. */
  creditGold: (amount: number) => void;
  /** Queue a signed material-counter delta (M7.6 ตีบวก, SUMS across same-frame
   * calls — see `PendingInput.materialsDelta`'s doc). */
  creditMaterials: (amount: number) => void;
  /** Queue a manual play (M7.8) tap-the-ground move order (last-wins per
   * frame) — see `PendingInput.moveTo`'s doc. */
  queueMoveTo: (x: number) => void;
  /** Queue a manual play (M7.8) tap-a-monster attack order (last-wins per
   * frame) — see `PendingInput.attackTarget`'s doc. */
  queueAttackTarget: (id: number) => void;
  /** Queue a manual play (M7.8) cancel of the active move/attack command. */
  queueCancelCommand: () => void;

  // ---- Owner UX round (2026-07-09): ปุ่มตีบวก works from anywhere ----
  /** `RefineButton.tsx`-only: start (or instantly resolve) a "smith trip" —
   * see `smithTrip`'s doc for the full decision. Reads `world`/`npcInRange`
   * synchronously off the current store state at press-time. */
  startSmithTrip: () => void;
  /** Cancel any in-flight trip, silently (no notice) — called on death or a
   * conflicting manual move/attack (see `queueMoveTo`/`queueAttackTarget`).
   * A no-op while already `"idle"`. */
  cancelSmithTrip: () => void;
  /** `SmithTripWatcher.tsx`-only: advance an in-flight trip by one throttled-
   * snapshot tick — a thin store-side wrapper around the pure
   * `ui/world/smithTrip.ts#nextSmithTripStep`, applying whichever effect it
   * returns (queue the walk-to-smith `moveTo`, or open the panel + end the
   * trip). A no-op while `"idle"`. */
  advanceSmithTrip: () => void;

  // ---- Owner UX round (2026-07-09): เดินไปที่ประตูก่อน แล้วค่อยวาป ----
  /** `GameClient.tsx`'s `onGateTap`-only: arm a gate trip on an OPEN gate tap
   * — queues the SAME manual `moveTo` intent a ground tap uses (targeting
   * `gateX`), and arms `gateTrip`. Cancels any in-flight `smithTrip` (mutual
   * exclusion — see `gateTrip`'s doc). */
  startGateTrip: (gateX: number, destination: WorldLocation) => void;
  /** Cancel any in-flight gate trip, silently (no notice/toast) — called on a
   * conflicting manual move/attack/talk, a fast-travel/warp start, or death.
   * A no-op while already `"idle"`. */
  cancelGateTrip: () => void;
  /** `GateTripWatcher.tsx`-only: advance an in-flight gate trip by one
   * throttled-snapshot tick — a thin store-side wrapper around the pure
   * `ui/world/gateTrip.ts#nextGateTripStep`, firing the ORIGINAL `walkToZone`
   * intent on arrival. A no-op while `"idle"`. */
  advanceGateTrip: () => void;

  // ---- M8 quest Wave C ----
  /** Install/refresh today's daily roster (from a save GET/POST response's
   * `dailies` field) — see `PendingInput.setDailies`'s doc. Safe to call on
   * every response (idempotent same-day reconcile, engine-side). */
  queueSetDailies: (serverDay: number, questIds: string[]) => void;
  /** Claim a completed daily's reward by catalog id — queued ONLY after the
   * server confirms (`ui/quest/dailyClaimFlow.ts`), see
   * `PendingInput.claimDaily`'s doc. */
  queueClaimDaily: (questId: string) => void;
  /** Claim a completed main-chapter's reward by chapter id — a pure engine
   * intent, no server round trip (see `PendingInput.claimMainReward`'s doc). */
  queueClaimMainReward: (chapterId: string) => void;
  /** Consume a warp scroll to fast-travel to `target` (the Friends panel's
   * per-member "🌀 วาปไปหา" button) — see `PendingInput.useWarpScroll`'s doc. */
  queueWarpScroll: (target: WorldLocation) => void;

  // ---- "ตำราตำนาน" secret tome + legendary craft (endgame v1.2/v1.3) ----
  /** Bank the daily z10 ตราอสูร sigil — queued ONLY after `POST /api/asura/sigil`
   * confirms (`ui/asura/tomeFlow.ts`), see `PendingInput.claimAsuraSigil`'s doc. */
  queueClaimAsuraSigil: () => void;
  /** Request the tome craft (the recipe's own class weapon) — queued ONLY after
   * `POST /api/asura/craft` confirms (`ui/asura/tomeFlow.ts`), see
   * `PendingInput.craftLegendary`'s doc. */
  queueCraftLegendary: () => void;

  // ---- Town NPCs phase 3 (final): tap-again-to-talk panel gating ----
  /** Open `panel`'s dialog (last-wins — talking to the other NPC or the dock
   * shortcut always wins over whatever was open). */
  openTownPanel: (panel: TownPanelId) => void;
  /** Close whichever NPC dialog is open (✕ button, or `TownNpcPanelHost.tsx`'s
   * auto-close-on-walk-away watch). No-op if already `null`. */
  closeTownPanel: () => void;

  // ---- M7 Gear & Drops: inventory slice + drop-feed juice (network-driven,
  // NOT part of the throttled engine snapshot — see `inventory`/`dropFeed` docs
  // above) ----
  /** Bulk-replace the inventory slice (boot hydration + the equip-failure
   * resync in `InventoryPanel.tsx`). */
  setInventory: (items: InventoryItem[]) => void;
  /** Merge newly-claimed wire items into the slice without dropping any local
   * row not present in `items` (the claim-flush path only ever ADDS — see
   * `gear/inventoryOps.ts`'s `mergeClaimedItems`). */
  mergeInventory: (claimed: ItemInstanceWire[]) => void;
  /** Push a drop-feed toast (M7 juice) — capped, oldest evicted first. */
  pushDropFeed: (templateId: string, rarity: ItemRarity) => void;
  /** Dismiss one toast (called by `DropFeed.tsx` after its display timer). */
  dismissDropFeed: (id: string) => void;
  /** Push a หินเสริมพลัง stone-drop toast (`StoneFeedEntry`'s doc) — capped,
   * oldest evicted first. */
  pushStoneFeed: (qty: number) => void;
  /** Dismiss one stone toast (called by `DropFeed.tsx` after its display timer). */
  dismissStoneFeed: (id: string) => void;
  /** Boot-only (M7.5 "NEW" badge baseline): set once from the boot payload's
   * inventory templateIds — see `sessionKnownTemplateIds`'s doc. */
  setSessionKnownTemplateIds: (ids: string[]) => void;
  /** Remove sold instances from the inventory slice (M7.5, manual + auto-sell
   * flows — see `gear/inventoryOps.ts`'s `removeSoldItems`). */
  removeSoldFromInventory: (results: SellItemResultWire[]) => void;
  /** Patch one instance's refine +level after a non-destroying refine outcome
   * (M7.6 ตีบวก — see `gear/inventoryOps.ts`'s `applyRefineLevelChange`). */
  setInventoryRefineLevel: (instanceId: string, refineLevel: number) => void;
  /** Remove one instance destroyed by a refine "break" outcome (M7.6 ตีบวก). */
  removeInventoryInstance: (instanceId: string) => void;

  // ---- M7.5: generic notice toasts + fast-travel channel UI state ----
  /** Push a one-line notice toast (M7.5) — capped, oldest evicted first. */
  pushNotice: (messageKey: string, params?: Record<string, string | number>) => void;
  /** Dismiss one notice toast (called by `NoticeToast.tsx` after its display timer). */
  dismissNotice: (id: string) => void;
  /** Start (or restart) the fast-travel channel progress UI (M7.5). */
  startFastTravelChannel: (mapId: string, zoneIdx: number) => void;
  /** Clear the fast-travel channel progress UI (arrival or block/cancel). */
  clearFastTravelChannel: () => void;

  // ---- M8 party P4b ----
  /** `useFriendsPoll.ts`-only: push the latest `party` field from the ONE friends
   * poll — see `party`'s doc. */
  setParty: (party: PartyWire | null) => void;
  /** `GameClient.tsx`-only: reflect the cohort session's current state into the HUD
   * chip — see `cohortStatus`'s doc. */
  setCohortStatus: (status: CohortStatusState) => void;
  /** `GameClient.tsx`-only: ~1Hz push of the signal-chip popover detail — see
   * `cohortNet`'s doc. */
  setCohortNet: (net: CohortNetState) => void;
  /** `GameClient.tsx`-only: see `mySocialBadge`'s doc. */
  setMySocialBadge: (badge: { title: string | null; champion: boolean } | null) => void;

  // ---- Wave 3 "global chat" ----
  /** `GameClient.tsx`-only: a `c-history` frame just landed — replaces `chatMessages`
   * wholesale (never bumps `chatUnread`; a history dump on (re)join isn't a "new"
   * message). */
  ingestChatHistory: (entries: RawChatEntry[]) => void;
  /** `GameClient.tsx`-only: one live `c` frame — appends + bumps `chatUnread` per
   * `nextUnreadCount`. */
  ingestChatMessage: (entry: RawChatEntry) => void;
  /** `ChatButton.tsx`-only: open/close the panel — opening clears `chatUnread`. */
  setChatOpen: (open: boolean) => void;

  // ---- World boss "เสี่ยจ๋อง" ----
  /** `GameClient.tsx`-only: push the countdown-banner state on a TRANSITION (see
   * `worldBossStatus`'s doc — never called per-frame unchanged). */
  setWorldBossStatus: (status: WorldBossStatus) => void;
  /** `GameClient.tsx`-only: queue the spawn intent while standing in the window's
   * boss zone during the "active" phase (last-wins per frame) — see
   * `PendingInput.spawnWorldBoss`'s doc. `hp` (M8.6) is the server-fetched shared pool
   * level, once resolved. */
  queueSpawnWorldBoss: (windowId: number, remainingSeconds: number, hp?: number) => void;
  /** `GameClient.tsx`-only: queue the shared-HP sync intent from a damage-report
   * round trip's response (last-wins per frame) — see `PendingInput.syncWorldBoss`'s doc. */
  queueSyncWorldBoss: (windowId: number, hp: number) => void;

  // ---- ดินแดนอสูร (ASURA) endgame v1 ----
  /** `GameClient.tsx`-only: queue today's Bangkok day-key while standing in
   * asura (last-wins per frame, re-queued only on change) — see
   * `PendingInput.setAsuraHotZone`'s doc. */
  queueSetAsuraHotZone: (dayKey: number) => void;

  // ---- M7.9 server-wide high-refine announcement feed ----
  /** Boot-only: record this client's own characterId (see `myCharacterId`'s doc). */
  setMyCharacterId: (characterId: string | null) => void;
  /** Ingest one poll of the `/api/save` (GET or POST) `announcements` field —
   * pure filtering/dedup lives in `ui/announcements/queue.ts`'s
   * `ingestAnnouncements`; this action just applies the result. */
  ingestAnnouncementFeed: (wire: AnnouncementWire[]) => void;
  /** `AnnouncementBanner.tsx`-only: pop the currently-shown entry after its
   * display timer, advancing to the next queued one (if any). */
  shiftAnnouncementQueue: () => void;

  // ---- mid-session "new patch deployed" banner ----
  /** `GameClient.tsx`-only: record the build id off a fresh `/api/save`
   * response (GET or POST). */
  setServerBuildId: (id: string | null) => void;
  /** `UpdateBanner.tsx`-only: dismiss the banner for the CURRENT mismatched
   * server build id (see `updateBannerDismissedForId`'s doc). */
  dismissUpdateBanner: (forId: string) => void;
  /** `UpdateBanner.tsx`-only: request the flush-then-reload (see
   * `updateReloadRequested`'s doc). */
  requestReload: () => void;

  // ---- M7.5→M7.7 auto-dispose rules (localStorage-persisted) ----
  setAutoSellCommon: (action: AutoSellAction) => void;
  setAutoSellRare: (action: AutoSellAction) => void;
  setAutoSellEpic: (action: AutoSellAction) => void;
  toggleAutoSellKeepBetterStat: () => void;
  /** Mount-effect-only: apply the persisted rules once, post-hydration (same
   * "don't re-persist on mount" rule as `setSoundMuted`). */
  hydrateAutoSellRules: (rules: StoredAutoSellRules) => void;
  toggleAutoEquip: () => void;
  /** Mount-effect-only: apply the persisted auto-equip preference once. */
  hydrateAutoEquip: (on: boolean) => void;

  /** Apply a cross-device uiConfig blob (owner request 2026-07-07) — used for
   * BOTH the localStorage fallback and the server (server WINS, applied last on
   * boot). Only DEFINED fields are applied (a partial keeps the current default
   * for a missing field); the merged full config is written THROUGH to
   * localStorage (unified + legacy auto-sell/auto-equip keys) so any later
   * mount-effect hydration reads the fresh value rather than clobbering it.
   * See `UiConfig`'s doc + `GameClient.tsx`'s boot/autosave wiring. */
  hydrateUiConfig: (cfg: Partial<UiConfig>) => void;

  /** Integration-loop-only: pop + clear the pending intents for this frame. */
  drainPendingInput: () => PendingInput;
}

export const useGameStore = create<HudState>((set, get) => ({
  gold: 0,
  stage: 1,
  kills: 0,
  killGoal: 0,
  phase: "battle",
  bossReady: false,
  bossHint: emptyBossHint,
  heroes: [],
  world: {
    mapId: "map1",
    zoneIdx: 1,
    kind: "farm",
    stage: 1,
    traveling: false,
    left: null,
    right: null,
  },
  shop: emptyShop,
  bot: defaultBotSettings(),
  // Owner default (2026-07-09) "เข้าเกมมาบอทจะปิดไว้ก่อน": pre-hydration display
  // value only — `GameClient.tsx`'s boot sequence force-queues a real
  // `setAutoHunt: false` intent through the engine after any offline-idle
  // replay finishes (which runs on the SAVED value, untouched — see its own
  // comment), and the very next `syncFromEngine` overwrites this default
  // anyway. Matching it here just avoids a one-frame "ON" flash before that
  // lands, AND keeps this the correct baseline for `manualPlayHint`'s
  // trigger edge (`prev.autoHunt && !next.autoHunt` must never see a false
  // "just turned off" transition purely from booting).
  autoHunt: false,
  unlockedZones: {},
  materials: 0,
  npcInRange: { "npc:pahpu": false, "npc:lungdueng": false, "npc:elder": false },
  tier3FrontierLocked: false,
  deepestUnlockedFarm: { mapId: "map1", zoneIdx: 1 },
  mainChapters: [],
  dailies: { serverDay: 0, quests: [] },
  asuraEssence: 0,
  asuraZoneKills: {},
  asuraHotZoneIdx: null,
  tomePagesFound: 0,
  tomeUnlocked: false,
  asuraSigils: 0,
  hasAllZoneStones: false,
  canCraftLegendary: false,
  craftBlockReason: null,
  tomeAssembledCelebration: false,
  activeTownPanel: null,
  smithTrip: "idle",
  gateTrip: "idle",
  gateTripTarget: null,

  inventory: [],
  dropFeed: [],
  stoneFeed: [],
  sessionKnownTemplateIds: [],
  notices: [],
  fastTravelChannel: null,

  party: null,
  cohortStatus: { kind: "solo" },
  cohortNet: { rttMs: null, waitingOnSlot: null, perMember: [] },
  worldBossStatus: { kind: "idle" },
  mySocialBadge: null,

  chatMessages: [],
  chatUnread: 0,
  chatOpen: false,

  myCharacterId: null,
  announcementQueue: [],

  serverBuildId: null,
  updateBannerDismissedAt: null,
  updateBannerDismissedForId: null,
  updateReloadRequested: false,

  // Safe defaults pre-hydration; a mount effect (`SettingsPanel`'s bot/auto-sell
  // section) applies the persisted values once via `hydrateAutoSellRules` —
  // same two-step pattern as `soundMuted`/`setSoundMuted`.
  autoSellCommon: DEFAULT_AUTO_SELL_RULES.common,
  autoSellRare: DEFAULT_AUTO_SELL_RULES.rare,
  autoSellEpic: DEFAULT_AUTO_SELL_RULES.epic,
  autoSellKeepBetterStat: DEFAULT_AUTO_SELL_RULES.keepBetterStat,
  autoEquip: true,

  autoCast: false,
  autoAllocate: false,
  autoReturn: true,
  autoAdvance: true,
  autoHpPotion: CONFIG.shop.autoDefaults.hpPotion,
  autoManaPotion: CONFIG.shop.autoDefaults.manaPotion,
  autoHpThreshold: CONFIG.shop.autoDefaults.hpThreshold,
  autoManaThreshold: CONFIG.shop.autoDefaults.manaThreshold,
  optimisticStatSpend: {},
  soundMuted: false,
  // Default ON pre-hydration (matches `readStoredGhostsVisible`'s default); corrected
  // post-mount via `setGhostsVisible`. Safe either way — a one-frame extra ghost socket
  // never affects the sim.
  ghostsVisible: true,

  // Default ON pre-hydration (matches `readStoredWorldDepthOn`/etc.'s default);
  // corrected post-mount via `setWorldDepthOn`/`setWorldCameraOn`/
  // `setWorldAtmosphereOn`. Safe either way — render-only, never affects the sim.
  worldDepthOn: true,
  worldCameraOn: true,
  worldAtmosphereOn: true,

  hasSyncedOnce: false,
  ftueCompleted: true,
  onboardingStepIndex: -1,
  patchNotesVisible: false,

  pendingInput: emptyPendingInput(),

  syncFromEngine: (snapshot) =>
    // The just-arrived snapshot already reflects every allocateStat tap that
    // was queued up to (and drained/stepped within) this frame — see
    // `optimisticStatSpend`'s doc — so the overlay always clears clean here.
    set({ ...snapshot, hasSyncedOnce: true, optimisticStatSpend: {} }),

  toggleAutoCast: () => set((s) => ({ autoCast: !s.autoCast })),
  toggleAutoAllocate: () => set((s) => ({ autoAllocate: !s.autoAllocate })),
  toggleAutoReturn: () => set((s) => ({ autoReturn: !s.autoReturn })),
  toggleAutoAdvance: () => set((s) => ({ autoAdvance: !s.autoAdvance })),
  toggleAutoHpPotion: () => set((s) => ({ autoHpPotion: !s.autoHpPotion })),
  toggleAutoManaPotion: () => set((s) => ({ autoManaPotion: !s.autoManaPotion })),
  setAutoHpThreshold: (frac) =>
    set({ autoHpThreshold: Math.max(0.05, Math.min(0.95, frac)) }),
  setAutoManaThreshold: (frac) =>
    set({ autoManaThreshold: Math.max(0.05, Math.min(0.95, frac)) }),
  toggleSound: () =>
    set((s) => {
      const soundMuted = !s.soundMuted;
      writeSoundMuted(soundMuted);
      return { soundMuted };
    }),
  setSoundMuted: (soundMuted) => set({ soundMuted }),
  toggleGhostsVisible: () =>
    set((s) => {
      const ghostsVisible = !s.ghostsVisible;
      writeGhostsVisible(ghostsVisible);
      return { ghostsVisible };
    }),
  setGhostsVisible: (ghostsVisible) => set({ ghostsVisible }),

  toggleWorldDepthOn: () =>
    set((s) => {
      const worldDepthOn = !s.worldDepthOn;
      writeWorldDepthOn(worldDepthOn);
      return { worldDepthOn };
    }),
  setWorldDepthOn: (worldDepthOn) => set({ worldDepthOn }),
  toggleWorldCameraOn: () =>
    set((s) => {
      const worldCameraOn = !s.worldCameraOn;
      writeWorldCameraOn(worldCameraOn);
      return { worldCameraOn };
    }),
  setWorldCameraOn: (worldCameraOn) => set({ worldCameraOn }),
  toggleWorldAtmosphereOn: () =>
    set((s) => {
      const worldAtmosphereOn = !s.worldAtmosphereOn;
      writeWorldAtmosphereOn(worldAtmosphereOn);
      return { worldAtmosphereOn };
    }),
  setWorldAtmosphereOn: (worldAtmosphereOn) => set({ worldAtmosphereOn }),

  startOnboarding: () => set({ onboardingStepIndex: 0 }),
  setOnboardingStepIndex: (onboardingStepIndex) => set({ onboardingStepIndex }),
  completeOnboarding: () => {
    writeFtueCompleted(true);
    set({ onboardingStepIndex: -1, ftueCompleted: true });
  },
  setFtueCompleted: (ftueCompleted) => set({ ftueCompleted }),
  resetOnboarding: () => {
    writeFtueCompleted(false);
    set({ ftueCompleted: false, onboardingStepIndex: 0 });
  },

  showPatchNotes: () => set({ patchNotesVisible: true }),
  dismissPatchNotes: () => set({ patchNotesVisible: false }),

  showTomeAssembledCelebration: () => set({ tomeAssembledCelebration: true }),
  dismissTomeAssembledCelebration: () => set({ tomeAssembledCelebration: false }),

  castSkill: (skillId) =>
    set((s) => ({
      pendingInput: s.pendingInput.castSkills.some((c) => c.skillId === skillId)
        ? s.pendingInput
        : {
            ...s.pendingInput,
            castSkills: [...s.pendingInput.castSkills, { slot: 0, skillId }],
          },
    })),

  setAutoSlot: (slot, skillId) =>
    set((s) => ({
      pendingInput: {
        ...s.pendingInput,
        // Last-wins per slot: replace any pending assignment for the same slot.
        setAutoSlots: [
          ...s.pendingInput.setAutoSlots.filter((a) => a.slot !== slot),
          { slot, skillId },
        ],
      },
    })),

  challengeBoss: () =>
    set((s) => ({ pendingInput: { ...s.pendingInput, challengeBoss: true } })),

  advanceStage: () =>
    set((s) => ({ pendingInput: { ...s.pendingInput, advanceStage: true } })),

  walkToZone: (target) =>
    set((s) => ({ pendingInput: { ...s.pendingInput, walkToZone: target } })),

  evolveHero: (slot) =>
    set((s) => ({ pendingInput: { ...s.pendingInput, evolveHero: slot } })),

  acceptQuest: (slot) =>
    set((s) => ({ pendingInput: { ...s.pendingInput, acceptQuest: slot } })),

  allocateStat: (stat, amount) =>
    set((s) => ({
      pendingInput: {
        ...s.pendingInput,
        // Accumulate: same-stat taps sum, different-stat taps all survive
        // within one real frame's batch (M7.9 stat-tap-fix).
        allocateStat: {
          ...s.pendingInput.allocateStat,
          [stat]: (s.pendingInput.allocateStat?.[stat] ?? 0) + amount,
        },
      },
      // Instant local feedback ahead of the next throttled snapshot — cleared
      // wholesale in `syncFromEngine` once the engine's own numbers catch up.
      optimisticStatSpend: {
        ...s.optimisticStatSpend,
        [stat]: (s.optimisticStatSpend[stat] ?? 0) + amount,
      },
    })),

  buyShopItem: (item, qty) =>
    set((s) => ({ pendingInput: { ...s.pendingInput, buyShopItem: { item, qty } } })),

  useConsumable: (item) =>
    set((s) => ({ pendingInput: { ...s.pendingInput, useConsumable: item } })),

  useReturnScroll: () =>
    set((s) => ({ pendingInput: { ...s.pendingInput, useReturnScroll: true } })),

  queueEquip: (slot, templateId, refineLevel) =>
    set((s) => ({
      pendingInput: { ...s.pendingInput, equip: { slot, templateId, refineLevel } },
    })),

  setBotSettings: (patch) =>
    set((s) => ({
      pendingInput: {
        ...s.pendingInput,
        setBotSettings: { ...(s.pendingInput.setBotSettings ?? {}), ...patch },
      },
    })),

  // A player-initiated fast-travel silently cancels an in-flight gate trip
  // (owner UX round 2026-07-09) — the trip's OWN internal fast-travel leg
  // (`startSmithTrip`'s traveling branch) writes `pendingInput.fastTravel`
  // directly rather than calling this action, so smithTrip never self-cancels.
  queueFastTravel: (target) =>
    set((s) => ({
      pendingInput: { ...s.pendingInput, fastTravel: target },
      gateTrip: s.gateTrip === "idle" ? s.gateTrip : "idle",
      gateTripTarget: s.gateTrip === "idle" ? s.gateTripTarget : null,
    })),

  queueSetAutoHunt: (on) =>
    set((s) => ({ pendingInput: { ...s.pendingInput, setAutoHunt: on } })),

  toggleBotMaster: () =>
    set((s) => {
      const turningOff = s.autoHunt; // currently ON -> this call turns it off
      if (turningOff) {
        writeBotMasterSnapshot({
          enabled: s.bot.enabled,
          sellTripEnabled: s.bot.sellTripEnabled,
        });
        return {
          pendingInput: {
            ...s.pendingInput,
            setAutoHunt: false,
            setBotSettings: {
              ...(s.pendingInput.setBotSettings ?? {}),
              enabled: false,
              sellTripEnabled: false,
            },
          },
        };
      }
      const snap = readBotMasterSnapshot();
      writeBotMasterSnapshot(null);
      return {
        pendingInput: {
          ...s.pendingInput,
          setAutoHunt: true,
          setBotSettings: snap
            ? {
                ...(s.pendingInput.setBotSettings ?? {}),
                enabled: snap.enabled,
                sellTripEnabled: snap.sellTripEnabled,
              }
            : s.pendingInput.setBotSettings,
        },
      };
    }),

  creditGold: (amount) =>
    set((s) => ({
      pendingInput: {
        ...s.pendingInput,
        goldCredit: (s.pendingInput.goldCredit ?? 0) + amount,
      },
    })),

  creditMaterials: (amount) =>
    set((s) => ({
      pendingInput: {
        ...s.pendingInput,
        materialsDelta: (s.pendingInput.materialsDelta ?? 0) + amount,
      },
    })),

  // A manual move/attack order is "the player tapping elsewhere" (owner UX
  // round 2026-07-09) — silently cancels any in-flight smith trip AND gate
  // trip so neither fights a real player-directed command. Each trip's OWN
  // internal moveTo (`startSmithTrip`/`advanceSmithTrip`/`startGateTrip`/
  // `advanceGateTrip`) writes `pendingInput.moveTo` directly rather than
  // calling this action, so starting/advancing one never self-cancels.
  queueMoveTo: (x) =>
    set((s) => ({
      pendingInput: { ...s.pendingInput, moveTo: { x } },
      smithTrip: s.smithTrip === "idle" ? s.smithTrip : "idle",
      gateTrip: s.gateTrip === "idle" ? s.gateTrip : "idle",
      gateTripTarget: s.gateTrip === "idle" ? s.gateTripTarget : null,
    })),

  queueAttackTarget: (id) =>
    set((s) => ({
      pendingInput: { ...s.pendingInput, attackTarget: { id } },
      smithTrip: s.smithTrip === "idle" ? s.smithTrip : "idle",
      gateTrip: s.gateTrip === "idle" ? s.gateTrip : "idle",
      gateTripTarget: s.gateTrip === "idle" ? s.gateTripTarget : null,
    })),

  queueCancelCommand: () =>
    set((s) => ({ pendingInput: { ...s.pendingInput, cancelCommand: true } })),

  queueSetDailies: (serverDay, questIds) =>
    set((s) => ({ pendingInput: { ...s.pendingInput, setDailies: { serverDay, questIds } } })),

  queueClaimDaily: (questId) =>
    set((s) => ({ pendingInput: { ...s.pendingInput, claimDaily: questId } })),

  queueClaimMainReward: (chapterId) =>
    set((s) => ({ pendingInput: { ...s.pendingInput, claimMainReward: chapterId } })),

  // A friend-warp is a manual zone jump too (owner UX round 2026-07-09) —
  // same gate-trip cancel as `queueFastTravel`.
  queueWarpScroll: (target) =>
    set((s) => ({
      pendingInput: { ...s.pendingInput, useWarpScroll: target },
      gateTrip: s.gateTrip === "idle" ? s.gateTrip : "idle",
      gateTripTarget: s.gateTrip === "idle" ? s.gateTripTarget : null,
    })),

  queueClaimAsuraSigil: () =>
    set((s) => ({ pendingInput: { ...s.pendingInput, claimAsuraSigil: true } })),
  queueCraftLegendary: () =>
    set((s) => ({ pendingInput: { ...s.pendingInput, craftLegendary: true } })),

  openTownPanel: (panel) => set({ activeTownPanel: panel }),
  closeTownPanel: () => set({ activeTownPanel: null }),

  // ---- Owner UX round (2026-07-09): ปุ่มตีบวก works from anywhere ----
  startSmithTrip: () => {
    // Mutual exclusion with an in-flight gate trip (owner UX round
    // 2026-07-09) — a player can only be walking toward one destination.
    set((st) => (st.gateTrip === "idle" ? {} : { gateTrip: "idle", gateTripTarget: null }));
    const s = get();
    if (s.world.kind === "town") {
      if (s.npcInRange["npc:lungdueng"]) {
        set({ activeTownPanel: "lungdueng" });
        return;
      }
      set((st) => ({
        smithTrip: "walking",
        pendingInput: {
          ...st.pendingInput,
          moveTo: { x: townNpcConfig("npc:lungdueng").x },
        },
      }));
      get().pushNotice("walkToLungdueng");
      return;
    }
    set((st) => ({
      smithTrip: "traveling",
      pendingInput: {
        ...st.pendingInput,
        fastTravel: { mapId: CONFIG.world.townMapId, zoneIdx: 0 },
      },
    }));
    get().pushNotice("smithTripTraveling");
  },

  cancelSmithTrip: () => set((s) => (s.smithTrip === "idle" ? {} : { smithTrip: "idle" })),

  advanceSmithTrip: () => {
    const s = get();
    if (s.smithTrip === "idle") return;
    const result = nextSmithTripStep(s.smithTrip, {
      inTown: s.world.kind === "town",
      inRange: s.npcInRange["npc:lungdueng"],
      dead: s.heroes[0]?.dead ?? false,
    });
    if (result.effect === "openPanel") {
      set({ smithTrip: "idle", activeTownPanel: "lungdueng" });
    } else if (result.effect === "walkToSmith") {
      set((st) => ({
        smithTrip: "walking",
        pendingInput: {
          ...st.pendingInput,
          moveTo: { x: townNpcConfig("npc:lungdueng").x },
        },
      }));
    } else if (result.phase !== s.smithTrip) {
      set({ smithTrip: result.phase });
    }
  },

  // ---- Owner UX round (2026-07-09): เดินไปที่ประตูก่อน แล้วค่อยวาป ----
  startGateTrip: (gateX, destination) =>
    set((s) => ({
      // Mutual exclusion with an in-flight smith trip (mirrors
      // `startSmithTrip`'s own reset).
      smithTrip: "idle",
      gateTrip: "walking",
      gateTripTarget: {
        gateX,
        destination,
        originZone: { mapId: s.world.mapId, zoneIdx: s.world.zoneIdx },
        armedAt: Date.now(),
      },
      // Writes `pendingInput.moveTo` directly (not via `queueMoveTo`) so
      // arming never immediately self-cancels — mirrors `startSmithTrip`'s
      // own bypass.
      pendingInput: { ...s.pendingInput, moveTo: { x: gateX } },
    })),

  cancelGateTrip: () =>
    set((s) => (s.gateTrip === "idle" ? {} : { gateTrip: "idle", gateTripTarget: null })),

  advanceGateTrip: () => {
    const s = get();
    if (s.gateTrip === "idle" || !s.gateTripTarget) return;
    const target = s.gateTripTarget;
    const result = nextGateTripStep(s.gateTrip, target, {
      heroX: s.heroes[0]?.x ?? target.gateX,
      dead: s.heroes[0]?.dead ?? false,
      currentZone: { mapId: s.world.mapId, zoneIdx: s.world.zoneIdx },
      nowMs: Date.now(),
    });
    if (result.effect === "transition") {
      set((st) => ({
        gateTrip: "idle",
        gateTripTarget: null,
        // Fires the ORIGINAL `walkToZone` intent the immediate-transition
        // flow used to queue directly on tap — see `gateTap.ts`'s doc.
        pendingInput: { ...st.pendingInput, walkToZone: target.destination },
      }));
      return;
    }
    if (result.phase !== s.gateTrip) {
      set({ gateTrip: "idle", gateTripTarget: null });
    }
  },

  setInventory: (items) => set({ inventory: items }),
  mergeInventory: (claimed) =>
    set((s) => ({ inventory: mergeClaimedItems(s.inventory, claimed) })),

  pushDropFeed: (templateId, rarity) =>
    set((s) => ({
      dropFeed: [
        ...s.dropFeed,
        { id: `drop-${++dropFeedSeq}`, templateId, rarity },
      ].slice(-MAX_DROP_FEED),
    })),
  dismissDropFeed: (id) =>
    set((s) => ({ dropFeed: s.dropFeed.filter((d) => d.id !== id) })),

  pushStoneFeed: (qty) =>
    set((s) => ({
      stoneFeed: [...s.stoneFeed, { id: `stone-${++stoneFeedSeq}`, qty }].slice(
        -MAX_STONE_FEED,
      ),
    })),
  dismissStoneFeed: (id) =>
    set((s) => ({ stoneFeed: s.stoneFeed.filter((d) => d.id !== id) })),

  setSessionKnownTemplateIds: (ids) =>
    set({ sessionKnownTemplateIds: [...new Set(ids)] }),
  removeSoldFromInventory: (results) =>
    set((s) => ({ inventory: removeSoldItems(s.inventory, results) })),
  setInventoryRefineLevel: (instanceId, refineLevel) =>
    set((s) => ({
      inventory: applyRefineLevelChange(s.inventory, instanceId, refineLevel),
    })),
  removeInventoryInstance: (instanceId) =>
    set((s) => ({ inventory: removeInstanceId(s.inventory, instanceId) })),

  pushNotice: (messageKey, params) =>
    set((s) => ({
      notices: [...s.notices, { id: `notice-${++noticeSeq}`, messageKey, params }].slice(
        -MAX_NOTICES,
      ),
    })),
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),

  startFastTravelChannel: (mapId, zoneIdx) =>
    set((s) => ({
      fastTravelChannel: { key: (s.fastTravelChannel?.key ?? 0) + 1, mapId, zoneIdx },
    })),
  clearFastTravelChannel: () => set({ fastTravelChannel: null }),

  setParty: (party) => set({ party }),
  setCohortStatus: (status) => set({ cohortStatus: status }),
  setCohortNet: (net) => set({ cohortNet: net }),
  setMySocialBadge: (badge) => set({ mySocialBadge: badge }),

  ingestChatHistory: (entries) =>
    set({ chatMessages: capChatMessages(entries.map((e) => ({ ...e, id: `chat-${chatMsgSeq++}` }))) }),
  ingestChatMessage: (entry) =>
    set((s) => ({
      chatMessages: capChatMessages([...s.chatMessages, { ...entry, id: `chat-${chatMsgSeq++}` }]),
      chatUnread: nextUnreadCount(s.chatUnread, s.chatOpen),
    })),
  setChatOpen: (open) => set((s) => ({ chatOpen: open, chatUnread: open ? 0 : s.chatUnread })),

  setWorldBossStatus: (status) => set({ worldBossStatus: status }),
  queueSpawnWorldBoss: (windowId, remainingSeconds, hp) =>
    set((s) => ({
      pendingInput: { ...s.pendingInput, spawnWorldBoss: { windowId, remainingSeconds, hp } },
    })),
  queueSyncWorldBoss: (windowId, hp) =>
    set((s) => ({ pendingInput: { ...s.pendingInput, syncWorldBoss: { windowId, hp } } })),

  queueSetAsuraHotZone: (dayKey) =>
    set((s) => ({ pendingInput: { ...s.pendingInput, setAsuraHotZone: { dayKey } } })),

  setMyCharacterId: (characterId) => set({ myCharacterId: characterId }),
  ingestAnnouncementFeed: (wire) =>
    set((s) => {
      const { toQueue, seenIds } = ingestAnnouncements(
        wire,
        seenAnnouncementIds,
        s.myCharacterId,
      );
      seenAnnouncementIds = seenIds;
      if (toQueue.length === 0) return {};
      return {
        announcementQueue: [...s.announcementQueue, ...toQueue].slice(
          -MAX_ANNOUNCEMENT_QUEUE,
        ),
      };
    }),
  shiftAnnouncementQueue: () =>
    set((s) => ({ announcementQueue: s.announcementQueue.slice(1) })),

  setServerBuildId: (id) => set({ serverBuildId: id }),
  dismissUpdateBanner: (forId) =>
    set({ updateBannerDismissedAt: Date.now(), updateBannerDismissedForId: forId }),
  requestReload: () => set({ updateReloadRequested: true }),

  setAutoSellCommon: (action) =>
    set((s) => {
      writeAutoSellRules({
        common: action,
        rare: s.autoSellRare,
        epic: s.autoSellEpic,
        keepBetterStat: s.autoSellKeepBetterStat,
      });
      return { autoSellCommon: action };
    }),
  setAutoSellRare: (action) =>
    set((s) => {
      writeAutoSellRules({
        common: s.autoSellCommon,
        rare: action,
        epic: s.autoSellEpic,
        keepBetterStat: s.autoSellKeepBetterStat,
      });
      return { autoSellRare: action };
    }),
  setAutoSellEpic: (action) =>
    set((s) => {
      writeAutoSellRules({
        common: s.autoSellCommon,
        rare: s.autoSellRare,
        epic: action,
        keepBetterStat: s.autoSellKeepBetterStat,
      });
      return { autoSellEpic: action };
    }),
  toggleAutoSellKeepBetterStat: () =>
    set((s) => {
      const autoSellKeepBetterStat = !s.autoSellKeepBetterStat;
      writeAutoSellRules({
        common: s.autoSellCommon,
        rare: s.autoSellRare,
        epic: s.autoSellEpic,
        keepBetterStat: autoSellKeepBetterStat,
      });
      return { autoSellKeepBetterStat };
    }),
  hydrateAutoSellRules: (rules) =>
    set({
      autoSellCommon: rules.common,
      autoSellRare: rules.rare,
      autoSellEpic: rules.epic,
      autoSellKeepBetterStat: rules.keepBetterStat,
    }),
  toggleAutoEquip: () =>
    set((s) => {
      const autoEquip = !s.autoEquip;
      writeAutoEquip(autoEquip);
      return { autoEquip };
    }),
  hydrateAutoEquip: (on) => set({ autoEquip: on }),

  hydrateUiConfig: (cfg) =>
    set((s) => {
      // Merge only DEFINED fields over the current config so a partial blob
      // never wipes a field to `undefined`.
      const merged: UiConfig = { ...selectUiConfig(s) };
      for (const key of Object.keys(cfg) as (keyof UiConfig)[]) {
        const v = cfg[key];
        if (v === undefined) continue;
        // A legacy `Character.uiConfig` row (server, pre-2026-07-08) may still
        // carry the RETIRED "salvage" action — the server's own schema stays
        // backward-compatible and doesn't reject it, so guard it here too: an
        // invalid action is simply skipped, leaving whatever this rarity's
        // CURRENT value is untouched (never migrated to "sell", per owner spec —
        // see `AutoSellAction`'s doc).
        if (
          (key === "autoSellCommon" || key === "autoSellRare" || key === "autoSellEpic") &&
          !isAutoSellAction(v)
        ) {
          continue;
        }
        (merged[key] as UiConfig[typeof key]) = v;
      }
      // Write-through so the legacy mount-effect hydrations (which read their own
      // keys) pick up the winning value instead of re-applying a stale local one.
      writeUiConfig(merged);
      writeAutoSellRules({
        common: merged.autoSellCommon,
        rare: merged.autoSellRare,
        epic: merged.autoSellEpic,
        keepBetterStat: merged.autoSellKeepBetterStat,
      });
      writeAutoEquip(merged.autoEquip);
      return merged;
    }),

  drainPendingInput: () => {
    const pending = get().pendingInput;
    set({ pendingInput: emptyPendingInput() });
    return pending;
  },
}));
