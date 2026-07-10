/**
 * R4 Wave B — TEMPORARY identity guard for the "render cutover to engine-owned y"
 * (`worldDepthFromEngineY`). Proves that, for seeded entities of EVERY placed
 * class, the depth-band placement is byte-identical whether the seam recomputes
 * its own render-side hash (flag OFF) or reads the engine-owned `planeY` (flag
 * ON). This is the whole safety net of the cutover: engine `planeY` is a VERBATIM
 * port of the render depth math, so ON must equal OFF exactly.
 *
 * RETIRES AT WAVE C: once y BECOMES engine-owned (entities MOVE along the plane),
 * the render hash path is deleted and the flag with it — there is no longer an
 * "OFF" to compare against, so delete this file at that point.
 *
 * We assert on the SHARED pure seam (`worldFxContext`) rather than a full Pixi
 * rig because the seam IS the placement math (`worldDepthPlacement.test.ts`
 * already pins the pivot/bounds side). Both seams run depth ON / terrain OFF
 * (flat) — the ONLY difference between them is the cutover flag.
 */

import { describe, expect, it } from "vitest";
import {
  createRng,
  heroPlaneY,
  makeBoss,
  makeBossAdd,
  makeEnemy,
  makeHero,
  makeWorldBoss,
  scatterPlaneY,
  type HeroClass,
} from "@/engine";
import { depthZIndex } from "@/render/worldDepth/depthBand";
import {
  createWorldFxContext,
  DEPTH_NEUTRAL,
  type WorldFxContext,
  type WorldFxKind,
} from "@/render/worldDepth/worldFxContext";

const CLASSES: HeroClass[] = ["swordsman", "archer", "mage", "ninja"];
const XS = [0, 137, 460, 900];

/** Flag OFF (render-owned hash) and flag ON (engine `planeY`) seams — depth ON,
 *  flat terrain. Everything else about them is identical. */
function seams(): { off: WorldFxContext; on: WorldFxContext } {
  const off = createWorldFxContext();
  off.setFlags({ depth: true, terrain: false, engineY: false });
  off.setZone(null);
  const on = createWorldFxContext();
  on.setFlags({ depth: true, terrain: false, engineY: true });
  on.setZone(null);
  return { off, on };
}
const { off, on } = seams();

/**
 * Assert flag ON === flag OFF for one entity's placement. OFF ignores the
 * supplied `planeY` (recomputes the hash); ON reads it. Returns the resolved
 * depth so callers can additionally assert the feature is actually doing
 * something (row !== the flat neutral row).
 */
function expectIdentity(
  kind: WorldFxKind,
  id: number | string,
  planeY: number,
  slot: number | undefined,
  partySize: number | undefined,
): number {
  const dOff = off.depthOf(kind, id, slot, partySize); // no planeY → hash path
  const dOn = on.depthOf(kind, id, slot, partySize, planeY); // reads engine planeY
  expect(dOn).toBe(dOff); // exact — not toBeCloseTo
  for (const x of XS) {
    expect(on.footY(x, dOn)).toBe(off.footY(x, dOff));
  }
  expect(on.depthScaleOf(dOn)).toBe(off.depthScaleOf(dOff));
  expect(depthZIndex(dOn)).toBe(depthZIndex(dOff));
  return dOn;
}

describe("R4 Wave B: worldDepthFromEngineY ON === OFF (temporary, retires at Wave C)", () => {
  it("enemies — engine e.planeY reproduces the render enemyDepth hash row", () => {
    const rng = createRng(4242);
    const rows = new Set<number>();
    for (let id = 1; id <= 24; id++) {
      const e = makeEnemy(id, id % 2 ? "normal" : "fast", 3, rng);
      rows.add(expectIdentity("enemy", e.id, e.planeY!, undefined, undefined));
    }
    // A crowd actually scatters across rows (the flag is exercising real depth,
    // not the flat neutral row for everyone).
    expect(rows.size).toBeGreaterThan(4);
    expect(rows.has(DEPTH_NEUTRAL)).toBe(false);
  });

  it("boss-summoned adds — carry planeY, ride the same enemy path", () => {
    for (let slot = 0; slot < 4; slot++) {
      const add = makeBossAdd(500 + slot, "tank", 5, slot);
      expectIdentity("enemy", add.id, add.planeY!, undefined, undefined);
    }
  });

  it("solo hero — engine h.planeY (class formation row) reproduces heroDepth(0,1)", () => {
    for (const cls of CLASSES) {
      const h = makeHero(1, cls);
      const d = expectIdentity("hero", h.id, h.planeY!, 0, 1);
      // Solo row is the fixed formation row (0.65 today), not the flat neutral row.
      expect(d).not.toBe(DEPTH_NEUTRAL);
    }
  });

  it("party heroes (sizes 2-6) — the slot fan stamped at cohort build reproduces heroDepth(slot,size)", () => {
    for (let size = 2; size <= 6; size++) {
      const rows: number[] = [];
      for (let slot = 0; slot < size; slot++) {
        // Exactly what buildCohortState stamps: heroPlaneY(cls, cohortIndex, size).
        const cls = CLASSES[slot % CLASSES.length];
        const planeY = heroPlaneY(cls, slot, size);
        rows.push(expectIdentity("hero", slot + 1, planeY, slot, size));
      }
      // The fan really spreads far→near across the slots (strictly increasing).
      for (let i = 1; i < rows.length; i++) expect(rows[i]).toBeGreaterThan(rows[i - 1]);
    }
  });

  it("ghosts — scatterPlaneY(cid) reproduces the render ghostDepth(cid) hash row", () => {
    const rows = new Set<number>();
    for (const cid of ["char-a", "char-bbb", "ghost:99", "พี่โจ๋ง", "z"]) {
      rows.add(expectIdentity("ghost", cid, scatterPlaneY(cid), undefined, undefined));
    }
    expect(rows.size).toBeGreaterThan(1);
    expect(rows.has(DEPTH_NEUTRAL)).toBe(false);
  });

  it("bosses / world boss / town NPCs — NOT depth-scattered: placed at DEPTH_NEUTRAL under BOTH flags", () => {
    // The stage boss, world boss and town NPCs are placed via placeStaticActor
    // (DEPTH_NEUTRAL, terrain-lift only, fixed zIndex) — never the depthOf scatter
    // seam — so their placement is flag-INDEPENDENT by construction. Their engine
    // planeY (bossPlaneY = the near row) is intentionally NOT consumed: render draws
    // them frontmost via a fixed zIndex, and consuming it would move them ~40px and
    // break ON===OFF. Town NPCs have no engine entity and no hash row at all today.
    // This asserts the cutover left that static path untouched.
    expect(makeBoss(9, 5).planeY).toBe(makeWorldBoss(9).planeY); // both = near row (stamped, unused by render)
    for (const x of XS) {
      expect(on.footY(x, DEPTH_NEUTRAL)).toBe(off.footY(x, DEPTH_NEUTRAL));
      expect(on.depthScaleOf(DEPTH_NEUTRAL)).toBe(off.depthScaleOf(DEPTH_NEUTRAL));
    }
  });
});
