import { describe, expect, it } from "vitest";
import { formatBossClearTime, formatPlainValue, splitOnlineSeconds } from "@/ui/hof/format";

describe("formatPlainValue", () => {
  it("keeps level as a bare integer (no thousands separator)", () => {
    expect(formatPlainValue("level", 90)).toBe("90");
  });

  it("adds a thousands separator for power/gold", () => {
    expect(formatPlainValue("power", 12345)).toBe("12,345");
    expect(formatPlainValue("gold", 1000000)).toBe("1,000,000");
  });

  it("rounds fractional values and clamps negatives to 0", () => {
    expect(formatPlainValue("power", 12.6)).toBe("13");
    expect(formatPlainValue("gold", -5)).toBe("0");
  });
});

describe("formatBossClearTime", () => {
  it("formats sub-minute times as 0:ss.s", () => {
    expect(formatBossClearTime(12.3)).toBe("0:12.3");
  });

  it("formats multi-minute times as m:ss.s with zero-padded seconds", () => {
    expect(formatBossClearTime(83.4)).toBe("1:23.4");
  });

  it("zero-pads sub-10 seconds", () => {
    expect(formatBossClearTime(65.05)).toBe("1:05.0");
  });

  it("clamps negative input to 0:00.0", () => {
    expect(formatBossClearTime(-3)).toBe("0:00.0");
  });
});

describe("splitOnlineSeconds", () => {
  it("splits into whole hours + remainder minutes", () => {
    expect(splitOnlineSeconds(3661)).toEqual({ hours: 1, minutes: 1 });
  });

  it("floors partial minutes", () => {
    expect(splitOnlineSeconds(119)).toEqual({ hours: 0, minutes: 1 });
  });

  it("clamps negative input to zero", () => {
    expect(splitOnlineSeconds(-10)).toEqual({ hours: 0, minutes: 0 });
  });
});
