/**
 * World props for the Forest Road slice (R4.5 Wave 2C, issue #69) — code-drawn
 * deterministic decoration for map2 farm zones. Follows the `forestRoad.test.ts`
 * convention: real pixi.js `Graphics`/`Container` building runs fine headless,
 * so the builders are exercised directly, while the pure placement/geometry is
 * unit-tested without Pixi.
 *
 * Covers: (1) gating — only map2 farm zones activate; (2) deterministic
 * placement — same zone → identical layout across two calls; (3) zIndex
 * interleave — an actor nearer than a trunk draws in front, farther behind
 * (shared sort domain, `ghostInterleave.test.ts` technique); (4) foreground
 * strip stays in its near band (geometry bound); (5) no-tap — no prop x sits in
 * a gate tap rect or a town-NPC anchor range (so `hitTestGate`/`hitTestNpc`
 * can't match; `hitTestGhost` scans presence, never props); (6) build-once /
 * no-growth + the Pool-sweep-doesn't-touch-props guarantee.
 */

import { describe, expect, it } from "vitest";
import { Container, Graphics } from "pixi.js";
import type { Zone } from "@/engine";
import { Pool } from "@/render/Pool";
import { GROUND_Y } from "@/render/layout";
import { DEPTH_OFFSET_FAR, DEPTH_OFFSET_NEAR, depthZIndex } from "@/render/worldDepth/depthBand";
import {
  createWorldFxContext,
  planeToDepth,
  type WorldFxContext,
} from "@/render/worldDepth/worldFxContext";
import { gateTapSide } from "@/render/environment/zoneGates";
import { biomeForZone } from "@/render/environment/biomes";
import { TOWN_NPCS } from "@/render/townNpcs";
import {
  buildMapProps,
  foregroundStripBand,
  GRASS_D_MAX,
  GRASS_D_MIN,
  MAP_PROPS_NEAR_LABEL,
  MAP_PROP_LABEL_PREFIX,
  MAP_PROPS_NEAR_Z,
  mapPropLayout,
  mapPropsActiveForZone,
  type MapPropSpec,
} from "@/render/environment/mapProps";

function map2Farm(zoneIdx: number): Zone {
  return { mapId: "map2", zoneIdx, kind: "farm", stage: zoneIdx };
}

/** A depth-flag-ON, flat-terrain seam — the R4.5 world under validation. */
function depthCtx(): WorldFxContext {
  const ctx = createWorldFxContext();
  ctx.setFlags({ depth: true, terrain: false });
  ctx.setZone(map2Farm(1));
  return ctx;
}

/** Places a prop / actor with the EXACT expression `GameRenderer.placeProp`
 * uses (`depthZIndex(planeToDepth(planeY))`). */
function placeWithDepth(view: Container, ctx: WorldFxContext, x: number, planeY: number): void {
  const d = planeToDepth(planeY);
  view.x = x;
  view.y = ctx.footY(x, d);
  view.scale.set(ctx.depthScaleOf(d));
  view.zIndex = depthZIndex(d);
}

function drawsInFront(parent: Container, a: Container, b: Container): boolean {
  parent.sortChildren();
  return parent.getChildIndex(a) > parent.getChildIndex(b);
}

describe("mapPropsActiveForZone — gating (matches forestRoad's map2-farm target)", () => {
  it("true for every map2 farm zone", () => {
    for (let z = 1; z <= 5; z++) expect(mapPropsActiveForZone(map2Farm(z))).toBe(true);
  });

  it("false for map2 boss, town, and other maps' farm zones", () => {
    expect(mapPropsActiveForZone({ mapId: "map2", zoneIdx: 6, kind: "boss", stage: 10 })).toBe(false);
    expect(mapPropsActiveForZone({ mapId: "map1", zoneIdx: 1, kind: "farm", stage: 1 })).toBe(false);
    expect(mapPropsActiveForZone({ mapId: "map1", zoneIdx: 0, kind: "town", stage: 1 })).toBe(false);
    expect(mapPropsActiveForZone({ mapId: "map3", zoneIdx: 1, kind: "farm", stage: 1 })).toBe(false);
  });
});

describe("mapPropLayout — deterministic (same zone → identical layout)", () => {
  it("two calls produce byte-identical standing + grass specs", () => {
    const a = mapPropLayout(map2Farm(2));
    const b = mapPropLayout(map2Farm(2));
    expect(a).toEqual(b);
  });

  it("has the required prop inventory (4-6 trees, 3-4 rocks, 1 lamp/sign/gateFragment)", () => {
    const { standing } = mapPropLayout(map2Farm(3));
    const count = (k: MapPropSpec["kind"]) => standing.filter((s) => s.kind === k).length;
    expect(count("tree")).toBeGreaterThanOrEqual(4);
    expect(count("tree")).toBeLessThanOrEqual(6);
    expect(count("rock")).toBeGreaterThanOrEqual(3);
    expect(count("rock")).toBeLessThanOrEqual(4);
    expect(count("lamp")).toBe(1);
    expect(count("sign")).toBe(1);
    expect(count("gateFragment")).toBe(1);
  });

  it("different zones produce different layouts (hash varies by zone id)", () => {
    expect(mapPropLayout(map2Farm(1))).not.toEqual(mapPropLayout(map2Farm(4)));
  });
});

