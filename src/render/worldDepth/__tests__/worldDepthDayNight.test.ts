import { describe, expect, it } from "vitest";
import {
  ENTITY_TINT_RELIEF,
  entityAmbientTint,
  OVERLAY_ALPHA_MAX,
  samplePalette,
  type DayPalette,
} from "@/render/worldDepth/dayNight";
import { lerpColor } from "@/render/environment/colorUtils";

function channels(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

function expectColorsClose(a: number, b: number, tolerance: number): void {
  const ca = channels(a);
  const cb = channels(b);
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(ca[i] - cb[i])).toBeLessThanOrEqual(tolerance);
  }
}

describe("worldDepth day/night palette — experiment ⑨", () => {
  it("wraps continuously: t→1⁻ lands back on the t=0 keyframe", () => {
    const end = samplePalette(1 - 1e-6);
    const start = samplePalette(0);
    expectColorsClose(end.skyTint, start.skyTint, 1);
    expectColorsClose(end.ambientTint, start.ambientTint, 1);
    expectColorsClose(end.overlayColor, start.overlayColor, 1);
    expect(Math.abs(end.overlayAlpha - start.overlayAlpha)).toBeLessThan(1e-3);
    expect(Math.abs(end.nightness - start.nightness)).toBeLessThan(1e-3);
  });

  it("any real t wraps into [0,1): t=1, t=4.25, t=-0.25 hit exact keyframes", () => {
    expect(samplePalette(1)).toEqual(samplePalette(0));
    expect(samplePalette(4.25)).toEqual(samplePalette(0.25));
    expect(samplePalette(-0.25)).toEqual(samplePalette(0.75));
  });

  it("noon (t=0.25) is the exact neutral A/B baseline", () => {
    const noon = samplePalette(0.25);
    expect(noon.skyTint).toBe(0xffffff);
    expect(noon.ambientTint).toBe(0xffffff);
    expect(noon.overlayColor).toBe(0xffffff);
    expect(noon.overlayAlpha).toBe(0);
    expect(noon.nightness).toBe(0);
  });

  it("night (t=0.75) hits nightness 1 and the overlay ceiling", () => {
    const night = samplePalette(0.75);
    expect(night.nightness).toBe(1);
    expect(night.overlayAlpha).toBe(OVERLAY_ALPHA_MAX);
  });

  it("midpoint between keyframes equals lerpColor of its neighbors", () => {
    const pairs: [number, number, number][] = [
      // [midT, keyframeA-t, keyframeB-t]
      [0.125, 0, 0.25],
      [0.375, 0.25, 0.5],
      [0.625, 0.5, 0.75],
      [0.875, 0.75, 1],
    ];
    for (const [mid, ta, tb] of pairs) {
      const m = samplePalette(mid);
      const a = samplePalette(ta);
      const b = samplePalette(tb);
      for (const key of ["skyTint", "ambientTint", "overlayColor"] as const) {
        expect(m[key]).toBe(lerpColor(a[key], b[key], 0.5));
      }
      expect(m.nightness).toBeCloseTo((a.nightness + b.nightness) / 2, 12);
      expect(m.overlayAlpha).toBeCloseTo((a.overlayAlpha + b.overlayAlpha) / 2, 12);
    }
  });

  it("overlayAlpha stays in [0, OVERLAY_ALPHA_MAX] over a dense sweep", () => {
    for (let i = 0; i <= 2048; i++) {
      const p: DayPalette = samplePalette(i / 2048);
      expect(p.overlayAlpha).toBeGreaterThanOrEqual(0);
      expect(p.overlayAlpha).toBeLessThanOrEqual(OVERLAY_ALPHA_MAX);
      expect(p.nightness).toBeGreaterThanOrEqual(0);
      expect(p.nightness).toBeLessThanOrEqual(1);
    }
  });

  describe("entityAmbientTint — actor readability relief", () => {
    it("is strictly brighter than the ambient tint at deep night, per channel", () => {
      const night = samplePalette(0.75);
      const relieved = entityAmbientTint(night.ambientTint);
      const amb = channels(night.ambientTint);
      const rel = channels(relieved);
      for (let i = 0; i < 3; i++) {
        expect(rel[i]).toBeGreaterThan(amb[i]);
        expect(rel[i]).toBeLessThanOrEqual(0xff);
      }
    });

    it("keeps the noon/OFF neutral baseline: white stays exactly white", () => {
      expect(entityAmbientTint(0xffffff)).toBe(0xffffff);
      expect(entityAmbientTint(samplePalette(0.25).ambientTint)).toBe(0xffffff);
    });

    it("matches the knob: lerp toward white by ENTITY_TINT_RELIEF", () => {
      const night = samplePalette(0.75);
      expect(entityAmbientTint(night.ambientTint)).toBe(
        lerpColor(night.ambientTint, 0xffffff, ENTITY_TINT_RELIEF),
      );
    });
  });
});
