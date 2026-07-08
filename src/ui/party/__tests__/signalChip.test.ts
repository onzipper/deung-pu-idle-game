import { describe, expect, it } from "vitest";
import type { CohortStatusState } from "@/ui/store/gameStore";
import { formatMemberLag, rttBars, rttTone, signalChipView } from "../signalChip";

describe("rttTone", () => {
  it("reads gray for no sample yet", () => {
    expect(rttTone(null)).toBe("gray");
  });
  it("reads emerald under 120ms", () => {
    expect(rttTone(0)).toBe("emerald");
    expect(rttTone(119)).toBe("emerald");
  });
  it("reads amber between 120 and 300ms", () => {
    expect(rttTone(120)).toBe("amber");
    expect(rttTone(299)).toBe("amber");
  });
  it("reads rose at 300ms and above", () => {
    expect(rttTone(300)).toBe("rose");
    expect(rttTone(5000)).toBe("rose");
  });
});

describe("rttBars", () => {
  it("shows 1 dim bar for no sample yet (not zero)", () => {
    expect(rttBars(null)).toBe(1);
  });
  it("scales 4 -> 1 as RTT worsens", () => {
    expect(rttBars(50)).toBe(4);
    expect(rttBars(200)).toBe(3);
    expect(rttBars(450)).toBe(2);
    expect(rttBars(900)).toBe(1);
  });
});

describe("formatMemberLag", () => {
  it("reads caught-up for zero lag (the healthy-peer clamp case)", () => {
    expect(formatMemberLag(0)).toEqual({ kind: "caughtUp" });
  });
  it("reads caught-up for negative lag too (belt-and-suspenders)", () => {
    expect(formatMemberLag(-2)).toEqual({ kind: "caughtUp" });
  });
  it("renders ms for positive lag", () => {
    expect(formatMemberLag(1)).toEqual({ kind: "ms", ms: 100 });
    expect(formatMemberLag(3)).toEqual({ kind: "ms", ms: 300 });
  });
});

describe("signalChipView", () => {
  it("renders nothing while solo", () => {
    expect(signalChipView({ kind: "solo" }, 50)).toBeNull();
  });

  it("connecting is a gray pulsing chip regardless of RTT", () => {
    expect(signalChipView({ kind: "connecting" }, 50)).toEqual({
      bars: 1,
      tone: "gray",
      pulsing: true,
    });
  });

  it("reconnecting is an amber pulsing chip", () => {
    expect(signalChipView({ kind: "reconnecting" }, 50)).toEqual({
      bars: 1,
      tone: "amber",
      pulsing: true,
    });
  });

  it("waiting is an amber pulsing chip", () => {
    expect(signalChipView({ kind: "waiting" }, 50)).toEqual({
      bars: 1,
      tone: "amber",
      pulsing: true,
    });
  });

  it("active derives bars/tone from RTT and never pulses", () => {
    const active: CohortStatusState = { kind: "active", names: ["dueng"] };
    expect(signalChipView(active, 50)).toEqual({ bars: 4, tone: "emerald", pulsing: false });
    expect(signalChipView(active, 250)).toEqual({ bars: 3, tone: "amber", pulsing: false });
    expect(signalChipView(active, 800)).toEqual({ bars: 1, tone: "rose", pulsing: false });
    expect(signalChipView(active, null)).toEqual({ bars: 1, tone: "gray", pulsing: false });
  });
});
