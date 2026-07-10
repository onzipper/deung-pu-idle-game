/**
 * R4.5 Wave 1.2 (issue #69) — ghosts share the LOCAL actors' depth sort domain.
 *
 * Owner finding after Wave 1.1: ghost live `planeY` placement worked, but the
 * LOCAL hero always drew in FRONT of every ghost regardless of row, because
 * ghost views lived in a separate `ghosts` container BELOW `entities` — a
 * container boundary, not zIndex, decided their order, so they could never
 * interleave. Wave 1.2 moves ghost roots INTO the shared `entities` container
 * (see `GhostLayer`/`GameRenderer`), where the SAME `depthZIndex(d)` key that
 * `GameRenderer.placeActor` gives heroes/enemies now sorts ghosts too.
 *
 * This exercises the REAL `GhostLayer` (ghost roots + their actual `view.zIndex`)
 * against LOCAL-actor stand-ins keyed by the EXACT expression `placeActor` uses
 * (`depthEnabled() ? depthZIndex(ctx.depthOf(...)) : 0`), all in ONE
 * `sortableChildren` container, and asserts sibling child-index ordering after
 * `sortChildren()` — the same headless scene-graph technique as
 * `worldDepthPlacement.test.ts` (no WebGL/Application needed). A regression that
 * re-separates the sort domains, or mis-keys a ghost, flips one of these orders.
 *
 * The enemy-vs-hero cases double as the requested verification that local
 * hero-vs-enemy interleave already works through `placeActor`'s shared key.
 */

import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { GhostLayer, type GhostDrawItem } from "@/render/views/ghostLayer";
import { depthZIndex, DEPTH_OFFSET_FAR, DEPTH_OFFSET_NEAR } from "@/render/worldDepth/depthBand";
import {
  createWorldFxContext,
  type WorldFxContext,
  type WorldFxKind,
} from "@/render/worldDepth/worldFxContext";

const DT = 1 / 60;
/** Live plane-band edges (planeToDepth maps these to d=0 far, d=1 near). */
const FAR = DEPTH_OFFSET_FAR; // -24, upstage → depthZIndex 0
const NEAR = DEPTH_OFFSET_NEAR; // 40, downstage → depthZIndex 1000

function item(over: Partial<GhostDrawItem> & { cid: string }): GhostDrawItem {
  return { name: over.cid, cls: "swordsman", tier: 1, x: 0, alpha: 1, ...over };
}

/** A depth-flag-ON, flat-terrain seam — the R4.5 world under validation. */
function depthCtx(): WorldFxContext {
  const ctx = createWorldFxContext();
  ctx.setFlags({ depth: true, terrain: false });
  ctx.setZone(null);
  return ctx;
}

/**
 * A LOCAL hero/enemy root stand-in placed with the EXACT sort key
 * `GameRenderer.placeActor` assigns (`worldFxFlags.depth === ctx.depthEnabled()`),
 * added to the shared container. Its rig geometry is irrelevant to a zIndex sort,
 * so a bare Container is faithful and keeps the test focused on ordering.
 */
function placeLocalActor(
  parent: Container,
  ctx: WorldFxContext,
  kind: WorldFxKind,
  id: number,
  planeY: number,
): Container {
  const v = new Container();
  const d = ctx.depthOf(kind, id, undefined, undefined, planeY);
  v.zIndex = ctx.depthEnabled() ? depthZIndex(d) : 0;
  parent.addChild(v);
  return v;
}

/** Draws `items` through the real GhostLayer into `entities`; returns cid→root. */
function placeGhosts(
  entities: Container,
  ctx: WorldFxContext,
  items: GhostDrawItem[],
): Map<string, Container> {
  const gl = new GhostLayer(entities, { worldFx: ctx });
  gl.update(items, DT);
  const out = new Map<string, Container>();
  for (const it of items) out.set(it.cid, gl.viewFor(it.cid)!);
  return out;
}

/** True if `a` draws in FRONT of `b` (later child = painted over) after sort. */
function drawsInFront(parent: Container, a: Container, b: Container): boolean {
  parent.sortChildren();
  return parent.getChildIndex(a) > parent.getChildIndex(b);
}

