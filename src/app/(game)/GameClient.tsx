"use client";

/**
 * The game-loop host: the seam where the pure engine, the Pixi renderer, and
 * the React HUD meet.
 *
 * Owns the live `GameState` and the render `Application` as plain closures
 * inside a single `useEffect` (never React state — see `CLAUDE.md`'s no
 * per-frame-state-in-React rule). Each rAF tick:
 *   1. copies the UI-owned `autoCast`/`autoAllocate`/`autoReturn`/auto-potion/
 *      `soundMuted` flags off the Zustand store onto the engine state /
 *      `AudioController` — every automation flag here (all but `soundMuted`)
 *      is ALSO ANDed against the bot MASTER switch (`store.autoHunt` — see
 *      `gameStore.ts`'s `toggleBotMaster` doc) so a single switch silences
 *      every sub-behavior at once,
 *   2. drains the one-shot player-intent queue (`drainPendingInput`) exactly
 *      once and hands it to the FIRST fixed sub-step of the frame,
 *   2b. shapes this frame's real elapsed seconds through `TimeDirector`
 *      (`./timeDirector.ts`) using LAST frame's events, for hit-stop/slow-mo
 *      (M4 juice) — ONLY the accumulator's input is shaped; the renderer,
 *      audio, and the ~10Hz UI-sync below all keep using the real elapsed
 *      time so fx/SFX/HUD stay snappy even while the sim is frozen/slowed,
 *   3. asks the fixed-timestep accumulator how many `FIXED_DT` sub-steps to
 *      run and runs `step()` that many times, concatenating each sub-step's
 *      `state.events` into one `frameEvents` array (M4 juice feed — the buffer
 *      is cleared at the START of every step(), so a multi-sub-step frame
 *      must collect across all of them). The player-facing 1x/2x/3x speed
 *      selector was removed (M6.7) — the accumulator is always drained at a
 *      fixed multiplier of 1 sub-step per real frame now; `drainAccumulator`
 *      itself still takes a speed argument (used by the sim/balance harness
 *      and engine tests), it's just hardcoded to `1` from this integration seam,
 *   4. draws the resulting state + `frameEvents` with the (one-way,
 *      read-only) `GameRenderer`, which reacts to them on its `fx` layer, then
 *      hands the same `frameEvents` to the `AudioController` (`render/audio`)
 *      for SFX — same one-way, event-driven shape as the fx layer,
 *   5. at the throttled `CONFIG.uiSyncHz` cadence, pushes a HUD-only snapshot
 *      back into the store via `syncFromEngine`.
 *
 * No game logic lives here — this only pumps input -> step -> draw -> snapshot.
 * Save/load (M3) hooks in at two points: pass a loaded `SaveData` into
 * `initGameState(seed, save)` on mount, and periodically/on-unload serialize
 * the relevant `GameState` fields back out.
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import {
  CONFIG,
  FIXED_DT,
  ITEM_TEMPLATES,
  SIGNATURE_SKILL,
  bossHint,
  canEvolveHero,
  canUseConsumable,
  combatPower,
  createAccumulator,
  dailyDef,
  deepestUnlockedFarm,
  drainAccumulator,
  evolutionQuestFor,
  initGameState,
  isEvolutionQuestOffered,
  isTier3BossObjectiveActive,
  learnedSkills,
  lookupTemplate,
  mainChapterDefs,
  mainQuestChapters,
  migrate,
  npcInRange,
  repairHeroClass,
  primaryStat,
  shopPriceAt,
  shopStageOf,
  skillCdOf,
  step,
  tier3FrontierLocked,
  toSaveData,
  townNpcConfig,
  unlockedAutoSlotCount,
  worldNav,
  worldBossPhaseAt,
  worldBossDamageDealt,
  effectiveUnlockedZones,
  wantsBotTownTrip,
  zoneAt,
  isAsuraLocation,
  // "ตำราตำนาน" secret tome + legendary craft (endgame v1.3) — pure snapshot reads.
  tomePagesFound,
  hasAllZoneStones,
  canCraftLegendary,
  craftBlockReason,
  TOME_ALL_PAGES,
  type FrameInput,
  type GameEvent,
  type GameState,
  type Hero,
  type HeroClass,
  type SaveData,
  type TownNpcId,
  type BotSettings,
} from "@/engine";
import { type TurnMessage } from "@/engine/lockstep";
import { AudioController } from "@/render/audio";
import { GameRenderer } from "@/render/GameRenderer";
import type { AnnouncementWire } from "@/ui/announcements/types";
import { GameHud } from "@/ui/components/GameHud";
import { PatchNotesModal } from "@/ui/components/PatchNotesModal";
import { AsuraTomeAssembledModal } from "@/ui/asura/AsuraTomeAssembledModal";
import { selectAutoEquip } from "@/ui/gear/autoEquip";
import { selectAutoSellIds } from "@/ui/gear/autoSell";
import {
  takeBatch,
  type ClaimBufferEntry,
  type StoneClaimBufferEntry,
} from "@/ui/gear/claimBuffer";
import { postClaimBatch, postEquip } from "@/ui/gear/api";
import { applyEquipChange } from "@/ui/gear/inventoryOps";
import { executeSell } from "@/ui/gear/sellFlow";
import { toInventoryItem } from "@/ui/gear/types";
import type {
  ClaimItemResultWire,
  ItemInstanceWire,
  StoneClaimResultWire,
} from "@/ui/gear/types";
import {
  useGameStore,
  readStoredUiConfig,
  selectUiConfig,
  writeUiConfig,
  type DailyBoardSummary,
  type CohortStatusState,
  type CohortNetState,
  type DailyQuestSummary,
  type EngineSnapshot,
  type HeroQuestSummary,
  type HeroSummary,
  type MainChapterSummary,
  type ShopSummary,
  type SkillSummary,
  type TownPanelId,
  type UiConfig,
  type WorldBossStatus,
} from "@/ui/store/gameStore";
import { getWorldBossState, postWorldBossClaim, postWorldBossDamage } from "@/ui/worldBoss/api";
import {
  authorityReportDelta,
  deriveWorldBossStatus,
  sameWorldBossStatus,
  shouldPollHp,
  shouldQueueWorldBossSpawn,
  shouldSendParticipationPing,
} from "@/ui/worldBoss/schedule";
import { asuraDayKeyForMs } from "@/ui/asura/schedule";
import { fetchHofRewards } from "@/ui/hof/rewardsApi";
import { HOF_REWARD_BOARDS, titleLabel } from "@/ui/hof/titles";
import { resolveCatchUp } from "./catchUp";
import {
  PartyHandshake,
  extractSoloState,
  progressionFromHero,
  sharedSaveFromState,
  type ReseedAckMsg,
  type ReseedOfferMsg,
} from "./partyHandshake";
import {
  PartySession,
  electLeader,
  liveCohortSlots,
  resolveMemberDisplayName,
  synthesizeShadowMessage,
  type CohortMember,
  type PartyConnStatus,
} from "./partySession";
import { CohortTurnEngine, type CohortTickIO } from "./cohortTurnEngine";
import { emaRtt, pickWaitingSlot } from "./cohortNet";
import { buildFrameInput, hasZoneChangeIntent, sanitizeLanes } from "./buildFrameInput";
import { BOT_TRIP_LEAVE_DEBOUNCE_MS, shouldLeaveCohortForBotTrip } from "./cohortBotTrip";
import { buildCohortSocialBadges } from "./cohortBadges";
import {
  botSettingsFrom,
  desiredHeroConfig,
  dropAssignedIndex,
  heroConfigDiff,
  myAutoHuntDisplay,
  nextAutoHuntWish,
  nextBotSettingsWish,
  virtualWallet,
  walletSliceFrom,
  type WalletSlice,
} from "./cohortWallet";
import {
  applyProgressSlice,
  deriveUnlockedZones,
  progressSliceFrom,
  settleProgressSlice,
  sharedProgressFrom,
  type ProgressSlice,
  type SharedProgress,
} from "./cohortProgress";
import { TimeDirector } from "./timeDirector";
import { WorldSession } from "./presence/worldSession";
import { GhostStore, GHOST_CAP_DEFAULT } from "./presence/ghostStore";
import { buildPresenceSnapshot, shouldPublish, type PresenceSnapshot } from "./presence/presencePublish";
import { parseChatFrame } from "@/ui/chat/chatMessages";
import { onSendChatRequest } from "@/ui/chat/chatSendSignal";

/** Narrow, allocation-cheap "is this a plain JSON object" guard for parsing opaque
 * relay `g` payloads (handshake messages / lockstep `TurnMessage`s) — mirrors
 * `partySession.ts`'s internal helper (kept local; not worth exporting one function
 * across the module boundary). */
function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

/** Mirrors `server/items.ts`'s `MAX_CLAIM_BATCH` (server zone, not importable
 * from here — the cap is a plain contract number, duplicated deliberately
 * rather than reached into `@/server/**`). A buffer bigger than this flushes
 * across multiple autosave-cadence ticks instead of being truncated. */
const MAX_CLAIM_BATCH = 64;

/** Mirrors `server/worldBoss.ts`'s `WORLD_BOSS_REWARD.materials` (server zone,
 * not importable from here — same "duplicated deliberately" convention as
 * `MAX_CLAIM_BATCH` above). The claim response's `materialsTotal` is an
 * ABSOLUTE post-credit balance, not a delta — `creditMaterials` wants a signed
 * delta (same convention as every other materials credit in this file), so the
 * known fixed reward is applied directly rather than diffed against a
 * possibly-stale local mirror. */
const WORLD_BOSS_REWARD_MATERIALS = 350;

/** SHARED-HP client driver (M8.6) cadence: how often the AUTHORITY posts its accrued
 * damage delta (and a non-authority cohort member polls the read-only state endpoint) —
 * generous enough to keep well clear of any rate limiting while still feeling live on the
 * HP bar. Mirrors `server/worldBoss.ts`'s generous `maxDamagePerPost` cap design intent
 * (a batched report, not per-hit). */
const WB_DAMAGE_REPORT_MS = 10_000;

/** FIX 2 (2026-07-09 live round) — all-clients defeat poll cadence: a client that's
 * NOT currently engaged in the fight (never receives an hp-report response of its
 * own) still needs to learn the SHARED pool died so `WorldBossBanner` can stop
 * showing a stale countdown and the "found it!"/participant auto-claim path can
 * fire. Same generous order of magnitude as `WB_DAMAGE_REPORT_MS` — a public GET,
 * cheap, only runs during the ~15-minute active window. */
const WB_DEFEAT_POLL_MS = 12_000;

/** Party handshake deadline safety net (partySession.ts D1/D2 fixes). A re-seed exchange
 * that hasn't converged within `HANDSHAKE_DEADLINE_MS` is aborted + retried; a trip backs
 * the next window off to `HANDSHAKE_RETRY_MS` so a genuinely-absent peer doesn't thrash.
 * Tuned tight (RTT is ~42ms p95, the exchange is ~2 round-trips): a handshake still
 * unconverged after 3s is genuinely stuck, so this is pure recovery latency for the rare
 * lost-message case — kept far above the exchange time to never abort a live formation. */
const HANDSHAKE_DEADLINE_MS = 3_000;
const HANDSHAKE_RETRY_MS = 6_000;

/** Grace before the "connecting" cohort chip is allowed to show. A same-zone re-form
 * (leaving for a town trip + walking back) now converges in well under this, so a seamless
 * re-join never flashes the chip at all; only a genuinely slow/stuck formation surfaces it.
 * Any terminal chip state (active/solo/waiting/reconnecting) cancels a pending grace. */
const CONNECTING_CHIP_GRACE_MS = 600;

/** Wall-clock seconds between throttled engine -> UI snapshots. */
const UI_SYNC_INTERVAL = 1 / CONFIG.uiSyncHz;

/** Town NPCs phase 3 (final): how many rotating greeting lines each NPC has
 * (`townNpc.<id>.greetings.greeting1..N` in messages/*.json) — kept as one
 * shared constant since both NPCs carry the same count. */
const NPC_GREETING_COUNT = 3;

/**
 * Clamp per-frame elapsed wall time (tab-away, debugger pauses, dropped
 * frames) so a stall never dumps a huge burst of sub-steps into one rAF.
 * A hidden-tab gap longer than `CATCHUP_MIN_HIDDEN_MS` is instead replayed
 * explicitly by the tab-return catch-up below (`resolveCatchUp` +
 * `replayFixedSteps`) — this clamp only protects the ORDINARY per-frame case
 * (a dropped frame, a debugger pause) from ever dumping a huge sub-step burst.
 */
const MAX_FRAME_SECONDS = 0.25;

/**
 * Minimum hidden-tab wall-clock gap that triggers the explicit catch-up
 * replay below. Below this the ordinary `MAX_FRAME_SECONDS` clamp on the next
 * real rAF frame already handles it fine (losing at most a quarter second of
 * sim time is imperceptible); above it we'd otherwise silently lose real
 * elapsed time to that same clamp (tab switch, mobile screen fold, …).
 */
const CATCHUP_MIN_HIDDEN_MS = 5_000;

// ── FIX 5 (2026-07-09) hidden-tab lane-keepalive for an ACTIVE cohort ────────────────
/** While a cohort member's tab is hidden the rAF loop pauses, so this fallback interval
 * keeps ISSUING its idle lanes to peers so the cohort never stalls waiting on it.
 * Background tabs throttle timers to ~1Hz, which is exactly this cadence (inbound peer
 * messages drive it faster when they're active — see `onPartyGameMessage`). */
const KEEPALIVE_ISSUE_INTERVAL_MS = 1_000;
/** Cap on how long a tab may sit in lane-keepalive before resume falls back to the legacy
 * leave -> solo catch-up -> re-handshake path (a huge buffered backlog isn't worth
 * bursting; the bounded solo offline replay is cheaper). 30 min. */
const HIDDEN_KEEPALIVE_MAX_MS = 30 * 60 * 1_000;
/** Wall-clock budget per rAF frame for the resume backlog burst, so catching up a long
 * hidden gap spreads over a few frames instead of janking one. */
const CATCHUP_BURST_BUDGET_MS = 24;
/** Sub-steps per burst batch between wall-clock checks (amortises the `performance.now()`
 * read; `step()` is cheap enough that a batch of 128 fits well under one frame). */
const CATCHUP_BURST_SUBSTEPS = 128;

/** Wall time between periodic autosave POSTs. */
const AUTOSAVE_INTERVAL_MS = 30_000;

/** Ghost-presence publish cadence (~3Hz, docs/ghost-presence-design.md §3). One snapshot
 * of MY hero per beat, sent only when it changed or every 3rd beat (keepalive). */
const PRESENCE_BEAT_MS = 330;

/** Wave 3 network HUD (docs/ghost-presence-design.md): RTT ping cadence over the PARTY
 * socket (relay echoes it point-to-point) and the `cohortNet` store-push cadence. Both
 * are wall-clock accumulators like `PRESENCE_BEAT_MS` above, not per-rAF-frame writes. */
const COHORT_PING_INTERVAL_MS = 5_000;
const COHORT_NET_PUSH_MS = 1_000;

/**
 * Wall-clock budget for replaying capped offline-idle time synchronously on
 * load. A full `offlineCapHours` (8h ≈ 1.7M fixed steps @60Hz) would freeze the
 * tab, so we replay as many real `step()`s as fit in this budget and DROP the
 * remainder. Bounded by wall time (not a fixed step count) so it stays jank-free
 * on any machine. Exact long-idle fidelity is an M4 concern (a coarse
 * closed-form idle-rate model, or a chunked/worker catch-up).
 *
 * Reused verbatim by the mid-session tab-return catch-up (`replayFixedSteps`)
 * below — same budget, same drop-the-remainder behavior, same forced
 * `autoReturn` — so a long tab-away gap gets identical treatment to a boot
 * offline-idle gap.
 */
const OFFLINE_SYNC_BUDGET_MS = 250;

/** Wall-clock timeout for the blocking save-load GET so a hung/flaky network
 * (LAN / Tailscale over plain HTTP on mobile) can never stop the game from
 * starting — on timeout we abort and boot a fresh game. */
const SAVE_LOAD_TIMEOUT_MS = 6_000;

/** Fetch with a hard timeout via AbortController (works on older mobile Safari
 * that lacks `AbortSignal.timeout`). */
async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wait until the mount element has been laid out to a non-zero size (mobile
 * flex/aspect-ratio can report 0x0 for the first frame or two). Bounded so a
 * genuinely collapsed layout still proceeds (the renderer's own resize guard
 * then keeps it at a safe fallback size until the ResizeObserver fires).
 */
