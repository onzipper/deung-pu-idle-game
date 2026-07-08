import { describe, it, expect } from "vitest";
import {
  initGameState,
  step,
  toSaveData,
  migrate,
  makeHero,
  ITEM_TEMPLATES,
  dropTableForStage,
  bossDropTableForStage,
  maxSummedDropChance,
  tierForStage,
  vendorPriceForTemplate,
  equipAtkOf,
  equipDefOf,
  equipHpOf,
  heroBaseAtkOf,
  heroMaxHpOf,
  combatPower,
  lootFloat,
  SAVE_VERSION,
  type GameState,
} from "@/engine";
import { soloSave, makeStubEnemy } from "./helpers";

/**
 * M7 Gear & Drops — engine core. Determinism of the STATELESS drop hash, migrate
 * v9→v10, equip stat math + classReq, itemDrop emission, and the no-wave-RNG-leak
 * guarantee (the whole-state deterministic replay proves drops don't desync the
 * reserved stream).
 */

/** Collect every itemDrop across `n` steps into a flat (rollId, templateId) list. */
function collectDrops(s: GameState, n: number): { rollId: string; templateId: string }[] {
  const out: { rollId: string; templateId: string }[] = [];
  for (let i = 0; i < n; i++) {
    step(s, {});
    for (const e of s.events) {
      if (e.type === "itemDrop") out.push({ rollId: e.rollId, templateId: e.templateId });
    }
  }
  return out;
}

describe("catalog + drop tables", () => {
  it("every drop-table entry references a real, correctly-slotted template", () => {
    for (let stage = 1; stage <= 15; stage++) {
      for (const entry of [...dropTableForStage(stage), ...bossDropTableForStage(stage)]) {
        const t = ITEM_TEMPLATES[entry.templateId];
        expect(t, `${entry.templateId} @ s${stage}`).toBeDefined();
        expect(entry.chance).toBeGreaterThan(0);
      }
      // Farm table = the on-curve tier's items (a class weapon per class + armor).
      const tier = tierForStage(stage);
      for (const entry of dropTableForStage(stage)) {
        expect(ITEM_TEMPLATES[entry.templateId].tier).toBe(tier);
      }
    }
  });

  it("maxSummedDropChance is honest (== the densest per-stage max) and in (0,1)", () => {
    // The guard must cap to the DENSEST table any hero can roll — that is a ninja's
    // (SAVE v18), whose table is the SUPERSET (every legacy line + its own class-gated
    // daggers). Scanned across the full s1-30 range with the ninja pool, matching the
    // guard's own computation.
    let max = 0;
    for (let s = 1; s <= 30; s++) {
      max = Math.max(max, dropTableForStage(s, "ninja").reduce((a, e) => a + e.chance, 0));
    }
    expect(maxSummedDropChance()).toBeCloseTo(max, 10);
    expect(maxSummedDropChance()).toBeGreaterThan(0);
    expect(maxSummedDropChance()).toBeLessThan(1);
    // And it is strictly ABOVE the legacy 3-class max (daggers add per-kill chance for
    // ninja only) — a looser cap that never rejects a byte-identical non-ninja claim.
    let legacyMax = 0;
    for (let s = 1; s <= 30; s++) {
      legacyMax = Math.max(legacyMax, dropTableForStage(s).reduce((a, e) => a + e.chance, 0));
    }
    expect(maxSummedDropChance()).toBeGreaterThan(legacyMax);
  });

  it("template ids are all ≤64 chars (frozen DB key constraint)", () => {
    for (const id of Object.keys(ITEM_TEMPLATES)) expect(id.length).toBeLessThanOrEqual(64);
  });
});

