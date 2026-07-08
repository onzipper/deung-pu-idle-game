import { describe, it, expect } from "vitest";

/**
 * "ปลุกพลัง" awaken UI gate logic (endgame v1.3) — the pure cost/affordance
 * derivation both `AsuraTomePanel` and the inventory `DetailCard` render. No
 * React/network: exercises the target/cost step, the +N/max readout, the cap,
 * and the gold-before-stones block order (matching the server's 409 order).
 */

import { awakenGate } from "@/ui/asura/awakenView";
import { LEGENDARY_MAX_AWAKEN, awakenCost } from "@/engine/config/items";

const LEG = "w_legend_sword_emberfall";

describe("awakenGate", () => {
  it("is ready at +0 when both gold and stones cover the +1 cost", () => {
    const cost = awakenCost(1)!;
    const g = awakenGate(LEG, 0, cost.gold, cost.stones);
    expect(g).toEqual({ status: "ready", current: 0, max: LEGENDARY_MAX_AWAKEN, target: 1, cost });
  });

  it("reports maxed at +5 (no target/cost)", () => {
    const g = awakenGate(LEG, LEGENDARY_MAX_AWAKEN, 9_999_999, 9_999_999);
    expect(g).toEqual({ status: "maxed", current: LEGENDARY_MAX_AWAKEN, max: LEGENDARY_MAX_AWAKEN });
  });

  it("clamps an over-cap refineLevel down to +5 → maxed", () => {
    const g = awakenGate(LEG, 99, 9_999_999, 9_999_999);
    expect(g.status).toBe("maxed");
    expect(g.current).toBe(LEGENDARY_MAX_AWAKEN);
  });

  it("blocks on gold first (server check order) when gold is short even if stones suffice", () => {
    const cost = awakenCost(1)!;
    const g = awakenGate(LEG, 0, cost.gold - 1, cost.stones + 1000);
    expect(g.status).toBe("gold");
    if (g.status !== "maxed") expect(g.target).toBe(1);
  });

  it("blocks on stones when gold is fine but stones are short", () => {
    const cost = awakenCost(1)!;
    const g = awakenGate(LEG, 0, cost.gold, cost.stones - 1);
    expect(g.status).toBe("stones");
  });

  it("advances the target/cost as the level climbs (+3 → +4 step)", () => {
    const cost4 = awakenCost(4)!;
    const g = awakenGate(LEG, 3, cost4.gold, cost4.stones);
    expect(g).toMatchObject({ status: "ready", current: 3, target: 4, cost: cost4 });
  });
});
