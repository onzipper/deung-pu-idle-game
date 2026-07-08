import { describe, it, expect } from "vitest";
import { GhostStore, parseGhostSnapshot, GHOST_CAP_DEFAULT } from "../ghostStore";

function snap(cid: string, x: number, t: number, extra: Record<string, unknown> = {}) {
  return { v: 1, cid, name: cid.toUpperCase(), cls: "mage", tier: 1, x, t, ...extra };
}

describe("parseGhostSnapshot — validation", () => {
  it("rejects non-objects, wrong version, missing cid/x", () => {
    expect(parseGhostSnapshot(null)).toBeNull();
    expect(parseGhostSnapshot("nope")).toBeNull();
    expect(parseGhostSnapshot({ v: 2, cid: "a", x: 1 })).toBeNull(); // deploy-skew drop
    expect(parseGhostSnapshot({ v: 1, x: 1 })).toBeNull(); // no cid
    expect(parseGhostSnapshot({ v: 1, cid: "a" })).toBeNull(); // no x
    expect(parseGhostSnapshot({ v: 1, cid: "a", x: Infinity })).toBeNull();
  });

  it("defaults unknown class to swordsman and clamps tier", () => {
    const s = parseGhostSnapshot({ v: 1, cid: "a", x: 5, cls: "wizard", tier: 9 });
    expect(s?.cls).toBe("swordsman");
    expect(s?.tier).toBe(1);
    const n = parseGhostSnapshot({ v: 1, cid: "a", x: 5, cls: "ninja", tier: 3 });
    expect(n?.cls).toBe("ninja");
    expect(n?.tier).toBe(3);
  });
});

describe("GhostStore — lerp / prune / dedupe / cap", () => {
  it("interpolates x between the last two snapshots over ~350ms", () => {
    const gs = new GhostStore();
    gs.upsert(snap("p1", 100, 1), 0);
    gs.upsert(snap("p1", 200, 2), 1000);
    // right after the second snapshot: sits at prev (100)
    expect(gs.list(1000)[0].x).toBeCloseTo(100, 3);
    // halfway through the 350ms window
    expect(gs.list(1175)[0].x).toBeCloseTo(150, 0);
    // past the window: fully at the latest (200)
    expect(gs.list(1400)[0].x).toBeCloseTo(200, 3);
  });

  it("fades in on appear", () => {
    const gs = new GhostStore();
    gs.upsert(snap("p1", 0, 1), 0);
    expect(gs.list(0)[0].alpha).toBeCloseTo(0, 3);
    expect(gs.list(175)[0].alpha).toBeCloseTo(0.5, 1);
    expect(gs.list(400)[0].alpha).toBeCloseTo(1, 3);
  });

  it("prunes a ghost silent past 10s", () => {
    const gs = new GhostStore();
    gs.upsert(snap("p1", 0, 1), 0);
    expect(gs.list(5000)).toHaveLength(1);
    gs.prune(10_001);
    expect(gs.list(10_001)).toHaveLength(0);
  });

  it("ignores stale/duplicate sequence numbers", () => {
    const gs = new GhostStore();
    gs.upsert(snap("p1", 100, 5), 0);
    gs.upsert(snap("p1", 999, 3), 100); // older seq — ignored
    gs.upsert(snap("p1", 999, 5), 100); // duplicate seq — ignored
    expect(gs.list(1000)[0].x).toBeCloseTo(100, 3);
  });

  it("drops excluded cids and display names (cohort/self dedupe)", () => {
    const gs = new GhostStore();
    gs.upsert(snap("me", 0, 1), 0);
    gs.upsert(snap("peer", 10, 1), 0);
    gs.upsert({ v: 1, cid: "friend", name: "Bob", cls: "archer", tier: 1, x: 5, t: 1 }, 0);
    gs.setExcluded(new Set(["me", "Bob"]));
    const ids = gs.list(500).map((g) => g.cid);
    expect(ids).toEqual(["peer"]); // "me" by cid, "friend" by name "Bob"
  });

  it("caps the rendered list, keeping the freshest", () => {
    const gs = new GhostStore();
    gs.setCap(6);
    for (let i = 0; i < 20; i++) gs.upsert(snap("p" + i, i, 1), i); // p19 freshest
    const list = gs.list(20);
    expect(list).toHaveLength(6);
    expect(list.some((g) => g.cid === "p19")).toBe(true);
    expect(list.some((g) => g.cid === "p0")).toBe(false);
  });

  it("default cap is 12", () => {
    const gs = new GhostStore();
    for (let i = 0; i < 30; i++) gs.upsert(snap("p" + i, i, 1), i);
    expect(gs.list(30)).toHaveLength(GHOST_CAP_DEFAULT);
  });
});
