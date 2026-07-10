import { describe, it, expect } from "vitest";
import {
  CONFIG,
  SAVE_VERSION,
  createRng,
  initGameState,
  toSaveData,
  step,
  makeHero,
  makeEnemy,
  makeBoss,
  makeWorldBoss,
  hashUnit,
  planeYForDepth,
  enemyPlaneY,
  heroPlaneY,
  bossPlaneY,
  scatterPlaneY,
} from "@/engine";
import type { HeroClass } from "@/engine";
import { soloSave } from "./helpers";

/**
 * R4 Wave A — engine-owned deterministic depth-plane y at spawn (`Entity.planeY`,
 * systems/plane.ts). These lock down: (1) the plane helpers are pure/deterministic and
 * numerically reproduce the render depth band they were ported from; (2) every spawn site
 * stamps a deterministic `planeY`; (3) `planeY` is TRANSIENT — never persisted, recomputed
 * on load — so it needs NO SAVE_VERSION bump.
 *
 * The BAND knobs (bandFar/bandNear) mirror render's surviving `depthBand.DEPTH_OFFSET_*`
 * (the engine may not import render) — keep them in lock-step; if those render constants
 * change, the pinned literals (and CONFIG.plane) must change with them. As of R4 Wave C0
 * the render-side depth ASSIGNMENT source (`depthAssign` heroDepth/enemyDepth/ghostDepth +
 * its HERO_* row constants) is RETIRED — depth is engine-owned — so the hero-row knobs
 * (heroBandMin/Max, formationDepth) are now engine-only invariants with no render twin.
 */

const CLASSES: HeroClass[] = ["swordsman", "archer", "mage", "ninja"];

describe("plane helpers — determinism + render-band parity", () => {
  it("hashUnit is a stable [0,1) hash, number/string-agnostic", () => {
    expect(hashUnit(3)).toBe(hashUnit("3"));
    for (const k of [0, 1, 7, 42, 99999, "npc:pahpu", "ghost-abc"]) {
      const v = hashUnit(k);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(hashUnit(k)).toBe(v); // pure — identical on re-call
    }
  });

  it("CONFIG.plane band knobs stay pinned to render depthBand; hero rows are engine-owned", () => {
    // ≡ render/worldDepth/depthBand.DEPTH_OFFSET_FAR / DEPTH_OFFSET_NEAR (still the
    // live render band math — keep in lock-step).
    expect(CONFIG.plane.bandFar).toBe(-24);
    expect(CONFIG.plane.bandNear).toBe(40);
    // Hero-row knobs: engine-owned invariants since R4 Wave C0 (the render-side
    // depthAssign HERO_* constants they used to mirror are retired). Pinned so
    // Wave C1 can't drift them unnoticed.
    expect(CONFIG.plane.heroBandMin).toBe(0.45);
    expect(CONFIG.plane.heroBandMax).toBe(0.85);
    for (const c of CLASSES) expect(CONFIG.plane.formationDepth[c]).toBe(0.65);
  });

  it("planeYForDepth reproduces depthBand.depthOffsetY (lerp far→near, clamped, monotonic)", () => {
    const { bandFar, bandNear } = CONFIG.plane;
    expect(planeYForDepth(0)).toBe(bandFar);
    expect(planeYForDepth(1)).toBe(bandNear);
    // Same formula depthBand uses: FAR + (NEAR-FAR)*d.
    for (const d of [0, 0.25, 0.375, 0.5, 0.65, 0.85, 1]) {
      expect(planeYForDepth(d)).toBeCloseTo(bandFar + (bandNear - bandFar) * d, 10);
    }
    // Clamped to [0,1] like clampDepth.
    expect(planeYForDepth(-3)).toBe(bandFar);
    expect(planeYForDepth(9)).toBe(bandNear);
    // Strictly increasing in d (the band never folds).
    let prev = -Infinity;
    for (let d = 0; d <= 1.0001; d += 0.05) {
      const y = planeYForDepth(d);
      expect(y).toBeGreaterThan(prev);
      prev = y;
    }
  });

  it("enemyPlaneY = planeYForDepth(hashUnit(id)) and is deterministic per id", () => {
    for (const id of [1, 2, 3, 50, 12345]) {
      expect(enemyPlaneY(id)).toBe(planeYForDepth(hashUnit(id)));
      expect(enemyPlaneY(id)).toBe(enemyPlaneY(id)); // pure
      expect(enemyPlaneY(id)).toBeGreaterThanOrEqual(CONFIG.plane.bandFar);
      expect(enemyPlaneY(id)).toBeLessThanOrEqual(CONFIG.plane.bandNear);
    }
    // A crowd spreads across the band (not all one row) — real front/back rows.
    const rows = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(enemyPlaneY));
    expect(rows.size).toBeGreaterThan(1);
  });

  it("heroPlaneY: solo = class formation row; party fans monotonically by slot", () => {
    for (const c of CLASSES) {
      expect(heroPlaneY(c)).toBe(planeYForDepth(CONFIG.plane.formationDepth[c]));
      expect(heroPlaneY(c, 0, 1)).toBe(heroPlaneY(c)); // solo default
    }
    // A 3-hero party fans slot 0 (far) → slot 2 (near), endpoints inclusive.
    const size = 3;
    const ys = [0, 1, 2].map((slot) => heroPlaneY("swordsman", slot, size));
    expect(ys[0]).toBe(planeYForDepth(CONFIG.plane.heroBandMin));
    expect(ys[2]).toBe(planeYForDepth(CONFIG.plane.heroBandMax));
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
    // Stray slot indices clamp into the band (never leave it).
    expect(heroPlaneY("mage", -5, size)).toBe(ys[0]);
    expect(heroPlaneY("mage", 99, size)).toBe(ys[2]);
  });

  it("bossPlaneY = the NEAR (downstage) row; scatterPlaneY is a stable per-key row", () => {
    expect(bossPlaneY()).toBe(CONFIG.plane.bandNear);
    expect(scatterPlaneY("npc:pahpu")).toBe(planeYForDepth(hashUnit("npc:pahpu")));
    expect(scatterPlaneY("npc:pahpu")).toBe(scatterPlaneY("npc:pahpu"));
  });
});

