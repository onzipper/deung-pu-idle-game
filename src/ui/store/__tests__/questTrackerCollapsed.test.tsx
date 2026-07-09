// @vitest-environment jsdom
/**
 * R2.6 Wave 1 — localStorage round-trip for the quest-tracker collapse
 * preference (`GoalLadder.tsx`'s whole-card collapse-to-chip, now viewport-
 * independent). Needs a real `window`/`localStorage`, hence the jsdom
 * pragma — every other `gameStore.test.ts` file stays on the fast Node
 * environment (see `vitest.config.ts`'s doc). Mirrors the ghosts-visible
 * helper's shape (`GHOSTS_VISIBLE_STORAGE_KEY`) but with the OPPOSITE
 * default (expanded, not collapsed).
 *
 * R2.6 Wave 2 (below) — same round-trip, cloned for the skill-dock collapse
 * preference (`SkillDock.tsx`), same storage tier and default.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readStoredQuestTrackerCollapsed,
  readStoredSkillDockCollapsed,
  useGameStore,
} from "@/ui/store/gameStore";

const STORAGE_KEY = "ddp-quest-tracker-collapsed";
const SKILL_DOCK_STORAGE_KEY = "ddp-skill-dock-collapsed";

beforeEach(() => {
  window.localStorage.clear();
  useGameStore.setState({ questTrackerCollapsed: false, skillDockCollapsed: false });
});

afterEach(() => {
  window.localStorage.clear();
  useGameStore.setState({ questTrackerCollapsed: false, skillDockCollapsed: false });
});

describe("readStoredQuestTrackerCollapsed", () => {
  it("defaults to false (expanded) when nothing has been stored", () => {
    expect(readStoredQuestTrackerCollapsed()).toBe(false);
  });

  it("reads back a persisted collapsed=true", () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    expect(readStoredQuestTrackerCollapsed()).toBe(true);
  });

  it("treats any non-'1' value as expanded", () => {
    window.localStorage.setItem(STORAGE_KEY, "0");
    expect(readStoredQuestTrackerCollapsed()).toBe(false);
  });
});

describe("gameStore: toggleQuestTrackerCollapsed / setQuestTrackerCollapsed", () => {
  it("defaults to expanded (false) in a fresh store", () => {
    expect(useGameStore.getState().questTrackerCollapsed).toBe(false);
  });

  it("toggle flips the field AND persists to localStorage", () => {
    useGameStore.getState().toggleQuestTrackerCollapsed();
    expect(useGameStore.getState().questTrackerCollapsed).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");

    useGameStore.getState().toggleQuestTrackerCollapsed();
    expect(useGameStore.getState().questTrackerCollapsed).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("0");
  });

  it("setQuestTrackerCollapsed applies a value WITHOUT writing to storage (mount-effect-only)", () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    useGameStore.getState().setQuestTrackerCollapsed(true);
    expect(useGameStore.getState().questTrackerCollapsed).toBe(true);
    // still exactly what was there before — setQuestTrackerCollapsed never writes.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
  });
});

describe("readStoredSkillDockCollapsed (R2.6 Wave 2)", () => {
  it("defaults to false (expanded) when nothing has been stored", () => {
    expect(readStoredSkillDockCollapsed()).toBe(false);
  });

  it("reads back a persisted collapsed=true", () => {
    window.localStorage.setItem(SKILL_DOCK_STORAGE_KEY, "1");
    expect(readStoredSkillDockCollapsed()).toBe(true);
  });

  it("treats any non-'1' value as expanded", () => {
    window.localStorage.setItem(SKILL_DOCK_STORAGE_KEY, "0");
    expect(readStoredSkillDockCollapsed()).toBe(false);
  });
});

describe("gameStore: toggleSkillDockCollapsed / setSkillDockCollapsed (R2.6 Wave 2)", () => {
  it("defaults to expanded (false) in a fresh store", () => {
    expect(useGameStore.getState().skillDockCollapsed).toBe(false);
  });

  it("toggle flips the field AND persists to localStorage", () => {
    useGameStore.getState().toggleSkillDockCollapsed();
    expect(useGameStore.getState().skillDockCollapsed).toBe(true);
    expect(window.localStorage.getItem(SKILL_DOCK_STORAGE_KEY)).toBe("1");

    useGameStore.getState().toggleSkillDockCollapsed();
    expect(useGameStore.getState().skillDockCollapsed).toBe(false);
    expect(window.localStorage.getItem(SKILL_DOCK_STORAGE_KEY)).toBe("0");
  });

  it("setSkillDockCollapsed applies a value WITHOUT writing to storage (mount-effect-only)", () => {
    window.localStorage.setItem(SKILL_DOCK_STORAGE_KEY, "1");
    useGameStore.getState().setSkillDockCollapsed(true);
    expect(useGameStore.getState().skillDockCollapsed).toBe(true);
    // still exactly what was there before — setSkillDockCollapsed never writes.
    expect(window.localStorage.getItem(SKILL_DOCK_STORAGE_KEY)).toBe("1");
  });
});
