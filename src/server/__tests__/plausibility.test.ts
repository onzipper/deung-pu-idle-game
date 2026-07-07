import { describe, it, expect } from "vitest";

/**
 * M7.95 W2b anti-cheat re-derive — `judgePlausibility` is a PURE function (no DB), so
 * these tests exercise it directly: a legit (even theoretically-fastest) player passes
 * the ×2 margin, egregious level/gold/power forgeries flag, and the level/gold-latch vs
 * power-recovery semantics hold.
 */

import {
  judgePlausibility,
  minPlaySecondsForLevel,
  maxPowerForLevel,
  effectivePlaySeconds,
  MAX_GOLD_PER_SEC,
  PLAUSIBILITY_MARGIN,
  type PlausibilityInput,
} from "@/server/plausibility";
import { CONFIG, type HeroClass } from "@/engine";

const NOW = new Date("2026-07-07T12:00:00.000Z");
const CAP = CONFIG.leveling.levelCap;

/** Build an input `secondsAgo` after creation, with sane defaults. */
function input(over: Partial<PlausibilityInput> & { cls?: HeroClass; secondsAgo?: number }): PlausibilityInput {
  const secondsAgo = over.secondsAgo ?? 3600;
  const cls = over.cls ?? "mage";
  const createdAt = over.createdAt ?? new Date(NOW.getTime() - secondsAgo * 1000);
  return {
    cls,
    level: 50,
    power: 100,
    goldEarned: 1000,
    onlineSeconds: secondsAgo,
    createdAt,
    now: NOW,
    levelCapAt: null,
    ...over,
  };
}

describe("effectivePlaySeconds (generous: online + offline-idle credit)", () => {
  it("adds the per-day offline cap on top of online time", () => {
    // 1h-old account, 1h online → online(3600) + offlineCredit(min(3600, 1×8h)) = 7200.
    const play = effectivePlaySeconds({
      onlineSeconds: 3600,
      createdAt: new Date(NOW.getTime() - 3600 * 1000),
      now: NOW,
    });
    expect(play).toBe(7200);
  });
});

describe("judgePlausibility — plausible players pass", () => {
  it("passes a legit, deeply-played character comfortably", () => {
    const v = judgePlausibility(
      input({ cls: "mage", level: 60, secondsAgo: 20 * 3600, power: maxPowerForLevel("mage", 60), goldEarned: 500_000 }),
    );
    expect(v.suspect).toBe(false);
    expect(v.reasons).toEqual([]);
  });

  it("passes even the THEORETICALLY-fastest level-cap player (×2 margin headroom)", () => {
    // Reached the cap at ~40h wall — above the ~13.9h earliest-possible; passes.
    const v = judgePlausibility(
      input({
        cls: "swordsman",
        level: CAP,
        secondsAgo: 40 * 3600,
        onlineSeconds: 40 * 3600,
        power: maxPowerForLevel("swordsman", CAP),
        goldEarned: 1_000_000,
        levelCapAt: NOW,
      }),
    );
    expect(v.suspect).toBe(false);
  });
});

describe("judgePlausibility — forgeries flag", () => {
  it("flags level 90 reached in an hour", () => {
    const v = judgePlausibility(
      input({ cls: "swordsman", level: CAP, secondsAgo: 3600, onlineSeconds: 3600, power: 100, goldEarned: 100 }),
    );
    expect(v.suspect).toBe(true);
    expect(v.reasons.join(" ")).toMatch(/level 90/);
  });

  it("flags a levelCapAt stamped implausibly soon after creation (wall-clock backstop)", () => {
    // Ignore onlineSeconds entirely (forged huge): the unforgeable wall gap is 1h.
    const v = judgePlausibility(
      input({
        cls: "mage",
        level: CAP,
        secondsAgo: 3600,
        onlineSeconds: 10_000_000, // forged
        levelCapAt: NOW,
        power: 100,
        goldEarned: 100,
      }),
    );
    expect(v.suspect).toBe(true);
    expect(v.reasons.join(" ")).toMatch(/levelCapAt/);
  });

  it("flags ~10× the plausible gold for the elapsed time", () => {
    const play = effectivePlaySeconds({
      onlineSeconds: 2 * 3600,
      createdAt: new Date(NOW.getTime() - 2 * 3600 * 1000),
      now: NOW,
    });
    const ceiling = MAX_GOLD_PER_SEC * play * PLAUSIBILITY_MARGIN;
    const v = judgePlausibility(
      input({ cls: "mage", level: 40, secondsAgo: 2 * 3600, goldEarned: Math.round(ceiling * 10), power: 100 }),
    );
    expect(v.suspect).toBe(true);
    expect(v.reasons.join(" ")).toMatch(/goldEarned/);
  });

  it("flags impossible power (stat/gear tampering) for the level", () => {
    const v = judgePlausibility(input({ cls: "mage", level: 50, secondsAgo: 30 * 24 * 3600, power: 10_000_000 }));
    expect(v.suspect).toBe(true);
    expect(v.reasons.join(" ")).toMatch(/power/);
  });
});

describe("judgePlausibility — recovery semantics", () => {
  it("recovers a power flag once the snapshot is back within bounds", () => {
    const spike = input({ cls: "mage", level: 50, secondsAgo: 30 * 24 * 3600, power: 10_000_000 });
    expect(judgePlausibility(spike, false).suspect).toBe(true);

    // Later save: power dropped (unequipped gear) → clean → recovers to false.
    const clean = input({ cls: "mage", level: 50, secondsAgo: 30 * 24 * 3600, power: 100 });
    const v = judgePlausibility(clean, true);
    expect(v.suspect).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/recovered/);
  });

  it("keeps a level/gold flag latched (monotonic — cannot regress) across saves", () => {
    // Still cap level, still only 1h of real wall time → re-detected, stays flagged.
    const v = judgePlausibility(
      input({ cls: "mage", level: CAP, secondsAgo: 3600, onlineSeconds: 3600, power: 100, goldEarned: 100 }),
      true,
    );
    expect(v.suspect).toBe(true);
  });
});

describe("ceilings are monotonic + engine-derived (re-derivable)", () => {
  it("minPlaySecondsForLevel increases with level and is 0 at level 1", () => {
    expect(minPlaySecondsForLevel(1)).toBe(0);
    expect(minPlaySecondsForLevel(90)).toBeGreaterThan(minPlaySecondsForLevel(50));
  });

  it("maxPowerForLevel increases with level for each class", () => {
    for (const cls of ["swordsman", "archer", "mage"] as HeroClass[]) {
      expect(maxPowerForLevel(cls, 90)).toBeGreaterThan(maxPowerForLevel(cls, 10));
    }
  });
});