async function waitForNonZeroSize(el: HTMLElement, maxFrames = 10): Promise<void> {
  for (let i = 0; i < maxFrames; i++) {
    if (el.clientWidth > 0 && el.clientHeight > 0) return;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

/** Town NPCs phase 3 (final; extended M8 quest Wave C): maps the engine's
 * `TownNpcId` union onto the store's shorter `TownPanelId` (which panel a
 * given NPC opens — pahpu -> ShopPanel, lungdueng -> RefinePanel, elder ->
 * QuestBoardPanel). */
function townPanelOf(id: TownNpcId): TownPanelId {
  if (id === "npc:pahpu") return "pahpu";
  if (id === "npc:lungdueng") return "lungdueng";
  return "board";
}

/** Town NPCs phase 3 (final; extended M8 quest Wave C): maps the engine's
 * `TownNpcId` union onto the `townNpc.<key>` i18n namespace key (greetings +
 * bot-flavor line) — shared by `talkToNpc`'s speech-bubble lookup and the
 * `npcTrade` bot-flavor handler below. */
function npcI18nKey(id: TownNpcId): "pahpu" | "lungdueng" | "elder" {
  if (id === "npc:pahpu") return "pahpu";
  if (id === "npc:lungdueng") return "lungdueng";
  return "elder";
}

/** Precompute the learned-skill kit's display state (M5 skill framework v2). */
function buildSkillSummaries(h: Hero): SkillSummary[] {
  return learnedSkills(h).map((def): SkillSummary => {
    const cd = skillCdOf(h, def.id);
    const affordable = h.mana >= def.cost;
    const autoSlot = h.autoSlots.indexOf(def.id);
    return {
      id: def.id,
      cd,
      maxCd: def.cd,
      cost: def.cost,
      ready: cd <= 0 && affordable && !h.dead,
      affordable,
      autoSlot: autoSlot >= 0 ? autoSlot : null,
    };
  });
}

/**
 * Precompute the evolution-quest affordance state — covers BOTH the tier-1 ->
 * tier-2 class-change quest and the M7.9 tier-2 -> tier-3 quest (same shape,
 * `evolutionQuestFor(cls, tier)` resolves the right def). Returns null when
 * there's nothing quest-related to show: tier 3 (fully evolved — no further
 * quest, the bar shows the final-form badge instead), or below the level gate
 * with no active quest (the bar shows the locked hint from tier/level).
 */
function buildQuestSummary(state: GameState, h: Hero, isSolo: boolean): HeroQuestSummary | null {
  if (h.tier === 3) return null;
  const offered = isEvolutionQuestOffered(h);
  const q = h.quest;
  if (!offered && !q) return null; // below the level gate — no affordance yet
  const def = evolutionQuestFor(h.cls, h.tier);
  if (!def) return null;
  const killIdx = def.objectives.findIndex((o) => o.type === "kill");
  const bossIdx = def.objectives.findIndex((o) => o.type === "killBoss");
  const kills = killIdx >= 0 ? (q?.progress[killIdx] ?? 0) : 0;
  const killGoal = killIdx >= 0 ? def.objectives[killIdx].count : 0;
  const bossDone =
    bossIdx >= 0 && (q?.progress[bossIdx] ?? 0) >= def.objectives[bossIdx].count;
  const accepted = q?.accepted ?? false;
  const complete =
    accepted && def.objectives.every((o, i) => (q?.progress[i] ?? 0) >= o.count);
  const killMapId = killIdx >= 0 ? (def.objectives[killIdx].mapId ?? null) : null;
  const bossMapId = bossIdx >= 0 ? (def.objectives[bossIdx].mapId ?? null) : null;
  return {
    offered,
    accepted,
    complete,
    kills,
    killGoal,
    bossDone,
    killMapId,
    bossMapId,
    // M7.9b: `isTier3BossObjectiveActive` reads `state.heroes[0]` internally
    // (it's a solo-hero concept), so it's only meaningful for that hero.
    bossChallengeActive: isSolo && isTier3BossObjectiveActive(state),
  };
}

function buildSnapshot(state: GameState): EngineSnapshot {
  const heroes: HeroSummary[] = state.heroes.map((h) => {
    const atLevelCap = h.level >= CONFIG.leveling.levelCap;
    // Precompute the 0..1 progress float HERE (the one place the xp-curve
    // math is allowed to run) so the throttled store only ever carries a
    // display-ready number, never raw xp/`xpToLevel()` (see HeroSummary's
    // doc comment).
    const xpProgress = atLevelCap
      ? 1
      : Math.max(0, Math.min(1, h.xp / CONFIG.leveling.xpToLevel(h.level)));
    return {
      cls: h.cls,
      hp: h.hp,
      maxHp: h.maxHp,
      // Signature skill cooldown (onboarding's "you cast a skill" detector).
      skillCd: skillCdOf(h, SIGNATURE_SKILL[h.cls]),
      // Owner request: War Cry buff status chip — raw values, no engine math.
      atkBuffMult: h.atkBuffMult,
      atkBuffTimer: h.atkBuffTimer,
      mana: h.mana,
      maxMana: h.maxMana,
      skills: buildSkillSummaries(h),
      autoSlots: [...h.autoSlots],
      unlockedSlots: unlockedAutoSlotCount(h.level, h.tier),
      dead: h.dead,
      level: h.level,
      xpProgress,
      atLevelCap,
      tier: h.tier,
      // Pure display reads (M5 evolution) — the same rule/read-path
      // `xpProgress` uses: engine helpers compute it, the store just carries
      // the display-ready result.
      canEvolve: canEvolveHero(state, h),
      quest: buildQuestSummary(state, h, h === state.heroes[0]),
      // M5 "Base stats" — same one-way display read-path: engine helpers compute
      // it, the store just carries the display-ready result.
      statPoints: h.statPoints,
      stats: { ...h.stats },
      primaryStat: primaryStat(h.cls),
      combatPower: combatPower(h),
      // M7 Gear & Drops: the sim's own applied loadout (see `HeroSummary.equipped`
      // doc — distinct from, but kept in sync with, the DB-hydrated `inventory`
      // store slice). Shallow-copied like `stats` above (never alias engine state).
      equipped: { ...h.equipped },
      // M7.8 Manual Play: read-only display flag for the "✕ ยกเลิกคำสั่ง" chip.
      hasCommand: h.command != null,
    };
  });

  // World position + walk-arrow affordances (M6). Precompute the display-ready
  // neighbor state here (the one place the engine `worldNav` read runs) so the
  // throttled store carries only plain data.
  const nav = worldNav(state);
  const neighbor = (n: typeof nav.left) =>
    n
      ? {
          mapId: n.zone.mapId,
          zoneIdx: n.zone.zoneIdx,
          kind: n.zone.kind,
          unlocked: n.unlocked,
        }
      : null;

  // NPC shop + consumables (M6). Prices scale by farming depth (shopStageOf), not
  // the town's stage; readiness is the precomputed quick-use guard.
  const shopStage = shopStageOf(state);
  const shop: ShopSummary = {
    counts: { ...state.consumables },
    prices: {
      hpPotion: shopPriceAt("hpPotion", shopStage),
      manaPotion: shopPriceAt("manaPotion", shopStage),
      returnScroll: shopPriceAt("returnScroll", shopStage),
      warpScroll: shopPriceAt("warpScroll", shopStage),
    },
    stackCap: CONFIG.shop.stackCap,
    ready: {
      hpPotion: canUseConsumable(state, "hpPotion"),
      manaPotion: canUseConsumable(state, "manaPotion"),
    },
    cds: {
      hpPotion: state.consumableCds.hpPotion ?? 0,
      manaPotion: state.consumableCds.manaPotion ?? 0,
    },
    maxCds: {
      hpPotion: CONFIG.shop.items.hpPotion.cooldown,
      manaPotion: CONFIG.shop.items.manaPotion.cooldown,
    },
  };

  return {
    gold: state.gold,
    stage: state.stage,
    kills: state.kills,
    killGoal: CONFIG.killGoal(state.stage),
    phase: state.phase,
    bossReady: state.bossReady,
    bossHint: bossHint(state),
    heroes,
    world: {
      mapId: nav.current.mapId,
      zoneIdx: nav.current.zoneIdx,
      kind: nav.current.kind,
      stage: nav.current.stage,
      traveling: nav.traveling,
      left: neighbor(nav.left),
      right: neighbor(nav.right),
    },
    shop,
    // Idle-bot config (M7.5, read-only display source — see `HudState.bot`'s
    // doc) + per-map unlocked-zone counts (M6 SAVE v8 field, surfaced for the
    // fast-travel picker's lock read). PER-HERO now (2026-07-09): read MY OWN hero's
    // config (heroes[0] is my-hero-first in a cohort) so the BotSettings panel shows my
    // own settings, not the shared lane-0 `state.bot`. Byte-identical in solo (config ≡ state.bot).
    bot: botSettingsFrom(state.heroes[0]?.config, state.bot),
    // Bot MASTER switch display (M8 party live bug fix — see `myAutoHuntDisplay`'s doc):
    // MY OWN hero's config, never the shared `state.autoHunt` legacy field.
    autoHunt: myAutoHuntDisplay(state),
    // M7.9 tier-3 preview (owner "option ข"): surface the EFFECTIVE unlocked counts —
    // the persisted map + any active tier-3 quest grant (map4 z1) folded in — so the
    // fast-travel picker + walk arrows offer the preview zone. Derived, never persisted
    // (effectiveUnlockedZones returns a copy; toSaveData still writes state.unlockedZones).
    unlockedZones: effectiveUnlockedZones(state),
    // M7.6 ตีบวก material counter — same one-way "engine carries it, store just
    // reflects it" pattern as `gold`.
    materials: state.materials,
    // Town NPCs phase 3 (final): per-NPC talk-range read, straight off the
    // engine's pure `npcInRange` — see `EngineSnapshot.npcInRange`'s doc.
    npcInRange: {
      "npc:pahpu": npcInRange(state, "npc:pahpu"),
      "npc:lungdueng": npcInRange(state, "npc:lungdueng"),
      "npc:elder": npcInRange(state, "npc:elder"),
    },
    // Tier-3 frontier GATE (owner rule 2026-07-07 "ห้ามข้ามแมพ") — pure engine
    // reads, same one-way "engine computes, store just carries it" pattern as
    // `npcInRange`. Drives the quest card's locked kill-row copy + the guide-me
    // gated branch (`ui/questGuide.ts`).
    tier3FrontierLocked: tier3FrontierLocked(state),
    deepestUnlockedFarm: deepestUnlockedFarm(state),
    // M8 quest Wave C — main-chapter tracker, precomputed here (the one place
    // engine reads run — same rule `xpProgress` follows): each chapter's
    // derived state zipped with its STATIC reward (a pure config lookup, safe
    // to call every sync since `mainChapterDefs()` is a plain CONFIG read).
    mainChapters: mainQuestChapters(state).map((c): MainChapterSummary => {
      const def = mainChapterDefs().find((d) => d.id === c.id);
      return { ...c, reward: def?.reward ?? {} };
    }),
    // M8 quest Wave C — today's daily roster, precomputed display-ready: each
    // slot's `type`/`target`/`reward` resolved once from the `dailyDef`
    // catalog (same "engine reads only happen in buildSnapshot" rule).
    dailies: ((): DailyBoardSummary => {
      const hd = state.heroes[0]?.dailies;
      if (!hd) return { serverDay: 0, quests: [] };
      return {
        serverDay: hd.serverDay,
        quests: hd.quests.map((dq): DailyQuestSummary => {
          const def = dailyDef(dq.id);
          return {
            id: dq.id,
            type: def?.type ?? "killAnywhere",
            progress: dq.progress,
            target: def?.target ?? 0,
            claimed: dq.claimed,
            complete: def !== null && dq.progress >= def.target,
            reward: def?.reward ?? {},
          };
        }),
      };
    })(),
    // ดินแดนอสูร (ASURA) endgame v1 accrual — plain throttled reads, same one-way
    // "engine carries it, store just reflects it" pattern as `materials`.
    asuraEssence: state.asuraEssence,
    asuraZoneKills: { ...state.asuraZoneKills },
    asuraHotZoneIdx: state.asuraHotZone,
    // "ตำราตำนาน" secret tome + legendary craft (endgame v1.3) — pure engine reads,
    // same one-way "engine computes, store just carries it" pattern as `asuraEssence`.
    tomePagesFound: tomePagesFound(state),
    tomeUnlocked: state.tomeUnlocked,
    asuraSigils: state.asuraSigils,
    hasAllZoneStones: hasAllZoneStones(state),
    canCraftLegendary: canCraftLegendary(state),
    craftBlockReason: craftBlockReason(state),
  };
}

/**
 * M7.5→M7.9 auto-dispose executor — runs off a `townArrived` event (reason
 * "sell" / "restockSell"): computes the sell list from the CURRENT inventory
 * slice + persisted rules in ONE sweep (`selectAutoSellIds`), then reuses the
 * same POST-first flow the manual `InventoryPanel` sell button uses
 * (`executeSell`). Fire-and-forget: a dropped/failed run simply leaves the
 * inventory full, so the NEXT trip (or a manual dispose) retries it — never a
 * stuck state. Owner request 2026-07-08 (หินเสริมพลัง final wave): salvage is
 * RETIRED (refine stones now drop directly from mobs instead) — sell-only.
 */
/**
 * M7.5 auto-equip executor (owner request 2026-07-06) — keeps the hero in its
 * best gear without babysitting. Same POST-first flow as the manual equip
 * buttons; one run in flight at a time (each pick is a server round trip).
 * Runs off: boot hydration, merged drop claims, and town arrivals (BEFORE the
 * auto-sell sweep, so the keep-guard baseline reflects the new gear and
 * yesterday's pieces become sellable in the same trip).
 */
let autoEquipInFlight = false;
async function performAutoEquip(): Promise<void> {
  if (autoEquipInFlight) return;
  const store = useGameStore.getState();
  // Bot MASTER switch gate (owner UX consolidation, 2026-07-07): `autoHunt`
  // doubles as the master's on/off value — see `gameStore.ts`'s
  // `toggleBotMaster` doc. OFF must mean zero auto-equip too.
  if (!store.autoHunt || !store.autoEquip) return;
  const picks = selectAutoEquip(store.inventory, ITEM_TEMPLATES, store.heroes[0]?.cls);
  if (picks.length === 0) return;
  autoEquipInFlight = true;
  try {
    let equippedCount = 0;
    for (const pick of picks) {
      const res = await postEquip(pick.instanceId);
      const st = useGameStore.getState();
      if (!res.ok) break; // server said no (stale local view) — stop, next run resyncs
      st.setInventory(applyEquipChange(st.inventory, pick.instanceId, pick.slot));
      st.queueEquip(pick.slot, pick.templateId);
      equippedCount++;
    }
    if (equippedCount > 0) {
      useGameStore.getState().pushNotice("autoEquipDone", { count: equippedCount });
    }
  } finally {
    autoEquipInFlight = false;
  }
}

async function performAutoSell(suppressNothingNotice = false): Promise<void> {
  const store = useGameStore.getState();
  // Bot MASTER switch gate (owner UX consolidation, 2026-07-07): belt-and-
  // suspenders — the engine's own bot sub-flags are already force-disabled
  // while the master is off (see `toggleBotMaster`'s doc), so this event
  // should never fire in that state, but never auto-dispose regardless.
  if (!store.autoHunt) return;
  // Owner request 2026-07-08 (หินเสริมพลัง final wave): salvage is RETIRED —
  // the bot is sell-only now (refine stones drop directly from mobs instead).
  const sellIds = selectAutoSellIds(
    store.inventory,
    ITEM_TEMPLATES,
    {
      common: store.autoSellCommon,
      rare: store.autoSellRare,
      epic: store.autoSellEpic,
      keepBetterStat: store.autoSellKeepBetterStat,
    },
    store.heroes[0]?.cls, // scope the empty-slot best-backup pick to wearable gear
  );
  if (sellIds.length === 0) {
    // Rules matched nothing. On a GENUINE full-bag sell trip the engine latches its
    // sell-trip watermark and stops tripping, so tell the player WHY the bot gave up
    // (fix = loosen the rules in Settings or sell manually). On an OPPORTUNISTIC
    // sweep (a potions trip that also tidies the bag) a nothing-to-do result is
    // normal, not a stuck bot — stay silent (`suppressNothingNotice`).
    if (!suppressNothingNotice) store.pushNotice("autoSellNothing");
    return;
  }
  const sellResult = await executeSell(sellIds);
  if (sellResult.ok && sellResult.soldCount > 0) {
    useGameStore.getState().pushNotice("autoSellDone", {
      count: sellResult.soldCount,
      gold: sellResult.totalGold.toLocaleString(),
    });
  } else if (!sellResult.ok) {
    // POST/network failure — the bag stays full, so the engine re-trips the warp
    // and this retries next trip. Log it: a SILENT failure here is exactly what
    // makes the "warps but sells nothing" report undiagnosable in the field.
    console.warn("[GameClient] auto-sell POST failed; bag stays full, will retry", {
      requested: sellIds.length,
    });
  }
}

/** World boss "เสี่ยจ๋อง" claim: at most one attempt in flight; a genuinely stale/
 * network-failed attempt is remembered here so the next autosave tick retries it
 * (same "small holder, retried on the next cadence" shape as the drop-claim
 * buffer, just for a single one-shot claim rather than a batch). */
let worldBossClaimInFlight = false;
let pendingWorldBossClaim: { windowId: number } | null = null;

/**
 * Claim the world-boss reward for `windowId` (fires off a `worldBossDefeated`
 * frame event — see `frame()`'s event loop below). POST-first, same "never
 * mutate local state before the server confirms" rule as sell/refine:
 *  - `res === null` (network/parse failure) → re-queue for the next autosave
 *    tick via `pendingWorldBossClaim` (also the path taken when `myCharacterId`
 *    hasn't resolved yet — a boot-race edge case, resolves within one tick).
 *  - `res.ok === false` (403 not_owned / 409 stale_window / 409 already_claimed)
 *    → terminal, silent — a genuinely stale/foreign claim will never succeed on
 *    retry (see the route's doc).
 *  - `res.ok === true` → credit gold via the SAME `goldCredit` intent sell/
 *    refine use, credit the known fixed materials reward, merge the minted
 *    fortifier into the inventory slice (its OWN drop-feed toast resolves the
 *    item's translated name — no cross-namespace lookup needed here), and push
 *    a gold+stones+ITEM notice (`resolveItemName` — module-scope, so it can't
 *    reach a React `useTranslations` hook directly; the caller passes
 *    `tContentItemsRef.current` through, same reasoning `titleLabel`'s
 *    `tHofRef` plumbing already established for this file).
 * IN A COHORT every member calls this independently for their OWN character —
 * the shared sim's `worldBossDefeated` event fires identically on every
 * client, and each one claims into its own save row (by design).
 *
 * Returns a settle outcome (FIX 2, 2026-07-09 live round) so callers can latch
 * `wbClaimedWindow` — `"pending"` means "try again later" (network failure or the
 * characterId boot-race), `"ok"`/`"rejected"` are both TERMINAL for this window
 * (a confirmed grant, or a definitive 403/409 that will never succeed on retry).
 */
async function attemptWorldBossClaim(
  windowId: number,
  resolveItemName: (templateId: string) => string,
): Promise<"ok" | "rejected" | "pending"> {
  if (worldBossClaimInFlight) {
    pendingWorldBossClaim = { windowId };
    return "pending";
  }
  const characterId = useGameStore.getState().myCharacterId;
  if (!characterId) {
    pendingWorldBossClaim = { windowId };
    return "pending";
  }
  worldBossClaimInFlight = true;
  try {
    const res = await postWorldBossClaim(characterId, windowId);
    if (res === null) {
      pendingWorldBossClaim = { windowId }; // network failure — retry next autosave tick
      return "pending";
    }
    if (!res.ok) return "rejected"; // terminal rejection — silent, no retry
    const store = useGameStore.getState();
    store.creditGold(res.goldCredit);
    store.creditMaterials(WORLD_BOSS_REWARD_MATERIALS);
    store.mergeInventory([res.item]);
    store.pushDropFeed(res.item.templateId, lookupTemplate(res.item.templateId)?.rarity ?? "epic");
    store.pushNotice("worldBossClaimed", {
      gold: res.goldCredit.toLocaleString(),
      stones: WORLD_BOSS_REWARD_MATERIALS,
      item: resolveItemName(res.item.templateId),
    });
    return "ok";
  } finally {
    worldBossClaimInFlight = false;
  }
}

export function GameClient() {
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const t = useTranslations("common");
  // Captured in a ref (not read directly inside the mount-only effect below)
  // so a mid-session locale switch (`router.refresh()` — no remount, see
  // `LocaleSwitch.tsx`) still updates the string this rare fatal-error path
  // would show, without re-running the boot/rAF-loop effect itself.
  const tRef = useRef(t);
  tRef.current = t;

  // Town NPCs phase 3 (final): rotating greeting/flavor lines for the
  // tap-to-talk speech bubble + the bot's npcTrade flavor bubble. Same
  // ref-captured pattern as `tRef` above (a mid-session locale switch must
  // still pick up the right language without re-running the boot effect).
  const tTownNpc = useTranslations("townNpc");
  const tTownNpcRef = useRef(tTownNpc);
  tTownNpcRef.current = tTownNpc;

  // M8 quest Wave C: the reward-toast/daily-complete notice copy — same
  // ref-captured pattern as `tTownNpcRef` (mid-session locale switch safety).
  const tNotices = useTranslations("notices");
  const tNoticesRef = useRef(tNotices);
  tNoticesRef.current = tNotices;

  // HOF seasonal rewards (owner-approved docs/hof-rewards-design.md): the
  // translator `titleLabel` needs to localize a title id BEFORE it reaches the
  // `setHeroSocialBadges`/`setTownChampions` render seams (both want an
  // already-localized string) — same ref-captured pattern as `tNoticesRef`.
  const tHof = useTranslations("hof");
  const tHofRef = useRef(tHof);
  tHofRef.current = tHof;

  // World-boss "เสี่ยจ๋อง" claim toast: names WHICH fortifier landed (see
  // `attemptWorldBossClaim`'s doc) — same ref-captured pattern as `tHofRef`.
  const tContentItems = useTranslations("content.items");
  const tContentItemsRef = useRef(tContentItems);
  tContentItemsRef.current = tContentItems;

  // DEV-ONLY diagnostics: prove hydration actually happened. Fires once on
  // mount; if the inline boot-ping (src/app/layout.tsx) shows up in the dev
  // log but this never does, React never hydrated even though scripts ran.
  // Safe to delete alongside src/app/api/client-log once done debugging.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    void fetch("/api/client-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "hydrated",
        url: window.location.href,
        time: new Date().toISOString(),
      }),
      keepalive: true,
    }).catch(() => {
      /* dev diagnostics only — never let this affect the real app */
    });
  }, []);

  // DEV-ONLY diagnostics: on-device console (eruda) so we can inspect a
  // phone's console/network/DOM without plugging in remote devtools. Dynamic
  // import behind the dev check keeps it out of the production bundle. Safe
  // to delete once done debugging.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    import("eruda")
      .then((m) => m.default.init())
      .catch(() => {
        /* dev diagnostics only */
      });
  }, []);

  useEffect(() => {
    const arenaEl = arenaRef.current;
    if (!arenaEl) return;

    const seed = Date.now() >>> 0;
    // Starts cold; if a save loads, `state` is re-initialised from it before the
    // loop begins (below). Keeping it always-defined avoids use-before-assign.
    let state = initGameState(seed);
    const renderer = new GameRenderer();
    const audio = new AudioController();
    const acc = createAccumulator();
    const timeDirector = new TimeDirector();

    // ---- M8 party P4b: lockstep cohort (dormant unless the store's `party` is set
    // AND I share a zone with >=1 live member — see partySession.ts/partyHandshake.ts
    // module docs for the full design). Solo (no party, or alone in my zone) never
    // touches ANY of this beyond one cheap `cohortActive` boolean check per frame —
    // the solo path stays byte-identical. ----
    let cohortActive = false;
    /** My party TICKET slot (0..2, from the relay ticket) — used for handshake/
     * leader-election/shadow bookkeeping, which all operate over ticket slots. */
    let myTicketSlot = 0;
    /** My INDEX into the cohort's `state.heroes[]` (== `lanes[]`) — the ASCENDING
     * position of `myTicketSlot` within `lastCohortSlots`. Distinct from the ticket
     * slot whenever the cohort's lowest member isn't ticket-slot 0 (e.g. cohort
     * [1,2] ⇒ ticket-slot 1 is array index 0). This is what the engine's per-hero
     * `TurnMessage.slot` routing actually needs. */
    let myCohortIndex = 0;
    /** The LIVE cohort slot list the current handshake/active cohort is built over —
     * shadowed members are already filtered OUT (see `liveCohortSlots`). Every consumer
     * (`myCohortIndex` mapping, `cohortEngine` size, nameplate index) reads this. */
    let lastCohortSlots: number[] = [];
    /** The last RAW slot list `partySession.onCohortChanged` delivered (a shadowed member
     * still appears here — its beat lingers). `reconcileCohort()` re-derives the live list
     * from THIS + `shadowedTicketSlots`, so a shadow/unshadow can re-run the membership
     * decision without a fresh beat. */
    let lastRawCohortSlots: number[] = [];
    const shadowedTicketSlots = new Set<number>();
    /** ticket slot -> userId, for cohort members OTHER than me (from the relay welcome/
     * membership stream). The stable key we resolve friendly names against. */
    let cohortMemberIds = new Map<number, string>();
    /** ticket slot -> RESOLVED display name (never a userId — null resolutions omitted).
     * Rebuilt by `resolveCohortNames()` against the friends-poll `party` snapshot. */
    let cohortMemberNames = new Map<number, string>();
    let handshake: PartyHandshake | null = null;
    /** `performance.now()` when the in-flight handshake began — the frame loop's deadline
     * safety net (a formation that never converges, e.g. a peer that vanished without a
     * clean member-left, or a lost offer on a reload race) aborts + retries past this. */
    let handshakeStartedAt = 0;
    /** The current deadline window (ms). Starts short; backs off to `HANDSHAKE_RETRY_MS`
     * after a trip so repeated failures don't thrash. Reset to base on a successful
     * `activateCohort()`/`collapseToSolo()`. */
    let handshakeDeadlineMs = HANDSHAKE_DEADLINE_MS;
    /** Grace timer for the "connecting" chip (see `CONNECTING_CHIP_GRACE_MS`): a re-form
     * that resolves within the grace never flashes "connecting". `pushCohortStatus` is the
     * single funnel for every chip transition — it DEFERS a "connecting" push and cancels
     * that deferral the instant any terminal state (active/solo/waiting/reconnecting)
     * arrives, so a seamless re-join goes straight solo/active -> active with no flicker. */
    let connectingChipTimer: ReturnType<typeof setTimeout> | null = null;
    function pushCohortStatus(status: CohortStatusState): void {
      if (status.kind === "connecting") {
        if (connectingChipTimer) return; // a grace is already pending — don't restart it
        connectingChipTimer = setTimeout(() => {
          connectingChipTimer = null;
          useGameStore.getState().setCohortStatus({ kind: "connecting" });
        }, CONNECTING_CHIP_GRACE_MS);
        return;
      }
      if (connectingChipTimer) {
        clearTimeout(connectingChipTimer);
        connectingChipTimer = null;
      }
      useGameStore.getState().setCohortStatus(status);
    }
    /** ECONOMY-INTEGRITY (cohortWallet.ts): my personal wallet AT THE MOMENT I joined
     * this cohort (my pre-cohort solo wallet, or the settled value from the prior cohort
     * on a re-seed) + the shared pot at that same moment. `virtualWallet(base, sharedBase,
     * <pot now>, size)` reconstructs my personal share of the shared pot's drift WITHOUT
     * ever writing into the live cohort `state` (that would desync the sim) — it only
     * shapes save payloads, the HUD snapshot, and the post-collapse solo state. Both null
     * while solo. */
    let cohortWalletBase: WalletSlice | null = null;
    let cohortSharedBase: WalletSlice | null = null;
    /** PROGRESSION-INTEGRITY (cohortProgress.ts): my OWN world-progression fields, FROZEN
     * at the moment I joined this cohort (or, on a re-seed of an already-active cohort,
     * unchanged — it never drifts while active, see `activateCohort`'s doc). Unlike the
     * wallet's divisible drift-split, there's no principled per-member share of shared
     * world-unlock progress, so this is substituted verbatim into every SAVE payload while
     * active (`serialize()`) and restored verbatim on `collapseToSolo()` — the fix for the
     * "partying with a deep player permanently unlocked my zones" live bug. Null while solo. */
    let cohortProgressBase: ProgressSlice | null = null;
    /** PROGRESSION-INTEGRITY, owner bug batch B + 2026-07-09 asura per-member accounting: the
     * SHARED cohort pot's progression baseline (`zoneKills` + asura essence/zone-kills/tome
     * pages) at the moment I joined (or re-seeded) — what `settleProgressSlice` measures the
     * pot's delta against, so I get FULL credit for kills / my mean-field share of essence
     * without double-counting across re-seeds (mirrors `cohortSharedBase`'s role for the
     * wallet). Null while solo. */
    let cohortSettleBase: SharedProgress | null = null;
    /** 2026-07-09 asura per-member accounting: MY own count of successful daily z10 sigil
     * claims made WHILE in this cohort. The `claimAsuraSigil` engine intent is lane-0-only
     * (a member's would be dead) so it's STRIPPED in a cohort; the claim is server-ledgered
     * (once/day/character) and this counter — incremented only when the POST-gated intent is
     * drained — feeds `settleProgressSlice` so my own settled sigils reflect my own claims.
     * Reset on activate (folded into the re-based slice) / collapse. */
    let cohortSigilClaims = 0;
    /** FIX 4 (2026-07-09): my last-seen DERIVED per-member unlocked-zone counts (see
     * `deriveUnlockedZones`), to fire a one-shot "new zone unlocked!" notice when a zone
     * flips unlocked for ME mid-cohort (the engine's `zoneUnlocked` event never fires in the
     * shared state a deep friend already unlocked). Null while solo / until first derived. */
    let cohortPrevDerivedUnlocked: Record<string, number> | null = null;
    /** Owner bug batch A #2: my CLIENT-LOCAL bot-master toggle wish latch (see
     * `nextAutoHuntWish`). Holds a pressed `autoHunt` value until my hero's replicated
     * config confirms it; `null` = no pending wish. Cleared on activate/collapse. */
    let cohortAutoHuntWish: boolean | null = null;
    /** 2026-07-09 "ตั้งค่าบอทเป็นของใครของมัน": my CLIENT-LOCAL bot-SETTINGS wish latch (see
     * `nextBotSettingsWish`). Holds each pressed BotSettings field until my hero's replicated
     * config confirms it; `null` = no pending wish. Cleared on activate/collapse. */
    let cohortBotSettingsWish: Partial<BotSettings> | null = null;
    /** The cohort's lockstep turn scheduler while active (issue/execute cadence, buffer,
     * catch-up, stall/waiting) — see `cohortTurnEngine.ts`. `null` while solo. */
    let cohortEngine: CohortTurnEngine | null = null;
    /** Last-seen `waiting` value from the engine, to detect chip transitions per frame. */
    let cohortPrevWaiting = false;
    let lastZoneKey: string | null = null;

    // ── FIX 5 hidden-tab lane-keepalive state (see the constants block up top) ──
    /** True while this tab is hidden AND in lane-keepalive (issuing but not executing).
     * Set in `onVisibility(hidden)`; cleared on resume / true-close / collapse. */
    let hiddenKeepaliveActive = false;
    /** The 1s fallback issue-driver interval while hidden (undefined when not hidden). */
    let keepaliveInterval: ReturnType<typeof setInterval> | undefined;
    /** `performance.now()` of the last keepalive issue (message- OR interval-driven), so the
     * shared issue accumulator advances by the true wall-clock delta between drivers. */
    let keepaliveLastIssueAt = 0;
    /** `Date.now()` when lane-keepalive engaged (for the `HIDDEN_KEEPALIVE_MAX_MS` cap). */
    let hiddenKeepaliveStartedAt = 0;
    /** True while resume is bursting the buffered backlog to catch the execute cursor up to
     * the issue cursor (see `CohortTurnEngine.burstExecute`). Cleared once caught up. */
    let cohortCatchUp = false;
    /** Last relay connection status reported by `onPartyStatusChange` — read on resume to
     * decide burst-catch-up vs. the legacy re-handshake fallback. */
    let partyConnStatus: PartyConnStatus = "off";

    // ---- Wave 3 "signal chip" network HUD (docs/ghost-presence-design.md) ----
    /** EMA-smoothed RTT to the relay over the PARTY socket (`partySession.ping`'s pong
     * echo), or `null` before the first sample. Survives cohort collapse/reform (still
     * meaningful once reconnected — a fresh EMA seed on the next pong reads fine either
     * way, so this is deliberately never reset). */
    let cohortRttMs: number | null = null;
    let cohortPingAccumMs = 0;
    let cohortNetAccumMs = 0;

    // ---- HOF seasonal rewards (owner-approved docs/hof-rewards-design.md) ----
    /** At most one `/api/hof/rewards` fetch in flight — refreshed on every town
     * arrival (cheap read; also the lazy-finalize trigger, see `refreshHofOnTownArrival`'s
     * doc). No queued retry (unlike the world-boss claim): a dropped refresh just
     * gets picked up on the NEXT town trip. */
    let hofFetchInFlight = false;

    // ---- World boss "เสี่ยจ๋อง" schedule (server-clock aligned; see `serverNowMs`'s
    // doc) ----
    /** `serverNow - Date.now()` at boot (from the `/api/save` GET response's
     * `serverNow` field) — the device clock is never trusted for the world-boss
     * schedule math (`worldBossPhaseAt` reads a wall clock, unlike the rest of the
     * pure engine). `0` (device clock, unadjusted) until boot's fetch resolves —
     * a harmless few-second skew for the brief window before that. */
    let serverTimeOffset = 0;
    function serverNowMs(): number {
      return Date.now() + serverTimeOffset;
    }
    /** Last status PUSHED to the store — gates `setWorldBossStatus` to actual
     * transitions only (see `sameWorldBossStatus`'s doc: comparing `secondsLeft`
     * too gives the countdown its ~1Hz cadence for free). */
    let lastWorldBossStatus: WorldBossStatus = { kind: "idle" };

    // ---- World boss SHARED-HP client driver (M8.6) ----
    // `/api/worldboss/state` GET seeds a fresh spawn/re-entry at the REAL server hp instead
    // of full (see `spawnWorldBoss{hp}`'s doc); the periodic damage report + its dedup rule
    // (only the cohort AUTHORITY posts the full delta, everyone else pings once then polls)
    // lives in `ui/worldBoss/schedule.ts`'s doc comment — this is just the stateful
    // bookkeeping GameClient owns, same tier as `lastWorldBossStatus` above.
    /** The window whose hp seed I've already fetched-or-attempted (fetched once per window,
     * regardless of outcome — a failed fetch just leaves the spawn seedless, same as before
     * this driver existed). `null` = no window seeded yet. */
    let wbSeedAttemptedWindow: number | null = null;
    /** Resolved hp for `wbSeedAttemptedWindow`, once the GET resolves — undefined while
     * in flight/failed (the spawn intent's `hp` stays unset, engine falls back to full). */
    let wbSeedHp: number | undefined;
    /** The window my damage-report/ping bookkeeping below is scoped to; resets (with
     * `wbReportedDamage`/`wbPingedWindow`) whenever the live `worldBossDamageDealt` window
     * changes OR goes dormant (fight ended / collapsed to solo mid-fight — a fresh solo
     * rebuild never carries `state.worldBoss` over, see `partyHandshake.ts`, so the next
     * real spawn always starts this bookkeeping clean). */
    let wbReportWindow: number | null = null;
    /** AUTHORITY watermark: damage already CONFIRMED posted for `wbReportWindow` (only
     * advanced on a successful POST response — a failed post retries the same delta, now
     * possibly larger, on the next cadence tick). */
    let wbReportedDamage = 0;
    /** Non-authority latch: the window my one-shot participation ping already fired for
     * (set BEFORE the request resolves so a slow response can't double-fire). */
    let wbPingedWindow: number | null = null;
    let wbNetworkInFlight = false;
    let wbLastReportAt = 0;
    /** FIX 2 (2026-07-09 live round) — the all-clients defeat poll's own bookkeeping,
     * distinct from the in-zone report/poll bookkeeping above (that branch already
     * learns `defeated` for free via `state.worldBoss.defeated` the instant the local
     * sim's shared hp hits 0, so this poll only needs to run for clients NOT currently
     * engaged — see the per-frame block below). `wbDefeatedWindowId` latches the first
     * window confirmed dead by EITHER source; `wbDefeatPollAt` gates the GET cadence. */
    let wbDefeatedWindowId: number | null = null;
    let wbDefeatPollAt = 0;
    /** Window-scoped "did I deal damage this window" latch — unlike `wbReportWindow`
     * (which resets the instant `worldBossDamageDealt` goes null, e.g. I leave the
     * zone or the fight ends locally), this one SURVIVES that reset so a player who
     * tapped the boss and then walked away still shows the "defeated, collecting your
     * reward" banner + auto-claims once the SHARED pool dies elsewhere. */
    let wbParticipatedWindow: number | null = null;
    /** Window-scoped "my claim for this window is settled" latch — set once
     * `attemptWorldBossClaim` resolves to either a confirmed grant or a TERMINAL
     * rejection (already_claimed/not_owned/stale_window); a network-failure retry
     * (`"pending"`) leaves it unset so the auto-claim path below tries again. */
    let wbClaimedWindow: number | null = null;
    /** ดินแดนอสูร daily hot zone: the last Bangkok day-key QUEUED via
     * `setAsuraHotZone` — re-queued only when it changes (idempotent, same
     * shape as `lastWorldBossStatus`'s "only push on transition" idiom). */
    let lastAsuraDayKeyQueued: number | null = null;

    /** FIX 2 (2026-07-09 live round) — thin wrapper over `attemptWorldBossClaim` that
     * latches `wbClaimedWindow` on a TERMINAL outcome (`"ok"`/`"rejected"`), leaving it
     * unset on `"pending"` so the retry cadence / next auto-claim frame tries again.
     * Every call site (the `worldBossDefeated` event, the pending-retry autosave tick,
     * and the new defeat-poll auto-claim below) routes through this so the latch is
     * never forgotten. */
    function settleWorldBossClaim(windowId: number): void {
      void attemptWorldBossClaim(windowId, (id) => tContentItemsRef.current(`${id}.name`)).then(
        (outcome) => {
          if (outcome !== "pending") wbClaimedWindow = windowId;
        },
      );
    }

    /** Rebuild the `heroId -> displayName` map `GameRenderer.setHeroDisplayNames`
     * wants (keyed by hero id, not slot/index — see its doc). `null` while solo. */
    function currentHeroDisplayNames(): ReadonlyMap<number, string> | null {
      if (!cohortActive) return null;
      const names = new Map<number, string>();
      for (const [ticketSlot, name] of cohortMemberNames) {
        const idx = lastCohortSlots.indexOf(ticketSlot);
        const hero = idx >= 0 ? state.heroes[idx] : undefined;
        if (hero) names.set(hero.id, name);
      }
      return names;
    }

    function refreshCohortStatus(): void {
      if (!cohortActive) return;
      pushCohortStatus({ kind: "active", names: [...cohortMemberNames.values()] });
      renderer.setHeroDisplayNames(currentHeroDisplayNames());
      pushHeroSocialBadges();
    }

    /** HOF seasonal rewards (owner-approved docs/hof-rewards-design.md) — the
     * `heroId -> {title, champion}` map `GameRenderer.setHeroSocialBadges` wants
     * (nameplate aura + chosen-title seam, mirrors `currentHeroDisplayNames`'
     * shape/doc). Solo: just my own `mySocialBadge` (kept fresh by
     * `refreshHofOnTownArrival`) on hero 0. Cohort: delegates to the pure,
     * headlessly-tested `buildCohortSocialBadges` (`cohortBadges.ts`) — MY OWN
     * badge is always `mySocialBadge` keyed onto `heroes[myCohortIndex]` (never
     * fished out of the party rows by elimination — see that module's doc for
     * the live bug this replaced: an elimination heuristic silently
     * mis-assigned/blanked titles the moment the party held any member outside
     * the CURRENT same-zone cohort), peers resolved via `cohortMemberIds`'s
     * ticket slot -> `lastCohortSlots`, the exact same keying
     * `currentHeroDisplayNames` uses. */
    function currentHeroSocialBadges(): Map<string, { title: string | null; champion: boolean }> {
      const mine = useGameStore.getState().mySocialBadge;
      if (!cohortActive) {
        const badges = new Map<string, { title: string | null; champion: boolean }>();
        const hero = state.heroes[0];
        if (mine && hero) badges.set(String(hero.id), mine);
        return badges;
      }
      const party = useGameStore.getState().party;
      return buildCohortSocialBadges(
        state.heroes,
        myCohortIndex,
        mine,
        cohortMemberIds,
        lastCohortSlots,
        party?.members ?? [],
        (titleId) => titleLabel(titleId, tHofRef.current),
      );
    }

    function pushHeroSocialBadges(): void {
      renderer.setHeroSocialBadges(currentHeroSocialBadges());
    }

    /** HOF seasonal rewards: refresh the town honor board + MY OWN solo aura off
     * `GET /api/hof/rewards` on every town arrival (`townArrived` frame event
     * below) — cheap read, and the request is ALSO the server's lazy-finalize
     * trigger for a just-ended month (see `src/server/hofSeason.ts`'s doc), so
     * riding it here means a season closes the moment any player walks into
     * town after the cutoff. Fire-and-forget; a dropped refresh is silently
     * retried on the NEXT town trip (no queued retry, unlike the world-boss
     * claim — nothing here is a one-shot entitlement). */
    function refreshHofOnTownArrival(): void {
      if (hofFetchInFlight) return;
      hofFetchInFlight = true;
      const characterId = useGameStore.getState().myCharacterId;
      void fetchHofRewards(characterId).then((res) => {
        hofFetchInFlight = false;
        if (res.kind !== "ok") return;
        const data = res.data;

        const entries: { board: string; name: string; title: string }[] = [];
        for (const board of HOF_REWARD_BOARDS) {
          const top = data.champions[board][0];
          if (!top) continue;
          const label = titleLabel(top.titleId, tHofRef.current);
          if (label) entries.push({ board, name: top.charName, title: label });
        }
        renderer.setTownChampions(entries);

        const champion = data.me?.titles.some((mt) => mt.rank === 1 && mt.board !== "online") ?? false;
        const title = data.me ? titleLabel(data.me.displayTitle, tHofRef.current) : null;
        useGameStore.getState().setMySocialBadge({ title, champion });
        pushHeroSocialBadges();
      });
    }

    /** Rebuild `cohortMemberNames` (ticket slot -> friendly name) by resolving each
     * peer's stable `userId` against the CURRENT friends-poll `party` snapshot. A slot
     * whose name isn't known yet is OMITTED (never falls back to the cuid) — a late poll
     * fills it in and `refreshCohortStatus()` re-pushes it to the chip/nameplates. */
    function resolveCohortNames(): void {
      const party = useGameStore.getState().party;
      const next = new Map<number, string>();
      for (const [slot, userId] of cohortMemberIds) {
        const name = resolveMemberDisplayName(userId, party);
        if (name) next.set(slot, name);
      }
      cohortMemberNames = next;
    }

    /** My personal wallet reconstructed from the live shared cohort pot (cohortWallet.ts),
     * or null while solo / before the bases are set. Divisor = `state.heroes.length` (the
     * cohort headcount by construction — race-free vs. the `lastCohortSlots` bookkeeping,
     * which is updated at different points in the membership-change flow). NEVER writes to
     * `state`. */
    function myVirtualWallet(): WalletSlice | null {
      if (!cohortActive || !cohortWalletBase || !cohortSharedBase) return null;
      return virtualWallet(
        cohortWalletBase,
        cohortSharedBase,
        walletSliceFrom(state),
        Math.max(1, state.heroes.length),
      );
    }

    /** My personal, FULL-CREDIT zone-unlock progress reconstructed from the live shared
     * cohort pot (cohortProgress.ts, owner bug batch B) — my frozen base + the pot's
     * kill-delta since I joined. Null while solo / before the bases are set. NEVER writes to
     * `state`. Reads the live current-zone counter (`liveZoneKills`) so a kill made THIS
     * frame is credited immediately (both to the HUD gauge and to any save that lands). */
    function settledProgress(): ProgressSlice | null {
      if (!cohortActive || !cohortProgressBase || !cohortSettleBase) return null;
      return settleProgressSlice(
        cohortProgressBase,
        cohortSettleBase,
        sharedProgressFrom(state),
        Math.max(1, state.heroes.length),
        cohortSigilClaims,
      );
    }

    /** Cohort -> solo (design C): extract MY hero, rebuild solo via the exact same
     * `buildCohortState` primitive (`extractSoloState`), resume the ordinary solo
     * accumulator loop next frame. */
    function collapseToSolo(): void {
      if (!cohortActive) return;
      // ECONOMY-INTEGRITY: settle my personal wallet from the cohort pot BEFORE the
      // extract (which rebuilds solo from the SHARED slice — it would otherwise adopt the
      // authority-seeded pot). Overwrite the rebuilt solo wallet with my settled share so
      // leaving a party keeps my own gold/materials/potions, not the shared pot's.
      const settled = myVirtualWallet();
      // PROGRESSION-INTEGRITY (owner bug batch B): settle my FULL-CREDIT zone-unlock
      // progress from the live shared pot BEFORE the extract rebuilds `state` off the shared
      // slice — kills I made inside the cohort accrue to my own `zoneKills`, so leaving the
      // party keeps them (and the accumulated count unlocks the zone once I'm solo).
      const settledProg = settledProgress();
      // Bot settings are PER HERO now (2026-07-09): capture MY hero's own bot config BEFORE
      // the extract (which rebuilds `state.bot` from the SHARED slice) so the post-collapse
      // solo state keeps MY settings, not the authority's shared `state.bot`.
      const myBot = botSettingsFrom(state.heroes[myCohortIndex]?.config, state.bot);
      state = extractSoloState(state, myCohortIndex, seed);
      // Overwrite the rebuilt solo `state.bot` with my own — the next step's
      // `syncPrimaryHeroConfig` then mirrors it onto heroes[0].config (so the solo bot behaves
      // exactly as my in-cohort settings dictated).
      state.bot = myBot;
      if (settled) {
        state.gold = settled.gold;
        state.goldEarned = settled.goldEarned;
        state.materials = settled.materials;
        state.consumables = { ...state.consumables, ...settled.consumables };
      }
      // PROGRESSION-INTEGRITY: `extractSoloState` rebuilds `location`/`unlockedZones`/
      // `stage`/`zoneKills`/`lastFarmZone`/`bossBest`/`levelCapAt` from the cohort's SHARED
      // slice (`sharedSaveFromState`) — restore my SETTLED snapshot over it instead (my
      // frozen base + full credit for kills made in the cohort, batch B), so leaving a party
      // never adopts a deep friend's world unlocks (or, for the asura/tome fields — not part
      // of the shared slice at all — resets them from the fresh rebuild's zeroed defaults
      // back to what I actually had). Safe to mutate here: this `state` is the freshly-built
      // SOLO state, no longer shared with any other client.
      if (settledProg) applyProgressSlice(state, settledProg);
      cohortWalletBase = null;
      cohortSharedBase = null;
      cohortProgressBase = null;
      cohortSettleBase = null;
      cohortSigilClaims = 0;
      cohortPrevDerivedUnlocked = null;
      cohortAutoHuntWish = null;
      cohortBotSettingsWish = null;
      cohortActive = false;
      cohortCatchUp = false; // FIX 5: a collapse mid-burst exits catch-up mode
      handshake?.abort();
      handshake = null;
      handshakeDeadlineMs = HANDSHAKE_DEADLINE_MS;
      cohortEngine = null;
      cohortPrevWaiting = false;
      cohortMemberNames = new Map();
      renderer.setHeroDisplayNames(null);
      renderer.setPovHeroIndex(0);
      pushCohortStatus({ kind: "solo" });
      // Wave 3 network HUD: clear the popover's stale member rows immediately (the chip
      // itself is already hidden by "solo" above — this just keeps `cohortNet` honest for
      // the instant something reads it before the next push). RTT survives (still
      // meaningful — the party socket itself may still be connected).
      cohortNetAccumMs = 0;
      useGameStore.getState().setCohortNet({ rttMs: cohortRttMs, waitingOnSlot: null, perMember: [] });
      pushHeroSocialBadges(); // switch the nameplate/aura seam back to my solo badge
    }

    /** Begin (or restart) the zone-boundary re-seed handshake for a fresh cohort
     * membership (design §4). */
    function beginHandshake(cohortSlots: number[]): void {
      handshake?.abort();
      // The one honest use of the "connecting" chip: a same-zone cohort exists and
      // the re-seed handshake is actually in flight (relay-connected states without
      // a cohort show nothing — see `onPartyStatusChange`). Deferred by
      // `pushCohortStatus` so a re-form that converges within the grace never flashes it.
      pushCohortStatus({ kind: "connecting" });
      myTicketSlot = partySession.slot;
      // Pre-handshake, "my own hero" is `heroes[0]` while solo, or `heroes[myCohortIndex]`
      // if this is a re-seed of an ALREADY-active cohort (e.g. a 3rd member joins).
      const myHero = cohortActive ? state.heroes[myCohortIndex] : state.heroes[0];
      const myProgression = progressionFromHero(myHero);
      handshake = new PartyHandshake({
        mySlot: myTicketSlot,
        cohortSlots,
        send: (msg) => partySession.send(msg),
        myProgression,
        mySharedSave: sharedSaveFromState(state),
        mintSeed: () => Date.now() >>> 0,
        // Owner bug batch A #1 ("position reset on cohort re-form"): attach my CURRENT x
        // ALWAYS. The unshadow/reconnect paths collapse to solo BEFORE re-handshaking, so
        // `cohortActive` is already false by the time we get here — the old
        // `cohortActive ? … : undefined` gate silently dropped x on exactly those paths,
        // re-spawning me at the anchor every trip. Sending my real x on a fresh
        // solo->cohort join is correct too (I'm standing somewhere in the zone already),
        // and old-format offers without x still anchor-default (ReseedOfferMsg.x optional).
        myX: myHero.x,
      });
      handshakeStartedAt = performance.now();
      handshake.start();
    }

    /** Apply a completed handshake (design §4's "every client builds the SAME
     * state"): swap the live `state` to the rebuilt cohort, reset the cohort turn
     * bookkeeping, and flip the HUD chip to "active". */
    function activateCohort(): void {
      if (!handshake || handshake.phase !== "done") return;
      const built = handshake.result;
      if (!built) return;
      // ECONOMY-INTEGRITY: my wallet base for the NEW cohort is my personal wallet right
      // now — either my pre-cohort solo wallet, or (on a re-seed of an ALREADY-active
      // cohort, e.g. a 3rd member joins) my SETTLED share of the old pot, so drift never
      // double-counts across re-seeds. `state.heroes.length` here is still the OLD cohort
      // size (state is overwritten below). Computed via `myVirtualWallet` which reads the
      // current bases + live state.
      const preWallet: WalletSlice = myVirtualWallet() ?? walletSliceFrom(state);
      // PROGRESSION-INTEGRITY (owner bug batch B): my progress base for the NEW cohort is my
      // SETTLED slice — on a re-seed of an already-active cohort that folds the OLD pot's
      // full kill-credit into my base FIRST (mirrors the wallet's `myVirtualWallet` re-base),
      // so re-seeds never double-count; on a fresh join from solo `settledProgress()` is null
      // and we snapshot my current world-progression fields as-is.
      const preProgress: ProgressSlice = settledProgress() ?? progressSliceFrom(state);
      state = built;
      cohortWalletBase = preWallet;
      cohortSharedBase = walletSliceFrom(built);
      cohortProgressBase = preProgress;
      // Baseline the pot's progression (zoneKills + asura essence/zone-kills/tome pages) for
      // THIS cohort (what `settleProgressSlice` measures the shared delta against) + clear the
      // bot-toggle wish latch and the per-member sigil/derived-unlock trackers for the fresh
      // cohort — on a re-seed the OLD cohort's sigil claims are already folded into
      // `preProgress.asuraSigils` (via `settledProgress()`), so resetting to 0 never
      // double-counts.
      cohortSettleBase = sharedProgressFrom(built);
      cohortSigilClaims = 0;
      cohortPrevDerivedUnlocked = null;
      cohortAutoHuntWish = null;
      cohortBotSettingsWish = null;
      cohortCatchUp = false; // FIX 5: a fresh re-handshake supersedes any in-flight burst
      handshake = null;
      handshakeDeadlineMs = HANDSHAKE_DEADLINE_MS; // converged — reset the backoff
      cohortActive = true;
      myCohortIndex = lastCohortSlots.indexOf(myTicketSlot);
      // Fix C: force the SHARED navigation globals OFF in a cohort — zone changes only ever
      // happen via item-3's leave-cohort path, never by an auto-return/auto-advance mutating
      // the shared location under everyone (that'd be the whole-party-drag class of bug). The
      // per-frame writes of these are gated to solo (see the frame loop), so once cleared here
      // they stay cleared for the cohort's lifetime. `autoHunt`/`bot` are per-hero config from
      // the handshake and stay as-is (in-zone bot behaviour is legit and per-owner).
      state.autoReturn = false;
      state.autoAdvance = false;
      cohortEngine = new CohortTurnEngine(lastCohortSlots.length, myCohortIndex, performance.now());
      // Seed the scheduler's shadowed set: a member can ALREADY be shadowed when this fresh
      // handshake completes (fix A.1) — translate each shadowed ticket slot to its cohort index.
      for (const ticketSlot of shadowedTicketSlots) {
        const idx = lastCohortSlots.indexOf(ticketSlot);
        if (idx >= 0) cohortEngine.setSlotShadowed(idx, true);
      }
      cohortPrevWaiting = false;
      renderer.setPovHeroIndex(myCohortIndex);
      refreshCohortStatus();
    }

    function onPartyStatusChange(status: PartyConnStatus): void {
      partyConnStatus = status;
      if (status === "reconnecting") {
        // Design C's abort path: a dropped/gapped relay connection breaks the ordered-
        // stream contract the WHOLE cohort rests on — discard any in-flight handshake
        // and collapse an active cohort back to solo (extract MY hero) rather than risk
        // silently drifting. `lastCohortSlots` resets so the NEXT `onCohortChanged`
        // (once reconnected + membership re-forms) always starts a FRESH handshake,
        // even if the resulting slot list happens to look identical to the old one.
        handshake?.abort();
        handshake = null;
        collapseToSolo(); // no-op if not active; sets cohortStatus to "solo"
        lastCohortSlots = [];
        lastRawCohortSlots = [];
        // A fresh (re)join re-derives membership + shadow state from the relay welcome/
        // event stream — stale shadow flags would wrongly exclude a now-live peer from the
        // next formation, so clear them and let fresh member-shadowed events re-populate.
        shadowedTicketSlots.clear();
        pushCohortStatus({ kind: "reconnecting" }); // overrides "solo" above
      } else if (status === "connecting" && !cohortActive) {
        pushCohortStatus({ kind: "connecting" });
      } else if (status === "connected" && !cohortActive) {
        // Connected to the relay but no same-zone cohort (yet) — the chip's "solo"
        // (hidden) state, per its design. Without this branch the "connecting" label
        // from the previous status sticks forever while alone in a zone, reading as
        // a stuck connection when the session is actually live and waiting.
        pushCohortStatus({ kind: "solo" });
      } else if (status === "off" && !cohortActive) {
        pushCohortStatus({ kind: "solo" });
      }
    }

    function sameSlots(a: readonly number[], b: readonly number[]): boolean {
      return a.length === b.length && a.every((v, i) => v === b[i]);
    }

    function onPartyCohortChanged(
      cohortSlots: number[],
      members: ReadonlyMap<number, CohortMember>,
    ): void {
      myTicketSlot = partySession.slot;
      lastRawCohortSlots = cohortSlots;
      // Record each peer's stable userId (NEVER surface it — `resolveCohortNames`
      // turns it into a friendly name against the friends-poll `party` snapshot).
      cohortMemberIds = new Map();
      for (const slot of cohortSlots) {
        if (slot === myTicketSlot) continue;
        const m = members.get(slot);
        if (m) cohortMemberIds.set(slot, m.userId);
      }
      resolveCohortNames();
      // FORMATION operates on the LIVE list: a shadowed member's beat lingers in the raw
      // list (only member-left removes it) but it never sends a reseed-ack — including it
      // would deadlock the handshake forever (the stuck "connecting" chip, D2).
      applyCohortMembership(liveCohortSlots(cohortSlots, shadowedTicketSlots));
    }

    /** The membership decision, factored out so `reconcileCohort()` can re-run it after a
     * shadow/unshadow WITHOUT waiting for a fresh beat. `live` is always the shadow-filtered
     * slot list. */
    function applyCohortMembership(live: number[]): void {
      if (live.length <= 1) {
        lastCohortSlots = live;
        // Discard an in-flight handshake explicitly: `collapseToSolo()` is a no-op
        // when the cohort never ACTIVATED, which would otherwise strand a stale
        // handshake (and its "connecting" chip) after the peer walked away mid-offer.
        handshake?.abort();
        handshake = null;
        collapseToSolo();
        pushCohortStatus({ kind: "solo" });
        return;
      }
      const changed = !sameSlots(live, lastCohortSlots);
      lastCohortSlots = live;
      if (changed) beginHandshake(live);
      else refreshCohortStatus(); // membership unchanged — names may have (nick, etc.)
    }

    /** Re-run the membership decision from the LAST RAW cohort list + the CURRENT shadow
     * set. Called when a shadow/unshadow (or the deadline net) changes which slots are live
     * without a new beat arriving — an in-flight handshake restarts with the reduced/grown
     * live list; ≤1 live ⇒ solo. */
    function reconcileCohort(): void {
      applyCohortMembership(liveCohortSlots(lastRawCohortSlots, shadowedTicketSlots));
    }

    function onPartyGameMessage(fromSlot: number, seq: number, payload: unknown): void {
      const rec = asRecord(payload);
      if (!rec) return;
      if (rec.kind === "reseed-offer") {
        if (!handshake) {
          // Belt-and-braces (reload race): a peer's offer reached me BEFORE my own
          // onCohortChanged (re)started a handshake. If my zone-derived LIVE cohort still
          // includes the sender (and me), form the handshake now; the ordered stream then
          // replays the rest of the exchange in order. Otherwise the offer is ignored.
          const live = liveCohortSlots(lastRawCohortSlots, shadowedTicketSlots);
          if (live.length > 1 && live.includes(fromSlot) && live.includes(partySession.slot)) {
            lastCohortSlots = []; // force reconcile to begin a fresh handshake
            reconcileCohort();
          }
        }
        if (handshake) {
          handshake.receiveOffer(fromSlot, payload as ReseedOfferMsg, seq);
          activateCohort();
        }
        return;
      }
      if (rec.kind === "reseed-ack" && handshake) {
        handshake.receiveAck(fromSlot, payload as ReseedAckMsg);
        activateCohort();
        return;
      }
      if (cohortActive && typeof rec.executeTurn === "number" && typeof rec.slot === "number") {
        cohortEngine?.deliver(payload as TurnMessage);
      }
      // FIX 5 hidden-tab keepalive: a ws message still fires while my tab is hidden (~10/s),
      // so use each inbound peer message as a wall-clock tick for the issue driver — my lanes
      // keep flowing to peers without waiting on the 1s fallback interval. No-op when visible.
      if (hiddenKeepaliveActive) issueOnlyTick();
    }

    /** Broadcast the leader-authored `setShadowed` lane-fill intent for a member of the
     * ACTIVE cohort (fix A.1: keeps the scheduler from stalling on absent lanes). No-op
     * when the affected slot isn't a live-cohort member or I'm not the leader. */
    function pushCohortShadowLane(ticketSlot: number, shadowed: boolean): void {
      const affectedIndex = lastCohortSlots.indexOf(ticketSlot);
      if (affectedIndex < 0) return;
      const liveTicketSlots = lastCohortSlots.filter((s) => !shadowedTicketSlots.has(s));
      const leader = liveTicketSlots.length ? electLeader(liveTicketSlots) : myTicketSlot;
      cohortEngine?.setSlotShadowed(affectedIndex, shadowed);
      const currentTurn = cohortEngine?.turn ?? 0;
      const msg = synthesizeShadowMessage(leader, myTicketSlot, affectedIndex, shadowed, currentTurn);
      if (msg) partySession.send(msg);
    }

    /**
     * A member's live socket flipped (protocol §5). Membership RECONCILIATION with a
     * deliberate asymmetry (partySession.ts D1/D2):
     *  - SHADOWED: if this member is part of the ACTIVE cohort → keep running, just
     *    auto-fill its lane (existing fix A.1). Otherwise (handshake in flight or idle)
     *    → reconcile so an in-flight formation restarts WITHOUT the dead slot (≤1 ⇒ solo).
     *  - UNSHADOWED: the returnee rebuilt its state from a fresh zone-boundary re-seed
     *    (no turn history to resume), so the WHOLE cohort must re-form. If a cohort is
     *    active, collapse to solo (settles the wallet) first, then reconcile INCLUDING the
     *    returnee; if a handshake's in flight (or idle), just reconcile it back in. Both
     *    sides process the same ordered member-unshadowed, so they restart symmetrically.
     */
    function onPartyMemberShadowChanged(ticketSlot: number, shadowed: boolean): void {
      if (shadowed) shadowedTicketSlots.add(ticketSlot);
      else shadowedTicketSlots.delete(ticketSlot);

      if (shadowed) {
        if (cohortActive && lastCohortSlots.includes(ticketSlot)) {
          pushCohortShadowLane(ticketSlot, true); // keep running, auto-fill the dead lane
        } else {
          reconcileCohort(); // in-flight/idle — drop the dead slot from formation
        }
        return;
      }

      // UNSHADOWED
      if (!lastRawCohortSlots.includes(ticketSlot)) {
        // A returnee that isn't (any longer) one of my raw cohort members — nothing to
        // re-form; just un-fill any stale auto-filled lane if we're somehow active.
        if (cohortActive) pushCohortShadowLane(ticketSlot, false);
        return;
      }
      if (cohortActive) {
        collapseToSolo(); // settles my wallet share of the cohort pot
        lastCohortSlots = []; // force reconcile to (re)begin a fresh handshake
      }
      reconcileCohort(); // fresh formation INCLUDING the returnee
    }

    const partySession = new PartySession({
      onCohortChanged: onPartyCohortChanged,
      onGameMessage: onPartyGameMessage,
      onStatusChange: onPartyStatusChange,
      onMemberShadowChanged: onPartyMemberShadowChanged,
      // Wave 3 network HUD: `n` is the `Date.now()` I stamped the ping with, so the
      // round trip is just "now minus that" — EMA-smoothed for display stability.
      onPong: (n) => {
        cohortRttMs = emaRtt(cohortRttMs, Date.now() - n, 0.3);
      },
    });

    // ---- Ghost presence "world layer" (docs/ghost-presence-design.md). A SEPARATE socket
    // from `partySession` that carries render-only presence (+ chat, later). THE ONE RULE:
    // inbound presence flows ONLY into `ghostStore`; it has no path into `pendingInput`,
    // `state`, or the lockstep stream (invariants §2). Dormant unless `ghostsVisible` &&
    // the tab is visible — solo/feature-off costs nothing beyond one boolean per frame. ----
    const ghostStore = new GhostStore();
    const worldSession = new WorldSession({
      onGhost: (payload) => ghostStore.upsert(payload, performance.now()),
      // Wave 3 "chat UI": parse the raw relay frame (the ONE place that trusts its
      // shape, see `ui/chat/chatMessages.ts`) and hand the typed result straight to the
      // store — mirrors `onGhost` -> `ghostStore.upsert` above, just a different sink.
      onChat: (frame) => {
        const parsed = parseChatFrame(frame);
        if (!parsed) return;
        if (parsed.kind === "history") {
          useGameStore.getState().ingestChatHistory(parsed.entries);
        } else if (parsed.kind === "message") {
          useGameStore.getState().ingestChatMessage(parsed.entry);
        } else {
          useGameStore.getState().pushNotice("chatRateLimited");
        }
      },
    });
    /** Presence publish accumulator (≈330ms beat) + monotonic seq + last-SENT snapshot for
     * change detection. Purely local publish bookkeeping — never read by the sim. */
    let presenceAccumMs = 0;
    let presenceBeatIndex = 0;
    let presenceSeq = 0;
    let lastSentPresence: PresenceSnapshot | null = null;
    /** fps valve (design §7): a smoothed frame-time EMA steps the ghost cap 12→6→0 so a
     * struggling device sheds ghost rigs first. Client-local, display-only. */
    let ghostFpsEmaMs = 1000 / 60;
    let ghostCap = GHOST_CAP_DEFAULT;
    /** Drives `worldSession.connect/disconnect`: on only while EITHER the ghosts flag is
     * set OR the chat panel is open, AND the tab is visible. Recomputed by
     * `syncWorldSessionActive()`. */
    let ghostsFeatureOn = useGameStore.getState().ghostsVisible;
    /** Wave 3 "chat UI": the socket must stay open while the chat panel is open even if
     * ghost-presence is off — decoupled per docs/ghost-presence-design.md Wave 3. */
    let chatFeatureOn = useGameStore.getState().chatOpen;
    let unsubscribeGhosts: (() => void) | undefined;
    let unsubscribeChatOpen: (() => void) | undefined;
    let unsubscribeChatSend: (() => void) | undefined;
    function syncWorldSessionActive(): void {
      const active = (ghostsFeatureOn || chatFeatureOn) && document.visibilityState === "visible";
      worldSession.setPresenceEnabled(ghostsFeatureOn);
      if (active) {
        worldSession.connect();
      } else {
        worldSession.disconnect();
        ghostStore.clear();
        renderer.setGhosts([]);
      }
    }

    let rafId = 0;
    let lastTime = performance.now();
    let uiSyncAccum = 0;
    let cancelled = false;
    // Previous rAF frame's event batch — TimeDirector reacts to these (a
    // one-frame trigger latency is expected/fine; see timeDirector.ts).
    let lastFrameEvents: GameEvent[] = [];
    // ---- backgrounded-tab catch-up (owner request 2026-07) ----
    // `hiddenAt` = wall-clock `Date.now()` at the moment the tab went hidden
    // (set in `onVisibility` below); cleared once consumed. `lastActiveAt` is
    // a fallback reference for `pageshow` (bfcache restore) in case it fires
    // without a preceding `visibilitychange` hidden event on some mobile
    // browsers — it's just "the last time a real rAF frame ran," which is
    // exactly when the tab stopped being driven. Both use `Date.now()`, never
    // `performance.now()`, so a device-sleep gap (which can distort monotonic
    // clocks on some platforms) is measured the same way the boot offline-idle
    // path measures its own gap (server `lastSeen` wall-clock delta).
    let hiddenAt: number | null = null;
    let lastActiveAt = Date.now();
    // Guards the rAF `frame()` tick from ever running WHILE a catch-up replay
    // is in flight. The replay itself is synchronous (same shape as the boot
    // offline-idle loop), so in practice a queued rAF can never fire mid-replay
    // on a single JS thread — this is a cheap defensive belt-and-suspenders in
    // case that assumption ever changes (e.g. a future chunked/async replay).
    let catchingUp = false;
    // M7.5 bot-status toast trackers (frame-to-frame transition detection).
    let botPrevTravelReason: string | null = null;
    let botPrevDwell = false;
    let botTownActivityUntil = 0;
    // M8 party (owner 2026-07-08): last `now` this client left the cohort for a bot
    // restock/sell trip — see `cohortBotTrip.ts`'s `shouldLeaveCohortForBotTrip` doc.
    let lastBotTripLeaveAtMs: number | null = null;
    // Town NPCs phase 3 (final): rotating greeting-line index per NPC (2-3
    // lines each, see messages/*.json's `townNpc.<id>.greetings`) — bumped
    // every tap-to-talk so repeat conversations don't feel like a broken
    // record. Plain closure counters (cosmetic UI text pick only; never reads
    // the engine's seeded RNG stream — CLAUDE.md reserves that for wave
    // composition).
    const npcGreetingIndex: Record<TownNpcId, number> = {
      "npc:pahpu": 0,
      "npc:lungdueng": 0,
      "npc:elder": 0,
    };
    let autosaveTimer: ReturnType<typeof setInterval> | undefined;
    // Mid-session "new patch deployed" banner: unsubscribe handle for the
    // `updateReloadRequested` store subscription (registered once boot
    // succeeds, alongside the other event listeners below).
    let unsubscribeReload: (() => void) | undefined;
    // M8 party P4b: unsubscribe handle for the `party` store subscription (see
    // `partySession.setParty`'s call site below).
    let unsubscribeParty: (() => void) | undefined;
    // HOF seasonal rewards: unsubscribe handle for the `mySocialBadge` store
    // subscription (see the settings title-picker call site below) — the
    // nameplate/aura seam otherwise only refreshes on the next `townArrived`.
    let unsubscribeSocialBadge: (() => void) | undefined;
    // A non-React DOM node we may append to the (React-owned) arena div to show
    // a fatal init error; tracked so cleanup can remove it before a remount.
    let errorEl: HTMLElement | null = null;

    // ---- M7 Gear & Drops: drop-claim buffer (closure state, NOT React/Zustand
    // — same "never per-frame state in React" rule as engine state itself).
    // `itemDrop`/`stoneDrop` events are collected here every frame and flushed
    // as one batch on the autosave cadence + tab-hide (see
    // `flushClaims`/`onVisibility`). ----
    let pendingClaims: ClaimBufferEntry[] = [];
    // หินเสริมพลัง (enhancement-stone) claim buffer — the `stones[]` sibling of
    // `pendingClaims` above, sent in the SAME `/api/items/claim` batch (see
    // `flushClaims`/`flushSaveBeacon` below).
    let pendingStoneClaims: StoneClaimBufferEntry[] = [];
    let claimInFlight = false;

    /**
     * Never fail silently: any init error becomes a visible Thai message inside
     * the arena slot plus a real console.error. This is the safety net that
     * turns an opaque "the game never starts" phone report into a readable
     * cause on-screen (WebGL2 unsupported, save-load crash, Pixi init reject…).
     */
    function showFatalError(reason: string): void {
      if (!arenaEl) return;
      if (!errorEl) {
        errorEl = document.createElement("div");
        errorEl.className =
          "absolute inset-0 z-10 flex items-center justify-center p-4 text-center text-sm font-medium text-red-300";
        arenaEl.appendChild(errorEl);
      }
      errorEl.textContent = tRef.current("fatalError", { reason });
    }

    /**
     * Shared fixed-step replay primitive for BOTH the boot offline-idle
     * catch-up and the mid-session backgrounded-tab catch-up
     * (`handleReturnFromBackground` below) — same wall-clock-bounded loop,
     * same forced `autoReturn`, same "drop the remainder past the budget"
     * behavior, so a long tab-away gap gets identical treatment to a boot
     * offline-idle gap. Never called from inside `frame()` itself — this is
     * strictly the "outside the rAF tick" replay path.
     */
    function replayFixedSteps(steps: number, budgetMs: number): number {
      // Forces auto-return (M6): a hero dead at the snapshot must respawn +
      // walk back to farm during the replay so idle earnings never stall in
      // town, regardless of the live UI toggle — the next real `frame()` tick
      // re-applies the store's own toggle anyway (see `frame()`'s UI-owned
      // flags block), so nothing needs restoring here.
      state.autoReturn = true;
      const deadline = performance.now() + budgetMs;
      let ran = 0;
      for (; ran < steps; ran++) {
        step(state, {});
        // Amortise the clock read so it doesn't dominate the tight loop.
        if ((ran & 0x3ff) === 0 && performance.now() >= deadline) {
          ran++;
          break;
        }
      }
      return ran;
    }

    /**
     * Backgrounded-tab catch-up (owner request 2026-07): fires when the tab
     * returns from `hidden` (via `onVisibility`) or a bfcache `pageshow`
     * restore. Reuses the SAME bounded replay + cap the boot offline-idle
     * path uses (`resolveCatchUp`/`replayFixedSteps`/`OFFLINE_SYNC_BUDGET_MS`)
     * so the two mechanisms behave identically — the only difference is the
     * elapsed gap's source (a hidden-tab timestamp vs. the server's
     * `lastSeen`).
     *
     * Event-flood suppression: like the boot replay, this calls `step()`
     * directly and never touches `frameEvents`/`renderer.draw`/
     * `audio.consumeEvents`/drop-claim buffering — the replayed steps' events
     * are simply discarded (same as boot: an `itemDrop`/`stoneDrop` rolled
     * during a replay is not claimed, an accepted parity with the existing
     * offline-idle behavior). The very next live `frame()` tick draws + UI-syncs the
     * POST-replay state normally, so the HUD just "jumps" to the caught-up
     * numbers instead of visibly fast-forwarding.
     */
    function handleReturnFromBackground(): void {
      const since = hiddenAt ?? lastActiveAt;
      hiddenAt = null;
      const elapsedMs = Date.now() - since;
      if (elapsedMs < CATCHUP_MIN_HIDDEN_MS) return;
      const { steps, capped } = resolveCatchUp(elapsedMs, {
        fixedDtSeconds: FIXED_DT,
        capHours: CONFIG.offlineCapHours,
      });
      if (steps <= 0) return;
      catchingUp = true;
      try {
        const goldBefore = state.gold;
        const ran = replayFixedSteps(steps, OFFLINE_SYNC_BUDGET_MS);
        // TODO(M4): surface this in the HUD instead of the console (same gap
        // as the boot offline-idle path's own TODO).
        console.log(
          `กลับมาที่แท็บ ได้ทอง +${state.gold - goldBefore} ` +
            `(${Math.round(elapsedMs / 1000)}s${capped ? ", capped" : ""}, ` +
            `simulated ${ran}/${steps} steps)`,
        );
      } finally {
        catchingUp = false;
        // Prevents the next real frame() from seeing a huge `now - lastTime`
        // (it'd be clamped by MAX_FRAME_SECONDS anyway, but this keeps the
        // accounting honest) and clears stale events so TimeDirector doesn't
        // react to anything from before the gap.
        lastTime = performance.now();
        lastActiveAt = Date.now();
        lastFrameEvents = [];
      }
    }

    /**
     * Build MY cohort lane input for one issue boundary. Extracted from the inline
     * `io.drainInput` so BOTH the rAF `frame()` loop AND the hidden-tab keepalive driver
     * (`issueOnlyTick`, FIX 5) assemble it identically — draining `pendingInput` (zero-loss),
     * latching the bot-toggle/bot-settings wishes, stripping the lane-0-only legacy intents,
     * counting sigil claims, and replicating my hero-config diff. Returns `manualBuy` instead
     * of touching the frame-local flag so the keepalive path (where it's irrelevant) can
     * ignore it. Reads `useGameStore.getState()` fresh — the same live singleton snapshot the
     * frame loop uses.
     */
    function drainCohortInput(): { input: FrameInput; manualBuy: boolean } {
      const store = useGameStore.getState();
      const pending = store.drainPendingInput();
      const manualBuy = !!pending.buyShopItem;
      const input = buildFrameInput(pending, store.inventory.length, myCohortIndex);
      cohortAutoHuntWish = nextAutoHuntWish(
        cohortAutoHuntWish,
        input.setAutoHunt,
        state.heroes[myCohortIndex]?.config.autoHunt ?? store.autoHunt,
      );
      cohortBotSettingsWish = nextBotSettingsWish(
        cohortBotSettingsWish,
        input.setBotSettings,
        state.heroes[myCohortIndex]?.config,
      );
      input.setAutoHunt = undefined;
      input.setBotSettings = undefined;
      if (input.claimAsuraSigil) cohortSigilClaims += 1;
      input.claimAsuraSigil = undefined;
      input.craftLegendary = undefined;
      const bot = { ...store.bot, ...(cohortBotSettingsWish ?? {}) };
      const diff = heroConfigDiff(
        desiredHeroConfig({
          autoHunt: cohortAutoHuntWish ?? store.autoHunt,
          autoCast: store.autoCast,
          autoAllocate: store.autoAllocate,
          autoHpPotion: store.autoHpPotion,
          autoManaPotion: store.autoManaPotion,
          autoHpThreshold: store.autoHpThreshold,
          autoManaThreshold: store.autoManaThreshold,
          enabled: bot.enabled,
          sellTripEnabled: bot.sellTripEnabled,
          hpPotionTarget: bot.hpPotionTarget,
          mpPotionTarget: bot.mpPotionTarget,
          scrollReserve: bot.scrollReserve,
          goldReserve: bot.goldReserve,
        }),
        state.heroes[myCohortIndex]?.config,
      );
      if (diff) input.setHeroConfig = diff;
      return { input, manualBuy };
    }

    // FIX 5: the io the hidden-tab keepalive driver feeds `issueOnly` — same lane assembly +
    // relay send as the frame loop, minus `runSubStep` (nothing executes while hidden).
    const keepaliveIo: Pick<CohortTickIO, "drainInput" | "send"> = {
      drainInput: () => drainCohortInput().input,
      send: (msg) => partySession.send(msg),
    };

    /**
     * FIX 5 hidden-tab keepalive driver: advance the issue cursor by the true wall-clock
     * delta since the last issue (message- OR interval-driven — both share
     * `keepaliveLastIssueAt`), emitting my due lanes to peers WITHOUT executing locally.
     * No-op unless a cohort is active AND we're in keepalive, so it's safe to call from both
     * the 1s interval and `onPartyGameMessage`.
     */
    function issueOnlyTick(): void {
      if (!hiddenKeepaliveActive || !cohortActive || !cohortEngine) return;
      const nowP = performance.now();
      const elapsed = Math.max(0, nowP - keepaliveLastIssueAt);
      keepaliveLastIssueAt = nowP;
      cohortEngine.issueOnly(elapsed, keepaliveIo);
    }

    function frame(now: number) {
      rafId = requestAnimationFrame(frame);

      // A catch-up replay is a synchronous, blocking call (see
      // `replayFixedSteps`/`handleReturnFromBackground` below) so this should
      // never actually be true when a rAF callback runs — kept as a defensive
      // no-op guard (see `catchingUp`'s doc above).
      if (catchingUp) return;

      // Handshake deadline safety net (partySession.ts D1/D2): a re-seed exchange that
      // never converges (a peer that vanished without a clean member-left, a lost offer on
      // a reload race) must not strand the "connecting" chip forever. Cheap — only touched
      // while a handshake is actually in flight. Abort, FORGET the live list (so reconcile
      // always re-forms), retry with a longer window to avoid thrash.
      if (
        handshake &&
        (handshake.phase === "offering" || handshake.phase === "acking") &&
        now - handshakeStartedAt > handshakeDeadlineMs
      ) {
        handshake.abort();
        handshake = null;
        handshakeDeadlineMs = HANDSHAKE_RETRY_MS;
        lastCohortSlots = [];
        reconcileCohort();
      }

      const elapsed = Math.min((now - lastTime) / 1000, MAX_FRAME_SECONDS);
      lastTime = now;
      lastActiveAt = Date.now();

      const store = useGameStore.getState();

      // World boss "เสี่ยจ๋อง": cheap per-frame schedule check off the SERVER-clock-
      // aligned `serverNowMs()` (never the device clock). The store push is gated to
      // actual transitions by `sameWorldBossStatus` (its ceil-second comparison also
      // gives the countdown its ~1Hz refresh for free — no separate throttle timer
      // needed). While standing in the window's boss zone during "active", queue the
      // spawn intent for THIS frame — idempotent both here (`shouldQueueWorldBossSpawn`
      // checks the live `state.worldBoss` window) and engine-side (`trySpawnWorldBoss`).
      const worldBossPhase = worldBossPhaseAt(serverNowMs());

      // SHARED-HP client driver (M8.6): read once per frame, reused below by both the
      // FIX 2 defeat/participation bookkeeping and the report/poll block further down.
      const dealt = worldBossDamageDealt(state);

      // FIX 2 (2026-07-09 live round) — participation latch: SURVIVES `dealt` going
      // null (leaving the zone / the local fight ending), unlike `wbReportWindow`
      // below — so a player who tapped the boss and walked away still sees the
      // "defeated, collecting your reward" banner and auto-claims once the SHARED
      // pool dies elsewhere.
      if (dealt && dealt.damage > 0) wbParticipatedWindow = dealt.windowId;

      // FIX 2 — defeat source (1): the local sim's own witness. `state.worldBoss.
      // defeated` persists past `active` going false (`retireWorldBoss`), scoped to
      // the CURRENT schedule window only (a stale prior-window record must never
      // leak forward as "defeated" for a brand-new window).
      if (
        state.worldBoss &&
        state.worldBoss.windowId === worldBossPhase.windowId &&
        state.worldBoss.defeated
      ) {
        wbDefeatedWindowId = worldBossPhase.windowId;
      }

      // FIX 2 — defeat source (2): all-clients poll for anyone NOT already covered
      // by source (1) this frame (`dealt` truthy means I'm locally engaged — the
      // shared-hp sync below will flip `state.worldBoss.defeated` for me directly
      // the instant the pool dies, so polling here too would just be a redundant
      // duplicate request). Cheap public GET, only while the window is genuinely
      // active and not already known-defeated.
      if (
        worldBossPhase.phase === "active" &&
        !dealt &&
        wbDefeatedWindowId !== worldBossPhase.windowId &&
        now - wbDefeatPollAt >= WB_DEFEAT_POLL_MS
      ) {
        const pollWindowId = worldBossPhase.windowId;
        wbDefeatPollAt = now;
        void getWorldBossState(pollWindowId).then((res) => {
          if (res && res.ok && res.defeated) wbDefeatedWindowId = pollWindowId;
        });
      }

      const wbDefeated = wbDefeatedWindowId === worldBossPhase.windowId;
      const wbMyUnclaimed =
        wbParticipatedWindow === worldBossPhase.windowId &&
        wbClaimedWindow !== worldBossPhase.windowId;

      const worldBossStatus = deriveWorldBossStatus(
        worldBossPhase,
        state.location,
        wbDefeated,
        wbMyUnclaimed,
      );
      if (!sameWorldBossStatus(worldBossStatus, lastWorldBossStatus)) {
        lastWorldBossStatus = worldBossStatus;
        store.setWorldBossStatus(worldBossStatus);
      }

      // FIX 2 — AUTO-CLAIM: a defeated window I still have an unclaimed reward for
      // collects automatically (covers "hit the boss, then left the zone before it
      // died" — the participation row already exists server-side). Guarded by the
      // in-flight flag so this doesn't refire every frame while a request is out.
      if (wbDefeated && wbMyUnclaimed && !worldBossClaimInFlight) {
        settleWorldBossClaim(worldBossPhase.windowId);
      }

      if (
        shouldQueueWorldBossSpawn(
          worldBossPhase,
          worldBossStatus,
          state.worldBoss
            ? {
                windowId: state.worldBoss.windowId,
                active: state.worldBoss.active,
                defeated: state.worldBoss.defeated,
              }
            : null,
        )
      ) {
        const spawnWindowId = worldBossPhase.windowId;
        // SHARED-HP seed (M8.6): fetch the server pool's current hp ONCE per window (fire-
        // and-forget; a failed/slow fetch just leaves the spawn seedless this frame — the
        // engine falls back to full hp, backward-compatible, and the very next damage-report
        // round trip corrects it anyway). Harmless to run on every cohort client (only the
        // first slot-ordered lane's spawn intent is ever applied — see `applyWorldBossSpawnIntents`).
        if (wbSeedAttemptedWindow !== spawnWindowId) {
          wbSeedAttemptedWindow = spawnWindowId;
          wbSeedHp = undefined;
          void getWorldBossState(spawnWindowId).then((res) => {
            if (res && res.ok && wbSeedAttemptedWindow === spawnWindowId) wbSeedHp = res.hp;
          });
        }
        store.queueSpawnWorldBoss(
          spawnWindowId,
          Math.ceil(worldBossPhase.msRemaining / 1000),
          wbSeedAttemptedWindow === spawnWindowId ? wbSeedHp : undefined,
        );
      }

      // SHARED-HP client driver (M8.6): while the live sim has an ENGAGED world boss,
      // report/poll on the `WB_DAMAGE_REPORT_MS` cadence — see `ui/worldBoss/schedule.ts`'s
      // module doc for the cohort dedup rule (only the lowest-slot AUTHORITY posts the
      // periodic full delta; every other member sends one participation ping then polls).
      // Reads `worldBossDamageDealt` (not `state.worldBoss` directly) so this is a no-op the
      // instant the fight ends/despawns/is defeated (the read goes null) OR I collapse to
      // solo mid-fight (a fresh solo rebuild never carries `state.worldBoss` over).
      // `dealt` was already read once above (FIX 2's defeat/participation bookkeeping) —
      // reused here rather than re-reading `state.worldBoss` a second time this frame.
      {
        if (dealt) {
          if (wbReportWindow !== dealt.windowId) {
            wbReportWindow = dealt.windowId;
            wbReportedDamage = 0;
            wbPingedWindow = null;
          }
          const isAuthority = !cohortActive || myCohortIndex === 0;
          const windowId = dealt.windowId;
          if (isAuthority) {
            const delta = authorityReportDelta(
              dealt.damage,
              wbReportedDamage,
              now - wbLastReportAt,
              WB_DAMAGE_REPORT_MS,
            );
            if (delta > 0 && !wbNetworkInFlight) {
              wbNetworkInFlight = true;
              wbLastReportAt = now;
              void postWorldBossDamage(windowId, delta).then((res) => {
                wbNetworkInFlight = false;
                // Only advance the watermark on a CONFIRMED post — a failure (network/422/410)
                // retries the same (now possibly larger) delta on the next cadence tick.
                if (res && res.ok) {
                  if (wbReportWindow === windowId) wbReportedDamage += delta;
                  useGameStore.getState().queueSyncWorldBoss(windowId, res.hp);
                }
              });
            }
          } else {
            if (
              shouldSendParticipationPing(dealt.damage, windowId, wbPingedWindow) &&
              !wbNetworkInFlight
            ) {
              wbNetworkInFlight = true;
              wbPingedWindow = windowId; // latch BEFORE the request resolves
              const pingDamage = Math.max(1, dealt.damage - wbReportedDamage);
              void postWorldBossDamage(windowId, pingDamage).then((res) => {
                wbNetworkInFlight = false;
                if (res && res.ok) {
                  if (wbReportWindow === windowId) wbReportedDamage = Math.max(wbReportedDamage, pingDamage);
                  useGameStore.getState().queueSyncWorldBoss(windowId, res.hp);
                } else {
                  if (wbPingedWindow === windowId) wbPingedWindow = null; // retry next observed-positive frame
                }
              });
            } else if (shouldPollHp(now - wbLastReportAt, WB_DAMAGE_REPORT_MS) && !wbNetworkInFlight) {
              wbLastReportAt = now;
              void getWorldBossState(windowId).then((res) => {
                if (res && res.ok) useGameStore.getState().queueSyncWorldBoss(windowId, res.hp);
              });
            }
          }
        } else if (wbReportWindow !== null) {
          wbReportWindow = null;
          wbReportedDamage = 0;
          wbPingedWindow = null;
        }
      }

      // ดินแดนอสูร (ASURA) daily hot zone: cheap per-frame day-key check, same
      // server-clock-aligned `serverNowMs()` the world-boss schedule uses. Only
      // queued while standing IN asura (the zone the intent actually affects),
      // and only re-queued when the day-key CHANGES (idempotent — the engine's
      // `applyAsuraHotZone` is itself a plain set, safe to repeat).
      if (isAsuraLocation(state.location)) {
        const asuraDayKey = asuraDayKeyForMs(serverNowMs());
        if (lastAsuraDayKeyQueued !== asuraDayKey) {
          lastAsuraDayKeyQueued = asuraDayKey;
          store.queueSetAsuraHotZone(asuraDayKey);
        }
      }

      // M7.5 bot-status toasts ("มันเกิดขึ้นไวไป มองไม่ทัน" — owner request):
      // capture pre-step consumable counts so a town restock this frame can be
      // reported with real numbers after the sub-steps run.
      const potsBefore = {
        hp: state.consumables.hpPotion,
        mp: state.consumables.manaPotion,
        scroll: state.consumables.returnScroll,
      };

      // Bot MASTER switch (owner UX consolidation, 2026-07-07) — `state.autoHunt`
      // doubles as the master's own on/off value (see `gameStore.ts`'s
      // `toggleBotMaster` doc). Every OTHER UI-owned automation flag below is
      // NOT persisted (unlike `autoHunt`/`state.bot`), so ANDing them against it
      // every frame is a safe, reversible gate: turning the master back on just
      // resumes reading whatever the player already had each sub-toggle set to
      // — nothing here needs its own snapshot/restore.
      const botOn = store.autoHunt;

      // UI-owned flags the engine reads directly (not part of FrameInput). Fix C: these
      // mirror MY store onto SHARED globals, so in a cohort they'd diverge per client —
      // and `autoReturn`/`autoAdvance` would self-navigate the shared location (the
      // whole-party-drag class). Gate to SOLO: in a cohort each hero's config is the
      // canonical replicated `setHeroConfig`, and nav is forced off at activateCohort.
      // (`autoCast`/`autoAllocate` are inert in a cohort anyway — `syncPrimaryHeroConfig`
      // only mirrors them at heroes.length===1 — but gating keeps the intent explicit.)
      if (!cohortActive) {
        state.autoCast = botOn && store.autoCast;
        state.autoAllocate = botOn && store.autoAllocate;
        state.autoReturn = botOn && store.autoReturn;
        state.autoAdvance = botOn && store.autoAdvance;
      }
      // Auto-use potion toggles + thresholds (M6), same UI-owned pattern.
      state.autoHpPotion = botOn && store.autoHpPotion;
      state.autoManaPotion = botOn && store.autoManaPotion;
      state.autoHpThreshold = store.autoHpThreshold;
      state.autoManaThreshold = store.autoManaThreshold;
      // UI-owned sound preference — applied to the audio module every frame,
      // same pattern (never queued through FrameInput; it isn't sim state).
      audio.setMuted(store.soundMuted);

      // Shape ONLY the accumulator's input (hit-stop/slow-mo, M4 juice) off of
      // LAST frame's events — real `elapsed` still drives the renderer, audio,
      // and UI-sync below so fx/SFX/HUD never stutter, even mid-freeze. Computed
      // every frame (both branches) so TimeDirector's internal cadence is unbroken;
      // it feeds only the SOLO accumulator (the cohort branch uses real `elapsed`).
      const simElapsed = timeDirector.shape(elapsed, lastFrameEvents);

      // Did this frame drain a manual potion buy? Drives the `botRestocked`-toast
      // suppression below (line ~"potGain") — in SOLO it's just `pending.buyShopItem`;
      // in a cohort the drain happens inside the scheduler's issue boundary, so the
      // closure below flags it there. Preserves the original per-frame check either way.
      let manualBuyThisFrame = false;

      // `state.events` is cleared at the START of each step() and holds only that
      // sub-step's events; a frame can run more than one sub-step, so we collect
      // across ALL of them before draw() (see engine/state/events.ts's contract).
      // M8 party P4b: an ACTIVE cohort ticks through `CohortTurnEngine` (issue my lane
      // at 100ms boundaries, meter out sub-steps on real time) instead of the solo
      // fixed-step accumulator. `simElapsed` (TimeDirector-shaped) is intentionally
      // UNUSED there — hit-stop/slow-mo stay render-side for a cohort. The solo path
      // stays byte-for-byte unchanged.
      // Fix B: a zone-change intent (warp / fast-travel / walk / return-scroll / advance)
      // means I'm LEAVING the cohort to roam solo — a member's move must NOT drag the whole
      // party (design §3, free-roam). PEEK the store's pending intent WITHOUT draining; if it
      // carries a zone change, collapse to solo FIRST so the `cohortActive` branch below is
      // skipped and THIS frame's solo path drains + applies the move normally. The resulting
      // `state.location` change then broadcasts a fresh zone beat (block after draw), and my
      // peers re-derive their cohort without me. Instant moves drop me next beat; a channelled
      // fast-travel/warp updates the beat only on ARRIVAL (peers briefly hold — waiting chip
      // covers it), the accepted tradeoff of beat-driven re-derivation.
      if (cohortActive && hasZoneChangeIntent(store.pendingInput)) collapseToSolo();

      // M8 party (owner 2026-07-08, "ไม่ว่าจะเล่นเดี่ยวหรือปาร์ตี้ บอทยังคงต้องทำงานเหมือนเดิม"): the
      // shared cohort state must never travel on one member's automation (8822f54's guard is
      // correct), so when MY hero's bot wants a restock/sell trip, THIS client alone leaves
      // the cohort via the SAME `collapseToSolo()` escape hatch the zone-change intent above
      // uses — the now-solo engine's own `updateBots` (heroes.length back to 1) then runs the
      // trip completely normally starting THIS SAME frame (walk to town, chores, walk back to
      // the farm frontier), and the existing zone-beat protocol re-forms the party the moment
      // I'm standing back in the same zone as my friends (identical mechanism to walking INTO
      // a friend's zone — see `cohortBotTrip.ts`'s module doc). `wantsBotTownTrip` is evaluated
      // against MY virtualized wallet slice (not the raw shared state.gold/consumables), so the
      // decision matches what solo will actually see the instant `collapseToSolo()` settles it.
      if (cohortActive) {
        const myWallet = myVirtualWallet();
        const myHero = state.heroes[myCohortIndex];
        if (
          myWallet &&
          myHero &&
          !myHero.dead &&
          !state.traveling &&
          !state.fastTravelCast &&
          state.phase === "battle" && // never mid a shared boss fight
          zoneAt(state.location).kind === "farm"
        ) {
          const want = wantsBotTownTrip(
            // Bot settings are PER HERO now (2026-07-09): read MY hero's own config directly
            // (structurally a BotSettings) — it holds MY enabled/sellTripEnabled/targets, set via
            // the replicated `setHeroConfig`. No more ANDing the shared lane-0 `state.bot` with my
            // master switch; the config IS my own, so the leave-decision honours my own settings.
            myHero.config,
            { hpPotion: myWallet.consumables.hpPotion ?? 0, manaPotion: myWallet.consumables.manaPotion ?? 0 },
            myWallet.gold,
            shopStageOf(state),
            store.inventory.length,
            state.sellTripWatermark,
          );
          if (
            shouldLeaveCohortForBotTrip({
              cohortActive,
              needRestock: want.needRestock,
              needSell: want.needSell,
              nowMs: now,
              lastLeaveAtMs: lastBotTripLeaveAtMs,
              debounceMs: BOT_TRIP_LEAVE_DEBOUNCE_MS,
            })
          ) {
            lastBotTripLeaveAtMs = now;
            collapseToSolo();
            store.pushNotice("botLeftCohortForTrip");
          }
        }
      }

      let frameEvents: GameEvent[];
      if (cohortActive && cohortEngine) {
        const collected: GameEvent[] = [];
        const io: CohortTickIO = {
          // Drained ONLY at issue boundaries (not per rAF frame) — no tap is lost. Assembly
          // is shared with the hidden-tab keepalive driver (FIX 5) via `drainCohortInput`.
          drainInput: () => {
            const r = drainCohortInput();
            if (r.manualBuy) manualBuyThisFrame = true;
            return r.input;
          },
          send: (msg) => partySession.send(msg),
          runSubStep: (lanes) => {
            // Defense-in-depth (fix B): strip any zone-change field from EVERY lane before
            // step() — identical on all clients, so a stale peer build can't drag the party.
            step(state, sanitizeLanes(lanes));
            // FIX 5: during a resume backlog burst the replayed events are DISCARDED (like the
            // solo offline catch-up) — collecting thousands would flood fx/audio. The next
            // normal frame draws + sounds the post-burst state.
            if (!cohortCatchUp) collected.push(...state.events);
          },
        };
        if (cohortCatchUp) {
          // FIX 5 RESUME: I'm back from a hidden tab that stayed in lane-keepalive. Keep
          // issuing my lane (wall clock advanced), then drain the buffered backlog in a
          // wall-clock-budgeted burst so the execute cursor catches the issue cursor without
          // janking this frame. Spread across frames until `burstExecute` reports caught-up.
          cohortEngine.issueOnly(elapsed * 1000, io);
          const deadline = performance.now() + CATCHUP_BURST_BUDGET_MS;
          let caughtUp = false;
          do {
            const r = cohortEngine.burstExecute(io, CATCHUP_BURST_SUBSTEPS, now);
            if (r.caughtUp) {
              caughtUp = true;
              break;
            }
          } while (performance.now() < deadline);
          if (caughtUp) {
            cohortCatchUp = false;
            cohortPrevWaiting = false;
            refreshCohortStatus(); // back to normal cadence — restore "active"
          }
          frameEvents = collected; // empty (events discarded during the burst)
        } else {
          const { waiting } = cohortEngine.tick(elapsed * 1000, now, io);
          frameEvents = collected;
          // Map the engine's waiting flag onto the HUD chip on TRANSITIONS only.
          if (waiting && !cohortPrevWaiting) {
            pushCohortStatus({ kind: "waiting" });
          } else if (!waiting && cohortPrevWaiting) {
            refreshCohortStatus(); // resumed — restore "active" (names)
          }
          cohortPrevWaiting = waiting;
        }
      } else {
        // Drain the one-shot intent queue exactly once per real frame; only the first
        // fixed sub-step of this frame gets it (remaining sub-steps get empty input).
        const pending = store.drainPendingInput();
        manualBuyThisFrame = !!pending.buyShopItem;
        const firstInput = buildFrameInput(pending, store.inventory.length, 0);
        const steps = drainAccumulator(acc, simElapsed, 1);
        frameEvents = [];
        for (let i = 0; i < steps; i++) {
          step(state, i === 0 ? firstInput : {});
          frameEvents.push(...state.events);
        }
      }

      // ---- Wave 3 "signal chip" network HUD (docs/ghost-presence-design.md) ----
      // RTT ping over the PARTY socket (~5s cadence; `partySession.ping` no-ops
      // internally while the socket isn't OPEN, so this accumulator can run
      // unconditionally without an extra "am I connected" branch here) + a ~1Hz push of
      // per-member lane lag/names into `cohortNet` for the chip's tap-to-open popover.
      cohortPingAccumMs += elapsed * 1000;
      if (cohortPingAccumMs >= COHORT_PING_INTERVAL_MS) {
        cohortPingAccumMs -= COHORT_PING_INTERVAL_MS;
        partySession.ping(Date.now());
      }
      if (cohortActive && cohortEngine) {
        cohortNetAccumMs += elapsed * 1000;
        if (cohortNetAccumMs >= COHORT_NET_PUSH_MS) {
          cohortNetAccumMs = 0;
          const lagMap = cohortEngine.perSlotLag();
          const perMember: CohortNetState["perMember"] = [];
          lastCohortSlots.forEach((ticketSlot, idx) => {
            if (ticketSlot === myTicketSlot) return;
            perMember.push({
              slot: ticketSlot,
              name: cohortMemberNames.get(ticketSlot) ?? null,
              lagTurns: lagMap.get(idx) ?? 0,
              shadowed: shadowedTicketSlots.has(ticketSlot),
            });
          });
          useGameStore.getState().setCohortNet({
            rttMs: cohortRttMs,
            waitingOnSlot: pickWaitingSlot(cohortPrevWaiting, perMember),
            perMember,
          });
        }
      } else if (cohortNetAccumMs !== 0) {
        // Cohort just ended — clear the stale member rows once (cheap transition-only
        // write; `cohortNetAccumMs` only ever moves inside the branch above, so this
        // guard fires exactly once per collapse, never every solo frame).
        cohortNetAccumMs = 0;
        useGameStore.getState().setCohortNet({ rttMs: cohortRttMs, waitingOnSlot: null, perMember: [] });
      }

      // ---- Ghost presence (render-only; THE ONE RULE — never touches `state`) ----
      // Publish MY hero read-only on a ~3Hz beat, and feed the peer render list to the
      // renderer. Gated on the feature flag; a disabled/dormant socket makes this a couple
      // of cheap boolean checks. `worldSession.me`/`publish` no-op until the socket is up.
      if (ghostsFeatureOn) {
        const me = worldSession.me;
        // My hero is `heroes[myCohortIndex]` in a cohort (index 0 solo) — same resolution
        // every other "my hero" read in this loop uses. Read-only: `buildPresenceSnapshot`
        // samples x/cls/tier and returns a fresh object, never mutating `state`.
        const myHero = state.heroes[myCohortIndex] ?? state.heroes[0];
        presenceAccumMs += elapsed * 1000;
        if (presenceAccumMs >= PRESENCE_BEAT_MS) {
          presenceAccumMs = 0;
          if (me && myHero) {
            const candidate = buildPresenceSnapshot(
              myHero,
              { charId: me.charId, displayName: me.displayName },
              presenceSeq + 1,
            );
            if (shouldPublish(lastSentPresence, candidate, presenceBeatIndex)) {
              presenceSeq++;
              worldSession.publish(candidate);
              lastSentPresence = candidate;
            }
            presenceBeatIndex++;
          }
        }
        // fps valve: smooth the frame time and step the cap down on sustained slowness
        // (design §7). Thresholds ~45fps → 6, ~30fps → 0; recovers when frames speed up.
        ghostFpsEmaMs += (elapsed * 1000 - ghostFpsEmaMs) * 0.05;
        const wantCap = ghostFpsEmaMs > 33 ? 0 : ghostFpsEmaMs > 22 ? 6 : GHOST_CAP_DEFAULT;
        if (wantCap !== ghostCap) {
          ghostCap = wantCap;
          ghostStore.setCap(ghostCap);
        }
        // Dedupe: never render my OWN ghost, nor a cohort peer (already a fully-simulated
        // real hero in my field). Peers key on displayName — the party wire carries no
        // charId (see `GhostStore.setExcluded`). Cheap set rebuild per frame.
        const excluded = new Set<string>();
        if (me) excluded.add(me.charId);
        if (cohortActive) for (const n of cohortMemberNames.values()) excluded.add(n);
        ghostStore.setExcluded(excluded);
        const nowMs = performance.now();
        ghostStore.prune(nowMs);
        renderer.setGhosts(ghostStore.list(nowMs));
      }

      renderer.draw(state, frameEvents);
      if (frameEvents.length) audio.consumeEvents(frameEvents);

      // M8 party P4b: broadcast a zone beat on every ACTUAL zone change (join +
      // every zone change, protocol/design §3) — cheap string compare, no-op
      // whenever `partySession` is dormant (no party).
      const zoneKey = `${state.location.mapId}:${state.location.zoneIdx}`;
      if (zoneKey !== lastZoneKey) {
        lastZoneKey = zoneKey;
        partySession.setZone(state.location.mapId, state.location.zoneIdx);
        // Same seam drives the world socket's presence room (pleave+pjoin). Idempotent:
        // `setZone` no-ops if the zone is unchanged, and does nothing while disconnected
        // (the next open re-`pjoin`s the current zone). Presence rides EVERY zone,
        // including town (the social space) — unlike lockstep cohorts, which skip town.
        worldSession.setZone(state.location.mapId, state.location.zoneIdx);
      }

      // ---- M7.5 bot-status toasts (transition detection; engine untouched) ----
      // The bot's town round trip resolves in seconds (warps are instant), so
      // without these the player only sees the hero teleport around. Signals:
      // traveling.reason "bot" = the walk out; botDwell = standing selling; a
      // potion-count jump without a manual buy = the restock; a "walk" transit
      // shortly after town activity = the walk home.
      const travelReason = state.traveling?.reason ?? null;
      if (travelReason === "bot" && botPrevTravelReason !== "bot") {
        store.pushNotice("botTripStart");
      }
      const dwellNow = state.botDwell !== null;
      if (dwellNow && !botPrevDwell) store.pushNotice("botSelling");
      const potGain = {
        hp: Math.max(0, state.consumables.hpPotion - potsBefore.hp),
        mp: Math.max(0, state.consumables.manaPotion - potsBefore.mp),
        scroll: Math.max(0, state.consumables.returnScroll - potsBefore.scroll),
      };
      if ((potGain.hp || potGain.mp || potGain.scroll) && !manualBuyThisFrame) {
        // A stock jump the player didn't click for = the bot restocked.
        store.pushNotice("botRestocked", potGain);
        botTownActivityUntil = now + 15_000;
      }
      if (frameEvents.some((e) => e.type === "townArrived") || dwellNow) {
        botTownActivityUntil = now + 15_000;
      }
      if (
        travelReason === "walk" &&
        botPrevTravelReason !== "walk" &&
        now < botTownActivityUntil
      ) {
        store.pushNotice("botReturning");
        botTownActivityUntil = 0;
      }
      botPrevTravelReason = travelReason;
      botPrevDwell = dwellNow;

      // M7 Gear & Drops: buffer every `itemDrop` this frame for the batched
      // server claim (flushed on the autosave cadence / tab-hide below). The
      // engine's roll is already deterministic + monotonic (rollId), so this
      // is a plain append — no on-the-spot dedup needed in the common case.
      // ECONOMY-INTEGRITY (cohortWallet.ts): in a cohort every client's shared sim emits
      // the SAME `itemDrop`/`stoneDrop` events (no hero attribution), so buffering them
      // all would mint every drop N times (claims are idempotent per rollId, so all N
      // clients each mint it once into their OWN inventory = N× duplication). Assign each
      // drop deterministically to exactly ONE member and buffer only MY assigned drops.
      // The field fx/SFX pop still plays for everyone (one-way renderer/audio below) — a
      // shared visual — but only the assignee claims + toasts it. Solo is unchanged.
      const cohortSize = Math.max(1, state.heroes.length);
      const dropIsMine = (rollId: string): boolean =>
        !cohortActive || dropAssignedIndex(rollId, cohortSize) === myCohortIndex;
      for (const ev of frameEvents) {
        if (ev.type === "itemDrop") {
          if (dropIsMine(ev.rollId)) {
            pendingClaims.push({
              rollId: ev.rollId,
              templateId: ev.templateId,
              stage: state.stage,
            });
          }
        } else if (ev.type === "stoneDrop") {
          // หินเสริมพลัง drop juice: buffer the claim for the same batched
          // flush AND toast immediately (unlike gear, a stone toast doesn't
          // wait on the server mint — see `DropFeed.tsx`'s module doc). The
          // field fx/SFX pop is handled one-way by the renderer/audio below.
          if (dropIsMine(ev.rollId)) {
            pendingStoneClaims.push({ rollId: ev.rollId, qty: ev.qty });
            useGameStore.getState().pushStoneFeed(ev.qty);
          }
        } else if (ev.type === "townArrived") {
          // HOF seasonal rewards: refresh the town honor board + my solo aura —
          // see `refreshHofOnTownArrival`'s doc (fire-and-forget, every arrival).
          refreshHofOnTownArrival();
          // M7.5 sell-trip bot: the engine restocked already (engine-side);
          // the CLIENT owns item instances, so a "sell"/"restockSell" arrival
          // is where the auto-sell rules actually run (fire-and-forget — a
          // dropped auto-sell just retries on the NEXT full-inventory trip).
          if (ev.reason === "sell" || ev.reason === "restockSell") {
            // Suppress the "nothing to dispose" notice on an OPPORTUNISTIC sweep
            // (a potions trip that also tidies the bag — `sellTriggered` false):
            // a tidy bag with nothing to sell is normal there, not a stuck bot.
            const suppressNothing = !ev.sellTriggered;
            // Equip first so the keep-guard baseline reflects the NEW gear —
            // the displaced pieces then vendor in this same trip. The dispose
            // sweep MUST still run if auto-equip rejects (the whole point of the
            // trip is to empty the bag): gating it on the equip promise settling
            // cleanly means a single equip failure silently skips sell+salvage,
            // leaving the bag full so the engine re-trips the warp forever — the
            // "bot warps but never sells/salvages" bug. Run dispose on BOTH the
            // fulfil and reject paths.
            void performAutoEquip().then(
              () => performAutoSell(suppressNothing),
              (err) => {
                console.warn("[GameClient] auto-equip failed; disposing anyway", err);
                return performAutoSell(suppressNothing);
              },
            );
          }
        } else if (ev.type === "fastTravelCastStart") {
          useGameStore.getState().startFastTravelChannel(ev.mapId, ev.zoneIdx);
        } else if (ev.type === "fastTravelArrive") {
          useGameStore.getState().clearFastTravelChannel();
        } else if (ev.type === "fastTravelBlocked") {
          useGameStore.getState().clearFastTravelChannel();
          useGameStore.getState().pushNotice(`fastTravelBlocked.${ev.reason}`);
          // Owner UX round (2026-07-09): a blocked ปุ่มตีบวก trip (boss phase
          // locked, etc.) already surfaces via the notice above — cancel the
          // smith trip too so it doesn't linger waiting for a town arrival
          // that was never actually queued.
          useGameStore.getState().cancelSmithTrip();
        } else if (ev.type === "npcTrade") {
          // Town NPCs phase 3 (final): flavor-only — the bot's transaction
          // itself is already engine-side (systems/bots.ts); this NEVER opens
          // `activeTownPanel` (the panel is a PLAYER dialog, not a ledger view).
          renderer.showNpcSpeech(ev.npcId, tTownNpcRef.current(`${npcI18nKey(ev.npcId)}.botFlavor`));
        } else if (ev.type === "questReward") {
          // M8 quest Wave C: celebratory toast (reuses NoticeToast's existing
          // look) — compose the reward summary from small localized unit
          // labels rather than one giant ICU conditional, same inline-
          // composition style `botRestocked` already uses.
          const parts: string[] = [];
          if (ev.gold > 0) parts.push(tNoticesRef.current("rewardGold", { amount: ev.gold }));
          if (ev.materials > 0) {
            parts.push(tNoticesRef.current("rewardMaterials", { amount: ev.materials }));
          }
          if (ev.hpPotion > 0) parts.push(tNoticesRef.current("rewardHpPotion", { amount: ev.hpPotion }));
          if (ev.manaPotion > 0) {
            parts.push(tNoticesRef.current("rewardManaPotion", { amount: ev.manaPotion }));
          }
          useGameStore.getState().pushNotice("questRewardClaimed", { summary: parts.join(" ") });
        } else if (ev.type === "dailyProgress" && ev.complete) {
          // M8 quest Wave C: throttled by the engine already (fires once, on
          // the complete transition) — points the player at ผู้ใหญ่บ้าน to claim.
          useGameStore.getState().pushNotice("dailyQuestComplete");
        } else if (ev.type === "worldBossDefeated") {
          // World boss "เสี่ยจ๋อง": the engine grants NO xp/gold itself (rewards are
          // SERVER-claimed) — fire the claim POST for MY character. In a cohort every
          // member sees this same shared-sim event and claims independently (by design).
          settleWorldBossClaim(ev.windowId);
        } else if (ev.type === "eliteSpawned") {
          // ดินแดนอสูร elite roaming mob — flavor-only toast (mysterious tone, no
          // stats/rewards spoiled here; the reward beat is `eliteKilled` below).
          useGameStore.getState().pushNotice("asuraEliteSpawned");
        } else if (ev.type === "eliteKilled") {
          useGameStore.getState().pushNotice("asuraEliteKilled", { essence: ev.essence });
        } else if (ev.type === "asuraZoneStoneEarned") {
          useGameStore.getState().pushNotice("asuraZoneStoneEarned");
        } else if (ev.type === "tomePageFound") {
          // "ตำราตำนาน" secret-quest breadcrumb (endgame v1.3, owner: discoverable WITHOUT
          // patch notes) — a dramatic, mysterious toast, no spoilers. Cohort guard
          // (2026-07-09): the shared state's page-found event fires for ALL members; skip the
          // toast when MY frozen base already had this page bit (I've seen it before).
          const pageBit = 1 << (ev.page - 1);
          if (!(cohortActive && cohortProgressBase && cohortProgressBase.tomePages & pageBit)) {
            useGameStore.getState().pushNotice(`tomePageFound.page${ev.page}`);
          }
        } else if (ev.type === "tomeAssembled") {
          // The 3rd page landed — celebratory reveal dialog (mounted at the top level,
          // see `AsuraTomeAssembledModal.tsx`), NOT a toast. Cohort guard: skip when MY base
          // already had the tome fully assembled (a member who long ago unlocked it must not
          // re-see the reveal every time a partymate completes their own set).
          if (
            !(
              cohortActive &&
              cohortProgressBase &&
              (cohortProgressBase.tomePages & TOME_ALL_PAGES) === TOME_ALL_PAGES
            )
          ) {
            useGameStore.getState().showTomeAssembledCelebration();
          }
        } else if (ev.type === "asuraSigilClaimed") {
          useGameStore.getState().pushNotice("asuraSigilClaimed", { count: ev.count });
        } else if (ev.type === "legendaryCraftBlocked") {
          // Defensive only — the panel already gates the button on `canCraftLegendary`
          // (client-side precondition check) before firing the server POST, so this only
          // fires on a genuine same-frame race (e.g. essence spent by a concurrent claim).
          useGameStore.getState().pushNotice(`asuraCraftBlocked.${ev.reason}`);
        }
      }

      uiSyncAccum += elapsed;
      if (uiSyncAccum >= UI_SYNC_INTERVAL) {
        uiSyncAccum -= UI_SYNC_INTERVAL;
        // The store contract everywhere (HUD hero panel, quest card, dailies,
        // auto-equip's class scope) is "heroes[0] = MY hero". In an active cohort
        // `state.heroes` is in SLOT order, so my hero can sit at index 1-2 — hand
        // the snapshot a my-hero-first view (engine state itself is untouched;
        // same object refs, so identity reads like `h === heroes[0]` stay true).
        // ECONOMY-INTEGRITY: in a cohort the HUD must show MY personal wallet, not the
        // shared pot — spread my virtualized wallet fields over the snapshot state
        // (buildSnapshot reads `gold`, `materials`, and `consumables` for the potion
        // counts + quick-use `ready` flags). Applies for EVERY cohort member incl. index 0
        // (even the authority's personal share diverges from the pot over time). Never
        // mutates the live `state`.
        let snapState: GameState = state;
        if (cohortActive) {
          const heroes =
            myCohortIndex > 0
              ? [
                  state.heroes[myCohortIndex],
                  ...state.heroes.filter((_, i) => i !== myCohortIndex),
                ]
              : state.heroes;
          const w = myVirtualWallet();
          // PROGRESSION-INTEGRITY (owner bug batch B): the zone-unlock gauge (`buildSnapshot`
          // reads `state.kills`) must show MY full-credit progress, not the shared pot's raw
          // counter — override it with my settled current-zone value (throwaway-view spread,
          // exactly like the wallet override; NEVER writes the live `state`, so it can't
          // enter the hash).
          const settledProg = settledProgress();
          const zk = `${state.location.mapId}:${state.location.zoneIdx}`;
          const kills = settledProg ? (settledProg.zoneKills[zk] ?? state.kills) : state.kills;
          // FIX 4 (2026-07-09) + asura per-member accounting: override the progression fields
          // `buildSnapshot` reads (`unlockedZones` via `effectiveUnlockedZones`/`worldNav`; the
          // asura essence/zone-kills/sigils; tome pages/unlock + the derived `hasAllZoneStones`/
          // `canCraftLegendary`/`craftBlockReason` gates) with MY OWN settled values, so every
          // member sees their own gauge/walk-arrows/tome checklist — not the shared authority's.
          // `unlockedZones` is DERIVED from my settled kills (`deriveUnlockedZones`, mirrors the
          // engine's `checkZoneUnlock`) so a member who personally re-cleared a zone in the
          // cohort sees it unlocked LIVE and can walk on.
          let prog: Partial<GameState> = {};
          if (settledProg) {
            const derivedUnlocked = deriveUnlockedZones(settledProg);
            // One-shot "new zone unlocked!" notice when a zone flips unlocked for ME (the
            // engine's `zoneUnlocked` event never fires in the shared state the authority
            // already unlocked). Compare against last frame's derived map.
            if (cohortPrevDerivedUnlocked) {
              for (const mapId of Object.keys(derivedUnlocked)) {
                if ((derivedUnlocked[mapId] ?? 0) > (cohortPrevDerivedUnlocked[mapId] ?? 0)) {
                  useGameStore.getState().pushNotice("cohortZoneUnlocked");
                  break;
                }
              }
            }
            cohortPrevDerivedUnlocked = derivedUnlocked;
            prog = {
              unlockedZones: derivedUnlocked,
              asuraEssence: settledProg.asuraEssence,
              asuraZoneKills: settledProg.asuraZoneKills,
              asuraSigils: settledProg.asuraSigils,
              tomePages: settledProg.tomePages,
              tomeUnlocked: settledProg.tomeUnlocked,
            };
          }
          snapState = w
            ? {
                ...state,
                heroes,
                kills,
                ...prog,
                gold: w.gold,
                goldEarned: w.goldEarned,
                materials: w.materials,
                consumables: { ...state.consumables, ...w.consumables },
              }
            : { ...state, heroes, kills, ...prog };
        }
        store.syncFromEngine(buildSnapshot(snapState));
      }

      // Feeds TimeDirector's trigger scan on the NEXT rAF frame (one-frame
      // latency by design — see timeDirector.ts's class doc).
      lastFrameEvents = frameEvents;
    }

    // ---- M3: autosave (server-authoritative persistence) ----
    // The server validates every field, ignores the client `lastSeen`, and
    // re-stamps it. Fire-and-forget: a dropped autosave just means the next one
    // (or the on-hide beacon) carries the progress.
    function serialize(): SaveData {
      // M8 party P4b (design D): while an ACTIVE cohort is live, `state.heroes` holds
      // every present member's hero — save ONLY MY OWN (`toSaveData` reads
      // `heroes[0]`, so this is the one place that matters; the shape is otherwise
      // unchanged). Never a route for cross-crediting another player's progress —
      // each client only ever POSTs its own slice.
      if (cohortActive) {
        const mine = state.heroes[myCohortIndex] ?? state.heroes[0];
        // ECONOMY-INTEGRITY: never persist the SHARED pot into my save row — overwrite the
        // wallet fields with my virtualized personal share (cohortWallet.ts). Without this,
        // autosave + the hide beacon write the authority's gold/goldEarned/consumables into
        // MY row (materials is server-authoritative on persist, but included for a coherent
        // blob). `myVirtualWallet` reads the live pot, never mutating it.
        const w = myVirtualWallet();
        // Bot settings are PER HERO now (2026-07-09): persist MY OWN hero's bot config (not the
        // shared lane-0 `state.bot`) so autosave/the hide beacon carry the settings I actually
        // set in the cohort — `toSaveData` reads `state.bot`, so overlay it on the throwaway base.
        const base = { ...state, heroes: [mine], bot: botSettingsFrom(mine.config, state.bot) };
        // PROGRESSION-INTEGRITY (cohortProgress.ts): same shape as the wallet override —
        // `base` is a THROWAWAY shallow clone (never the live `state`, so mutating its
        // scalar fields here can't desync the lockstep sim), overwritten with MY SETTLED
        // world-progression snapshot (frozen base + full credit for kills made in the cohort,
        // batch B) so autosave/the hide beacon never persist a deep friend's zone unlocks (or
        // wipe my own asura/tome progress, which isn't part of the shared slice at all and
        // would otherwise save as the cohort rebuild's zeroed defaults) AND my in-cohort
        // farming isn't lost on the next save. Falls back to the frozen base if the
        // zoneKills baseline somehow isn't set yet.
        const settledProg = settledProgress() ?? cohortProgressBase;
        if (settledProg) applyProgressSlice(base, settledProg);
        return toSaveData(
          w
            ? {
                ...base,
                gold: w.gold,
                goldEarned: w.goldEarned,
                materials: w.materials,
                consumables: { ...state.consumables, ...w.consumables },
              }
            : base,
        );
      }
      return toSaveData(state);
    }

    // Cross-device UI config (owner request 2026-07-07): the autosave POST body
    // carries the current preference snapshot as a sibling `uiConfig` key (the
    // server splits it off before the strict save-schema validation). ALSO
    // write-through to localStorage on the same cadence so the offline fallback
    // stays current with mid-session toggles.
    function serializeWithUiConfig(): SaveData & { uiConfig: UiConfig } {
      const uiConfig = selectUiConfig(useGameStore.getState());
      writeUiConfig(uiConfig);
      return { ...serialize(), uiConfig };
    }

    function autosave(): void {
      void fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serializeWithUiConfig()),
        keepalive: true,
      })
        .then((res) =>
          res.ok
            ? (res.json() as Promise<{
                announcements?: AnnouncementWire[];
                /** Mid-session "new patch deployed" banner — see the GET boot
                 * handler above / `@/server/buildId` / `@/ui/updateBanner`. */
                buildId?: string | null;
                /** M8 quest Wave B/C: today's daily roster (serverDay + up to
                 * `rosterSize` quest ids), recomputed every request from the
                 * SERVER clock — zero extra requests (see the GET boot
                 * handler above / `@/server/dailyQuests`). */
                dailies?: { serverDay: number; questIds: string[] };
              }>)
            : null,
        )
        .then((json) => {
          // M7.9: the polling piggyback — every autosave response carries any
          // recent server-wide high-refine landing (no websockets this phase).
          if (json?.announcements) {
            useGameStore.getState().ingestAnnouncementFeed(json.announcements);
          }
          if (json?.buildId) {
            useGameStore.getState().setServerBuildId(json.buildId);
          }
          // M8 quest Wave C: refresh the engine's daily roster on every autosave
          // tick too (idempotent same-day reconcile) — picks up a server-day
          // rollover mid-session within one cadence, same "zero extra requests"
          // piggyback as announcements/buildId above.
          if (json?.dailies) {
            useGameStore.getState().queueSetDailies(json.dailies.serverDay, json.dailies.questIds);
          }
        })
        .catch(() => {
          /* offline / transient failure — next autosave retries */
        });
      // Same cadence as the save POST (see the drop-claim flush's own doc below).
      flushClaims();
      // World boss "เสี่ยจ๋อง": retry a network-failed (or characterId-not-yet-
      // resolved) claim on the same cadence — see `attemptWorldBossClaim`'s doc.
      if (pendingWorldBossClaim && !worldBossClaimInFlight) {
        const claim = pendingWorldBossClaim;
        pendingWorldBossClaim = null;
        settleWorldBossClaim(claim.windowId);
      }
    }

    // ---- M7 Gear & Drops: batched drop-claim flush (same cadence as autosave,
    // see the call site below). Fire-and-forget; on a network failure the batch
    // is RE-QUEUED (claims are server-side idempotent via claimKey — a retry
    // can never double-mint, see `docs/persistence-m7.md`), so nothing here can
    // lose a drop except the tab-hide beacon path (accepted v1 tradeoff — noted
    // on `onVisibility` below and in the ui/README). One flush in flight at a
    // time so two overlapping timers can't race the same buffer. ----
    function applyClaimResults(results: ClaimItemResultWire[]): void {
      const minted: ItemInstanceWire[] = [];
      const rejectedCounts: Partial<Record<string, number>> = {};
      for (const r of results) {
        if (r.status === "rejected") {
          rejectedCounts[r.reason] = (rejectedCounts[r.reason] ?? 0) + 1;
          continue;
        }
        minted.push(r.item);
        if (r.status === "minted") {
          const template = ITEM_TEMPLATES[r.item.templateId];
          useGameStore
            .getState()
            .pushDropFeed(r.item.templateId, template?.rarity ?? "common");
        }
      }
      if (minted.length) {
        useGameStore.getState().mergeInventory(minted);
        void performAutoEquip(); // wear an upgrade the moment it drops
      }
      if (Object.keys(rejectedCounts).length) {
        console.warn("[GameClient] drop-claim rejections:", rejectedCounts);
      }
    }

    /** หินเสริมพลัง claim results (`stoneResults`) — mirrors `applyClaimResults`'
     * shape, but the only local-state mutation is crediting the AUTHORITATIVE
     * `totalMaterials` the server already summed (same `creditMaterials`
     * intent path the old salvage response used — see `postClaimBatch`'s doc). */
    function applyStoneClaimResults(
      results: StoneClaimResultWire[],
      totalMaterials: number,
    ): void {
      const rejectedCounts: Partial<Record<string, number>> = {};
      for (const r of results) {
        if (r.status === "rejected") {
          rejectedCounts[r.reason] = (rejectedCounts[r.reason] ?? 0) + 1;
        }
      }
      if (totalMaterials > 0) useGameStore.getState().creditMaterials(totalMaterials);
      if (Object.keys(rejectedCounts).length) {
        console.warn("[GameClient] stone-claim rejections:", rejectedCounts);
      }
    }

    function flushClaims(): void {
      if (claimInFlight || (pendingClaims.length === 0 && pendingStoneClaims.length === 0)) {
        return;
      }
      const { batch, remaining } = takeBatch(pendingClaims, MAX_CLAIM_BATCH);
      const { batch: stoneBatch, remaining: stoneRemaining } = takeBatch(
        pendingStoneClaims,
        MAX_CLAIM_BATCH,
      );
      pendingClaims = remaining;
      pendingStoneClaims = stoneRemaining;
      claimInFlight = true;
      void postClaimBatch(batch, stoneBatch)
        .then((res) => {
          if (res) {
            applyClaimResults(res.results);
            if (res.stoneResults) {
              applyStoneClaimResults(res.stoneResults, res.totalMaterials ?? 0);
            }
          } else {
            // network failure — retry next cadence
            pendingClaims = [...batch, ...pendingClaims];
            pendingStoneClaims = [...stoneBatch, ...pendingStoneClaims];
          }
        })
        .finally(() => {
          claimInFlight = false;
        });
    }

    // Best-effort synchronous flush via `sendBeacon` — guaranteed to fire
    // during unload where a normal `fetch` may be killed. Shared by the
    // tab-hide handler below AND the mid-session update banner's "อัปเดตเลย"
    // reload button (owner spec: "never reload without the flush" — see the
    // `updateReloadRequested` subscription further down).
    function flushSaveBeacon(): void {
      const blob = new Blob([JSON.stringify(serializeWithUiConfig())], {
        type: "application/json",
      });
      navigator.sendBeacon("/api/save", blob);

      // Best-effort drop-claim flush via the same fire-and-forget beacon
      // mechanism (gear items AND หินเสริมพลัง stones in the SAME batch, same
      // contract as `flushClaims`). UNLIKE the save beacon, a lost claim
      // beacon here is an accepted v1 loss (no response to merge into the
      // inventory/materials slices even if it lands) — documented tradeoff,
      // see this function's doc comment.
      if (pendingClaims.length > 0 || pendingStoneClaims.length > 0) {
        const claimBlob = new Blob(
          [
            JSON.stringify({
              items: pendingClaims.slice(0, MAX_CLAIM_BATCH),
              stones: pendingStoneClaims.slice(0, MAX_CLAIM_BATCH),
            }),
          ],
          { type: "application/json" },
        );
        navigator.sendBeacon("/api/items/claim", claimBlob);
        pendingClaims = [];
        pendingStoneClaims = [];
      }
    }

    // On tab-hide (covers most real "closing the game" cases): sendBeacon is
    // guaranteed to flush during unload where a normal fetch may be killed.
    // ALSO doubles as the backgrounded-tab catch-up's hide/show boundary
    // (owner request 2026-07): records `hiddenAt` on the way out, replays the
    // gap via `handleReturnFromBackground` on the way back in.
    function onVisibility(): void {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        flushSaveBeacon();
        const party = useGameStore.getState().party;
        // FIX 5 LANE-KEEPALIVE (owner: "พับจอแล้วยัง active, และปิดจริงต้องไม่ค้าง"): if I'm in an
        // ACTIVE cohort, do NOT teardown/collapse. The rAF loop pauses (no local execute), but
        // I keep ISSUING my idle lanes to peers via `issueOnlyTick` (driven by inbound peer
        // messages + a 1s fallback interval), so the whole cohort NEVER stalls waiting on me
        // and my hero keeps "farming" in the shared sim. On resume I burst-execute the buffered
        // backlog (the `cohortCatchUp` path in `frame()`) to catch my local state up. The TRUE
        // -close / OS-freeze cases are handled by `onPageHide`/`onFreeze` (clean-close) + the
        // relay heartbeat (silent death), NOT here — this branch is only the reversible hide.
        if (cohortActive && cohortEngine && party) {
          hiddenKeepaliveActive = true;
          hiddenKeepaliveStartedAt = Date.now();
          keepaliveLastIssueAt = performance.now();
          if (!keepaliveInterval) {
            keepaliveInterval = setInterval(issueOnlyTick, KEEPALIVE_ISSUE_INTERVAL_MS);
          }
        } else if (party) {
          // Party but not in an active cohort (solo-in-party / town) — no peer lanes depend on
          // me, so the legacy leave behavior is fine: collapse (no-op if not active) + teardown.
          collapseToSolo();
          partySession.teardown();
        }
        // Ghost presence: a hidden tab pauses rAF, so stop publishing + close the world
        // socket clean (peers despawn my ghost on silence). Unchanged by FIX 5.
        syncWorldSessionActive();
        return;
      }
      if (document.visibilityState === "visible") {
        if (hiddenKeepaliveActive) {
          // FIX 5 RESUME from lane-keepalive: stop the fallback interval and decide between the
          // fast in-place catch-up and the legacy fallback.
          hiddenKeepaliveActive = false;
          if (keepaliveInterval) {
            clearInterval(keepaliveInterval);
            keepaliveInterval = undefined;
          }
          const hiddenMs = Date.now() - hiddenKeepaliveStartedAt;
          const canBurst =
            cohortActive &&
            !!cohortEngine &&
            partyConnStatus === "connected" &&
            hiddenMs <= HIDDEN_KEEPALIVE_MAX_MS;
          if (canBurst) {
            // Drain the buffered backlog in budgeted bursts inside the rAF loop (see the
            // `cohortCatchUp` branch in `frame()`). The burst IS the catch-up, so skip the solo
            // offline replay; reset the frame clock so the first `elapsed` isn't a giant gap.
            cohortCatchUp = true;
            hiddenAt = null;
            lastTime = performance.now();
            lastActiveAt = Date.now();
          } else {
            // Hidden too long, or the socket died while away (a reconnect already collapsed me
            // to solo) — fall back to the legacy path: leave cleanly, solo catch-up, re-handshake.
            collapseToSolo();
            partySession.teardown();
            handleReturnFromBackground();
            const party = useGameStore.getState().party;
            if (party) partySession.setParty(party);
          }
          syncWorldSessionActive();
          return;
        }
        handleReturnFromBackground();
        // Re-join with a FRESH ticket (a prior teardown forgot the partyId): re-mints, re-beats
        // my zone, re-handshakes into a cohort if peers are still here. `setParty` is idempotent
        // when already live, so a hide that never actually tore down is a safe no-op.
        const party = useGameStore.getState().party;
        if (party) partySession.setParty(party);
        // Ghost presence: reopen the world socket if the feature is on (idempotent).
        syncWorldSessionActive();
      }
    }

    /** FIX 5: shared clean-close for the TRUE-close / OS-freeze paths — clears the keepalive
     * driver and tears the party socket down with a clean 1000 so peers shadow me INSTANTLY
     * (no ~35s relay-heartbeat wait). The next `visible`/`pageshow` re-handshakes. */
    function teardownPartyForClose(): void {
      if (keepaliveInterval) {
        clearInterval(keepaliveInterval);
        keepaliveInterval = undefined;
      }
      hiddenKeepaliveActive = false;
      cohortCatchUp = false;
      if (useGameStore.getState().party) partySession.teardown();
    }

    // bfcache restore (mobile back/forward navigation, some screen-fold cases)
    // fires `pageshow` with `persisted: true` INSTEAD OF a fresh page load —
    // `visibilitychange` may or may not have fired first depending on the
    // browser, so `handleReturnFromBackground` falls back to `lastActiveAt`
    // when `hiddenAt` is unset (see its doc comment). Idempotent if both fire
    // (`hiddenAt` is cleared after the first call).
    function onPageShow(e: PageTransitionEvent): void {
      if (e.persisted) {
        // A bfcache restore may arrive without a preceding `visible` (some browsers) — if we
        // were mid lane-keepalive, exit it and fall through to the standard rejoin (a frozen
        // bfcache page couldn't keep issuing, so a clean re-handshake is the safe choice).
        if (hiddenKeepaliveActive) teardownPartyForClose();
        handleReturnFromBackground();
        // Same rejoin as the visible path — a bfcache restore may have torn the session down
        // (or frozen the socket) while away. `setParty` is idempotent if still connected.
        const party = useGameStore.getState().party;
        if (party) partySession.setParty(party);
      }
    }

    // FIX 5 TRUE-CLOSE: `pagehide` fires on a real navigate-away / tab close. persisted===false
    // = the page is being discarded → clean-close the party socket so peers shadow me INSTANTLY
    // (the teardown-on-hide behavior moved here off `visibilitychange`, which now keeps the
    // cohort alive for a reversible hide). persisted===true = bfcache freeze → leave the socket
    // for `pageshow` to resume (JS is suspended; nothing useful to do here beyond the flush).
    function onPageHide(e: PageTransitionEvent): void {
      flushSaveBeacon();
      if (!e.persisted) teardownPartyForClose();
    }

    // FIX 5 OS-FREEZE: Page Lifecycle `freeze` — the browser is about to suspend a backgrounded
    // tab; its socket will die silently. Clean-close now (same as pagehide-non-persisted) so
    // peers shadow me instantly instead of waiting on the relay heartbeat; the `resume`/
    // `visible`/`pageshow` handler re-handshakes. Typed via a string listener (the Page
    // Lifecycle events aren't in the DOM lib's `DocumentEventMap`).
    function onFreeze(): void {
      flushSaveBeacon();
      teardownPartyForClose();
    }

    // Browsers block audio output until a real user gesture — resume() is
    // idempotent/cheap, so just call it on every gesture rather than trying to
    // detect "the first one" ourselves. Owner hotfix 2026-07-08: the listener
    // used to sit on the ARENA canvas only, so a player who only touched HUD
    // buttons/menus never unlocked sound and felt they had to "keep tapping the
    // game screen". Document-level capture (pointerdown + keydown) makes ANY
    // interaction anywhere on the page count. The autoplay policy itself can't
    // be bypassed — some first gesture is still required — and after a tab
    // switch the visibility retry below picks sound back up without a tap on
    // desktop browsers (mobile re-unlocks on the next touch, wherever it lands).
    function onPointerDown(): void {
      audio.resume();
    }
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    document.addEventListener("keydown", onPointerDown, { capture: true });
    function onVisibleResumeAudio(): void {
      if (document.visibilityState === "visible") audio.resume();
    }
    document.addEventListener("visibilitychange", onVisibleResumeAudio);

    // ---- Town NPCs phase 3 (final): tap-again-to-talk ------------------------
    // A greeting-line bubble + opens that NPC's dialog panel (pahpu -> shop,
    // lungdueng -> refine) via the store's `activeTownPanel` — see
    // `TownNpcPanelHost.tsx`. Rotates through 2-3 i18n lines per NPC
    // (`npcGreetingIndex` above) so repeat taps don't feel canned.
    function talkToNpc(id: TownNpcId): void {
      useGameStore.getState().openTownPanel(townPanelOf(id));
      const key = npcI18nKey(id);
      const idx = npcGreetingIndex[id];
      npcGreetingIndex[id] = (idx + 1) % NPC_GREETING_COUNT;
      renderer.showNpcSpeech(id, tTownNpcRef.current(`${key}.greetings.greeting${idx + 1}`));
    }

    // ---- M7.8 Manual Play: RO-style tap-to-move / tap-to-attack -------------
    // `click` normalizes a mouse click AND a touch tap (fires once, after
    // pointerup) — deliberately NOT hooked on `pointerdown` (that's the
    // audio-resume listener above) so a drag/scroll gesture never doubles as
    // a command. Hit-testing itself is a pure, one-way `GameRenderer` query
    // (`hitTestPointer`); this handler is the integration seam that turns the
    // result into a store intent, same as every other player input in this
    // file (drained once/frame above, never applied directly).
    //
    // Town NPCs phase 3 (final): `hitTestNpc` is checked FIRST while standing
    // in town (a live enemy never coexists with the town zone, so there's no
    // ordering ambiguity with `hitTestPointer`'s monster-wins-over-ground
    // rule). Tap-again-to-talk: out of `npcInRange` -> approach (the same
    // `moveTo` intent + ground-ping juice a plain ground tap gets, walking
    // toward the NPC's anchor x); already in range (including a tap that
    // lands in-range while mid-walk toward them) -> talk. The range check
    // reads LIVE off the closure's `state` (not the throttled store snapshot)
    // so it's never a frame stale.
    function onArenaClick(e: MouseEvent): void {
      if (!arenaEl) return;
      const rect = arenaEl.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;

      const npcHit = renderer.hitTestNpc(canvasX, canvasY, state);
      if (npcHit) {
        if (npcInRange(state, npcHit.id)) {
          talkToNpc(npcHit.id);
        } else {
          useGameStore.getState().queueMoveTo(townNpcConfig(npcHit.id).x);
        }
        return;
      }

      const hit = renderer.hitTestPointer(canvasX, canvasY, state);
      if (!hit) return;
      if (hit.kind === "monster") useGameStore.getState().queueAttackTarget(hit.id);
      else useGameStore.getState().queueMoveTo(hit.x);
    }
    arenaEl.addEventListener("click", onArenaClick);

    // Desktop-only cursor affordance (owner directive: comfortable on both
    // desktop AND mobile) — a crosshair while hovering a live target. Guarded
    // to `pointerType === "mouse"` so a touch drag never leaves a stuck cursor
    // style (touch devices don't fire `pointermove` without an active touch,
    // but this is a defensive no-op guard nonetheless).
    function onArenaPointerMove(e: PointerEvent): void {
      if (!arenaEl || e.pointerType !== "mouse") return;
      const rect = arenaEl.getBoundingClientRect();
      const hit = renderer.hitTestPointer(
        e.clientX - rect.left,
        e.clientY - rect.top,
        state,
      );
      arenaEl.style.cursor = hit?.kind === "monster" ? "crosshair" : "";
    }
    arenaEl.addEventListener("pointermove", onArenaPointerMove);

    // Pixi init + save load run in parallel; the loop starts only after both
    // resolve. Guards against the effect having been cleaned up mid-flight
    // (React Strict Mode's dev mount/unmount/mount) by tearing the renderer
    // back down instead of leaking an orphaned canvas.
    const boot = async (): Promise<void> => {
      // ---- cross-device UI config: seed from the localStorage FALLBACK first
      // (owner request 2026-07-07) so a boot with a dead/slow API still restores
      // the last-known preferences; the SERVER value (below) then WINS. ----
      const localUiConfig = readStoredUiConfig();
      if (localUiConfig) useGameStore.getState().hydrateUiConfig(localUiConfig);

      // ---- load the server-authoritative save (before initGameState) ----
      let loaded: SaveData | undefined;
      let bootClass: HeroClass | undefined; // fresh-character first boot class
      let offlineSeconds = 0;
      let offlineCapped = false;
      try {
        const res = await fetchWithTimeout(
          "/api/save",
          { method: "GET" },
          SAVE_LOAD_TIMEOUT_MS,
        );
        if (res.ok) {
          const json = (await res.json()) as {
            save: SaveData | null;
            offline?: { creditedSeconds: number; capped: boolean };
            // M7 boot payload (server: src/app/api/save/route.ts GET) — always
            // present (possibly empty arrays/nulls pre-character).
            inventory?: ItemInstanceWire[];
            equipped?: { weapon: string | null; armor: string | null };
            /** M7.6 ตีบวก: the AUTHORITATIVE material balance (DB column) —
             * overwrites the save blob's own mirror, same precedence rule as
             * `equipped` below. */
            materials?: number;
            /** Cross-device UI config (owner request 2026-07-07): the
             * per-character preference blob, or null (pre-existing/fresh
             * character → keep the localStorage fallback/defaults). When present
             * it WINS over localStorage — see `UiConfig`'s doc. */
            uiConfig?: Partial<UiConfig> | null;
            /** Authoritative character class (Character.baseClass) — corrects
             * a save whose hero.cls drifted + seeds a first boot (2026-07-06
             * "everyone is a swordsman" fix). */
            baseClass?: HeroClass | null;
            /** M7.9: this client's own active characterId (self-exclusion key
             * for the announcement banner — see `myCharacterId`'s doc). */
            activeCharacterId?: string | null;
            /** M7.9: a fresh login's recent server-wide high-refine feed
             * (last 5 min, LIMIT 10, newest-first) — same shape the autosave
             * POST response carries every ~30s thereafter. */
            announcements?: AnnouncementWire[];
            /** Mid-session "new patch deployed" banner: the server's build id
             * (see `@/server/buildId`), present on this boot response too —
             * compared against this client's own inlined `CLIENT_BUILD_ID`
             * (`@/ui/updateBanner`). */
            buildId?: string | null;
            /** M8 quest Wave B/C: today's daily roster (serverDay + up to
             * `rosterSize` quest ids), present even pre-character (the roster
             * is USER-scoped) — see `@/server/dailyQuests`. */
            dailies?: { serverDay: number; questIds: string[] };
            /** World boss "เสี่ยจ๋อง": the server's wall clock at response time —
             * seeds `serverTimeOffset` so the spawn-schedule countdown is aligned
             * to the SERVER clock, never the device clock (see `serverNowMs`'s
             * doc). Always present (both the pre-character and full branches of
             * the GET handler send it). */
            serverNow?: number;
          };
          // Server already migrated; pass through migrate() again defensively —
          // never trust a received save's shape/version (CLAUDE.md rule).
          if (json.save) loaded = migrate(json.save);
          if (typeof json.serverNow === "number") {
            serverTimeOffset = json.serverNow - Date.now();
          }
          // Class repair (2026-07-06): the account's baseClass is authoritative
          // over the save blob's hero.cls — a corrupted save gets its class
          // corrected + wrong-primary stat points refunded (engine helper).
          if (loaded && json.baseClass) loaded = repairHeroClass(loaded, json.baseClass);
          if (json.baseClass) bootClass = json.baseClass;
          // M7.9: record OUR OWN characterId (self-exclusion for the
          // announcement banner) before ingesting the boot feed, so a
          // same-poll self-landing (unlikely at boot, but cheap to guard) is
          // correctly filtered.
          if ("activeCharacterId" in json) {
            useGameStore.getState().setMyCharacterId(json.activeCharacterId ?? null);
          }
          if (json.announcements) {
            useGameStore.getState().ingestAnnouncementFeed(json.announcements);
          }
          if (json.buildId) {
            useGameStore.getState().setServerBuildId(json.buildId);
          }
          // M8 quest Wave C: queue the boot roster — the engine applies it on
          // the very first real frame() tick (harmless even pre-character;
          // `setHeroDailies` no-ops on an absent hero).
          if (json.dailies) {
            useGameStore.getState().queueSetDailies(json.dailies.serverDay, json.dailies.questIds);
          }
          if (json.offline) {
            offlineSeconds = json.offline.creditedSeconds;
            offlineCapped = json.offline.capped;
          }
          // Cross-device UI config: the SERVER value WINS over the localStorage
          // fallback seeded above (applied last). Null (pre-existing/fresh
          // character) → keep whatever the fallback/defaults gave us.
          if (json.uiConfig) useGameStore.getState().hydrateUiConfig(json.uiConfig);
          // M7: the DB `ItemInstance` ledger is AUTHORITATIVE over the save
          // blob's own `equipped` cache (precedence documented at the API) —
          // overwrite it BEFORE `initGameState` derives max HP from it below.
          if (loaded && json.equipped) loaded.equipped = { ...json.equipped };
          // M7.6 ตีบวก: the DB `Character.materials` column is authoritative
          // over the save blob's own counter — same precedence as `equipped`.
          if (loaded && typeof json.materials === "number") {
            loaded.materials = json.materials;
          }
          // Seed the inventory store slice straight from the boot payload —
          // this is the ONLY normal hydration path (InventoryPanel never
          // fetches on its own mount, only on an equip-failure resync).
          if (json.inventory) {
            useGameStore.getState().setInventory(json.inventory.map(toInventoryItem));
            void performAutoEquip(); // boot in best gear (no-op if already worn)
            // M7.5 "NEW" badge baseline: everything owned AT BOOT is "known" —
            // any templateId minted afterward reads as new for this session
            // (see `sessionKnownTemplateIds`'s doc).
            useGameStore
              .getState()
              .setSessionKnownTemplateIds(json.inventory.map((i) => i.templateId));
          }
        }
      } catch {
        /* first run / network down / slow-LAN timeout: start cold rather than
           blocking the game from ever starting */
      }

      if (cancelled) return;

      if (loaded) state = initGameState(seed, loaded);
      // No save yet (a just-created character): seed the fresh state with the
      // TRUE class instead of the swordsman default.
      else if (bootClass) state = initGameState(seed, undefined, bootClass);

      // ---- offline-idle catch-up ----
      // Replay the capped offline seconds through the SAME fixed-step/cap
      // primitive the mid-session backgrounded-tab catch-up reuses below
      // (`resolveCatchUp`/`replayFixedSteps`), bounded by OFFLINE_SYNC_BUDGET_MS
      // (see its comment).
      const { steps: totalOfflineSteps } = resolveCatchUp(offlineSeconds * 1000, {
        fixedDtSeconds: FIXED_DT,
        capHours: CONFIG.offlineCapHours,
      });
      if (totalOfflineSteps > 0) {
        const goldBefore = state.gold;
        const ran = replayFixedSteps(totalOfflineSteps, OFFLINE_SYNC_BUDGET_MS);
        // TODO(M4): surface this in the HUD instead of the console.
        console.log(
          `ได้ทองระหว่างออฟไลน์ +${state.gold - goldBefore} ` +
            `(${Math.round(offlineSeconds)}s${offlineCapped ? ", capped" : ""}, ` +
            `simulated ${ran}/${totalOfflineSteps} steps)`,
        );
      }

      // Don't init Pixi against a 0x0 mount (mobile aspect-ratio/flex reflow can
      // report zero for the first frame or two).
      await waitForNonZeroSize(arenaEl);
      if (cancelled) return;

      await renderer.create(arenaEl);
      if (cancelled) {
        renderer.destroy();
        return;
      }

      autosaveTimer = setInterval(autosave, AUTOSAVE_INTERVAL_MS);
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("pageshow", onPageShow);
      window.addEventListener("pagehide", onPageHide);
      document.addEventListener("freeze", onFreeze); // Page Lifecycle (not in DocumentEventMap)

      // Mid-session "new patch deployed" banner: the update button's ONLY
      // entry point into this effect's closure — `UpdateBanner.tsx` just
      // flips `updateReloadRequested` via a store action; this is the one
      // place with access to `flushSaveBeacon`/the live engine state, same
      // "UI dispatches an intent, the integration loop drains it" shape as
      // `pendingInput`. Zustand's `subscribe` fires synchronously on `set()`.
      unsubscribeReload = useGameStore.subscribe((next, prev) => {
        if (next.updateReloadRequested && !prev.updateReloadRequested) {
          flushSaveBeacon();
          window.location.reload();
        }
      });

      // M8 party P4b: `PartySession` is dormant (zero ticket fetch) until the store's
      // `party` field is non-null — see `partySession.ts`'s module doc. `party` is
      // pushed by the ONE friends poll (`useFriendsPoll.ts`), so this is the same
      // "push into the store, GameClient subscribes" idiom as `updateReloadRequested`
      // above. Feed the CURRENT value too (a poll may have already landed before this
      // subscription attaches — e.g. `FriendsButton` mounted earlier in the same tick).
      unsubscribeParty = useGameStore.subscribe((next, prev) => {
        if (next.party !== prev.party) {
          partySession.setParty(next.party);
          // A fresh friends poll may carry names the cohort couldn't resolve yet (the
          // relay only ever hands us userIds) — re-resolve and, if a cohort is live,
          // re-push the now-known names to the HUD chip + hero nameplates.
          resolveCohortNames();
          if (cohortActive) refreshCohortStatus();
        }
      });
      partySession.setParty(useGameStore.getState().party);

      // Ghost presence: react to the Settings toggle. Flipping it on/off lazily opens or
      // closes the world socket (and clears ghosts) via `syncWorldSessionActive`. Feed the
      // CURRENT value now (a hydrate may have landed before this subscription attaches).
      ghostsFeatureOn = useGameStore.getState().ghostsVisible;
      unsubscribeGhosts = useGameStore.subscribe((next, prev) => {
        if (next.ghostsVisible !== prev.ghostsVisible) {
          ghostsFeatureOn = next.ghostsVisible;
          syncWorldSessionActive();
        }
      });
      // Wave 3 "chat UI": the chat panel opening/closing ALSO drives the world socket
      // lifecycle (decoupled from `ghostsVisible` — see `syncWorldSessionActive`'s doc).
      chatFeatureOn = useGameStore.getState().chatOpen;
      unsubscribeChatOpen = useGameStore.subscribe((next, prev) => {
        if (next.chatOpen !== prev.chatOpen) {
          chatFeatureOn = next.chatOpen;
          syncWorldSessionActive();
        }
      });
      // Wave 3 "chat UI": the panel's send button reaches the live `worldSession`
      // instance through this signal (same "UI dispatches, GameClient's loop/effect
      // drains it" shape as `updateReloadRequested` above, just a CustomEvent instead of
      // a store field since sending is repeatable/non-engine — see `chatSendSignal.ts`).
      unsubscribeChatSend = onSendChatRequest((text) => worldSession.sendChat(text));
      syncWorldSessionActive();

      // HOF seasonal rewards: the Settings title picker (`TitleSection.tsx`)
      // writes a fresh `mySocialBadge` straight into the store the instant
      // `POST /api/hof/title` succeeds — this subscription is the ONLY thing
      // that re-pushes it to the nameplate/aura render seam without waiting
      // for the next `townArrived` refresh. Solo-only in effect (cohort reads
      // the friends-poll `party` rows instead — see `currentHeroSocialBadges`),
      // but re-pushing is harmless either way.
      unsubscribeSocialBadge = useGameStore.subscribe((next, prev) => {
        if (next.mySocialBadge !== prev.mySocialBadge) pushHeroSocialBadges();
      });

      lastTime = performance.now();
      lastActiveAt = Date.now();
      rafId = requestAnimationFrame(frame);
    };

    // Surface any boot failure instead of letting `void boot()` swallow the
    // rejection (which previously left the loop unstarted and the whole HUD
    // frozen at store defaults with no error anywhere).
    boot().catch((err: unknown) => {
      if (cancelled) return;
      console.error("[GameClient] boot failed:", err);
      showFatalError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (autosaveTimer) clearInterval(autosaveTimer);
      if (connectingChipTimer) clearTimeout(connectingChipTimer);
      unsubscribeReload?.();
      unsubscribeParty?.();
      unsubscribeSocialBadge?.();
      unsubscribeGhosts?.();
      unsubscribeChatOpen?.();
      unsubscribeChatSend?.();
      partySession.teardown();
      worldSession.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("freeze", onFreeze);
      if (keepaliveInterval) clearInterval(keepaliveInterval);
      document.removeEventListener("pointerdown", onPointerDown, { capture: true });
      document.removeEventListener("keydown", onPointerDown, { capture: true });
      document.removeEventListener("visibilitychange", onVisibleResumeAudio);
      arenaEl.removeEventListener("click", onArenaClick);
      arenaEl.removeEventListener("pointermove", onArenaPointerMove);
      errorEl?.remove();
      errorEl = null;
      renderer.destroy();
      audio.destroy();
    };
  }, []);

  return (
    <>
      <GameHud ref={arenaRef} />
      {/* UAT "what's new" patch-notes modal — mount only; all decision logic
          lives in `ui/hooks/usePatchNotes.ts` (see that file + `ui/patchNotes.ts`). */}
      <PatchNotesModal />
      {/* "ตำราตำนาน" secret-quest reveal — mount only; the store's `tomeAssembledCelebration`
          flag (flipped off the `tomeAssembled` engine event above) drives visibility. */}
      <AsuraTomeAssembledModal />
    </>
  );
}
