import { describe, expect, it } from "vitest";
import {
  BOT_TRIP_LEAVE_DEBOUNCE_MS,
  shouldLeaveCohortForBotTrip,
  type ShouldLeaveCohortForBotTripInput,
} from "../cohortBotTrip";

function base(overrides: Partial<ShouldLeaveCohortForBotTripInput> = {}): ShouldLeaveCohortForBotTripInput {
  return {
    cohortActive: true,
    needRestock: true,
    needSell: false,
    nowMs: 100_000,
    lastLeaveAtMs: null,
    debounceMs: BOT_TRIP_LEAVE_DEBOUNCE_MS,
    ...overrides,
  };
}

describe("shouldLeaveCohortForBotTrip", () => {
  it("solo (not in a cohort) never leaves — the ordinary engine path already handles it", () => {
    expect(shouldLeaveCohortForBotTrip(base({ cohortActive: false }))).toBe(false);
  });

  it("cohort size collapses to `cohortActive` — a lone/solo hero is simply not active", () => {
    // cohortActive is the caller's precomputed "am I in a >=2-member cohort right now"
    // signal (GameClient never calls this while solo), so a false here IS the "size 1"
    // case from this module's point of view.
    expect(shouldLeaveCohortForBotTrip(base({ cohortActive: false, needRestock: true, needSell: true }))).toBe(
      false,
    );
  });

  it("bot effectively OFF (both predicate outputs false) never leaves", () => {
    expect(shouldLeaveCohortForBotTrip(base({ needRestock: false, needSell: false }))).toBe(false);
  });

  it("restock wanted, cohort active, no prior leave -> true", () => {
    expect(shouldLeaveCohortForBotTrip(base())).toBe(true);
  });

  it("sell wanted alone is just as sufficient as restock alone", () => {
    expect(shouldLeaveCohortForBotTrip(base({ needRestock: false, needSell: true }))).toBe(true);
  });

  it("debounced: a leave inside the window is suppressed", () => {
    const input = base({ lastLeaveAtMs: 90_000, nowMs: 95_000, debounceMs: 20_000 });
    expect(shouldLeaveCohortForBotTrip(input)).toBe(false);
  });

  it("debounce expires exactly at the boundary and beyond", () => {
    const atBoundary = base({ lastLeaveAtMs: 80_000, nowMs: 100_000, debounceMs: 20_000 });
    expect(shouldLeaveCohortForBotTrip(atBoundary)).toBe(true);
    const wellPast = base({ lastLeaveAtMs: 50_000, nowMs: 100_000, debounceMs: 20_000 });
    expect(shouldLeaveCohortForBotTrip(wellPast)).toBe(true);
  });
});
