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
  npcInRange,
  townNpcConfig,
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
    // FREE-FIELD (Phase 1): the depth band widened into a tall play field (−64..56).
    expect(CONFIG.plane.bandFar).toBe(-64);
    expect(CONFIG.plane.bandNear).toBe(56);
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
    // R4 Wave C1: hero `planeY` is now MUTABLE (it steers toward the lane it engages). After a
    // run it need NOT equal the spawn home row anymore, but it stays a finite value inside the
    // band (enemies, by contrast, remain pinned to their spawn scatter — asserted above).
    const hy = s.heroes[0].planeY!;
    expect(Number.isFinite(hy)).toBe(true);
    expect(hy).toBeGreaterThanOrEqual(CONFIG.plane.bandFar - 1e-9);
    expect(hy).toBeLessThanOrEqual(CONFIG.plane.bandNear + 1e-9);
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

describe("FREE-FIELD Phase 3 — enemy 2D placement spans the widened field", () => {
  const { bandFar, bandNear } = CONFIG.plane;
  const span = bandNear - bandFar; // widened band = 120 (−64..56)

  it("enemyPlaneY covers the FULL widened band, edge to edge (id-hash → linear map)", () => {
    // A representative spawn-id population: the id-hash distributes uniformly over [0,1),
    // so a linear map into [bandFar,bandNear] reaches within a hair of both far/near edges.
    // Deterministic (pure hash — no RNG), so this span is fixed on every client.
    const ys: number[] = [];
    for (let id = 1; id <= 200; id++) ys.push(enemyPlaneY(id));
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    // Every row is inside the band…
    expect(min).toBeGreaterThanOrEqual(bandFar);
    expect(max).toBeLessThanOrEqual(bandNear);
    // …and the crowd reaches deep into BOTH the far quarter and the near quarter, so a
    // field genuinely fills the taller y axis (not clustered near the old ±40 strip).
    expect(min).toBeLessThan(bandFar + span * 0.1); // reaches the far edge
    expect(max).toBeGreaterThan(bandNear - span * 0.1); // reaches the near edge
  });

  it("a live hunt field spreads mobs across x AND y (genuine 2D scatter)", () => {
    const s = initGameState(2024, soloSave("swordsman", 2));
    // Sample the whole live population as mobs die + respawn across the run, so the id
    // pool that actually spawns is large enough to exercise the full band (a single
    // ≤17-mob snapshot can id-hash-cluster; over a run the field visits both edges).
    const ys: number[] = [];
    const xs: number[] = [];
    for (let i = 0; i < 600; i++) {
      step(s, {});
      for (const e of s.enemies) {
        ys.push(e.planeY!);
        xs.push(e.x);
      }
    }
    expect(ys.length).toBeGreaterThan(50);
    const mid = (bandFar + bandNear) / 2;
    // y: the run's mobs straddle the mid row and cover a wide slice of the band.
    expect(Math.min(...ys)).toBeLessThan(mid);
    expect(Math.max(...ys)).toBeGreaterThan(mid);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(span * 0.4);
    // x: scattered across the seeded spawn band (2D, not a single column).
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(50);
  });

  it("boss + worldBoss stay on ONE fixed downstage row — never id-scattered by the wider band", () => {
    for (const id of [1, 7, 42, 999]) {
      expect(makeBoss(id, 5).planeY).toBe(bandNear);
      expect(makeWorldBoss(id).planeY).toBe(bandNear);
    }
    // Same row regardless of id (contrast enemyPlaneY, which varies by id).
    expect(makeBoss(1, 5).planeY).toBe(makeBoss(2, 5).planeY);
  });
});

describe("FREE-FIELD Phase 3 — town NPCs are PLACED 2D points, interaction stays x-only", () => {
  const NPCS = ["npc:pahpu", "npc:lungdueng", "npc:elder"] as const;
  const TOWN = { mapId: "map1", zoneIdx: 0 };

  it("every town NPC carries an explicit deterministic planeY (design constant, in-band)", () => {
    for (const id of NPCS) {
      const a = townNpcConfig(id);
      expect(typeof a.planeY).toBe("number");
      expect(Number.isFinite(a.planeY)).toBe(true);
      expect(a.planeY).toBeGreaterThanOrEqual(CONFIG.plane.bandFar);
      expect(a.planeY).toBeLessThanOrEqual(CONFIG.plane.bandNear);
      // PLACED, not hash-scattered — the constant must NOT equal the enemy-style scatter row.
      // (This is what makes NPC depth intentional; if a future stagger happens to collide it's
      // still a design choice, but today they're pinned on the ground line, scatter is not.)
      expect(a.planeY).not.toBe(scatterPlaneY(id));
      expect(townNpcConfig(id).planeY).toBe(a.planeY); // pure/deterministic
    }
  });

  it("npcInRange gates on x ONLY — hero depth never changes tap-to-talk (IRON invariant)", () => {
    const s = initGameState(1);
    s.location = { ...TOWN };
    const hero = s.heroes[0];
    const merchant = townNpcConfig("npc:pahpu");
    // In range at the anchor x, out of range one radius away — regardless of hero planeY.
    for (const py of [-64, -12, 0, 33, 56, 999, -999]) {
      hero.planeY = py;
      hero.x = merchant.x;
      expect(npcInRange(s, "npc:pahpu")).toBe(true);
      hero.x = merchant.x + merchant.radius + 1;
      expect(npcInRange(s, "npc:pahpu")).toBe(false);
    }
  });

  it("interaction radius is unchanged (walk-order trips fire at the same x distances)", () => {
    const s = initGameState(1);
    s.location = { ...TOWN };
    const hero = s.heroes[0];
    for (const id of NPCS) {
      const a = townNpcConfig(id);
      expect(a.radius).toBe(42); // pinned — Phase 3 must not move the trip distance
      hero.planeY = -64; // far row: still purely x-gated
      hero.x = a.x + a.radius; // exactly on the boundary → in range (≤)
      expect(npcInRange(s, id)).toBe(true);
      hero.x = a.x - a.radius - 0.001;
      expect(npcInRange(s, id)).toBe(false);
    }
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
