import { describe, expect, it } from "vitest";
import { computeStatDelta } from "@/ui/gear/statDelta";

describe("computeStatDelta", () => {
  it("computes a positive delta (upgrade) vs an equipped item", () => {
    const entries = computeStatDelta({ atk: 8 }, { atk: 5 });
    expect(entries).toEqual([{ key: "atk", candidate: 8, equipped: 5, delta: 3 }]);
  });

  it("computes a negative delta (downgrade) vs an equipped item", () => {
    const entries = computeStatDelta({ atk: 3 }, { atk: 5 });
    expect(entries[0].delta).toBe(-2);
  });

  it("treats a null equipped slot as an empty baseline (full upgrade)", () => {
    const entries = computeStatDelta({ def: 4, hp: 55 }, null);
    expect(entries).toEqual([
      { key: "def", candidate: 4, equipped: 0, delta: 4 },
      { key: "hp", candidate: 55, equipped: 0, delta: 55 },
    ]);
  });

  it("omits a stat absent from BOTH sides", () => {
    const entries = computeStatDelta({ atk: 5 }, { atk: 3, def: 0 });
    expect(entries.map((e) => e.key)).toEqual(["atk"]);
  });
});
