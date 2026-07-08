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
});
