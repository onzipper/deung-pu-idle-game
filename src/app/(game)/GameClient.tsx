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
  effectiveUnlockedZones,
  type GameEvent,
  type GameState,
  type Hero,
  type HeroClass,
  type SaveData,
  type TownNpcId,
} from "@/engine";
import { type TurnMessage } from "@/engine/lockstep";
import { AudioController } from "@/render/audio";
import { GameRenderer } from "@/render/GameRenderer";
import type { AnnouncementWire } from "@/ui/announcements/types";
import { GameHud } from "@/ui/components/GameHud";
import { PatchNotesModal } from "@/ui/components/PatchNotesModal";
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
  type DailyQuestSummary,
  type EngineSnapshot,
  type HeroQuestSummary,
  type HeroSummary,
  type MainChapterSummary,
  type ShopSummary,
  type SkillSummary,
  type TownPanelId,
  type UiConfig,
} from "@/ui/store/gameStore";
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
  resolveMemberDisplayName,
  synthesizeShadowMessage,
  type CohortMember,
  type PartyConnStatus,
} from "./partySession";
import { CohortTurnEngine, type CohortTickIO } from "./cohortTurnEngine";
import { buildFrameInput, hasZoneChangeIntent, sanitizeLanes } from "./buildFrameInput";
import { TimeDirector } from "./timeDirector";

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

