import { describe, it, expect } from "vitest";
import {
  CONFIG,
  SKILLS,
  CLASS_SKILLS,
  SIGNATURE_SKILL,
  initGameState,
  step,
  learnedSkills,
  isSkillLearned,
  type HeroClass,
} from "@/engine";
import { applyDamage } from "@/engine/systems/damage";
import { makeStubEnemy, soloSave } from "./helpers";

/**
 * M7.7 "Skill Spectacle & World Heat" (owner-locked 2026-07-06) — engine coverage:
 * the reworked skill table (three layers per class; field-wide tier-2 ultimates),
 * MANA as the pacing governor (full-kit spam drains the pool), and the denser fields.
 * The survivor-retaliation rule itself is covered in hunt.test.ts; here we pin the
 * basic-attack half of it (unchanged) plus the skill-table + mana-economy invariants.
 */

const CLASSES: HeroClass[] = ["swordsman", "archer", "mage"];

/** A tier-2, high-level hero of `cls` with its whole kit auto-slotted, full mana. */
function evolvedHero(cls: HeroClass) {
  const s = initGameState(1, soloSave(cls, 12));
  const h = s.heroes[0];
  h.level = 30; // unlocks all 3 auto-slots + every tier-1/2 unlock level
  h.tier = 2; // evolution: tier-2 ultimate learnable
  h.autoSlots = [...CLASS_SKILLS[cls]] as (string | null)[];
  s.autoCast = true;
  s.spawnPaused = true;
  // A tough, harmless dummy in range of EVERY skill (whirl/quake/meteor/... all reach
  // < ~500px) that never dies (so casting continues) and never hits back (atk 0). Use a
  // high id so it can't collide with the solo hero's id (id-homing arrows resolve by id).
  s.enemies = [makeStubEnemy(900, h.x + 40, 1e12)];
  h.mana = h.maxMana;
  return { s, h };
}

describe("M7.7 skill table — three layers, learnable ultimate", () => {
  it("each class learns its signature + utility + tier-2 ultimate at tier2/L30 (the M7.9 tier-3 skill stays gated)", () => {
    for (const cls of CLASSES) {
      const { h } = evolvedHero(cls);
      const learned = new Set(learnedSkills(h).map((d) => d.id));
      // Every tier-1/tier-2 skill is learned at tier2/L30 (exactly the 3-skill kit).
      const kitUpToTier2 = CLASS_SKILLS[cls].filter((id) => SKILLS[id].tier <= 2);
      expect(kitUpToTier2.length).toBe(3);
      expect(kitUpToTier2.every((id) => learned.has(id))).toBe(true);
      // The M7.9 tier-3 skill-4 is NOT learned yet (needs tier 3 + L40).
      const tier3Skill = CLASS_SKILLS[cls].find((id) => SKILLS[id].tier === 3)!;
      expect(learned.has(tier3Skill)).toBe(false);
      // The tier-2 ULTIMATE is the sole tier-2 entry of the kit.
      const ultimate = CLASS_SKILLS[cls].find((id) => SKILLS[id].tier === 2)!;
      expect(SKILLS[ultimate].tier).toBe(2);
    }
  });

  it("the tier-2 ultimate is gated by BOTH tier and level (a tier-1 L30 hero has NOT learned it)", () => {
    for (const cls of CLASSES) {
      const s = initGameState(1, soloSave(cls, 12));
      const h = s.heroes[0];
      h.level = 30;
      h.tier = 1; // evolution not taken
      const ultimate = CLASS_SKILLS[cls].find((id) => SKILLS[id].tier === 2)!;
      expect(isSkillLearned(h, SKILLS[ultimate])).toBe(false);
      h.tier = 2;
      expect(isSkillLearned(h, SKILLS[ultimate])).toBe(true);
    }
  });

  it("every tier-2 ultimate is FIELD-WIDE (its coverage spans ~the 900px field)", () => {
    // quake = strike r460, cataclysm = meteor r460 (both ~half-field radius each side
    // -> ~920 diameter). Barrage = 13-drop rain whose widest offsets span ~±420 (~840).
    const field = CONFIG.world.maps[0].fieldWidth;
    expect(SKILLS.sword_quake.radius * 2).toBeGreaterThanOrEqual(field * 0.9);
    expect(SKILLS.mage_cataclysm.radius * 2).toBeGreaterThanOrEqual(field * 0.9);
    const barrageSpan =
      CONFIG.barrageOffsets[CONFIG.barrageOffsets.length - 1].dx - CONFIG.barrageOffsets[0].dx;
    expect(barrageSpan).toBeGreaterThanOrEqual(field * 0.8);
    expect(CONFIG.barrageOffsets.length).toBe(SKILLS.archer_barrage.targets); // table length = drops
  });
});