describe("#69 ghost↔local-actor depth interleave (shared sort domain)", () => {
  it("a nearer ghost draws in FRONT of a farther local hero", () => {
    const entities = new Container();
    entities.sortableChildren = true;
    const ctx = depthCtx();
    const hero = placeLocalActor(entities, ctx, "hero", 1, FAR); // far
    const ghost = placeGhosts(entities, ctx, [item({ cid: "gN", x: 0, planeY: NEAR })]).get("gN")!;
    expect(ghost.zIndex).toBeGreaterThan(hero.zIndex);
    expect(drawsInFront(entities, ghost, hero)).toBe(true);
    entities.destroy({ children: true });
  });

  it("a farther ghost draws BEHIND a nearer local hero", () => {
    const entities = new Container();
    entities.sortableChildren = true;
    const ctx = depthCtx();
    const hero = placeLocalActor(entities, ctx, "hero", 1, NEAR); // near
    const ghost = placeGhosts(entities, ctx, [item({ cid: "gF", x: 0, planeY: FAR })]).get("gF")!;
    expect(ghost.zIndex).toBeLessThan(hero.zIndex);
    expect(drawsInFront(entities, hero, ghost)).toBe(true);
    entities.destroy({ children: true });
  });

  it("a nearer local enemy draws in FRONT of a farther local hero (hero-vs-enemy verification)", () => {
    const entities = new Container();
    entities.sortableChildren = true;
    const ctx = depthCtx();
    const hero = placeLocalActor(entities, ctx, "hero", 1, FAR);
    const enemy = placeLocalActor(entities, ctx, "enemy", 7, NEAR);
    expect(enemy.zIndex).toBeGreaterThan(hero.zIndex);
    expect(drawsInFront(entities, enemy, hero)).toBe(true);
    entities.destroy({ children: true });
  });

  it("a farther local enemy draws BEHIND a nearer local hero (hero-vs-enemy verification)", () => {
    const entities = new Container();
    entities.sortableChildren = true;
    const ctx = depthCtx();
    const hero = placeLocalActor(entities, ctx, "hero", 1, NEAR);
    const enemy = placeLocalActor(entities, ctx, "enemy", 7, FAR);
    expect(enemy.zIndex).toBeLessThan(hero.zIndex);
    expect(drawsInFront(entities, hero, enemy)).toBe(true);
    entities.destroy({ children: true });
  });

  it("ghost↔enemy interleave both ways (near ghost over far enemy, far ghost under near enemy)", () => {
    const entities = new Container();
    entities.sortableChildren = true;
    const ctx = depthCtx();
    const enemyFar = placeLocalActor(entities, ctx, "enemy", 7, FAR);
    const enemyNear = placeLocalActor(entities, ctx, "enemy", 8, NEAR);
    const ghosts = placeGhosts(entities, ctx, [
      item({ cid: "gN", x: 0, planeY: NEAR }),
      item({ cid: "gF", x: 0, planeY: FAR }),
    ]);
    expect(drawsInFront(entities, ghosts.get("gN")!, enemyFar)).toBe(true);
    expect(drawsInFront(entities, enemyNear, ghosts.get("gF")!)).toBe(true);
    entities.destroy({ children: true });
  });

  it("the stage boss (+10000) stays frontmost and the world boss (−10000) stays behind the whole ghost band", () => {
    const entities = new Container();
    entities.sortableChildren = true;
    const ctx = depthCtx();
    const stageBoss = new Container();
    stageBoss.zIndex = 10000; // GameRenderer's fixed key
    const worldBoss = new Container();
    worldBoss.zIndex = -10000;
    entities.addChild(stageBoss, worldBoss);
    const ghosts = placeGhosts(entities, ctx, [
      item({ cid: "gN", x: 0, planeY: NEAR }), // z 1000
      item({ cid: "gF", x: 0, planeY: FAR }), // z 0
    ]);
    // Boss over the nearest ghost; world boss under the farthest ghost.
    expect(drawsInFront(entities, stageBoss, ghosts.get("gN")!)).toBe(true);
    expect(drawsInFront(entities, ghosts.get("gF")!, worldBoss)).toBe(true);
    // And boss is the single frontmost child overall.
    entities.sortChildren();
    const maxIdx = entities.children.length - 1;
    expect(entities.getChildIndex(stageBoss)).toBe(maxIdx);
    expect(entities.getChildIndex(worldBoss)).toBe(0);
    entities.destroy({ children: true });
  });

  it("depth OFF (flat world): ghosts stay behind local actors, preserving the pre-#69 z-order", () => {
    const entities = new Container();
    entities.sortableChildren = true;
    const ctx = createWorldFxContext(); // both flags OFF
    ctx.setZone(null);
    const hero = placeLocalActor(entities, ctx, "hero", 1, NEAR); // zIndex 0 when flat
    const ghost = placeGhosts(entities, ctx, [item({ cid: "gF", x: 0, planeY: FAR })]).get("gF")!;
    // Flat ghost takes the fixed backmost key; hero is at 0.
    expect(ghost.zIndex).toBeLessThan(hero.zIndex);
    expect(drawsInFront(entities, hero, ghost)).toBe(true);
    entities.destroy({ children: true });
  });
});
