import { describe, it, expect } from "vitest";
import {
  SAVE_VERSION,
  REFINE,
  refinedStat,
  clampRefine,
  successChanceForLevel,
  failModeForLevel,
  salvageYield,
  refineCost,
  ITEM_TEMPLATES,
  initGameState,
  step,
  toSaveData,
  migrate,
  equipAtkOf,
  equipDefOf,
  equipHpOf,
  combatPower,
  type GameState,
} from "@/engine";
import { soloSave } from "./helpers";

/**
 * M7.6 "ตีบวก" (Refine) — ENGINE side. The engine NEVER rolls a refine (server-
 * authoritative); it only (a) exposes the tunable table and (b) consumes a
 * server-decided `refineLevel` into item stats/power, deterministically (no RNG).
 * These suites cover the config table SHAPE, the stat/power derivation at +0/+5/
 * +10, the v13→v14 migration + material counter, and determinism.
 */

// ---------------------------------------------------------------------------
// Config table shape (pure — no engine state).
// ---------------------------------------------------------------------------

describe("refine config table", () => {
  it("caps at +10 and clamps hostile levels into [0, max]", () => {
    expect(REFINE.maxRefine).toBe(10);
    expect(clampRefine(-3)).toBe(0);
    expect(clampRefine(0)).toBe(0);
    expect(clampRefine(4.9)).toBe(4);
    expect(clampRefine(999)).toBe(REFINE.maxRefine);
    expect(clampRefine(NaN)).toBe(0);
    expect(clampRefine(undefined)).toBe(0);
  });

  it("+1-3 always succeed and are SAFE; +4-7 DEGRADE; +8-10 BREAK", () => {
    for (let lvl = 1; lvl <= 3; lvl++) {
      expect(successChanceForLevel(lvl)).toBe(1.0);
      expect(failModeForLevel(lvl)).toBe("safe");
    }
    for (let lvl = 4; lvl <= 7; lvl++) expect(failModeForLevel(lvl)).toBe("degrade");
    for (let lvl = 8; lvl <= 10; lvl++) expect(failModeForLevel(lvl)).toBe("break");
  });

  it("success chance is monotonically non-increasing and in (0,1] across +1..+10", () => {
    let prev = 1.01;
    for (let lvl = 1; lvl <= REFINE.maxRefine; lvl++) {
      const c = successChanceForLevel(lvl);
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThanOrEqual(1);
      expect(c).toBeLessThanOrEqual(prev);
      prev = c;
    }
  });

  it("salvage yield rises with tier and rarity", () => {
    expect(salvageYield(1, "common")).toBeLessThan(salvageYield(6, "common"));
    expect(salvageYield(3, "common")).toBeLessThan(salvageYield(3, "epic"));
    expect(salvageYield(1, "common")).toBeGreaterThan(0);
  });

  it("refine cost (materials + gold) rises with tier and target level", () => {
    const cheap = refineCost(1, 1);
    const dear = refineCost(6, 10);
    expect(cheap.materials).toBeLessThan(dear.materials);
    expect(cheap.gold).toBeLessThan(dear.gold);
    expect(refineCost(3, 4).materials).toBeLessThan(refineCost(3, 8).materials);
  });
});

// ---------------------------------------------------------------------------
// Stat / power derivation with refineLevel (0, +5, +10).
// ---------------------------------------------------------------------------

describe("refinedStat derivation", () => {
  it("+0 is exact identity; +N scales base by (1 + N*statBonusPerRefine), rounded", () => {
    expect(refinedStat(0, 5)).toBe(0);
    expect(refinedStat(15, 0)).toBe(15);
    const k = REFINE.statBonusPerRefine;
    expect(refinedStat(15, 5)).toBe(Math.round(15 * (1 + 5 * k)));
    expect(refinedStat(15, 10)).toBe(Math.round(15 * (1 + 10 * k)));
    // Strictly increasing in the refine level for a non-zero base.
    expect(refinedStat(15, 10)).toBeGreaterThan(refinedStat(15, 5));
    expect(refinedStat(15, 5)).toBeGreaterThan(refinedStat(15, 0));
  });
});

describe("equipped-gear stats + combatPower fold in refineLevel", () => {
  const staff = "w_staff_t3_arcane";
  const baseAtk = ITEM_TEMPLATES[staff].stats.atk!;

  it("a refined weapon adds refinedStat(atk) and raises combatPower monotonically", () => {
    const at = (refine: number): { atk: number; power: number } => {
      const s = initGameState(1, soloSave("mage", 6));
      step(s, { equip: { slot: "weapon", templateId: staff, refineLevel: refine } });
      const h = s.heroes[0];
      return { atk: equipAtkOf(h), power: combatPower(h) };
    };
    const r0 = at(0);
    const r5 = at(5);
    const r10 = at(10);
    expect(r0.atk).toBe(refinedStat(baseAtk, 0));
    expect(r5.atk).toBe(refinedStat(baseAtk, 5));
    expect(r10.atk).toBe(refinedStat(baseAtk, 10));
    expect(r10.power).toBeGreaterThan(r5.power);
    expect(r5.power).toBeGreaterThan(r0.power);
  });

  it("a refined armor scales def AND hp, and folds into maxHp", () => {
    const armor = "a_chain_t3_mail";
    const t = ITEM_TEMPLATES[armor].stats;
    const s = initGameState(1, soloSave("mage", 6));
    const h = s.heroes[0];
    const bareMax = h.maxHp;
    step(s, { equip: { slot: "armor", templateId: armor, refineLevel: 10 } });
    expect(equipDefOf(h)).toBe(refinedStat(t.def!, 10));
    expect(equipHpOf(h)).toBe(refinedStat(t.hp!, 10));
    // maxHp gained exactly the refined armor HP (headroom healed, like equipping).
    expect(h.maxHp).toBe(bareMax + refinedStat(t.hp!, 10));
  });

  it("unequip resets the slot's refine to +0; re-equip at a new +N re-derives", () => {
    const s = initGameState(1, soloSave("mage", 6));
    const h = s.heroes[0];
    step(s, { equip: { slot: "weapon", templateId: staff, refineLevel: 8 } });
    expect(equipAtkOf(h)).toBe(refinedStat(baseAtk, 8));
    step(s, { equip: { slot: "weapon", templateId: null } });
    expect(h.equipped.refine?.weapon).toBe(0);
    expect(equipAtkOf(h)).toBe(0);
    // Re-equip the SAME template at a higher +N (e.g. after a server refine) must
    // re-derive stats even though the templateId is unchanged.
    step(s, { equip: { slot: "weapon", templateId: staff, refineLevel: 3 } });
    step(s, { equip: { slot: "weapon", templateId: staff, refineLevel: 9 } });
    expect(equipAtkOf(h)).toBe(refinedStat(baseAtk, 9));
  });

  it("clamps an over-cap refineLevel from the equip intent to +max", () => {
    const s = initGameState(1, soloSave("mage", 6));
    const h = s.heroes[0];
    step(s, { equip: { slot: "weapon", templateId: staff, refineLevel: 999 } });
    expect(h.equipped.refine?.weapon).toBe(REFINE.maxRefine);
    expect(equipAtkOf(h)).toBe(refinedStat(baseAtk, REFINE.maxRefine));
  });
});

