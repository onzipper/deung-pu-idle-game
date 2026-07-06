/**
 * Store/selector regression tests for the M7.9 stat-tap-fix (UAT
 * "กดไม่ค่อยติด" — manual stat allocation felt unresponsive on slow/mobile
 * frames). Covers the two diagnosed causes:
 *
 *  1. Dropped taps: `pendingInput.allocateStat` must ACCUMULATE (same-stat
 *     taps sum, different-stat taps all survive) instead of last-wins.
 *  2. No sub-100ms feedback: `optimisticStatSpend` must bump instantly on
 *     every tap and reconcile (clear) wholesale once a throttled snapshot
 *     lands via `syncFromEngine`.
 *
 * Pure store logic — no React/DOM needed (Node test environment, see
 * `vitest.config.ts`).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CONFIG, defaultBotSettings } from "@/engine";
import type { BossHint, Phase } from "@/engine";
import { useGameStore, type EngineSnapshot } from "@/ui/store/gameStore";

const emptyBossHint: BossHint = {
  stage: 1,
  bossHp: 0,
  bossAtk: 0,
  recommendedPower: 0,
  teamPower: 0,
  ready: false,
};

/** Builds a minimal, type-valid `EngineSnapshot` — only `heroes` varies per
 * test (the field under test). */
function makeSnapshot(statPoints: number): EngineSnapshot {
  return {
    gold: 0,
    stage: 1,
    wave: 0,
    kills: 0,
    killGoal: 0,
    phase: "battle" as Phase,
    bossReady: false,
    bossHint: emptyBossHint,
    heroes: [
      {
        cls: "swordsman",
        hp: 100,
        maxHp: 100,
        skillCd: 0,
        mana: 10,
        maxMana: 10,
        skills: [],
        autoSlots: [null, null, null],
        unlockedSlots: 1,
        dead: false,
        level: 1,
        xpProgress: 0,
        atLevelCap: false,
        tier: 1,
        canEvolve: false,
        quest: null,
        statPoints,
        stats: { str: 10, dex: 10, int: 10, vit: 10 },
        primaryStat: "str",
        combatPower: 0,
        equipped: { weapon: null, armor: null },
        hasCommand: false,
      },
    ],
    world: {
      mapId: "map1",
      zoneIdx: 1,
      kind: "farm",
      stage: 1,
      traveling: false,
      left: null,
      right: null,
    },
    shop: {
      counts: { hpPotion: 0, manaPotion: 0, returnScroll: 0 },
      prices: {
        hpPotion: CONFIG.shop.items.hpPotion.basePrice,
        manaPotion: CONFIG.shop.items.manaPotion.basePrice,
        returnScroll: CONFIG.shop.items.returnScroll.basePrice,
      },
      stackCap: CONFIG.shop.stackCap,
      ready: { hpPotion: false, manaPotion: false },
    },
    bot: defaultBotSettings(),
    autoHunt: true,
    unlockedZones: {},
    materials: 0,
  };
}

describe("gameStore: allocateStat batch accumulation (M7.9 stat-tap-fix)", () => {
  beforeEach(() => {
    // Reset the queue + overlay between tests (singleton store).
    useGameStore.getState().drainPendingInput();
    useGameStore.setState({ optimisticStatSpend: {} });
  });

  it("sums repeated taps on the SAME stat instead of last-wins", () => {
    const { allocateStat } = useGameStore.getState();
    allocateStat("str", 1);
    allocateStat("str", 1);
    allocateStat("str", 1);
    expect(useGameStore.getState().pendingInput.allocateStat).toEqual({ str: 3 });
  });

  it("keeps taps on DIFFERENT stats all alive in the same batch", () => {
    const { allocateStat } = useGameStore.getState();
    allocateStat("str", 1);
    allocateStat("dex", 1);
    allocateStat("vit", 1);
    allocateStat("str", 1); // a second str tap sums onto the first
    expect(useGameStore.getState().pendingInput.allocateStat).toEqual({
      str: 2,
      dex: 1,
      vit: 1,
    });
  });

  it("drainPendingInput returns the accumulated batch and clears the queue", () => {
    const { allocateStat, drainPendingInput } = useGameStore.getState();
    allocateStat("int", 2);
    allocateStat("vit", 1);
    const drained = drainPendingInput();
    expect(drained.allocateStat).toEqual({ int: 2, vit: 1 });
    expect(useGameStore.getState().pendingInput.allocateStat).toBeNull();
  });

  it("optimisticStatSpend bumps per-stat, additively, on every tap", () => {
    const { allocateStat } = useGameStore.getState();
    allocateStat("vit", 1);
    allocateStat("vit", 1);
    allocateStat("int", 1);
    expect(useGameStore.getState().optimisticStatSpend).toEqual({ vit: 2, int: 1 });
  });

  it("syncFromEngine reconciles: clears the WHOLE optimistic overlay once the snapshot lands", () => {
    const { allocateStat, syncFromEngine } = useGameStore.getState();
    allocateStat("str", 1);
    allocateStat("dex", 2);
    expect(useGameStore.getState().optimisticStatSpend).toEqual({ str: 1, dex: 2 });

    // The throttled snapshot arrives reflecting the now-applied spend
    // (statPoints already decremented engine-side).
    syncFromEngine(makeSnapshot(4));

    expect(useGameStore.getState().optimisticStatSpend).toEqual({});
    expect(useGameStore.getState().heroes[0].statPoints).toBe(4);
  });

  it("does not double-subtract: a NEW tap after a sync starts a fresh overlay window", () => {
    const { allocateStat, syncFromEngine } = useGameStore.getState();
    allocateStat("str", 1);
    syncFromEngine(makeSnapshot(9)); // confirms the str tap; overlay clears
    expect(useGameStore.getState().optimisticStatSpend).toEqual({});

    allocateStat("dex", 1); // a tap AFTER the sync — its own fresh overlay
    expect(useGameStore.getState().optimisticStatSpend).toEqual({ dex: 1 });
    // The displayed total (statPoints - overlay) reflects only the new tap,
    // never re-subtracting the already-confirmed str spend.
    const s = useGameStore.getState();
    const totalPending = Object.values(s.optimisticStatSpend).reduce(
      (sum, n) => sum + (n ?? 0),
      0,
    );
    expect(s.heroes[0].statPoints - totalPending).toBe(8);
  });
});
