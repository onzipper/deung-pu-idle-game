import { describe, expect, it } from "vitest";
import { asuraDayKeyForMs } from "../schedule";

describe("asuraDayKeyForMs", () => {
  it("matches the Asia/Bangkok (UTC+7) day boundary shape (same formula as server/dailyQuests.serverDayFor)", () => {
    // 2026-07-08T00:00:00+07:00 == 2026-07-07T17:00:00Z
    const bangkokMidnight = Date.UTC(2026, 6, 7, 17, 0, 0);
    const justBefore = bangkokMidnight - 1000;
    const key = asuraDayKeyForMs(bangkokMidnight);
    expect(asuraDayKeyForMs(justBefore)).toBe(key - 1);
    expect(asuraDayKeyForMs(bangkokMidnight + 3600_000)).toBe(key);
  });

  it("is deterministic for the same instant", () => {
    const now = Date.now();
    expect(asuraDayKeyForMs(now)).toBe(asuraDayKeyForMs(now));
  });
});
