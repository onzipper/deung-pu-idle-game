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
import type { BossHint, HeroClass, Phase, SpeedMultiplier, Upgrades } from "@/engine";

/** Per-hero HUD summary (subset of the engine `Hero` entity). */
export interface HeroSummary {
  cls: HeroClass;
  hp: number;
  maxHp: number;
  /** Skill cooldown remaining, seconds (0 = ready). */
  skillCd: number;
  dead: boolean;
}

/** Gold cost of the next level of each upgrade line, at the current levels. */
export type UpgradeCosts = Upgrades;

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
  upgrades: Upgrades;
  upgradeCosts: UpgradeCosts;
}

/** One-shot player intents, accumulated between drains. Mirrors `FrameInput`. */
export interface PendingInput {
  castSkills: number[];
  buyUpgrade: keyof Upgrades | null;
  challengeBoss: boolean;
  advanceStage: boolean;
}

function emptyPendingInput(): PendingInput {
  return { castSkills: [], buyUpgrade: null, challengeBoss: false, advanceStage: false };
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
  upgrades: Upgrades;
  upgradeCosts: UpgradeCosts;

  // ---- plain UI-owned state the integration loop reads directly every frame ----
  speed: SpeedMultiplier;
  autoUpgrade: boolean;
  autoCast: boolean;

  // ---- intent queue: drained by the integration loop into FrameInput ----
  pendingInput: PendingInput;

  /** Bulk-apply a throttled snapshot from the engine. */
  syncFromEngine: (snapshot: EngineSnapshot) => void;

  setSpeed: (speed: SpeedMultiplier) => void;
  toggleAutoUpgrade: () => void;
  toggleAutoCast: () => void;

  /** Queue a skill cast for hero slot `i` (deduped; consumed on next drain). */
  castSkill: (slot: number) => void;
  /** Queue a purchase attempt for one upgrade line (last-wins per frame). */
  buyUpgrade: (stat: keyof Upgrades) => void;
  challengeBoss: () => void;
  advanceStage: () => void;

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
  upgrades: { atk: 0, speed: 0, hp: 0 },
  upgradeCosts: { atk: 0, speed: 0, hp: 0 },

  speed: 1,
  autoUpgrade: false,
  autoCast: false,

  pendingInput: emptyPendingInput(),

  syncFromEngine: (snapshot) => set(snapshot),

  setSpeed: (speed) => set({ speed }),
  toggleAutoUpgrade: () => set((s) => ({ autoUpgrade: !s.autoUpgrade })),
  toggleAutoCast: () => set((s) => ({ autoCast: !s.autoCast })),

  castSkill: (slot) =>
    set((s) => ({
      pendingInput: s.pendingInput.castSkills.includes(slot)
        ? s.pendingInput
        : { ...s.pendingInput, castSkills: [...s.pendingInput.castSkills, slot] },
    })),

  buyUpgrade: (stat) =>
    set((s) => ({ pendingInput: { ...s.pendingInput, buyUpgrade: stat } })),

  challengeBoss: () =>
    set((s) => ({ pendingInput: { ...s.pendingInput, challengeBoss: true } })),

  advanceStage: () =>
    set((s) => ({ pendingInput: { ...s.pendingInput, advanceStage: true } })),

  drainPendingInput: () => {
    const pending = get().pendingInput;
    set({ pendingInput: emptyPendingInput() });
    return pending;
  },
}));
