import { describe, it, expect } from "vitest";
import { dsin, dcos, dhypot, dpow, buildSinTable } from "@/engine/core/dmath";

/**
 * M8 party P1a — cross-engine deterministic transcendentals. These tests defend two
 * properties: (1) DETERMINISM (the LUT is rebuildable to a bit-identical table; the
 * table must be constructed WITHOUT Math.sin), and (2) ACCURACY sanity (dsin/dcos are
 * close to the libm value — NOT bit-equal, that is the whole point). dpow is exact
 * integer exponentiation, so it is checked against reference integer math.
 */

describe("dmath — LUT determinism", () => {
  it("rebuilds a bit-identical sine table", () => {
    const a = buildSinTable();
    const b = buildSinTable();
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBe(b[i]); // exact, every entry
  });

  it("first/last table samples match sin(0)=0 and sin(π/2)=1 (polynomial-built)", () => {
    const t = buildSinTable();
    expect(t[0]).toBe(0);
    expect(Math.abs(t[t.length - 1] - 1)).toBeLessThan(1e-7);
  });
});

describe("dmath — dsin / dcos accuracy (sanity, not equality)", () => {
  it("dsin tracks Math.sin within 1e-4 across a wide domain incl. large args", () => {
    let maxErr = 0;
    for (let x = -50; x <= 50; x += 0.013) {
      maxErr = Math.max(maxErr, Math.abs(dsin(x) - Math.sin(x)));
    }
    expect(maxErr).toBeLessThan(1e-4);
  });

  it("dcos tracks Math.cos within 1e-4", () => {
    let maxErr = 0;
    for (let x = -20; x <= 20; x += 0.017) {
      maxErr = Math.max(maxErr, Math.abs(dcos(x) - Math.cos(x)));
    }
    expect(maxErr).toBeLessThan(1e-4);
  });

  it("is periodic and deterministic (same input → identical output)", () => {
    expect(dsin(1.234)).toBe(dsin(1.234));
    expect(Math.abs(dsin(0.5) - dsin(0.5 + Math.PI * 2))).toBeLessThan(1e-4);
    expect(Math.abs(dsin(0.5) + dsin(0.5 + Math.PI))).toBeLessThan(1e-4); // sin(x+π) = -sin(x)
  });

  it("handles the quadrant seams (0, π/2, π, 3π/2, 2π)", () => {
    const P = Math.PI;
    expect(Math.abs(dsin(0))).toBeLessThan(1e-6);
    expect(Math.abs(dsin(P / 2) - 1)).toBeLessThan(1e-4);
    expect(Math.abs(dsin(P))).toBeLessThan(1e-4);
    expect(Math.abs(dsin((3 * P) / 2) + 1)).toBeLessThan(1e-4);
    expect(Math.abs(dsin(2 * P))).toBeLessThan(1e-4);
  });
});

describe("dmath — dhypot", () => {
  it("matches sqrt(x²+y²) exactly (IEEE sqrt)", () => {
    expect(dhypot(3, 4)).toBe(5);
    expect(dhypot(0, 0)).toBe(0);
    expect(dhypot(-3, -4)).toBe(5);
    expect(dhypot(1e6, 0)).toBe(1e6);
    expect(dhypot(5, 0)).toBe(5);
  });
});

describe("dmath — dpow (exact integer exponentiation)", () => {
  it("tracks Math.pow within ~1e-6 relative for the config bases (accuracy sanity)", () => {
    // NOT bit-equal to Math.pow — that is intentional (Math.pow is impl-defined). We
    // only assert the exact-integer-exp result is numerically the same power.
    for (const base of [1.2, 1.19, 1.12, 1.05, 0.92, 0.94]) {
      for (let n = 0; n <= 90; n++) {
        const ref = Math.pow(base, n);
        expect(Math.abs(dpow(base, n) - ref)).toBeLessThanOrEqual(Math.abs(ref) * 1e-9 + 1e-12);
      }
    }
  });

  it("gives exact results for integer bases (no rounding)", () => {
    expect(dpow(2, 30)).toBe(1073741824);
    expect(dpow(3, 10)).toBe(59049);
    expect(dpow(10, 6)).toBe(1000000);
  });

  it("handles exponent 0 and 1 and negatives", () => {
    expect(dpow(1.2, 0)).toBe(1);
    expect(dpow(7, 1)).toBe(7);
    expect(dpow(2, 10)).toBe(1024);
    expect(dpow(2, -2)).toBe(1 / 4);
  });

  it("is deterministic (same args → identical bits)", () => {
    expect(dpow(1.2, 29)).toBe(dpow(1.2, 29));
  });

  it("throws on a non-integer exponent (non-deterministic, must be added deliberately)", () => {
    expect(() => dpow(2, 0.5)).toThrow();
    expect(() => dpow(2, 1.0001)).toThrow();
  });
});
