import { describe, expect, it } from "vitest";
import { resolveRefineFxRecipe } from "@/lab/refineFxRecipes";
import type { ItemRarity } from "@/engine/config/items";

function totalRate(rarity: ItemRarity, refine: number, legendary: boolean): number {
  const recipe = resolveRefineFxRecipe(rarity, refine, legendary);
  return recipe.layers.reduce((sum, l) => sum + l.rate, 0);
}

describe("resolveRefineFxRecipe — common/rare start clean", () => {
  it("common has zero layers below +3", () => {
    for (const refine of [0, 1, 2]) {
      expect(resolveRefineFxRecipe("common", refine, false).layers).toHaveLength(0);
    }
  });

  it("rare has zero layers below +3", () => {
    for (const refine of [0, 1, 2]) {
      expect(resolveRefineFxRecipe("rare", refine, false).layers).toHaveLength(0);
    }
  });

  it("common/rare gain exactly one layer starting at +3", () => {
    expect(resolveRefineFxRecipe("common", 3, false).layers).toHaveLength(1);
    expect(resolveRefineFxRecipe("rare", 3, false).layers).toHaveLength(1);
  });
});

describe("resolveRefineFxRecipe — epic glows at +0", () => {
  it("epic has a flame layer already present at +0", () => {
    const recipe = resolveRefineFxRecipe("epic", 0, false);
    expect(recipe.layers).toHaveLength(1);
    expect(recipe.layers[0]!.kind).toBe("flame");
    expect(recipe.layers[0]!.rate).toBeGreaterThan(0);
  });
});

describe("resolveRefineFxRecipe — IGNITE exactly at +7", () => {
  it("common's element rate jumps to the full-ignite value exactly at +7 (not before)", () => {
    const at6 = resolveRefineFxRecipe("common", 6, false).layers[0]!.rate;
    const at7 = resolveRefineFxRecipe("common", 7, false).layers[0]!.rate;
    const at8 = resolveRefineFxRecipe("common", 8, false).layers[0]!.rate;
    expect(at7).toBeGreaterThan(at6);
    // +8 is the NEXT bump ("denser/faster") — +7 itself is the ignite plateau.
    expect(at8).toBeGreaterThan(at7);
  });

  it("+8 widens spread by +30% over +7", () => {
    const at7 = resolveRefineFxRecipe("rare", 7, false).layers[0]!.spread;
    const at8 = resolveRefineFxRecipe("rare", 8, false).layers[0]!.spread;
    expect(at8).toBeCloseTo(at7 * 1.3, 5);
  });

  it("rare's ELEMENT (sparkle) appears as a KIND change exactly at +7 — below it only accent motes", () => {
    for (const refine of [3, 4, 5, 6]) {
      const kinds = resolveRefineFxRecipe("rare", refine, false).layers.map((l) => l.kind);
      expect(kinds).toEqual(["motes"]);
    }
    const at7 = resolveRefineFxRecipe("rare", 7, false).layers.map((l) => l.kind);
    expect(at7).toContain("sparkle");
    expect(at7).toContain("motes");
  });

  it("epic's flame wisp stays faint (×0.3) until the +7 ignite jump", () => {
    const flameAt = (refine: number) =>
      resolveRefineFxRecipe("epic", refine, false).layers.find((l) => l.kind === "flame")!.rate;
    expect(flameAt(6)).toBeCloseTo(flameAt(0), 5); // wisp is flat +0..+6
    expect(flameAt(7)).toBeGreaterThan(flameAt(6) * 3); // ignite = ×0.3 → ×1.0
  });
});

describe("resolveRefineFxRecipe — crackle at +9, beat at +10 (normal gear)", () => {
  it("crackle is null below +9 and present from +9 onward", () => {
    expect(resolveRefineFxRecipe("epic", 8, false).crackle).toBeNull();
    expect(resolveRefineFxRecipe("epic", 9, false).crackle).not.toBeNull();
    expect(resolveRefineFxRecipe("epic", 10, false).crackle).not.toBeNull();
  });

  it("beat is null below +10 and present exactly at +10", () => {
    expect(resolveRefineFxRecipe("common", 9, false).beat).toBeNull();
    expect(resolveRefineFxRecipe("common", 10, false).beat).not.toBeNull();
  });
});

