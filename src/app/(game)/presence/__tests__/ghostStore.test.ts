import { describe, it, expect } from "vitest";
import { GhostStore, parseGhostSnapshot, easeToward, GHOST_CAP_DEFAULT } from "../ghostStore";

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

describe("easeToward — pure exponential ease (headless)", () => {
  it("is 0% at t=0, ~63% at one time-constant, and settles at ~100%", () => {
    expect(easeToward(0, 100, 0)).toBe(0); // at the anchor: exactly prev
    expect(easeToward(0, 100, 90)).toBeCloseTo(63.2, 0); // one τ (90ms): 1 - e^-1
    expect(easeToward(0, 100, 180)).toBeCloseTo(86.5, 0); // two τ: 1 - e^-2
    expect(easeToward(0, 100, 1e6)).toBeCloseTo(100, 3); // asymptotic settle
  });

  it("never overshoots and is monotonic toward the target (no rubber-band)", () => {
    let last = 0;
    for (let e = 0; e <= 2000; e += 13) {
      const v = easeToward(0, 100, e);
      expect(v).toBeGreaterThanOrEqual(last - 1e-9); // monotonic up
      expect(v).toBeLessThanOrEqual(100); // never past the target
      last = v;
    }
  });

  it("negative/zero elapsed clamps to the anchor (never reads behind it)", () => {
    expect(easeToward(50, 200, -10)).toBe(50);
    expect(easeToward(50, 200, 0)).toBe(50);
  });
});

describe("GhostStore — ease / prune / dedupe / cap", () => {
  it("eases x toward the latest snapshot (exponential, no overshoot)", () => {
    const gs = new GhostStore();
    gs.upsert(snap("p1", 100, 1), 0);
    gs.upsert(snap("p1", 200, 2), 1000);
    // right after the second snapshot: sits at prev (100)
    expect(gs.list(1000)[0].x).toBeCloseTo(100, 3);
    // one time-constant (90ms) in: ~63% of the way (100 -> 200)
    expect(gs.list(1090)[0].x).toBeCloseTo(163.2, 0);
    // well past ~3τ: settled at the latest without ever exceeding it
    const settled = gs.list(1500)[0].x;
    expect(settled).toBeGreaterThan(199);
    expect(settled).toBeLessThanOrEqual(200);
  });

  it("a mid-ease re-anchor starts from the CURRENT visible x (no forward snap)", () => {
    const gs = new GhostStore();
    gs.upsert(snap("p1", 0, 1), 0);
    gs.upsert(snap("p1", 100, 2), 1000); // ease 0 -> 100 begins
    const before = gs.list(1090)[0].x; // ~63 into the first ease
    gs.upsert(snap("p1", 200, 3), 1090); // re-anchor mid-ease
    const after = gs.list(1090)[0].x; // same instant, just re-anchored
    expect(after).toBeCloseTo(before, 6); // C0 continuity: no teleport at the anchor
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
