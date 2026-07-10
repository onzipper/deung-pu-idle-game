import { describe, it, expect } from "vitest";
import { buildPresenceSnapshot, shouldPublish } from "../presencePublish";

const IDENT = { charId: "char-1", displayName: "Aran" };

describe("buildPresenceSnapshot — pure read of my hero", () => {
  it("samples x(rounded)/cls/tier + identity into a v1 payload", () => {
    const snap = buildPresenceSnapshot({ x: 123.7, cls: "ninja", tier: 3 }, IDENT, 5);
    expect(snap).toEqual({ v: 1, cid: "char-1", name: "Aran", cls: "ninja", tier: 3, x: 124, t: 5 });
  });

  it("NEVER mutates the hero it samples (invariant #6)", () => {
    const hero = { x: 40.2, cls: "mage" as const, tier: 2 as const };
    const before = structuredClone(hero);
    buildPresenceSnapshot(hero, IDENT, 1);
    buildPresenceSnapshot(hero, IDENT, 2);
    expect(hero).toEqual(before); // deep-equal before/after — read-only sampler
  });
});

describe("buildPresenceSnapshot — R4.5 Wave 1.1 (issue #69) `py` field", () => {
  it("includes `py` (rounded) when the hero carries a finite planeY", () => {
    const snap = buildPresenceSnapshot({ x: 10, cls: "archer", tier: 2, planeY: 12.6 }, IDENT, 1);
    expect(snap.py).toBe(13);
  });

  it("omits `py` entirely when the hero has no planeY (older/defensive shape)", () => {
    const snap = buildPresenceSnapshot({ x: 10, cls: "archer", tier: 2 }, IDENT, 1);
    expect(snap.py).toBeUndefined();
    expect("py" in snap).toBe(false);
  });

  it("omits `py` when planeY is non-finite (defensive; never ships NaN/Infinity)", () => {
    const nanSnap = buildPresenceSnapshot({ x: 10, cls: "archer", tier: 2, planeY: NaN }, IDENT, 1);
    const infSnap = buildPresenceSnapshot(
      { x: 10, cls: "archer", tier: 2, planeY: Infinity },
      IDENT,
      1,
    );
    expect("py" in nanSnap).toBe(false);
    expect("py" in infSnap).toBe(false);
  });

  it("never mutates the hero it samples, even with planeY present", () => {
    const hero = { x: 40.2, cls: "mage" as const, tier: 2 as const, planeY: 5.4 };
    const before = structuredClone(hero);
    buildPresenceSnapshot(hero, IDENT, 1);
    expect(hero).toEqual(before);
  });
});

describe("shouldPublish — change detection + keepalive", () => {
  const s = (x: number, t: number) => buildPresenceSnapshot({ x, cls: "mage", tier: 1 }, IDENT, t);

  it("always sends the first snapshot", () => {
    expect(shouldPublish(null, s(10, 1), 1)).toBe(true);
  });

  it("sends when x changed", () => {
    expect(shouldPublish(s(10, 1), s(11, 2), 1)).toBe(true);
  });

  it("skips an unchanged snapshot off-keepalive, sends it on the keepalive beat", () => {
    const prev = s(10, 1);
    expect(shouldPublish(prev, s(10, 2), 1)).toBe(false);
    expect(shouldPublish(prev, s(10, 2), 2)).toBe(false);
    expect(shouldPublish(prev, s(10, 2), 3)).toBe(true); // every 3rd beat
  });

  it("sends when `py` appears, changes, or disappears (R4.5 Wave 1.1)", () => {
    const noRow = buildPresenceSnapshot({ x: 10, cls: "mage", tier: 1 }, IDENT, 1);
    const row5 = buildPresenceSnapshot({ x: 10, cls: "mage", tier: 1, planeY: 5 }, IDENT, 2);
    const row9 = buildPresenceSnapshot({ x: 10, cls: "mage", tier: 1, planeY: 9 }, IDENT, 3);
    expect(shouldPublish(noRow, row5, 1)).toBe(true); // undefined -> number
    expect(shouldPublish(row5, row9, 1)).toBe(true); // number -> different number
    expect(shouldPublish(row5, noRow, 1)).toBe(true); // number -> undefined
    // identical py, off-keepalive beat, x/cls/tier unchanged -> stays silent
    const row5Again = buildPresenceSnapshot({ x: 10, cls: "mage", tier: 1, planeY: 5 }, IDENT, 4);
    expect(shouldPublish(row5, row5Again, 1)).toBe(false);
  });
});