describe("drop-roll determinism (stateless hash)", () => {
  it("same (save, seed) → identical itemDrop stream + lootCounter", () => {
    const save = soloSave("swordsman", 3);
    const a = initGameState(4242, save);
    const b = initGameState(4242, save);
    const da = collectDrops(a, 4000);
    const db = collectDrops(b, 4000);
    expect(da.length).toBeGreaterThan(0); // drops actually happened
    expect(da).toEqual(db);
    expect(a.lootCounter).toBe(b.lootCounter);
  });

  it("lootFloat depends on (salt, counter) only — pure + reproducible", () => {
    expect(lootFloat(123, 7)).toBe(lootFloat(123, 7));
    expect(lootFloat(123, 7)).not.toBe(lootFloat(124, 7));
    expect(lootFloat(123, 7)).not.toBe(lootFloat(123, 8));
    for (let c = 0; c < 500; c++) {
      const f = lootFloat(999, c);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it("counter is monotonic + rollIds unique across a save/load boundary", () => {
    const s = initGameState(7, soloSave("archer", 3));
    const phase1 = collectDrops(s, 3000);
    const snapshot = toSaveData(s);
    const counterAtSave = s.lootCounter;
    expect(counterAtSave).toBeGreaterThan(0);

    // Reload with a DIFFERENT seed: the salt + counter persist (rolls key off the
    // saved salt, not the session seed), so the counter continues monotonically.
    const s2 = initGameState(99999, snapshot);
    expect(s2.lootCounter).toBe(counterAtSave);
    expect(s2.lootSalt).toBe(s.lootSalt);
    const phase2 = collectDrops(s2, 3000);

    const ids1 = phase1.map((d) => Number(d.rollId));
    const ids2 = phase2.map((d) => Number(d.rollId));
    // Every pre-save rollId is below the saved counter; every post-load one is at
    // or above it → the two sets are disjoint (no re-roll, no dupe claim key).
    for (const id of ids1) expect(id).toBeLessThan(counterAtSave);
    for (const id of ids2) expect(id).toBeGreaterThanOrEqual(counterAtSave);
  });

  it("whole-state replay stays byte-identical (drops don't desync the RNG stream)", () => {
    const a = initGameState(31337, soloSave("mage", 4));
    const b = initGameState(31337, soloSave("mage", 4));
    for (let i = 0; i < 2500; i++) {
      step(a, {});
      step(b, {});
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.lootCounter).toBeGreaterThan(0); // and rolls did occur
  });
});

describe("itemDrop event emission", () => {
  it("a farm kill can emit an itemDrop with a valid, in-table template", () => {
    const s = initGameState(1, soloSave("swordsman", 2));
    s.spawnPaused = true; // isolate hand-placed kills from the spawn pool
    const table = new Set(dropTableForStage(s.stage).map((e) => e.templateId));
    let sawDrop = false;
    // Kill a stream of stub enemies until a drop rolls (the hash guarantees one
    // within a bounded window given the ~12% summed chance).
    for (let k = 0; k < 200 && !sawDrop; k++) {
      const e = makeStubEnemy(1000 + k, s.heroes[0].x + 5, 1);
      s.enemies = [e];
      s.heroes[0].cd = 0; // ensure the hero swings + one-shots the 1-hp stub each step
      const before = s.lootCounter;
      step(s, {});
      expect(s.lootCounter).toBeGreaterThanOrEqual(before); // a kill ticks the counter
      for (const ev of s.events) {
        if (ev.type === "itemDrop") {
          sawDrop = true;
          expect(table.has(ev.templateId)).toBe(true);
          expect(ev.mobId).toBe(e.id);
          expect(typeof ev.rollId).toBe("string");
        }
      }
    }
    expect(sawDrop).toBe(true);
  });
});

describe("equip stat math", () => {
  it("weapon adds flat ATK; armor adds flat DEF + HP (and heals the headroom)", () => {
    const s = initGameState(1, soloSave("swordsman", 3));
    const h = s.heroes[0];
    const wid = "w_sword_t3_knight";
    const aid = "a_chain_t3_mail";
    const wAtk = ITEM_TEMPLATES[wid].stats.atk!;
    const aDef = ITEM_TEMPLATES[aid].stats.def!;
    const aHp = ITEM_TEMPLATES[aid].stats.hp!;

    const atk0 = heroBaseAtkOf(h);
    const hp0 = heroMaxHpOf(h);
    step(s, { equip: { slot: "weapon", templateId: wid } });
    expect(equipAtkOf(h)).toBe(wAtk);
    expect(heroBaseAtkOf(h)).toBe(atk0 + wAtk);

    const maxBefore = h.maxHp;
    const hpBefore = h.hp;
    step(s, { equip: { slot: "armor", templateId: aid } });
    expect(equipDefOf(h)).toBe(aDef);
    expect(equipHpOf(h)).toBe(aHp);
    expect(heroMaxHpOf(h)).toBe(hp0 + aHp);
    expect(h.maxHp).toBe(maxBefore + aHp);
    expect(h.hp).toBe(hpBefore + aHp); // equipping armor heals the added headroom
    expect(combatPower(h)).toBeGreaterThan(combatPower({ ...h, equipped: { weapon: null, armor: null } }));
  });

  it("unequip reverts stats and clamps HP to the smaller max", () => {
    const s = initGameState(1, soloSave("mage", 6));
    const h = s.heroes[0];
    step(s, { equip: { slot: "armor", templateId: "a_rune_t5_ward" } });
    const maxWith = h.maxHp;
    step(s, { equip: { slot: "armor", templateId: null } });
    expect(equipHpOf(h)).toBe(0);
    expect(h.maxHp).toBeLessThan(maxWith);
    expect(h.hp).toBeLessThanOrEqual(h.maxHp);
  });

  it("DEF reduces incoming hero damage (floored), no change when unarmored", () => {
    const s = initGameState(1, soloSave("swordsman", 3));
    const h = s.heroes[0];
    // Unarmored: DEF is 0, so incoming damage is untouched (balance-preserving).
    expect(equipDefOf(h)).toBe(0);
    step(s, { equip: { slot: "armor", templateId: "a_plate_t4_guard" } });
    expect(equipDefOf(h)).toBe(ITEM_TEMPLATES["a_plate_t4_guard"].stats.def!);
  });
});

describe("equip validation (classReq + slot)", () => {
  it("rejects a foreign-class weapon (no-op) but accepts a matching one", () => {
    const s = initGameState(1, soloSave("archer", 2));
    const h = s.heroes[0];
    step(s, { equip: { slot: "weapon", templateId: "w_sword_t1_rusty" } }); // sword on archer
    expect(h.equipped.weapon).toBeNull();
    step(s, { equip: { slot: "weapon", templateId: "w_bow_t1_short" } }); // archer bow
    expect(h.equipped.weapon).toBe("w_bow_t1_short");
  });

  it("universal (class-null) armor equips on any class", () => {
    for (const cls of ["swordsman", "archer", "mage"] as const) {
      const s = initGameState(1, soloSave(cls, 1));
      step(s, { equip: { slot: "armor", templateId: "a_cloth_t1_tunic" } });
      expect(s.heroes[0].equipped.armor).toBe("a_cloth_t1_tunic");
    }
  });

  it("rejects a wrong-slot templateId and an unknown id (no-op)", () => {
    const s = initGameState(1, soloSave("swordsman", 3));
    const h = s.heroes[0];
    step(s, { equip: { slot: "armor", templateId: "w_sword_t2_iron" } }); // weapon in armor slot
    expect(h.equipped.armor).toBeNull();
    step(s, { equip: { slot: "weapon", templateId: "does_not_exist" } });
    expect(h.equipped.weapon).toBeNull();
  });

  it("class-specific armor is gated by classReq", () => {
    const archer = initGameState(1, soloSave("archer", 4));
    step(archer, { equip: { slot: "armor", templateId: "a_sword_t4_fortress" } }); // sword-only
    expect(archer.heroes[0].equipped.armor).toBeNull();
    step(archer, { equip: { slot: "armor", templateId: "a_archer_t4_windcloak" } });
    expect(archer.heroes[0].equipped.armor).toBe("a_archer_t4_windcloak");
  });
});

describe("migrate v9 → v10", () => {
  it("backfills a pre-v10 save with empty gear, zero counter, derived salt", () => {
    const m = migrate({ version: 9, stage: 6, gold: 100, hero: { cls: "archer", level: 20, tier: 1 } });
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.equipped).toEqual({ weapon: null, armor: null, refine: { weapon: 0, armor: 0 } });
    expect(m.materials).toBe(0); // M7.6: pre-v14 backfills the material counter to 0
    expect(m.lootCounter).toBe(0);
    expect(typeof m.lootSalt).toBe("number");
    expect(Number.isInteger(m.lootSalt)).toBe(true);
  });

  it("preserves a v10 save's gear + salt + counter (idempotent)", () => {
    const once = migrate({
      version: 10,
      stage: 7,
      gold: 50,
      hero: { cls: "mage", level: 15, xp: 3, tier: 1 },
      equipped: { weapon: "w_staff_t3_arcane", armor: "a_chain_t3_mail" },
      lootCounter: 812,
      lootSalt: 55555,
    });
    expect(once.equipped).toEqual({
      weapon: "w_staff_t3_arcane",
      armor: "a_chain_t3_mail",
      refine: { weapon: 0, armor: 0 },
    });
    expect(once.lootCounter).toBe(812);
    expect(once.lootSalt).toBe(55555);
    expect(migrate(once)).toEqual(once); // idempotent
  });

  it("derived salt is stable for a given save (deterministic re-derive)", () => {
    const input = { version: 9, stage: 4, gold: 7, hero: { cls: "swordsman" as const, level: 9 } };
    expect(migrate(input).lootSalt).toBe(migrate(input).lootSalt);
  });

  it("round-trips gear through initGameState + toSaveData", () => {
    const save = soloSave("mage", 5);
    save.equipped = {
      weapon: "w_staff_t2_oak",
      armor: "a_leather_t2_vest",
      refine: { weapon: 0, armor: 0 },
    };
    const restored = toSaveData(initGameState(3, save));
    expect(restored.equipped).toEqual(save.equipped);
    const h = initGameState(3, save).heroes[0];
    expect(h.equipped).toEqual(save.equipped);
    expect(equipAtkOf(h)).toBe(ITEM_TEMPLATES["w_staff_t2_oak"].stats.atk);
  });
});

describe("ninja dagger line (SAVE v18)", () => {
  const DAGGERS = [
    "w_dagger_t1_kunai", "w_dagger_t2_tanto", "w_dagger_t3_shadow", "w_dagger_t4_venom",
    "w_dagger_t5_wraith", "w_dagger_t6_ragna", "w_dagger_t7_frost", "w_dagger_t8_dune",
    "w_dagger_t9_obsidian", "w_dagger_t10_apocalypse",
  ];

  it("has a full t1-t10 dagger line: weapon slot, classReq ninja, ATK == the sword curve", () => {
    for (let tier = 1; tier <= 10; tier++) {
      const dag = DAGGERS[tier - 1];
      const t = ITEM_TEMPLATES[dag];
      expect(t, dag).toBeDefined();
      expect(t.slot).toBe("weapon");
      expect(t.classReq).toBe("ninja");
      expect(t.tier).toBe(tier);
      // Curve reasoning (docs/ninja-design.md §6): dagger ATK == the shared sword ATK
      // curve; the ninja's ~+10% DPS over sword is delivered by the 2×0.55 double-hit
      // (multiHit), NOT a raw weapon-number premium — so the line stays parallel.
      const sword = Object.values(ITEM_TEMPLATES).find(
        (x) => x.slot === "weapon" && x.classReq === "swordsman" && x.tier === tier,
      )!;
      expect(t.stats.atk).toBe(sword.stats.atk);
    }
    // Rarity band mirrors the other weapon lines (t6 + t10 are the EPIC break/ceiling).
    expect(ITEM_TEMPLATES["w_dagger_t6_ragna"].rarity).toBe("epic");
    expect(ITEM_TEMPLATES["w_dagger_t10_apocalypse"].rarity).toBe("epic");
    expect(ITEM_TEMPLATES["w_dagger_t3_shadow"].rarity).toBe("rare");
  });

  it("vendor price + refine compat parallel the sword line (same tier/rarity → same price)", () => {
    for (let tier = 1; tier <= 10; tier++) {
      const dag = DAGGERS[tier - 1];
      const sword = Object.values(ITEM_TEMPLATES).find(
        (x) => x.slot === "weapon" && x.classReq === "swordsman" && x.tier === tier,
      )!;
      // Same tier + rarity ⇒ identical vendor price (tier² × rarityMult) — daggers are
      // real NPC-sellable gear like every other weapon line.
      expect(vendorPriceForTemplate(dag)).toBe(vendorPriceForTemplate(sword.id));
      expect(vendorPriceForTemplate(dag)).toBeGreaterThan(0);
    }
  });

  it("only a ninja hero can equip a dagger (classReq enforced through step)", () => {
    for (const cls of ["swordsman", "archer", "mage"] as const) {
      const s = initGameState(1, soloSave(cls, 3));
      step(s, { equip: { slot: "weapon", templateId: "w_dagger_t3_shadow" } });
      expect(s.heroes[0].equipped.weapon, `${cls} must not equip a dagger`).toBeNull();
    }
    const ninja = initGameState(1, soloSave("ninja", 3));
    step(ninja, { equip: { slot: "weapon", templateId: "w_dagger_t3_shadow" } });
    expect(ninja.heroes[0].equipped.weapon).toBe("w_dagger_t3_shadow");
  });
});

describe("dagger drop gating (existing players unaffected)", () => {
  const isDagger = (id: string) => id.startsWith("w_dagger_");

  it("non-ninja farm+boss tables are byte-identical to the pre-ninja (no-arg) tables", () => {
    for (let s = 1; s <= 30; s++) {
      for (const cls of ["swordsman", "archer", "mage"] as const) {
        // Passing a legacy class yields EXACTLY the default (no-arg) table — daggers
        // never leak in, so the deterministic loot-roll accumulator is unshifted.
        expect(dropTableForStage(s, cls)).toEqual(dropTableForStage(s));
        expect(bossDropTableForStage(s, cls)).toEqual(bossDropTableForStage(s));
      }
      // No dagger appears in ANY default table (the roll-site's current path).
      expect(dropTableForStage(s).some((e) => isDagger(e.templateId))).toBe(false);
      expect(bossDropTableForStage(s).some((e) => isDagger(e.templateId))).toBe(false);
    }
  });

  it("a ninja's tables DO include the on-curve dagger (superset of the legacy pool)", () => {
    for (let s = 1; s <= 30; s++) {
      const tier = tierForStage(s);
      const farm = dropTableForStage(s, "ninja");
      const dagger = farm.find((e) => isDagger(e.templateId));
      expect(dagger, `s${s} ninja farm dagger`).toBeDefined();
      expect(ITEM_TEMPLATES[dagger!.templateId].tier).toBe(tier);
      // Ninja pool = every legacy entry PLUS the dagger (superset, same order preserved).
      const legacy = dropTableForStage(s);
      expect(farm.length).toBe(legacy.length + 1);
      for (const e of legacy) expect(farm).toContainEqual(e);
      // Boss pool likewise gains the class daggers.
      expect(bossDropTableForStage(s, "ninja").some((e) => isDagger(e.templateId))).toBe(true);
    }
  });

  it("an existing-class hero NEVER rolls a dagger across thousands of kills (real roll path)", () => {
    // The live roll sites (systems/gear.ts) call dropTableForStage with NO class arg → the
    // daggers-excluded table. So a swordsman/archer/mage playthrough emits ZERO dagger drops,
    // and its itemDrop stream is exactly the pre-ninja sequence (locked by the determinism
    // test above). This is the "least impact on existing players" guarantee, end-to-end.
    for (const cls of ["swordsman", "archer", "mage"] as const) {
      const s = initGameState(4242, soloSave(cls, 3));
      const drops = collectDrops(s, 6000);
      expect(drops.length).toBeGreaterThan(0);
      expect(drops.some((d) => isDagger(d.templateId))).toBe(false);
    }
  });
});

describe("no-gear invariance (balance untouched)", () => {
  it("an unarmored hero's power math equals the pre-gear derivation", () => {
    const bare = makeHero(1, "swordsman", 20, 0, 1);
    expect(equipAtkOf(bare)).toBe(0);
    expect(equipDefOf(bare)).toBe(0);
    expect(equipHpOf(bare)).toBe(0);
    // heroBaseAtkOf/heroMaxHpOf add exactly 0 for an empty loadout.
    expect(heroBaseAtkOf(bare)).toBe(heroBaseAtkOf({ ...bare }));
  });
});
