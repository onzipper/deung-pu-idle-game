import { describe, expect, it } from "vitest";
import {
  pickIdleGroupKey,
  pickSitGroupKey,
  pickStandGroupKey,
  pickWalkGroupKey,
} from "@/lab/frameGroupHeuristics";

describe("pickWalkGroupKey — experiment ⑤ playground", () => {
  it("prefers a name containing walk/stand with the most frames", () => {
    const groups = {
      llama_sit: ["a.png", "b.png"],
      llama_walk: ["c.png", "d.png", "e.png"],
      other_stand: ["f.png"],
    };
    expect(pickWalkGroupKey(groups)).toBe("llama_walk");
  });

  it("falls back to the only group when nothing matches by name", () => {
    expect(pickWalkGroupKey({ mystery: ["a.png", "b.png"] })).toBe("mystery");
  });

  it("falls back to the most-framed group when several unmatched groups exist", () => {
    const groups = { a: ["1.png"], b: ["1.png", "2.png", "3.png"] };
    expect(pickWalkGroupKey(groups)).toBe("b");
  });

  it("null on an empty library", () => {
    expect(pickWalkGroupKey({})).toBeNull();
  });
});

describe("pickIdleGroupKey — excludes the already-picked walk group", () => {
  it("picks an idle/sit-named group distinct from the walk group", () => {
    const groups = { llama_walk: ["a.png"], llama_sit: ["b.png", "c.png"] };
    expect(pickIdleGroupKey(groups, "llama_walk")).toBe("llama_sit");
  });

  it("null when there's no separate idle/sit group", () => {
    expect(pickIdleGroupKey({ llama_walk: ["a.png"] }, "llama_walk")).toBeNull();
  });
});

describe("pickSitGroupKey / pickStandGroupKey — experiment ⑥ town preview", () => {
  it("picks the most-framed sit/stand groups independently", () => {
    const groups = {
      llama_sit: ["a.png", "b.png"],
      llama_stand: ["c.png", "d.png", "e.png", "f.png"],
      unrelated: ["g.png"],
    };
    expect(pickSitGroupKey(groups)).toBe("llama_sit");
    expect(pickStandGroupKey(groups)).toBe("llama_stand");
  });

  it("null when the naming convention isn't followed at all", () => {
    const groups = { llama: ["a.png", "b.png"] };
    expect(pickSitGroupKey(groups)).toBeNull();
    expect(pickStandGroupKey(groups)).toBeNull();
  });
});
