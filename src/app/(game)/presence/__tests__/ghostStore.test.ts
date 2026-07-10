import { describe, it, expect } from "vitest";
import { CONFIG } from "@/engine";
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

describe("parseGhostSnapshot — R4.5 Wave 1.1 (issue #69) `py` -> planeY", () => {
  it("a legacy x-only payload (no `py`) parses identically to before — planeY: null, never 0", () => {
    const s = parseGhostSnapshot({ v: 1, cid: "p1", name: "P1", cls: "mage", tier: 1, x: 42, t: 3 });
    expect(s).toEqual({ cid: "p1", name: "P1", cls: "mage", tier: 1, x: 42, t: 3, planeY: null });
  });

  it("a wrong-typed or non-finite `py` resolves to null, never NaN/0", () => {
    expect(parseGhostSnapshot({ v: 1, cid: "a", x: 5, py: "12" })?.planeY).toBeNull();
    expect(parseGhostSnapshot({ v: 1, cid: "a", x: 5, py: NaN })?.planeY).toBeNull();
    expect(parseGhostSnapshot({ v: 1, cid: "a", x: 5, py: Infinity })?.planeY).toBeNull();
    expect(parseGhostSnapshot({ v: 1, cid: "a", x: 5, py: null })?.planeY).toBeNull();
  });

  it("an in-band `py` passes through untouched", () => {
    expect(parseGhostSnapshot({ v: 1, cid: "a", x: 5, py: 10 })?.planeY).toBe(10);
    expect(parseGhostSnapshot({ v: 1, cid: "a", x: 5, py: 0 })?.planeY).toBe(0);
  });

  it("an out-of-band `py` clamps to the live plane band (defense-in-depth)", () => {
    expect(parseGhostSnapshot({ v: 1, cid: "a", x: 5, py: 9e9 })?.planeY).toBe(CONFIG.plane.bandNear);
    expect(parseGhostSnapshot({ v: 1, cid: "a", x: 5, py: -9e9 })?.planeY).toBe(CONFIG.plane.bandFar);
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

describe("GhostStore — R4.5 Wave 1.1 (issue #69) live `planeY` flow-through", () => {
  it("a `p`-only-legacy ghost (no `py` ever) omits `planeY` from the render item", () => {
    const gs = new GhostStore();
    gs.upsert(snap("p1", 100, 1), 0);
    expect(gs.list(0)[0]).not.toHaveProperty("planeY");
  });

  it("a ghost WITH `py` exposes an eased `planeY`, settling at the latest value", () => {
    const gs = new GhostStore();
    gs.upsert(snap("p1", 0, 1, { py: 0 }), 0);
    gs.upsert(snap("p1", 0, 2, { py: 20 }), 1000); // ease 0 -> 20 begins
    expect(gs.list(1000)[0].planeY).toBeCloseTo(0, 3); // right at the anchor
    const settled = gs.list(1500)[0].planeY!;
    expect(settled).toBeGreaterThan(19);
    expect(settled).toBeLessThanOrEqual(20);
  });

  it("a mid-ease re-anchor on `planeY` starts from the CURRENT visible row (no teleport)", () => {
    const gs = new GhostStore();
    gs.upsert(snap("p1", 0, 1, { py: 0 }), 0);
    gs.upsert(snap("p1", 0, 2, { py: 20 }), 1000);
    const before = gs.list(1090)[0].planeY;
    gs.upsert(snap("p1", 0, 3, { py: 30 }), 1090); // re-anchor mid-ease
    const after = gs.list(1090)[0].planeY;
    expect(after).toBeCloseTo(before!, 6);
  });

  it("a row appearing for the first time (no prior row) starts exactly at the snap, no ease-in", () => {
    const gs = new GhostStore();
    gs.upsert(snap("p1", 0, 1), 0); // no py yet
    gs.upsert(snap("p1", 0, 2, { py: 15 }), 500); // py appears
    expect(gs.list(500)[0].planeY).toBe(15); // immediate, not eased from some default
  });

  it("a snapshot that drops `py` again resets the row to unknown (omitted from the render item)", () => {
    const gs = new GhostStore();
    gs.upsert(snap("p1", 0, 1, { py: 15 }), 0);
    expect(gs.list(0)[0]).toHaveProperty("planeY");
    gs.upsert(snap("p1", 0, 2), 100); // py absent this beat
    expect(gs.list(100)[0]).not.toHaveProperty("planeY");
  });

  it("garbage/out-of-band `py` on the wire never reaches the render item as NaN", () => {
    const gs = new GhostStore();
    gs.upsert({ v: 1, cid: "p1", x: 0, t: 1, py: "not-a-number" }, 0);
    expect(gs.list(0)[0]).not.toHaveProperty("planeY"); // treated as absent, not NaN
    gs.upsert({ v: 1, cid: "p1", x: 0, t: 2, py: 9e9 }, 0);
    const clamped = gs.list(0)[0].planeY!;
    expect(Number.isFinite(clamped)).toBe(true);
    expect(clamped).toBe(CONFIG.plane.bandNear);
  });
});
