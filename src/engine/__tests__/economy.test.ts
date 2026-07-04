import { describe, it, expect } from "vitest";
import {
  initGameState,
  step,
  heroAtkSpeed,
  upgradeCost,
  UPGRADES,
  SPEED_UPGRADE_CAP,
  FIXED_DT,
} from "@/engine";
import { threeHeroSave } from "./helpers";

/**
 * Deep economy regression coverage (Phase C handoff): the upgradeCost curve,
 * auto-upgrade tie-break stability, HP re-sync reaching dead heroes, and the
 * speed-line cap actually flattening attack interval. Builds on
 * phase-b.test.ts, which only smoke-tests one buy per line.
 */

describe("upgradeCost curve", () => {
  it.each(["atk", "speed", "hp"] as const)(
    "%s cost matches base * growth^level exactly, for several levels",
    (stat) => {
      const line = UPGRADES[stat];
      for (let level = 0; level < 12; level++) {
        expect(upgradeCost(stat, level)).toBe(
          Math.round(line.base * Math.pow(line.growth, level)),
        );
      }
    },
  );

  it.each(["atk", "speed", "hp"] as const)(
    "%s cost strictly increases with level",
    (stat) => {
      for (let level = 0; level < 20; level++) {
        expect(upgradeCost(stat, level + 1)).toBeGreaterThan(
          upgradeCost(stat, level),
        );
      }
    },
  );
});

describe("auto-upgrade tie-break", () => {
  it("stable-sorts equal-cost lines, preferring atk over hp (declared array order)", () => {
    // The real cost curves never coincide at integer levels (checked by hand),
    // so force an exact tie at level 0 by temporarily equalizing the bases —
    // costs are `round(base * growth^level)`, and growth^0 === 1.
    const savedAtkBase = UPGRADES.atk.base;
    const savedHpBase = UPGRADES.hp.base;
    try {
      UPGRADES.atk.base = 50;
      UPGRADES.hp.base = 50;

      const s = initGameState(3);
      s.autoUpgrade = true;
      s.gold = 50;
      s.upgrades.speed = SPEED_UPGRADE_CAP; // exclude the speed line entirely
      s.autoUpgradeTimer = FIXED_DT / 2; // fire the auto-upgrade tick this step

      step(s, {});

      // tryAutoUpgrade builds its options as [atk, hp, ...speed] and sorts by
      // cost; Array#sort is stable, so an exact tie must resolve in that order.
      expect(s.upgrades.atk).toBe(1);
      expect(s.upgrades.hp).toBe(0);
      expect(s.gold).toBe(0);
    } finally {
      UPGRADES.atk.base = savedAtkBase;
      UPGRADES.hp.base = savedHpBase;
    }
  });
});

describe("HP upgrade re-sync", () => {
  it("re-syncs maxHp and heals by the delta even for a currently-dead hero", () => {
    const s = initGameState(3, threeHeroSave());
    const dead = s.heroes[0];
    dead.dead = true;
    dead.hp = 0;
    dead.reviveTimer = 999; // stays dead through this step
    const maxBefore = dead.maxHp;
    s.gold = 1_000_000;

    step(s, { buyUpgrade: "hp" });

    const delta = dead.maxHp - maxBefore;
    expect(delta).toBeGreaterThan(0);
    expect(dead.hp).toBe(delta); // healed by the delta despite being dead
    expect(dead.dead).toBe(true); // still flagged dead — revive timer untouched
  });

  it("also re-syncs every living hero's maxHp/hp by the same delta", () => {
    const s = initGameState(3, threeHeroSave());
    const before = s.heroes.map((h) => ({ maxHp: h.maxHp, hp: h.hp }));
    s.gold = 1_000_000;

    step(s, { buyUpgrade: "hp" });

    s.heroes.forEach((h, i) => {
      const delta = h.maxHp - before[i].maxHp;
      expect(delta).toBeGreaterThan(0);
      expect(h.hp).toBe(before[i].hp + delta);
    });
  });
});

describe("speed upgrade cap", () => {
  it("heroAtkSpeed stops improving past SPEED_UPGRADE_CAP", () => {
    const atCap = heroAtkSpeed("archer", { atk: 0, speed: SPEED_UPGRADE_CAP, hp: 0 });
    const beyondCap = heroAtkSpeed("archer", {
      atk: 0,
      speed: SPEED_UPGRADE_CAP + 50,
      hp: 0,
    });
    const belowCap = heroAtkSpeed("archer", { atk: 0, speed: 0, hp: 0 });

    expect(beyondCap).toBe(atCap); // clamped: no further improvement past the cap
    expect(atCap).toBeLessThan(belowCap); // faster (smaller interval) than unupgraded
  });

  it("buyUpgrade never lets the speed line exceed the cap during play", () => {
    const s = initGameState(3);
    s.gold = 10_000_000;
    for (let i = 0; i < SPEED_UPGRADE_CAP + 10; i++) {
      step(s, { buyUpgrade: "speed" });
    }
    expect(s.upgrades.speed).toBe(SPEED_UPGRADE_CAP);
  });
});