/** Wall time between periodic autosave POSTs. */
const AUTOSAVE_INTERVAL_MS = 30_000;

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
    // fast-travel picker's lock read).
    bot: { ...state.bot },
    autoHunt: state.autoHunt,
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
    let lastCohortSlots: number[] = [];
    const shadowedTicketSlots = new Set<number>();
    /** ticket slot -> userId, for cohort members OTHER than me (from the relay welcome/
     * membership stream). The stable key we resolve friendly names against. */
    let cohortMemberIds = new Map<number, string>();
    /** ticket slot -> RESOLVED display name (never a userId — null resolutions omitted).
     * Rebuilt by `resolveCohortNames()` against the friends-poll `party` snapshot. */
    let cohortMemberNames = new Map<number, string>();
    let handshake: PartyHandshake | null = null;
    /** The cohort's lockstep turn scheduler while active (issue/execute cadence, buffer,
     * catch-up, stall/waiting) — see `cohortTurnEngine.ts`. `null` while solo. */
    let cohortEngine: CohortTurnEngine | null = null;
    /** Last-seen `waiting` value from the engine, to detect chip transitions per frame. */
    let cohortPrevWaiting = false;
    let lastZoneKey: string | null = null;

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
      useGameStore.getState().setCohortStatus({ kind: "active", names: [...cohortMemberNames.values()] });
      renderer.setHeroDisplayNames(currentHeroDisplayNames());
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

    /** Cohort -> solo (design C): extract MY hero, rebuild solo via the exact same
     * `buildCohortState` primitive (`extractSoloState`), resume the ordinary solo
     * accumulator loop next frame. */
    function collapseToSolo(): void {
      if (!cohortActive) return;
      state = extractSoloState(state, myCohortIndex, seed);
      cohortActive = false;
      handshake?.abort();
      handshake = null;
      cohortEngine = null;
      cohortPrevWaiting = false;
      cohortMemberNames = new Map();
      renderer.setHeroDisplayNames(null);
      renderer.setPovHeroIndex(0);
      useGameStore.getState().setCohortStatus({ kind: "solo" });
    }

    /** Begin (or restart) the zone-boundary re-seed handshake for a fresh cohort
     * membership (design §4). */
    function beginHandshake(cohortSlots: number[]): void {
      handshake?.abort();
      // The one honest use of the "connecting" chip: a same-zone cohort exists and
      // the re-seed handshake is actually in flight (relay-connected states without
      // a cohort show nothing — see `onPartyStatusChange`).
      useGameStore.getState().setCohortStatus({ kind: "connecting" });
      myTicketSlot = partySession.slot;
      // Pre-handshake, "my own hero" is `heroes[0]` while solo, or `heroes[myCohortIndex]`
      // if this is a re-seed of an ALREADY-active cohort (e.g. a 3rd member joins).
      const myProgression = progressionFromHero(cohortActive ? state.heroes[myCohortIndex] : state.heroes[0]);
      handshake = new PartyHandshake({
        mySlot: myTicketSlot,
        cohortSlots,
        send: (msg) => partySession.send(msg),
        myProgression,
        mySharedSave: sharedSaveFromState(state),
        mintSeed: () => Date.now() >>> 0,
      });
      handshake.start();
    }

    /** Apply a completed handshake (design §4's "every client builds the SAME
     * state"): swap the live `state` to the rebuilt cohort, reset the cohort turn
     * bookkeeping, and flip the HUD chip to "active". */
    function activateCohort(): void {
      if (!handshake || handshake.phase !== "done") return;
      const built = handshake.result;
      if (!built) return;
      state = built;
      handshake = null;
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
        useGameStore.getState().setCohortStatus({ kind: "reconnecting" }); // overrides "solo" above
      } else if (status === "connecting" && !cohortActive) {
        useGameStore.getState().setCohortStatus({ kind: "connecting" });
      } else if (status === "connected" && !cohortActive) {
        // Connected to the relay but no same-zone cohort (yet) — the chip's "solo"
        // (hidden) state, per its design. Without this branch the "connecting" label
        // from the previous status sticks forever while alone in a zone, reading as
        // a stuck connection when the session is actually live and waiting.
        useGameStore.getState().setCohortStatus({ kind: "solo" });
      } else if (status === "off" && !cohortActive) {
        useGameStore.getState().setCohortStatus({ kind: "solo" });
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
      // Record each peer's stable userId (NEVER surface it — `resolveCohortNames`
      // turns it into a friendly name against the friends-poll `party` snapshot).
      cohortMemberIds = new Map();
      for (const slot of cohortSlots) {
        if (slot === myTicketSlot) continue;
        const m = members.get(slot);
        if (m) cohortMemberIds.set(slot, m.userId);
      }
      resolveCohortNames();
      if (cohortSlots.length <= 1) {
        lastCohortSlots = cohortSlots;
        // Discard an in-flight handshake explicitly: `collapseToSolo()` is a no-op
        // when the cohort never ACTIVATED, which would otherwise strand a stale
        // handshake (and its "connecting" chip) after the peer walked away mid-offer.
        handshake?.abort();
        handshake = null;
        collapseToSolo();
        useGameStore.getState().setCohortStatus({ kind: "solo" });
        return;
      }
      const changed = !sameSlots(cohortSlots, lastCohortSlots);
      lastCohortSlots = cohortSlots;
      if (changed) beginHandshake(cohortSlots);
      else refreshCohortStatus(); // membership unchanged — names may have (nick, etc.)
    }

    function onPartyGameMessage(fromSlot: number, seq: number, payload: unknown): void {
      const rec = asRecord(payload);
      if (!rec) return;
      if (rec.kind === "reseed-offer" && handshake) {
        handshake.receiveOffer(fromSlot, payload as ReseedOfferMsg, seq);
        activateCohort();
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
    }

    function onPartyMemberShadowChanged(ticketSlot: number, shadowed: boolean): void {
      if (shadowed) shadowedTicketSlots.add(ticketSlot);
      else shadowedTicketSlots.delete(ticketSlot);
      if (!cohortActive) return;
      const liveTicketSlots = lastCohortSlots.filter((s) => !shadowedTicketSlots.has(s));
      const leader = liveTicketSlots.length ? electLeader(liveTicketSlots) : myTicketSlot;
      const affectedIndex = lastCohortSlots.indexOf(ticketSlot);
      if (affectedIndex < 0) return; // not (or no longer) part of this cohort
      // Fix A.1: unblock the turn scheduler from waiting on a shadowed member's (now
      // absent) lanes — it auto-fills `{}` for this index until it's un-shadowed.
      cohortEngine?.setSlotShadowed(affectedIndex, shadowed);
      const currentTurn = cohortEngine?.turn ?? 0;
      const msg = synthesizeShadowMessage(leader, myTicketSlot, affectedIndex, shadowed, currentTurn);
      if (msg) partySession.send(msg);
    }

    const partySession = new PartySession({
      onCohortChanged: onPartyCohortChanged,
      onGameMessage: onPartyGameMessage,
      onStatusChange: onPartyStatusChange,
      onMemberShadowChanged: onPartyMemberShadowChanged,
    });

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

    function frame(now: number) {
      rafId = requestAnimationFrame(frame);

      // A catch-up replay is a synchronous, blocking call (see
      // `replayFixedSteps`/`handleReturnFromBackground` below) so this should
      // never actually be true when a rAF callback runs — kept as a defensive
      // no-op guard (see `catchingUp`'s doc above).
      if (catchingUp) return;

      const elapsed = Math.min((now - lastTime) / 1000, MAX_FRAME_SECONDS);
      lastTime = now;
      lastActiveAt = Date.now();

      const store = useGameStore.getState();

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

      let frameEvents: GameEvent[];
      if (cohortActive && cohortEngine) {
        const collected: GameEvent[] = [];
        const io: CohortTickIO = {
          // Drained ONLY at issue boundaries (not per rAF frame) — no tap is lost.
          drainInput: () => {
            const pending = store.drainPendingInput();
            if (pending.buyShopItem) manualBuyThisFrame = true;
            return buildFrameInput(pending, store.inventory.length, myCohortIndex);
          },
          send: (msg) => partySession.send(msg),
          runSubStep: (lanes) => {
            // Defense-in-depth (fix B): strip any zone-change field from EVERY lane before
            // step() — identical on all clients, so a stale peer build can't drag the party.
            step(state, sanitizeLanes(lanes));
            collected.push(...state.events);
          },
        };
        const { waiting } = cohortEngine.tick(elapsed * 1000, now, io);
        frameEvents = collected;
        // Map the engine's waiting flag onto the HUD chip on TRANSITIONS only.
        if (waiting && !cohortPrevWaiting) {
          useGameStore.getState().setCohortStatus({ kind: "waiting" });
        } else if (!waiting && cohortPrevWaiting) {
          refreshCohortStatus(); // resumed — restore "active" (names)
        }
        cohortPrevWaiting = waiting;
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

      renderer.draw(state, frameEvents);
      if (frameEvents.length) audio.consumeEvents(frameEvents);

      // M8 party P4b: broadcast a zone beat on every ACTUAL zone change (join +
      // every zone change, protocol/design §3) — cheap string compare, no-op
      // whenever `partySession` is dormant (no party).
      const zoneKey = `${state.location.mapId}:${state.location.zoneIdx}`;
      if (zoneKey !== lastZoneKey) {
        lastZoneKey = zoneKey;
        partySession.setZone(state.location.mapId, state.location.zoneIdx);
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
      for (const ev of frameEvents) {
        if (ev.type === "itemDrop") {
          pendingClaims.push({
            rollId: ev.rollId,
            templateId: ev.templateId,
            stage: state.stage,
          });
        } else if (ev.type === "stoneDrop") {
          // หินเสริมพลัง drop juice: buffer the claim for the same batched
          // flush AND toast immediately (unlike gear, a stone toast doesn't
          // wait on the server mint — see `DropFeed.tsx`'s module doc). The
          // field fx/SFX pop is handled one-way by the renderer/audio below.
          pendingStoneClaims.push({ rollId: ev.rollId, qty: ev.qty });
          useGameStore.getState().pushStoneFeed(ev.qty);
        } else if (ev.type === "townArrived") {
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
        const snapState =
          cohortActive && myCohortIndex > 0
            ? {
                ...state,
                heroes: [
                  state.heroes[myCohortIndex],
                  ...state.heroes.filter((_, i) => i !== myCohortIndex),
                ],
              }
            : state;
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
        return toSaveData({ ...state, heroes: [mine] });
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
        // Fix A.2: a hidden tab PAUSES rAF, so this client stops issuing lanes while its
        // socket stays open — the relay never sees a drop, never fires grace/shadow, and the
        // whole cohort freezes waiting on lanes that will never come. Actively LEAVE the
        // session so peers get grace -> member-shadowed (their scheduler then auto-fills my
        // lanes, fix A.1). Collapse my own sim to solo FIRST so the return catch-up replays
        // the hidden gap through the ordinary solo offline path (it can't replay a cohort —
        // there are no peer lanes for the hidden interval). Composes with the existing
        // >5s-hidden catch-up: `handleReturnFromBackground` replays the now-solo `state`.
        if (useGameStore.getState().party) {
          collapseToSolo(); // no-op if not in an active cohort
          partySession.teardown(); // closes the socket -> relay grace -> peers shadow me
        }
        return;
      }
      if (document.visibilityState === "visible") {
        handleReturnFromBackground();
        // Re-join with a FRESH ticket (teardown forgot the partyId): re-mints, re-beats my
        // zone, re-handshakes into a cohort if peers are still here. `setParty` is idempotent
        // when already live, so a hide that never actually tore down is a safe no-op.
        const party = useGameStore.getState().party;
        if (party) partySession.setParty(party);
      }
    }

    // bfcache restore (mobile back/forward navigation, some screen-fold cases)
    // fires `pageshow` with `persisted: true` INSTEAD OF a fresh page load —
    // `visibilitychange` may or may not have fired first depending on the
    // browser, so `handleReturnFromBackground` falls back to `lastActiveAt`
    // when `hiddenAt` is unset (see its doc comment). Idempotent if both fire
    // (`hiddenAt` is cleared after the first call).
    function onPageShow(e: PageTransitionEvent): void {
      if (e.persisted) {
        handleReturnFromBackground();
        // Same rejoin as the visible path — a bfcache restore may have torn the session down
        // (or frozen the socket) while away. `setParty` is idempotent if still connected.
        const party = useGameStore.getState().party;
        if (party) partySession.setParty(party);
      }
    }

    // Browsers block audio output until a real user gesture — resume() is
    // idempotent/cheap, so just call it on every pointerdown inside the arena
    // rather than trying to detect "the first one" ourselves.
    function onPointerDown(): void {
      audio.resume();
    }
    arenaEl.addEventListener("pointerdown", onPointerDown);

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
          };
          // Server already migrated; pass through migrate() again defensively —
          // never trust a received save's shape/version (CLAUDE.md rule).
          if (json.save) loaded = migrate(json.save);
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
      unsubscribeReload?.();
      unsubscribeParty?.();
      partySession.teardown();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      arenaEl.removeEventListener("pointerdown", onPointerDown);
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
    </>
  );
}
