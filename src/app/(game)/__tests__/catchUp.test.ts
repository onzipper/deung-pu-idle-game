import { describe, expect, it } from "vitest";
import { resolveCatchUp } from "../catchUp";

const caps = { fixedDtSeconds: 1 / 60, capHours: 8 };

describe("resolveCatchUp", () => {
  it("returns zero steps for a non-positive or non-finite gap", () => {
    expect(resolveCatchUp(0, caps)).toEqual({ steps: 0, capped: false });
    expect(resolveCatchUp(-100, caps)).toEqual({ steps: 0, capped: false });
    expect(resolveCatchUp(Number.NaN, caps)).toEqual({ steps: 0, capped: false });
    // Infinity is non-finite, so it's rejected by the same early guard as
    // NaN/negative rather than falling through to the cap-comparison branch.
    expect(resolveCatchUp(Infinity, caps)).toEqual({ steps: 0, capped: false });
  });

  it("converts a small hidden gap into the matching fixed-step count", () => {
    // 1 second hidden @ 60Hz fixed step -> exactly 60 steps, uncapped.
    expect(resolveCatchUp(1000, caps)).toEqual({ steps: 60, capped: false });
  });

  it("floors a gap that isn't an exact multiple of FIXED_DT", () => {
    const dtMs = (1 / 60) * 1000;
    const result = resolveCatchUp(dtMs * 10.9, caps);
    expect(result).toEqual({ steps: 10, capped: false });
  });

  it("caps a gap longer than capHours and reports capped=true", () => {
    const nineHoursMs = 9 * 3_600_000;
    const result = resolveCatchUp(nineHoursMs, caps);
    const expectedSteps = Math.floor((8 * 3_600_000) / 1000 / caps.fixedDtSeconds);
    expect(result.capped).toBe(true);
    expect(result.steps).toBe(expectedSteps);
  });

  it("does not cap a gap exactly at capHours", () => {
    const eightHoursMs = 8 * 3_600_000;
    const result = resolveCatchUp(eightHoursMs, caps);
    expect(result.capped).toBe(false);
  });
});
