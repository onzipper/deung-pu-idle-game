/**
 * Ghost-presence render layer — R3 action stream (docs/ghost-presence-design.md §2, §5).
 *
 * These exercise the REAL `GhostLayer`/`updateHeroView`/`playHeroPosePulse` path (no
 * re-statement of the pose math). They pin BOTH behaviors and the HARD INVARIANTS: a
 * `pa` action edge-triggers exactly the rig's own attack/skill pose (never an fx/camera/
 * audio effect), a `p`-only ghost renders exactly as before, and the HP bar / filters
 * stay untouched. The invariant proof is structural: `GhostLayer` is constructed with
 * ONLY a `Container` (no timeDirector / camera / audio / fx dependency exists to call),
 * and the pose path routes through `playHeroPosePulse`, which emits no `GameEvent`.
 */

import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { scatterPlaneY } from "@/engine";
import { createWorldFxContext, type WorldFxContext } from "@/render/worldDepth/worldFxContext";
import { GhostLayer, type GhostDrawItem } from "../ghostLayer";

const DT = 1 / 60;

function item(over: Partial<GhostDrawItem> & { cid: string; cls: GhostDrawItem["cls"] }): GhostDrawItem {
  return { name: over.cid, tier: 1, x: 0, alpha: 1, ...over };
}

function make(): GhostLayer {
  return new GhostLayer(new Container());
}

/** A depth-flag-ON world-fx context (R4.5 Wave 1.1 placement needs the seam actually
 *  live — the bare `make()` ghosts above stay flags-off/no-op for the pose tests). */
function makeWithDepth(): { gl: GhostLayer; ctx: WorldFxContext } {
  const ctx = createWorldFxContext();
  ctx.setFlags({ depth: true, terrain: false });
  ctx.setZone(null);
  const gl = new GhostLayer(new Container(), { worldFx: ctx });
  return { gl, ctx };
}

describe("GhostLayer — R3 pose mapping", () => {
  it("edge-triggers the class BASIC pose when a `basic` action counter first advances", () => {
    const gl = make();
    gl.update([item({ cid: "g1", cls: "swordsman", action: "basic", at: 1, facing: 1 })], DT);
    expect(gl.viewFor("g1")?.anim.attack?.kind).toBe("swing");
  });

  it("maps skill1-4 to the single class SKILL pose (mage -> castHold)", () => {
    const gl = make();
    gl.update([item({ cid: "g1", cls: "mage", action: "skill3", at: 1 })], DT);
    expect(gl.viewFor("g1")?.anim.attack?.kind).toBe("castHold");
  });

  it("maps `dash` to a quick class strike (ninja -> dualSlash)", () => {
    const gl = make();
    gl.update([item({ cid: "g1", cls: "ninja", action: "dash", at: 1 })], DT);
    expect(gl.viewFor("g1")?.anim.attack?.kind).toBe("dualSlash");
  });

  it("idle/walk never pulse a pose (locomotion only)", () => {
    const gl = make();
    gl.update([item({ cid: "g1", cls: "archer", action: "walk", at: 4 })], DT);
    expect(gl.viewFor("g1")?.anim.attack).toBeNull();
  });

  it("an explicit `pa` facing drives the rig flip (via the synthetic aim)", () => {
    const gl = make();
    gl.update([item({ cid: "g1", cls: "swordsman", action: "idle", at: 1, facing: -1 })], DT);
    expect(gl.viewFor("g1")?.bodyRoot.scale.x).toBe(-1);
  });

  it("edge-triggers ONCE: a re-delivered/held `at` never restarts the pose", () => {
    const gl = make();
    gl.update([item({ cid: "g1", cls: "swordsman", action: "basic", at: 1 })], DT);
    const view = gl.viewFor("g1")!;
    expect(view.anim.attackSeq).toBe(1);
    gl.update([item({ cid: "g1", cls: "swordsman", action: "basic", at: 1 })], DT); // same at
    expect(view.anim.attackSeq).toBe(1); // no re-pulse
    gl.update([item({ cid: "g1", cls: "swordsman", action: "basic", at: 2 })], DT); // advance
    expect(view.anim.attackSeq).toBe(2);
  });
});

