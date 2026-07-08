import { describe, expect, it } from "vitest";
import { FRIENDS_OPEN_STALE_MS, shouldRefreshOnOpen } from "@/ui/friends/quickStart";

describe("shouldRefreshOnOpen (party quick-start: open-triggered refresh gate)", () => {
  it("always refreshes before the first fetch has ever landed", () => {
    expect(shouldRefreshOnOpen(null, 1_000)).toBe(true);
  });

  it("skips a redundant refetch right after a fresh fetch", () => {
    const now = 10_000;
    expect(shouldRefreshOnOpen(now - 100, now)).toBe(false);
  });

  it("refreshes once the held data crosses the staleness threshold", () => {
    const now = 10_000;
    expect(shouldRefreshOnOpen(now - FRIENDS_OPEN_STALE_MS, now)).toBe(true);
    expect(shouldRefreshOnOpen(now - FRIENDS_OPEN_STALE_MS - 1, now)).toBe(true);
  });

  it("respects a custom staleMs override", () => {
    const now = 10_000;
    expect(shouldRefreshOnOpen(now - 500, now, 1_000)).toBe(false);
    expect(shouldRefreshOnOpen(now - 1_000, now, 1_000)).toBe(true);
  });
});
