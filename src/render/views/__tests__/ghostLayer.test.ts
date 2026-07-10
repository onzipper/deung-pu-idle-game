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
import { GhostLayer, type GhostDrawItem } from "../ghostLayer";

const DT = 1 / 60;

function item(over: Partial<GhostDrawItem> & { cid: string; cls: GhostDrawItem["cls"] }): GhostDrawItem {
  return { name: over.cid, tier: 1, x: 0, alpha: 1, ...over };
}

function make(): GhostLayer {
  return new GhostLayer(new Container());
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