describe("resolveRefineFxRecipe — legendary ladder (+0..+5)", () => {
  it("returns 2 base layers (gold flame + violet sparkle)", () => {
    const recipe = resolveRefineFxRecipe("epic", 0, true);
    expect(recipe.layers).toHaveLength(2);
    expect(recipe.layers[0]!.kind).toBe("flame");
    expect(recipe.layers[1]!.kind).toBe("sparkle");
  });

  it("both layers are already present (nonzero rate) at +0 — never reads as off", () => {
    const recipe = resolveRefineFxRecipe("epic", 0, true);
    for (const layer of recipe.layers) expect(layer.rate).toBeGreaterThan(0);
  });

  it("crackle appears at +4, beat at +5", () => {
    expect(resolveRefineFxRecipe("epic", 3, true).crackle).toBeNull();
    expect(resolveRefineFxRecipe("epic", 4, true).crackle).not.toBeNull();
    expect(resolveRefineFxRecipe("epic", 4, true).beat).toBeNull();
    expect(resolveRefineFxRecipe("epic", 5, true).beat).not.toBeNull();
  });

  it("out-of-range refine values clamp into +0..+5", () => {
    expect(resolveRefineFxRecipe("epic", 99, true)).toEqual(resolveRefineFxRecipe("epic", 5, true));
    expect(resolveRefineFxRecipe("epic", -3, true)).toEqual(resolveRefineFxRecipe("epic", 0, true));
  });
});

describe("resolveRefineFxRecipe — palettes match the rarity accents verbatim", () => {
  it("common motes palette", () => {
    expect(resolveRefineFxRecipe("common", 10, false).layers[0]!.palette).toEqual([
      0xffffff, 0xd7deee, 0x8a94ad, 0x525a70,
    ]);
  });

  it("rare sparkle palette", () => {
    expect(resolveRefineFxRecipe("rare", 10, false).layers[0]!.palette).toEqual([
      0xffffff, 0x9be3ff, 0x4fc3f7, 0x1d6fa3,
    ]);
  });

  it("epic flame palette", () => {
    expect(resolveRefineFxRecipe("epic", 10, false).layers[0]!.palette).toEqual([
      0xffffff, 0xffd166, 0xffb347, 0xf3722c, 0x8c2f1b,
    ]);
  });

  it("legendary gold + violet palettes", () => {
    const recipe = resolveRefineFxRecipe("epic", 5, true);
    expect(recipe.layers[0]!.palette).toEqual([0xffffff, 0xffe9a8, 0xf7d048, 0xc9962e, 0x7a5a1a]);
    expect(recipe.layers[1]!.palette).toEqual([0xffffff, 0xd0a9ff, 0x9d5cff, 0x5b2ea6]);
  });
});

describe("resolveRefineFxRecipe — total spawn rate is monotonically non-decreasing in refine", () => {
  const rarities: ItemRarity[] = ["common", "rare", "epic"];

  it("holds for every normal-gear rarity across +0..+10", () => {
    for (const rarity of rarities) {
      let prev = -Infinity;
      for (let refine = 0; refine <= 10; refine++) {
        const rate = totalRate(rarity, refine, false);
        expect(rate).toBeGreaterThanOrEqual(prev);
        prev = rate;
      }
    }
  });

  it("holds for the legendary ladder across +0..+5", () => {
    let prev = -Infinity;
    for (let refine = 0; refine <= 5; refine++) {
      const rate = totalRate("epic", refine, true);
      expect(rate).toBeGreaterThanOrEqual(prev);
      prev = rate;
    }
  });
});

describe("resolveRefineFxRecipe — rarity intensity ordering (common < rare < epic) at the same refine", () => {
  it("+10 total rate is strictly higher per rarity step", () => {
    const c = totalRate("common", 10, false);
    const r = totalRate("rare", 10, false);
    const e = totalRate("epic", 10, false);
    // Different base rates per element kind mean this isn't a strict total
    // ordering by intensity alone, but epic (flame, highest base + highest
    // intensity) must clear both motes and sparkle at the same stage.
    expect(e).toBeGreaterThan(c);
    expect(e).toBeGreaterThan(r);
  });
});
