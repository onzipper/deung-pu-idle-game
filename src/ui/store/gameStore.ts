/**
 * Zustand store — the bridge from engine to React HUD.
 *
 * CRITICAL: never put per-frame simulation state in here. React re-renders on
 * every store change; syncing 60 Hz would tank performance. The engine loop
 * pushes a THROTTLED snapshot (~10 Hz, see CONFIG.uiSyncHz) of only the fields
 * the HUD shows (gold, stage/wave/kills, heroes, boss hint, upgrade levels).
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
import { CONFIG } from "@/engine";
import type {
  BossHint,
  ConsumableCounts,
  HeroClass,
  HeroStats,
  Phase,
  ShopItemId,
  StatKey,
  WorldLocation,
  ZoneKind,
} from "@/engine";

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
 * Class-change quest state (M5 task 5) for the SkillBar quest flow. `null` when
 * not applicable (tier 2, or the hero is below the level gate with no active
 * quest — the bar shows the evolved badge / locked hint from `tier`/`level`
 * instead). Precomputed by the snapshot builder (engine reads only).
 */
export interface HeroQuestSummary {
  /** The quest is available to accept now (tier 1, level gate met, not yet taken). */
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
}

/** Per-hero HUD summary (subset of the engine `Hero` entity). */
export interface HeroSummary {
  cls: HeroClass;
  hp: number;
  maxHp: number;
  /**
   * SIGNATURE skill cooldown remaining, seconds (0 = ready). Kept for the
   * onboarding "you cast a skill" detector (`ui/onboarding`); the full per-skill
   * kit lives in `skills` below.
   */
  skillCd: number;
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
  /** Class-advancement tier (M5 evolution). 1 = base, 2 = evolved. */
  tier: 1 | 2;
  /** Precomputed `canEvolveHero(state, hero)` read (tier 1, class-change quest
   * complete) — the store never runs engine logic itself, just carries this
   * one-way display flag (same pattern as `atLevelCap`). */
  canEvolve: boolean;
  /** Class-change quest state (M5 task 5) driving the quest affordance, or null
   * (tier 2 / below the level gate — see `HeroQuestSummary`). */
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
}

/** The throttled snapshot shape pushed by the integration loop. */
export interface EngineSnapshot {
  gold: number;
  stage: number;
  wave: number;
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
  /** Base-stat allocation for the solo hero (M5), or `null`. Last-wins per frame
   * (a click allocates once; the engine no-ops an invalid/over-cap amount). */
  allocateStat: { stat: StatKey; amount: number } | null;
  /** Buy an NPC-shop item (M6), or `null` (last-wins per frame). Town-only —
   * the engine no-ops it elsewhere / when unaffordable / at the stack cap. */
  buyShopItem: { item: ShopItemId; qty: number } | null;
  /** Manual quick-use of a potion (M6), or `null` (last-wins per frame). */
  useConsumable: ShopItemId | null;
  /** Use a return scroll to teleport to town (M6, once per frame). */
  useReturnScroll: boolean;
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

const emptyBossHint: BossHint = {
  stage: 1,
  bossHp: 0,
  bossAtk: 0,
  recommendedPower: 0,
  teamPower: 0,
  ready: false,
};

const emptyShop: ShopSummary = {
  counts: { hpPotion: 0, manaPotion: 0, returnScroll: 0 },
  prices: {
    hpPotion: CONFIG.shop.items.hpPotion.basePrice,
    manaPotion: CONFIG.shop.items.manaPotion.basePrice,
    returnScroll: CONFIG.shop.items.returnScroll.basePrice,
  },
  stackCap: CONFIG.shop.stackCap,
  ready: { hpPotion: false, manaPotion: false },
};

export interface HudState {
  // ---- throttled engine snapshot (~CONFIG.uiSyncHz) ----
  gold: number;
  stage: number;
  wave: number;
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
  /** Auto-use hp/mana potions below a threshold (M6). UI-owned like `autoCast`:
   * the loop copies these onto `state.autoHpPotion`/`state.autoManaPotion` +
   * thresholds every frame; not part of `FrameInput`, never persisted. Default ON
   * (idle sustain works without setup). Thresholds are fractions of the max pool. */
  autoHpPotion: boolean;
  autoManaPotion: boolean;
  autoHpThreshold: number;
  autoManaThreshold: number;
  /** Client-side sound preference (persisted to localStorage, NOT SaveData —
   * see `SOUND_MUTED_STORAGE_KEY`'s comment). The integration loop reads this
   * every frame and applies it to the `AudioController`, same pattern as
   * `autoCast`/`autoAllocate`. */
  soundMuted: boolean;

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

  // ---- intent queue: drained by the integration loop into FrameInput ----
  pendingInput: PendingInput;

  /** Bulk-apply a throttled snapshot from the engine. */
  syncFromEngine: (snapshot: EngineSnapshot) => void;

  toggleAutoCast: () => void;
  toggleAutoAllocate: () => void;
  /** Toggle death auto-return (M6 "auto กลับไปฟาร์ม" / "รอที่เมือง"). */
  toggleAutoReturn: () => void;
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
  /** Queue a base-stat allocation for the solo hero (last-wins per frame) — the
   * engine no-ops an invalid/over-cap/over-spend amount. */
  allocateStat: (stat: StatKey, amount: number) => void;
  /** Queue an NPC-shop buy (M6, town-only, last-wins per frame). */
  buyShopItem: (item: ShopItemId, qty: number) => void;
  /** Queue a potion quick-use (M6, last-wins per frame). */
  useConsumable: (item: ShopItemId) => void;
  /** Queue a return-scroll teleport (M6, once per frame). */
  useReturnScroll: () => void;

  /** Integration-loop-only: pop + clear the pending intents for this frame. */
  drainPendingInput: () => PendingInput;
}

export const useGameStore = create<HudState>((set, get) => ({
  gold: 0,
  stage: 1,
  wave: 0,
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

  autoCast: false,
  autoAllocate: false,
  autoReturn: true,
  autoHpPotion: CONFIG.shop.autoDefaults.hpPotion,
  autoManaPotion: CONFIG.shop.autoDefaults.manaPotion,
  autoHpThreshold: CONFIG.shop.autoDefaults.hpThreshold,
  autoManaThreshold: CONFIG.shop.autoDefaults.manaThreshold,
  soundMuted: false,

  hasSyncedOnce: false,
  ftueCompleted: true,
  onboardingStepIndex: -1,

  pendingInput: emptyPendingInput(),

  syncFromEngine: (snapshot) => set({ ...snapshot, hasSyncedOnce: true }),

  toggleAutoCast: () => set((s) => ({ autoCast: !s.autoCast })),
  toggleAutoAllocate: () => set((s) => ({ autoAllocate: !s.autoAllocate })),
  toggleAutoReturn: () => set((s) => ({ autoReturn: !s.autoReturn })),
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
    set((s) => ({ pendingInput: { ...s.pendingInput, allocateStat: { stat, amount } } })),

  buyShopItem: (item, qty) =>
    set((s) => ({ pendingInput: { ...s.pendingInput, buyShopItem: { item, qty } } })),

  useConsumable: (item) =>
    set((s) => ({ pendingInput: { ...s.pendingInput, useConsumable: item } })),

  useReturnScroll: () =>
    set((s) => ({ pendingInput: { ...s.pendingInput, useReturnScroll: true } })),

  drainPendingInput: () => {
    const pending = get().pendingInput;
    set({ pendingInput: emptyPendingInput() });
    return pending;
  },
}));
