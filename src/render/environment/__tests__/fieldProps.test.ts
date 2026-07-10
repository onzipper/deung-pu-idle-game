/**
 * FREE-FIELD (Phase 6) — world props in the SHARED actor sort domain.
 *
 * Headless scene-graph technique (same as `ghostInterleave.test.ts`): the REAL
 * `FieldProps` places its prop roots into one `sortableChildren` container
 * alongside LOCAL-actor stand-ins keyed by the EXACT expression `placeActor`
 * uses (`depthEnabled() ? depthZIndex(depthOf(...)) : 0`), and we assert sibling
 * child-index ordering after `sortChildren()`. No WebGL / Application needed.
 *
 * Covers: (1) a prop sorts BETWEEN a far and a near actor (interleave); (2) an
 * actor nearer than a prop draws in front (the HP-bar-safe case — the bar rides
 * inside the actor root, so this IS the bar-vs-prop guarantee); (3) depth OFF →
 * the fixed backmost flat key keeps props behind every actor; (4) scene-swap
 * rebuild destroys the prior zone's props (no orphans); (5) authored placement
 * is farm-only + carries the unread blocker hook.
 */

import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import type { Zone } from "@/engine";
import {
  depthZIndex,
  DEPTH_OFFSET_FAR,
  DEPTH_OFFSET_NEAR,
} from "@/render/worldDepth/depthBand";
import {
  createWorldFxContext,
  type WorldFxContext,
} from "@/render/worldDepth/worldFxContext";
import {
  FieldProps,
  FIELD_PROP_FLAT_ZINDEX,
  fieldPropSpecsFor,
} from "@/render/environment/fieldProps";

const FAR = DEPTH_OFFSET_FAR; // -64, upstage → depthZIndex 0
const NEAR = DEPTH_OFFSET_NEAR; // 56, downstage → depthZIndex 1000

function farmZone(zoneIdx = 1): Zone {
  return { mapId: "map1", zoneIdx, kind: "farm", stage: 1 };
}
function bossZone(): Zone {
  return { mapId: "map1", zoneIdx: 5, kind: "boss", stage: 5 };
}

/** Depth-ON, flat-terrain seam — the free-field world under validation. */
function depthCtx(): WorldFxContext {
  const ctx = createWorldFxContext();
  ctx.setFlags({ depth: true, terrain: false });
  ctx.setZone(null);
  return ctx;
}

/** A LOCAL hero/enemy root stand-in with the EXACT sort key `placeActor` gives. */
function placeLocalActor(
  parent: Container,
  ctx: WorldFxContext,
  id: number,
  planeY: number,
): Container {
  const v = new Container();
  const d = ctx.depthOf("hero", id, undefined, undefined, planeY);
  v.zIndex = ctx.depthEnabled() ? depthZIndex(d) : 0;
  parent.addChild(v);
  return v;
}

/** True if `a` draws in FRONT of `b` (later child = painted over) after sort. */
function drawsInFront(parent: Container, a: Container, b: Container): boolean {
  parent.sortChildren();
  return parent.getChildIndex(a) > parent.getChildIndex(b);
}

