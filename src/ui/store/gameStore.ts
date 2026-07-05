/**
 * Zustand store — the bridge from engine to React HUD.
 *
 * CRITICAL: never put per-frame simulation state in here. React re-renders on
 * every store change; syncing 60 Hz would tank performance. The engine loop
 * pushes a THROTTLED snapshot (~10 Hz, see CONFIG.uiSyncHz) of only the fields
 * the HUD shows (gold, stage/wave/kills, heroes, boss hint, upgrade levels).
 *
 * This store also holds the PLAYER -> ENGINE direction of the seam:
 *  - `speed` / `autoUpgrade` / `autoCast` are plain UI-owned state. They are not
 *    part of `FrameInput` (the engine reads `state.autoUpgrade`/`state.autoCast`
 *    directly, and speed only changes how many fixed sub-steps the integration
 *    loop drains per frame) — the loop reads these three fields straight off the
 *    store every frame and applies them; no queueing needed.
 *  - Discrete one-shot actions (cast skill, buy upgrade, challenge boss, advance
 *    stage) map 1:1 onto `FrameInput` fields. React must NEVER call into the
 *    engine directly, so these are pushed into `pendingInput` and drained by the
 *    integration loop once per real frame (via `drainPendingInput()`), which
 *    clears the queue and hands the result to `step()`. This guarantees a click
 *    is applied exactly once even when a speed multiplier runs multiple fixed
 *    sub-steps within the same frame.
 */

import { create } from "zustand";
import type { BossHint, HeroClass, Phase, SpeedMultiplier } from "@/engine";

/** Per-hero HUD summary (subset of the engine `Hero` entity). */
export interface HeroSummary {
  cls: HeroClass;
  hp: number;
  maxHp: number;
  /** Skill cooldown remaining, seconds (0 = ready). */
  skillCd: number;
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
  /** Precomputed `canEvolveHero(state, hero)` read (tier 1, level gate met,
   * gold affordable) — the store never runs engine logic itself, just carries
   * this one-way display flag (same pattern as `atLevelCap`). */
  canEvolve: boolean;
  /** Gold cost of evolving this hero (`evolutionCost(hero.cls)`), for the
   * evolve affordance's cost label/tooltip — irrelevant once `tier === 2`. */
  evolutionCost: number;
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
}

/** One-shot player intents, accumulated between drains. Mirrors `FrameInput`. */
export interface PendingInput {
  castSkills: number[];
  challengeBoss: boolean;
  advanceStage: boolean;
  /** Hero slot index to evolve (M5), or `null` (last-wins per frame — a big
   * one-way purchase never needs to queue more than one per frame). */
  evolveHero: number | null;
}

function emptyPendingInput(): PendingInput {
  return {
    castSkills: [],
    challengeBoss: false,
    advanceStage: false,
    evolveHero: null,
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

  // ---- plain UI-owned state the integration loop reads directly every frame ----
  speed: SpeedMultiplier;
  autoCast: boolean;
  /** Client-side sound preference (persisted to localStorage, NOT SaveData —
   * see `SOUND_MUTED_STORAGE_KEY`'s comment). The integration loop reads this
   * every frame and applies it to the `AudioController`, same pattern as
   * `speed`/`autoUpgrade`/`autoCast`. */
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

  setSpeed: (speed: SpeedMultiplier) => void;
  toggleAutoCast: () => void;
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

  /** Queue a skill cast for hero slot `i` (deduped; consumed on next drain). */
  castSkill: (slot: number) => void;
  challengeBoss: () => void;
  advanceStage: () => void;
  /** Queue an evolve attempt for hero slot `i` (last-wins per frame, same as
   * `buyUpgrade`) — the engine no-ops it if requirements aren't met. */
  evolveHero: (slot: number) => void;

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

  speed: 1,
  autoCast: false,
  soundMuted: false,

  hasSyncedOnce: false,
  ftueCompleted: true,
  onboardingStepIndex: -1,

  pendingInput: emptyPendingInput(),

  syncFromEngine: (snapshot) => set({ ...snapshot, hasSyncedOnce: true }),

  setSpeed: (speed) => set({ speed }),
  toggleAutoCast: () => set((s) => ({ autoCast: !s.autoCast })),
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

  castSkill: (slot) =>
    set((s) => ({
      pendingInput: s.pendingInput.castSkills.includes(slot)
        ? s.pendingInput
        : { ...s.pendingInput, castSkills: [...s.pendingInput.castSkills, slot] },
    })),

  challengeBoss: () =>
    set((s) => ({ pendingInput: { ...s.pendingInput, challengeBoss: true } })),

  advanceStage: () =>
    set((s) => ({ pendingInput: { ...s.pendingInput, advanceStage: true } })),

  evolveHero: (slot) =>
    set((s) => ({ pendingInput: { ...s.pendingInput, evolveHero: slot } })),

  drainPendingInput: () => {
    const pending = get().pendingInput;
    set({ pendingInput: emptyPendingInput() });
    return pending;
  },
}));