describe("spawn-y determinism — every spawn site stamps planeY", () => {
  it("factories assign the deterministic plane row", () => {
    const rng = createRng(123);
    const e = makeEnemy(7, "normal", 3, rng);
    expect(e.planeY).toBe(enemyPlaneY(7));

    for (const c of CLASSES) {
      expect(makeHero(1, c).planeY).toBe(heroPlaneY(c));
    }
    expect(makeBoss(9, 5).planeY).toBe(bossPlaneY());
    expect(makeWorldBoss(9).planeY).toBe(bossPlaneY());
  });

  it("hunt-spawned mobs carry planeY = enemyPlaneY(id) across a full run", () => {
    const s = initGameState(2024, soloSave("swordsman", 2));
    for (let i = 0; i < 40; i++) step(s, {});
    expect(s.enemies.length).toBeGreaterThan(0);
    for (const e of s.enemies) expect(e.planeY).toBe(enemyPlaneY(e.id));
    expect(s.heroes[0].planeY).toBe(heroPlaneY(s.heroes[0].cls));
  });

  it("same seed + save → identical planeY on every entity (lockstep-safe)", () => {
    const save = soloSave("archer", 3);
    const run = (): number[] => {
      const s = initGameState(555, save);
      for (let i = 0; i < 60; i++) step(s, {});
      return [s.heroes[0].planeY!, ...s.enemies.map((e) => e.planeY!)];
    };
    expect(run()).toEqual(run());
  });
});

describe("SAVE: planeY is transient — no SAVE_VERSION bump", () => {
  it("SAVE_VERSION is unchanged by Wave A", () => {
    expect(SAVE_VERSION).toBe(20);
  });

  it("(a) a save carrying NO entity/plane data loads with planeY defaulted at spawn", () => {
    // A save NEVER holds entity positions (the live arrays are rebuilt on load), so any save
    // is a "pre-Wave-A-shaped" save w.r.t. planeY. It loads fine and the hero gains a planeY.
    const save = soloSave("mage", 4);
    expect(JSON.stringify(save)).not.toContain("planeY");
    const s = initGameState(77, save);
    expect(typeof s.heroes[0].planeY).toBe("number");
    expect(s.heroes[0].planeY).toBe(heroPlaneY("mage"));
  });

  it("(b) toSaveData never persists planeY (offline replay can't depend on a saved y)", () => {
    const s = initGameState(9, soloSave("swordsman", 3));
    for (let i = 0; i < 50; i++) step(s, {}); // spawn a field of mobs with planeY set
    expect(s.enemies.some((e) => typeof e.planeY === "number")).toBe(true);
    const saved = toSaveData(s);
    expect(JSON.stringify(saved)).not.toContain("planeY"); // entities aren't persisted at all
  });

  it("(c) same seed + reloaded save reproduces the same y (recomputed, not restored)", () => {
    const save = soloSave("ninja", 2);
    const first = initGameState(31337, save).heroes[0].planeY;
    const reloaded = initGameState(31337, save).heroes[0].planeY;
    expect(reloaded).toBe(first);
    // Injecting a bogus persisted `planeY` into the save can't change the recomputed value —
    // the engine derives it from the class formation row, never reads it off the blob.
    const tampered = { ...save, hero: { ...save.hero, planeY: 999 } } as unknown as typeof save;
    expect(initGameState(31337, tampered).heroes[0].planeY).toBe(first);
  });
});