describe("Phase 6 field props — shared actor sort domain", () => {
  it("a mid-row prop sorts BETWEEN a far actor and a near actor", () => {
    const entities = new Container();
    entities.sortableChildren = true;
    const ctx = depthCtx();
    const fp = new FieldProps(entities, { worldFx: ctx });
    fp.setZone(farmZone());

    const midProp = fp.views()[0]!; // slot[0] = mid-band planeY (see fieldProps.ts)
    const far = placeLocalActor(entities, ctx, 1, FAR);
    const near = placeLocalActor(entities, ctx, 2, NEAR);

    expect(midProp.zIndex).toBeGreaterThan(far.zIndex);
    expect(midProp.zIndex).toBeLessThan(near.zIndex);
    expect(drawsInFront(entities, midProp, far)).toBe(true);
    expect(drawsInFront(entities, near, midProp)).toBe(true);

    fp.destroy();
    entities.destroy({ children: true });
  });

  it("an actor nearer than the prop draws IN FRONT (HP bar rides inside the actor root)", () => {
    const entities = new Container();
    entities.sortableChildren = true;
    const ctx = depthCtx();
    const fp = new FieldProps(entities, { worldFx: ctx });
    fp.setZone(farmZone());
    const prop = fp.views()[0]!;

    // Actor feet BELOW the prop's foot line (nearer) ⇒ actor + its HP bar in front.
    const nearer = placeLocalActor(entities, ctx, 3, NEAR);
    expect(nearer.zIndex).toBeGreaterThan(prop.zIndex);
    expect(drawsInFront(entities, nearer, prop)).toBe(true);

    // And an actor farther than the prop draws behind it.
    const farther = placeLocalActor(entities, ctx, 4, FAR);
    expect(farther.zIndex).toBeLessThan(prop.zIndex);
    expect(drawsInFront(entities, prop, farther)).toBe(true);

    fp.destroy();
    entities.destroy({ children: true });
  });

  it("depth OFF: the prop takes the fixed backmost flat key, behind a flat actor", () => {
    const entities = new Container();
    entities.sortableChildren = true;
    const ctx = createWorldFxContext(); // both flags OFF
    ctx.setZone(null);
    const fp = new FieldProps(entities, { worldFx: ctx });
    fp.setZone(farmZone());

    const prop = fp.views()[0]!;
    const actor = placeLocalActor(entities, ctx, 1, NEAR); // zIndex 0 when flat
    expect(prop.zIndex).toBe(FIELD_PROP_FLAT_ZINDEX);
    expect(prop.zIndex).toBeLessThan(actor.zIndex);
    expect(drawsInFront(entities, actor, prop)).toBe(true);

    fp.destroy();
    entities.destroy({ children: true });
  });

  it("a depth-flag flip re-keys existing props without a rebuild", () => {
    const entities = new Container();
    entities.sortableChildren = true;
    const ctx = createWorldFxContext(); // OFF
    ctx.setZone(null);
    const fp = new FieldProps(entities, { worldFx: ctx });
    fp.setZone(farmZone());
    const propOff = fp.views()[0]!;
    expect(propOff.zIndex).toBe(FIELD_PROP_FLAT_ZINDEX);

    // Flip depth ON; setZone (same zone) must re-apply the band key, same view.
    ctx.setFlags({ depth: true, terrain: false });
    fp.setZone(farmZone());
    expect(fp.views()[0]).toBe(propOff); // no rebuild — same Container reused
    expect(propOff.zIndex).toBeGreaterThanOrEqual(0);
    expect(propOff.destroyed).toBe(false);

    fp.destroy();
    entities.destroy({ children: true });
  });

  it("scene swap rebuilds props and leaves NO orphans", () => {
    const entities = new Container();
    entities.sortableChildren = true;
    const ctx = depthCtx();
    const fp = new FieldProps(entities, { worldFx: ctx });

    fp.setZone(farmZone(1));
    const first = fp.views().slice();
    expect(first.length).toBe(2);
    expect(entities.children.length).toBe(2);

    // Different zone identity ⇒ rebuild: old props destroyed + removed.
    fp.setZone(farmZone(2));
    for (const v of first) expect(v.destroyed).toBe(true);
    expect(entities.children.length).toBe(2); // exactly the new props, no orphans
    for (const v of fp.views()) expect(first).not.toContain(v);

    // Boss zone ⇒ no props at all, prior ones swept.
    fp.setZone(bossZone());
    expect(fp.views().length).toBe(0);
    expect(entities.children.length).toBe(0);

    fp.destroy();
    entities.destroy({ children: true });
  });

  it("authored placement is farm-only and carries the (unread) blocker hook", () => {
    const farm = fieldPropSpecsFor(farmZone());
    expect(farm.length).toBe(2);
    expect(farm[0]!.blocker?.r).toBe(16); // shape carried, render never reads it
    expect(fieldPropSpecsFor(bossZone()).length).toBe(0);
    expect(fieldPropSpecsFor({ mapId: "map1", zoneIdx: 0, kind: "town", stage: 1 }).length).toBe(0);
  });
});