describe("M7.7 mana economy — mana governs pacing", () => {
  it("continuous FULL-KIT spam drains the pool below the auto-potion threshold (all classes)", () => {
    // The pool is the pacing governor: sustained full-kit casting outpaces regen, so
    // the pool empties toward needing a mana potion. Shallow (str/dex) pools drain in
    // seconds; the mage's deep INT pool drains slower but still empties under the kit.
    for (const cls of CLASSES) {
      const { s, h } = evolvedHero(cls);
      let minFrac = Infinity;
      for (let i = 0; i < 60 * 45; i++) {
        step(s, {});
        minFrac = Math.min(minFrac, h.mana / h.maxMana);
      }
      // Drops under the 25% auto-mana-potion threshold at least once => a real sink.
      expect(minFrac).toBeLessThan(CONFIG.shop.autoDefaults.manaThreshold);
    }
  });

  it("base regen still SUSTAINS each class's signature alone (no hard stall)", () => {
    // Only the signature slotted: base regen (7/s) covers every signature's cost/cd,
    // so a hero keeps casting it indefinitely and mana never hard-stalls at 0.
    for (const cls of CLASSES) {
      const s = initGameState(1, soloSave(cls, 12));
      const h = s.heroes[0];
      h.autoSlots = [SIGNATURE_SKILL[cls], null, null];
      s.autoCast = true;
      s.spawnPaused = true;
      s.enemies = [makeStubEnemy(900, h.x + 40, 1e12)]; // high id: no hero-id collision
      h.mana = h.maxMana;
      let casts = 0;
      for (let i = 0; i < 60 * 60; i++) {
        step(s, {});
        for (const e of s.events) if (e.type === "skillCast" && e.skillId === SIGNATURE_SKILL[cls]) casts++;
        expect(h.mana).toBeGreaterThanOrEqual(0); // never negative
      }
      // ~60s / signature cd => many casts; base regen kept it flowing (no mana lock).
      const expected = (60 / SKILLS[SIGNATURE_SKILL[cls]].cd) * 0.6;
      expect(casts).toBeGreaterThan(expected);
    }
  });
});

describe("M7.7 survivor-retaliation — basic-attack behaviour unchanged", () => {
  it("a BASIC attack that a passive mob SURVIVES engages it; one it KILLS does not", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    const survivor = { ...makeStubEnemy(1, 400, 1000), engaged: false };
    const doomed = { ...makeStubEnemy(2, 500, 3), engaged: false };
    s.enemies = [survivor, doomed];

    applyDamage(s, survivor, 10, "attack"); // survives -> retaliates (as pre-M7.7)
    applyDamage(s, doomed, 10, "attack"); // dies -> stays silent

    expect(survivor.engaged).toBe(true);
    expect(doomed.hp).toBeLessThanOrEqual(0);
    expect(doomed.engaged).toBe(false);
  });
});

describe("M7.7 density knobs — fields read ~17/19/21", () => {
  it("per-map maxAlive is 17 / 19 / 21 (maps 1-3)", () => {
    // M7.9 "Grand Expansion" appended maps 4-6 (21/23/25) — assert only the M7.7
    // maps 1-3 density here; the new maps' density is covered in grand-expansion.test.
    const alive = CONFIG.world.maps.slice(0, 3).map((m) => m.hunt.maxAlive);
    expect(alive).toEqual([17, 19, 21]);
  });

  it("a farm field fills up to its map's maxAlive cap", () => {
    // map1 fills to 17 over the respawn cadence (gradual re-entry burst then trickle).
    const s = initGameState(1);
    let maxSeen = 0;
    for (let i = 0; i < 60 * 30; i++) {
      step(s, {});
      maxSeen = Math.max(maxSeen, s.enemies.length);
    }
    expect(maxSeen).toBe(CONFIG.world.maps[0].hunt.maxAlive);
  });
});
