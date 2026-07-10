/**
 * FREE-FIELD (Phase 6) — combat-feedback guarantee, PINNED against refactors.
 *
 * World props live in the shared `entities` container, so two structural
 * invariants keep combat feedback readable (spec §3 "Actor depth sorting"):
 *
 *  (a) The `fx` + `overlay` layers sit ABOVE `entities` in the layer stack.
 *      Damage numbers / kill pops / tap markers render in `fx`; the boss plate
 *      in `overlay`. A prop's zIndex only sorts WITHIN `entities`, so as long as
 *      `entities` is composed BELOW `fx`/`overlay`, a prop can never occlude any
 *      of them. This source-guards the composition order in `create()`.
 *
 *  (b) Props are non-tappable. Every hit-test (`hitTestPointer`/`hitTestNpc`/
 *      `hitTestGate`/`hitTestGhost`) scans engine/renderer actor lists
 *      (`state.enemies`/`worldBoss`/`TOWN_NPCS`/`ghostList`) — NEVER a prop
 *      container. This guards that no hit-test method references the field-prop
 *      seam, so a prop can never become a tap target (the ghostHitTest-style
 *      exclusion pin). A live-Application behavioral test is impossible headless
 *      (`hitTest*` early-returns without WebGL), so this is the source pin.
 *
 * Same source-reading technique as `src/__tests__/codemap.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "../GameRenderer.ts"), "utf8");

/** Byte offset of a substring (asserted present so ordering checks are valid). */
function at(needle: string): number {
  const i = SRC.indexOf(needle);
  expect(i, `expected to find \`${needle}\` in GameRenderer.ts`).toBeGreaterThan(-1);
  return i;
}

describe("Phase 6 field props — fx/overlay layers sit ABOVE entities", () => {
  it("cameraRoot composes entities BEFORE projectiles/fx", () => {
    const add = SRC.indexOf("cameraRoot.addChild(");
    expect(add).toBeGreaterThan(-1);
    const call = SRC.slice(add, SRC.indexOf(")", add));
    // Same container, so z-order = child order: entities must precede fx.
    expect(call.indexOf("entities")).toBeLessThan(call.indexOf("projectiles"));
    expect(call.indexOf("projectiles")).toBeLessThan(call.indexOf("fx"));
  });

  it("overlay is added to `world` AFTER cameraRoot (screen-anchored, on top)", () => {
    const add = at("world.addChild(cameraRoot, overlay)");
    void add; // its mere presence pins the order (cameraRoot first, overlay last)
    // And `fx`/`overlay` are the two layers that must never be under a prop:
    // the FieldProps root is added to `entities`, never to fx/overlay.
    const fpCreate = at("new FieldProps(entities");
    expect(fpCreate).toBeGreaterThan(-1);
    expect(SRC.includes("new FieldProps(fx")).toBe(false);
    expect(SRC.includes("new FieldProps(overlay")).toBe(false);
  });
});

describe("Phase 6 field props — non-tappable (hit-tests never scan props)", () => {
  // The four hit-test methods form a contiguous block; slice it out and assert
  // it never reaches into the field-prop seam.
  const start = at("hitTestPointer(canvasX");
  const end = at("showNpcSpeech(");
  const hitTestBlock = SRC.slice(start, end);

  it("no hit-test method references the FieldProps seam", () => {
    expect(hitTestBlock.includes("fieldProps")).toBe(false);
    expect(hitTestBlock.includes("FieldProps")).toBe(false);
  });

  it("the hit-tests scan engine/renderer actor lists only", () => {
    // Sanity: the block still resolves taps against the sanctioned actor
    // sources (guards against a future edit that swaps in a container scan).
    expect(hitTestBlock.includes("state.enemies")).toBe(true);
    expect(hitTestBlock.includes("this.ghostList")).toBe(true);
    expect(hitTestBlock.includes("TOWN_NPCS")).toBe(true);
  });
});