describe("mapProps zIndex interleave — actors share the props' sort domain", () => {
  it("an actor NEARER than a trunk draws in FRONT; FARTHER draws BEHIND", () => {
    const entities = new Container();
    entities.sortableChildren = true;
    const ctx = depthCtx();
    const zone = map2Farm(2);

    const built = buildMapProps(
      biomeForZone(zone),
      zone,
      () => GROUND_Y,
      (view, spec) => placeWithDepth(view, ctx, spec.x, spec.planeY),
    );
    for (const v of built.standing) entities.addChild(v);

    const trunk = built.standing[built.layout.standing.findIndex((s) => s.kind === "tree")]!;
    const trunkSpec = built.layout.standing.find((s) => s.kind === "tree")!;

    // A nearer actor (bigger planeY = downstage) and a farther actor.
    const nearer = new Container();
    placeWithDepth(nearer, ctx, trunkSpec.x, Math.min(DEPTH_OFFSET_NEAR, trunkSpec.planeY + 12));
    const farther = new Container();
    placeWithDepth(farther, ctx, trunkSpec.x, Math.max(DEPTH_OFFSET_FAR, trunkSpec.planeY - 12));
    entities.addChild(nearer, farther);

    expect(nearer.zIndex).toBeGreaterThan(trunk.zIndex);
    expect(farther.zIndex).toBeLessThan(trunk.zIndex);
    expect(drawsInFront(entities, nearer, trunk)).toBe(true);
    expect(drawsInFront(entities, trunk, farther)).toBe(true);
    entities.destroy({ children: true });
  });
});

describe("mapProps — foreground strip stays in its near band (geometry bound)", () => {
  it("strip top/bottom sit inside the depth band's near half", () => {
    const { top, bottom } = foregroundStripBand(GROUND_Y);
    const bandTop = GROUND_Y + DEPTH_OFFSET_FAR;
    const bandBottom = GROUND_Y + DEPTH_OFFSET_NEAR;
    // Strip lives at the near edge: top is below ground and above the near foot
    // line by only a shin (a blade tip), bottom a shallow cover below it.
    expect(top).toBeGreaterThan(GROUND_Y);
    expect(top).toBeGreaterThan(bandTop);
    expect(top).toBeLessThanOrEqual(bandBottom);
    expect(bottom).toBeGreaterThan(bandBottom);
    // The whole strip is a shin's worth of band, never creeping up to mid-screen.
    expect(bottom - top).toBeLessThanOrEqual(28);
  });

  it("every grass clump sits in the near-half rows [GRASS_D_MIN, GRASS_D_MAX]", () => {
    const { grass } = mapPropLayout(map2Farm(2));
    expect(grass.length).toBeGreaterThan(0);
    for (const cl of grass) {
      expect(cl.d).toBeGreaterThanOrEqual(GRASS_D_MIN);
      expect(cl.d).toBeLessThanOrEqual(GRASS_D_MAX);
    }
  });
});

describe("mapProps — no prop is tappable (gate / NPC / ghost can't match a prop)", () => {
  it("no standing prop x sits inside a gate's tap rect (gateTapSide null at any height)", () => {
    for (let z = 1; z <= 5; z++) {
      const { standing } = mapPropLayout(map2Farm(z));
      for (const s of standing) {
        // Test across the whole gate tap-rect height — clearance guarantees null.
        for (const wy of [GROUND_Y, GROUND_Y - 60, GROUND_Y + 10]) {
          expect(gateTapSide(s.x, wy, GROUND_Y, "map2", "farm")).toBeNull();
        }
      }
    }
  });

  it("no standing prop x falls within a town-NPC anchor range", () => {
    for (let z = 1; z <= 5; z++) {
      const { standing } = mapPropLayout(map2Farm(z));
      for (const s of standing) {
        for (const n of TOWN_NPCS) {
          expect(Math.abs(s.x - n.x)).toBeGreaterThan(n.radius);
        }
      }
    }
    // hitTestGhost scans the presence list, never props — structurally
    // unreachable for a prop (no GameState/WebGL needed to assert this).
  });
});

describe("mapProps — build-once / no-growth + Pool-sweep isolation", () => {
  it("two builds yield the same standing count + near layer shape (label + zIndex + 2 children)", () => {
    const zone = map2Farm(3);
    const b1 = buildMapProps(biomeForZone(zone), zone, () => GROUND_Y, () => {});
    const b2 = buildMapProps(biomeForZone(zone), zone, () => GROUND_Y, () => {});
    expect(b1.standing.length).toBe(b2.standing.length);
    expect(b1.near.label).toBe(MAP_PROPS_NEAR_LABEL);
    expect(b1.near.zIndex).toBe(MAP_PROPS_NEAR_Z);
    // Near layer = strip + tufts, built once (no per-frame growth path exists).
    expect(b1.near.children.length).toBe(2);
    expect(b2.near.children.length).toBe(2);
    for (const g of b1.standing) expect(g.label.startsWith(MAP_PROP_LABEL_PREFIX)).toBe(true);
    b1.near.destroy({ children: true });
    b2.near.destroy({ children: true });
    for (const g of b1.standing) g.destroy();
    for (const g of b2.standing) g.destroy();
  });

  it("a Pool's mark-and-sweep never removes prop siblings from the shared container", () => {
    const entities = new Container();
    const zone = map2Farm(1);
    const built = buildMapProps(biomeForZone(zone), zone, () => GROUND_Y, () => {});
    for (const v of built.standing) entities.addChild(v);
    entities.addChild(built.near);
    const before = entities.children.length;

    // A pool over the SAME container: a full frame that sees only id 1.
    const pool = new Pool<Graphics>(entities, () => new Graphics());
    pool.beginFrame();
    pool.get(1);
    pool.endFrame(); // sweeps nothing prop-owned
    pool.beginFrame();
    // Next frame id 1 disappears → the pooled view is swept, props untouched.
    pool.endFrame();

    for (const v of built.standing) expect(entities.children.includes(v)).toBe(true);
    expect(entities.children.includes(built.near)).toBe(true);
    expect(entities.children.length).toBe(before); // props survived both sweeps
    entities.destroy({ children: true });
  });
});