describe("GhostLayer — invariants", () => {
  it("a `p`-only ghost (no action fields) never poses and derives facing from velocity", () => {
    const gl = make();
    // No action/at/facing -> pre-R3 behavior: velocity facing, no pose pulse.
    gl.update([item({ cid: "g1", cls: "swordsman", x: 100 })], DT);
    gl.update([item({ cid: "g1", cls: "swordsman", x: 200 })], DT); // moving +x
    const view = gl.viewFor("g1")!;
    expect(view.anim.attack).toBeNull();
    expect(view.bodyRoot.scale.x).toBe(1); // faced its movement direction, not an aim
  });

  it("HP bar stays hidden and no filters are attached, even while a pose plays", () => {
    const gl = make();
    gl.update([item({ cid: "g1", cls: "mage", action: "skill1", at: 1 })], DT);
    const view = gl.viewFor("g1")!;
    expect(view.anim.attack).not.toBeNull(); // a pose IS playing
    expect(view.hpBar.visible).toBe(false); // ...yet no combat readout
    expect(view.filters == null || (view.filters as unknown[]).length === 0).toBe(true);
  });

  it("respects the whole-rig fade alpha", () => {
    const gl = make();
    gl.update([item({ cid: "g1", cls: "archer", action: "basic", at: 1, alpha: 0.4 })], DT);
    expect(gl.viewFor("g1")?.alpha).toBeCloseTo(0.4, 5);
  });

  it("sweeps a vanished ghost's pose memory (no re-pulse leak on cid reuse)", () => {
    const gl = make();
    gl.update([item({ cid: "g1", cls: "swordsman", action: "basic", at: 5 })], DT);
    gl.update([], DT); // g1 leaves -> swept
    expect(gl.viewFor("g1")).toBeUndefined();
    // Same cid returns with a LOWER counter (fresh session) -> must pulse again.
    gl.update([item({ cid: "g1", cls: "swordsman", action: "basic", at: 1 })], DT);
    expect(gl.viewFor("g1")?.anim.attack?.kind).toBe("swing");
  });
});

describe("GhostLayer — R4.5 Wave 1.1 (issue #69) live planeY placement", () => {
  it("draws at the peer's live planeY when present (not the scatter fallback)", () => {
    const { gl, ctx } = makeWithDepth();
    const planeY = 10; // within the live plane field band [-64, 56]
    gl.update([item({ cid: "g1", cls: "swordsman", x: 50, planeY })], DT);
    const view = gl.viewFor("g1")!;
    const d = ctx.depthOf("ghost", "g1", undefined, undefined, planeY);
    expect(view.y).toBeCloseTo(ctx.footY(50, d), 5);
    // Sanity: this is NOT the same row the scatter fallback would have chosen (proves the
    // live value actually drove placement, not a coincidental match).
    const fallbackD = ctx.depthOf("ghost", "g1", undefined, undefined, scatterPlaneY("g1"));
    if (Math.abs(planeY - scatterPlaneY("g1")) > 0.5) {
      expect(view.y).not.toBeCloseTo(ctx.footY(50, fallbackD), 3);
    }
  });

  it("falls back to scatterPlaneY(cid) when planeY is absent (today's behavior, pinned)", () => {
    const { gl, ctx } = makeWithDepth();
    gl.update([item({ cid: "g2", cls: "mage", x: 50 })], DT); // no planeY field at all
    const view = gl.viewFor("g2")!;
    const d = ctx.depthOf("ghost", "g2", undefined, undefined, scatterPlaneY("g2"));
    expect(view.y).toBeCloseTo(ctx.footY(50, d), 5);
  });

  it("two ghosts with different live planeY end up at different foot rows", () => {
    const { gl } = makeWithDepth();
    gl.update(
      [
        item({ cid: "gA", cls: "archer", x: 0, planeY: -20 }),
        item({ cid: "gB", cls: "archer", x: 0, planeY: 35 }),
      ],
      DT,
    );
    const yA = gl.viewFor("gA")!.y;
    const yB = gl.viewFor("gB")!.y;
    expect(Math.abs(yA - yB)).toBeGreaterThan(1);
  });

  it("the contact shadow rides the live-row placement (child of the placed root)", () => {
    const { gl } = makeWithDepth();
    gl.update([item({ cid: "g1", cls: "swordsman", x: 50, planeY: 30 })], DT);
    const view = gl.viewFor("g1") as unknown as { contactShadow?: { position: { y: number } } };
    // The shadow is a CHILD positioned in the root's local space (see entityShadow.ts) —
    // its presence + the root's own y (already asserted above) together prove it tracks
    // the live row (no separate world-space anchor to drift out of sync).
    expect(view.contactShadow).toBeDefined();
  });
});
