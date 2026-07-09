import { describe, it, expect } from "vitest";
import { GhostStore, parseGhostAction } from "../ghostStore";

/**
 * R3 `pa` visual-action stream (docs/ghost-presence-design.md §5 wave 3). These pin the
 * store-side contract: strict parse, action-is-not-liveness (never spawns, never refreshes
 * the prune clock), stale/replay rejection with a rejoin-reset allowance, and that a
 * `p`-only ghost keeps its pre-R3 render shape (no action fields exposed).
 */

/** A live `p` keepalive so a ghost EXISTS before its actions apply (actions never spawn). */
function snap(cid: string, x: number, t: number) {
  return { v: 1, cid, name: cid.toUpperCase(), cls: "mage", tier: 1, x, t };
}
function act(cid: string, a: string, at: number, extra: Record<string, unknown> = {}) {
  return { v: 1, cid, x: 0, f: 1, a, at, t: at, ...extra };
}

describe("parseGhostAction — validation", () => {
  it("rejects non-objects, wrong version, missing cid/x, and UNKNOWN action values", () => {
    expect(parseGhostAction(null)).toBeNull();
    expect(parseGhostAction("nope")).toBeNull();
    expect(parseGhostAction({ v: 2, cid: "a", x: 0, a: "basic", at: 1 })).toBeNull();
    expect(parseGhostAction({ v: 1, x: 0, a: "basic", at: 1 })).toBeNull(); // no cid
    expect(parseGhostAction({ v: 1, cid: "a", x: Infinity, a: "basic", at: 1 })).toBeNull();
    expect(parseGhostAction({ v: 1, cid: "a", x: 0, a: "teleport", at: 1 })).toBeNull(); // bad a
    expect(parseGhostAction({ v: 1, cid: "a", x: 0, at: 1 })).toBeNull(); // missing a
  });

  it("accepts every known action value", () => {
    for (const a of ["idle", "walk", "basic", "skill1", "skill2", "skill3", "skill4", "dash"]) {
      expect(parseGhostAction({ v: 1, cid: "a", x: 0, f: 1, a, at: 1 })?.a).toBe(a);
    }
  });

  it("is lenient on cosmetics: bad f -> +1, missing y -> null, bad at -> 0", () => {
    const p = parseGhostAction({ v: 1, cid: "a", x: 3, a: "walk" });
    expect(p).toMatchObject({ facing: 1, y: null, at: 0 });
    expect(parseGhostAction({ v: 1, cid: "a", x: 3, a: "walk", f: -1 })?.facing).toBe(-1);
    expect(parseGhostAction({ v: 1, cid: "a", x: 3, a: "walk", f: 9 })?.facing).toBe(1);
    expect(parseGhostAction({ v: 1, cid: "a", x: 3, a: "walk", y: 42 })?.y).toBe(42);
  });
});

describe("GhostStore.applyAction — pose/facing, liveness, stale/reset", () => {
  it("drops an action for an UNKNOWN cid (an action is not liveness — never spawns)", () => {
    const gs = new GhostStore();
    gs.ingestAction(act("ghost", "basic", 1), 0);
    expect(gs.list(0)).toHaveLength(0);
  });

  it("applies facing + action + counter onto an existing ghost, exposed on the render list", () => {
    const gs = new GhostStore();
    gs.upsert(snap("p1", 100, 1), 0);
    gs.ingestAction(act("p1", "skill2", 7, { f: -1 }), 100);
    const item = gs.list(100)[0];
    expect(item).toMatchObject({ facing: -1, action: "skill2", at: 7 });
  });

  it("a p-only ghost exposes NO action fields (renders exactly as before R3)", () => {
    const gs = new GhostStore();
    gs.upsert(snap("p1", 100, 1), 0);
    const item = gs.list(0)[0];
    expect(item.facing).toBeUndefined();
    expect(item.action).toBeUndefined();
    expect(item.at).toBeUndefined();
  });

  it("a `pa` frame does NOT refresh the prune clock (liveness stays keyed to `p`)", () => {
    const gs = new GhostStore();
    gs.upsert(snap("p1", 100, 1), 0); // keepalive at t=0
    gs.ingestAction(act("p1", "basic", 5), 9_000); // action late in the window
    // Prune is keyed to the KEEPALIVE (t=0), not the action (t=9000): the ghost still dies.
    gs.prune(10_001);
    expect(gs.list(10_001)).toHaveLength(0);
  });

  it("rejects stale / duplicate / out-of-order action counters within an active session", () => {
    const gs = new GhostStore();
    gs.upsert(snap("p1", 100, 1), 0);
    gs.ingestAction(act("p1", "basic", 5), 100);
    gs.ingestAction(act("p1", "skill1", 3), 200); // older counter -> ignored
    gs.ingestAction(act("p1", "dash", 5), 300); // duplicate counter -> ignored
    expect(gs.list(400)[0]).toMatchObject({ action: "basic", at: 5 });
    gs.ingestAction(act("p1", "skill1", 6), 500); // forward -> accepted
    expect(gs.list(600)[0]).toMatchObject({ action: "skill1", at: 6 });
  });

  it("accepts a RESET counter after a long action-silence (rejoined session)", () => {
    const gs = new GhostStore();
    gs.upsert(snap("p1", 100, 1), 0);
    gs.ingestAction(act("p1", "basic", 900), 0);
    // Quiet on the action stream for >= the silence window, then a low/reset counter.
    gs.upsert(snap("p1", 100, 2), 10_000); // keepalive keeps the ghost alive
    gs.ingestAction(act("p1", "skill1", 1), 10_100);
    expect(gs.list(10_200)[0]).toMatchObject({ action: "skill1", at: 1 });
  });

  it("accepts a RESET counter on a large BACKWARD jump even within an active session", () => {
    const gs = new GhostStore();
    gs.upsert(snap("p1", 100, 1), 0);
    gs.ingestAction(act("p1", "basic", 2000), 0);
    gs.ingestAction(act("p1", "skill1", 500), 200); // 500 < 2000 - 1000 -> reset, accepted
    expect(gs.list(300)[0]).toMatchObject({ action: "skill1", at: 500 });
  });

  it("a `pa` position is fresher than the keepalive: it re-anchors the lerp target", () => {
    const gs = new GhostStore();
    gs.upsert(snap("p1", 100, 1), 0); // sitting at x=100
    gs.ingestAction({ v: 1, cid: "p1", x: 200, f: 1, a: "walk", at: 1 }, 1_000);
    expect(gs.list(1_000)[0].x).toBeCloseTo(100, 3); // lerp just re-anchored -> prev
    expect(gs.list(1_175)[0].x).toBeCloseTo(150, 0); // halfway through the 350ms window
  });
});
