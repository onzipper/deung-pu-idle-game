/**
 * Zustand store — the bridge from engine to React HUD.
 *
 * CRITICAL: never put per-frame simulation state in here. React re-renders on
 * every store change; syncing 60 Hz would tank performance. The engine loop
 * pushes a THROTTLED snapshot (~10 Hz, see CONFIG.uiSyncHz) of only the fields
 * the HUD shows (gold, level, wave, boss hint, toggles).
 *
 * Skeleton: fleshed out in M2 alongside the render integration.
 */

import { create } from "zustand";

export interface HudState {
  gold: number;
  stage: number;
  wave: number;
  speed: number;
  autoUpgrade: boolean;
  autoCast: boolean;
  /** Bulk-apply a throttled snapshot from the engine. */
  syncFromEngine: (snapshot: Partial<HudState>) => void;
  setSpeed: (speed: number) => void;
  toggleAutoUpgrade: () => void;
  toggleAutoCast: () => void;
}

export const useGameStore = create<HudState>((set) => ({
  gold: 0,
  stage: 1,
  wave: 1,
  speed: 1,
  autoUpgrade: false,
  autoCast: false,
  syncFromEngine: (snapshot) => set(snapshot),
  setSpeed: (speed) => set({ speed }),
  toggleAutoUpgrade: () => set((s) => ({ autoUpgrade: !s.autoUpgrade })),
  toggleAutoCast: () => set((s) => ({ autoCast: !s.autoCast })),
}));
