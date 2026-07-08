import { describe, expect, it } from "vitest";
import { emaRtt, pickWaitingSlot } from "../cohortNet";

describe("emaRtt", () => {
  it("seeds directly from the first sample (no ramp-up from 0)", () => {
    expect(emaRtt(null, 250)).toBe(250);
  });

  it("smooths toward a new sample by the alpha fraction", () => {
    // prev=100, sample=200, alpha=0.3 -> 100 + (200-100)*0.3 = 130
    expect(emaRtt(100, 200, 0.3)).toBeCloseTo(130, 5);
  });

  it("converges toward a steady sample over repeated calls", () => {
    let rtt: number | null = null;
    for (let i = 0; i < 50; i++) rtt = emaRtt(rtt, 300, 0.3);
    expect(rtt).toBeCloseTo(300, 1);
  });

  it("defaults alpha to 0.3", () => {
    expect(emaRtt(100, 200)).toBeCloseTo(130, 5);
  });
});

describe("pickWaitingSlot", () => {
  it("returns null when not waiting", () => {
    expect(pickWaitingSlot(false, [{ slot: 1, lagTurns: 9 }])).toBeNull();
  });

  it("returns null when waiting but there are no members", () => {
    expect(pickWaitingSlot(true, [])).toBeNull();
  });

  it("picks the laggiest member's slot while waiting", () => {
    const members = [
      { slot: 1, lagTurns: 2 },
      { slot: 2, lagTurns: 9 },
      { slot: 3, lagTurns: 5 },
    ];
    expect(pickWaitingSlot(true, members)).toBe(2);
  });

  it("picks the first member when all are tied", () => {
    const members = [
      { slot: 4, lagTurns: 3 },
      { slot: 5, lagTurns: 3 },
    ];
    expect(pickWaitingSlot(true, members)).toBe(4);
  });
});