// ---------------------------------------------------------------------------
// Material counter (carry-through + server-confirmed delta).
// ---------------------------------------------------------------------------

describe("material counter (SAVE v14)", () => {
  it("a fresh state starts at 0 and round-trips through save", () => {
    const s = initGameState(1, soloSave("archer", 3));
    expect(s.materials).toBe(0);
    s.materials = 42;
    const restored = initGameState(1, toSaveData(s));
    expect(restored.materials).toBe(42);
  });

  it("materialsDelta applies a signed, floor-0 server-confirmed change", () => {
    const s = initGameState(1, soloSave("archer", 3));
    step(s, { materialsDelta: 30 }); // salvage grant
    expect(s.materials).toBe(30);
    step(s, { materialsDelta: -12 }); // refine spend
    expect(s.materials).toBe(18);
    step(s, { materialsDelta: -999 }); // never below 0
    expect(s.materials).toBe(0);
    step(s, { materialsDelta: NaN }); // ignored
    expect(s.materials).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Migration v13 -> v14.
// ---------------------------------------------------------------------------

describe("migrate v13 → v14", () => {
  it("backfills a pre-v14 save: equipped.refine +0 on every slot, materials 0", () => {
    const m = migrate({
      version: 13,
      stage: 7,
      gold: 100,
      hero: { cls: "mage", level: 20, tier: 1 },
      equipped: { weapon: "w_staff_t3_arcane", armor: "a_chain_t3_mail" },
    });
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.equipped.refine).toEqual({ weapon: 0, armor: 0 });
    expect(m.materials).toBe(0);
  });

  it("preserves a v14 save's refine + materials, clamped, and is idempotent", () => {
    const once = migrate({
      version: 14,
      stage: 8,
      gold: 50,
      hero: { cls: "swordsman", level: 25, xp: 3, tier: 2 },
      equipped: {
        weapon: "w_sword_t4_flame",
        armor: "a_plate_t4_guard",
        refine: { weapon: 7, armor: 999 }, // over-cap clamps to +max
      },
      materials: 340,
    });
    expect(once.equipped.refine).toEqual({ weapon: 7, armor: REFINE.maxRefine });
    expect(once.materials).toBe(340);
    expect(migrate(once)).toEqual(once); // migrate-on-every-save is idempotent
  });

  it("carries the persisted refine into live hero stats on load", () => {
    const save = migrate({
      version: 13,
      stage: 8,
      gold: 0,
      hero: { cls: "swordsman", level: 20, tier: 1 },
      equipped: { weapon: "w_sword_t4_flame", armor: null },
    });
    save.equipped.refine = { weapon: 6, armor: 0 };
    const h = initGameState(9, save).heroes[0];
    expect(equipAtkOf(h)).toBe(refinedStat(ITEM_TEMPLATES["w_sword_t4_flame"].stats.atk!, 6));
  });
});

// ---------------------------------------------------------------------------
// Determinism — refine derivation adds no RNG / no drift.
// ---------------------------------------------------------------------------

describe("refine determinism", () => {
  const drive = (): GameState => {
    const s = initGameState(1234, soloSave("swordsman", 4));
    step(s, { equip: { slot: "weapon", templateId: "w_sword_t3_knight", refineLevel: 7 } });
    for (let i = 0; i < 240; i++) step(s, {});
    return s;
  };
  it("two identical runs with a refined weapon produce byte-identical state", () => {
    const a = JSON.stringify(drive());
    const b = JSON.stringify(drive());
    expect(a).toBe(b);
  });

  it("the equip+refine intent draws no RNG (reserved wave stream untouched)", () => {
    // A single step whose ONLY difference is a refined-weapon equip must leave the
    // reserved wave-composition RNG cursor exactly where a no-input step does — the
    // equip/refine path is deterministic and never touches the seeded stream.
    const withEquip = initGameState(77, soloSave("swordsman", 4));
    step(withEquip, {
      equip: { slot: "weapon", templateId: "w_sword_t3_knight", refineLevel: 5 },
    });
    const noEquip = initGameState(77, soloSave("swordsman", 4));
    step(noEquip, {});
    expect(withEquip.rngState).toBe(noEquip.rngState);
  });
});
