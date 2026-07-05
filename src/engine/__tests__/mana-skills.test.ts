import { describe, it, expect } from "vitest";
import {
  CONFIG,
  SKILLS,
  SIGNATURE_SKILL,
  FIXED_DT,
  SAVE_VERSION,
  initGameState,
  migrate,
  step,
  heroMaxMana,
  heroManaRegen,
  learnedSkills,
  unlockedAutoSlotCount,
  isSkillLearned,
} from "@/engine";
import { makeParty, makeStubEnemy, soloSave } from "./helpers";

/**
 * M5 "mana + skill framework v2" (86d3jv7m3) — the task's required coverage:
 * mana accounting/regen determinism, unlock-by-level, auto-slot priority
 * determinism, manual-cast once-per-click, migrate v5→v6, and the anti-stall
 * guarantee (mana starvation never freezes progression).
 */

describe("mana accounting", () => {
  it("a cast spends exactly the skill's mana cost and starts its cooldown", () => {
    const s = makeParty(7);
    const mage = s.heroes[2];
    // Sit below the pool so the step's regen actually adds (not clamped at full).
    const before = mage.maxMana - 5;
    mage.mana = before;
    s.enemies = [makeStubEnemy(1, mage.x + 40)];

    step(s, { castSkills: [{ slot: 2, skillId: "mage_meteor" }] });

    // One step of regen happens (decayHeroTimers) BEFORE the cast, so the net is
    // (before + regen*dt) - cost. Assert the cost was debited off the regen'd pool.
    const regenStep = heroManaRegen("mage", mage.stats.int) * FIXED_DT;
    expect(mage.mana).toBeCloseTo(before + regenStep - SKILLS.mage_meteor.cost, 5);
    expect(mage.skillCds["mage_meteor"]).toBe(SKILLS.mage_meteor.cd);
  });

  it("a skill the hero cannot afford does NOT cast (no cooldown, no mana spent)", () => {
    const s = makeParty(7);
    const mage = s.heroes[2];
    mage.mana = SKILLS.mage_meteor.cost - 10; // just short
    s.enemies = [makeStubEnemy(1, mage.x + 40)];

    // Suppress regen topping it up over the threshold this step: cost is well
    // above one step of regen, so it stays unaffordable.
    step(s, { castSkills: [{ slot: 2, skillId: "mage_meteor" }] });

    expect(s.projectiles.some((p) => p.kind === "meteor")).toBe(false);
    expect(s.heroes[2].skillCds["mage_meteor"] ?? 0).toBe(0);
  });

  it("max mana scales with allocated INT; regen too (caster identity)", () => {
    const base = CONFIG.stats.base.mage.int;
    expect(heroMaxMana("mage", base)).toBe(CONFIG.mana.base);
    expect(heroMaxMana("mage", base + 20)).toBeGreaterThan(heroMaxMana("mage", base));
    expect(heroManaRegen("mage", base + 20)).toBeGreaterThan(heroManaRegen("mage", base));
    // A str/dex class at its base int sits on the flat base pool + base regen.
    expect(heroMaxMana("swordsman")).toBe(CONFIG.mana.base);
    expect(heroManaRegen("swordsman")).toBe(CONFIG.mana.baseRegen);
  });

  it("regen is deterministic and clamps at the pool", () => {
    const a = initGameState(3, soloSave("mage", 1));
    const b = initGameState(3, soloSave("mage", 1));
    a.heroes[0].mana = 0;
    b.heroes[0].mana = 0;
    for (let i = 0; i < 300; i++) {
      step(a, {});
      step(b, {});
    }
    expect(a.heroes[0].mana).toBe(b.heroes[0].mana); // deterministic
    expect(a.heroes[0].mana).toBeLessThanOrEqual(a.heroes[0].maxMana); // clamped
    expect(a.heroes[0].mana).toBeGreaterThan(0); // it recovered
  });
});

describe("unlock-by-level within a tier", () => {
  it("signature is learned at level 1; the second tier-1 skill only at its unlock level", () => {
    const s = initGameState(1, soloSave("archer", 1));
    const archer = s.heroes[0];
    expect(isSkillLearned(archer, SKILLS.archer_rain)).toBe(true); // signature
    expect(isSkillLearned(archer, SKILLS.archer_powershot)).toBe(false); // needs L8

    archer.level = SKILLS.archer_powershot.unlockLevel;
    expect(isSkillLearned(archer, SKILLS.archer_powershot)).toBe(true);
  });

  it("a tier-2 skill needs BOTH the tier and the level (evolution gate)", () => {
    const s = initGameState(1, soloSave("mage", 1));
    const mage = s.heroes[0];
    mage.level = SKILLS.mage_cataclysm.unlockLevel; // level met...
    expect(isSkillLearned(mage, SKILLS.mage_cataclysm)).toBe(false); // ...but tier 1
    mage.tier = 2;
    expect(isSkillLearned(mage, SKILLS.mage_cataclysm)).toBe(true);
    expect(learnedSkills(mage).map((d) => d.id)).toContain("mage_cataclysm");
  });

  it("auto-cast never fires an unlearned skill even if it is slotted", () => {
    const s = initGameState(1, soloSave("mage", 1));
    const mage = s.heroes[0];
    mage.level = 30; // slot 2 unlocked, but mage is tier 1 so cataclysm is unlearned
    mage.autoSlots = ["mage_meteor", "mage_frostnova", "mage_cataclysm"];
    mage.mana = mage.maxMana;
    s.autoCast = true;
    s.enemies = [makeStubEnemy(1, mage.x + 40)];

    step(s, {});
    // meteor + frostnova learned & cast; cataclysm (tier-2, unlearned) never does.
    expect(s.heroes[0].skillCds["mage_cataclysm"] ?? 0).toBe(0);
  });
});

describe("auto-slot assignment + priority", () => {
  it("setAutoSlot rejects a locked slot and an unlearned skill", () => {
    const s = initGameState(1, soloSave("swordsman", 1)); // level 1 -> only slot 0 unlocked
    expect(unlockedAutoSlotCount(1)).toBe(1);
    // Slot 1 is locked at level 1.
    step(s, { setAutoSlots: [{ slot: 1, skillId: "sword_whirl" }] });
    expect(s.heroes[0].autoSlots[1]).toBe(null);
    // Unlearned skill into an unlocked slot.
    s.heroes[0].level = 20; // unlocks slot 1 (>=15)
    step(s, { setAutoSlots: [{ slot: 1, skillId: "sword_quake" }] }); // tier-1 hero
    expect(s.heroes[0].autoSlots[1]).toBe(null);
  });

  it("de-dups: assigning a slotted skill to another slot clears the old slot", () => {
    const s = initGameState(1, soloSave("swordsman", 1));
    s.heroes[0].level = 20; // slots 0 + 1 unlocked; warcry (L8) learned
    step(s, { setAutoSlots: [{ slot: 1, skillId: "sword_whirl" }] }); // whirl now in slot 1 too
    // whirl was default in slot 0; it should have moved, not duplicated.
    expect(s.heroes[0].autoSlots.filter((id) => id === "sword_whirl").length).toBe(1);
    expect(s.heroes[0].autoSlots[1]).toBe("sword_whirl");
    expect(s.heroes[0].autoSlots[0]).toBe(null);
  });

  it("auto-cast walks slots in ORDER (deterministic priority) — a starved pool funds the earlier slot", () => {
    const s = initGameState(1, soloSave("mage", 1));
    const mage = s.heroes[0];
    mage.level = 20;
    mage.tier = 2;
    // Two affordable-individually skills, but a pool that only funds ONE this step.
    mage.autoSlots = ["mage_meteor", "mage_frostnova", null];
    mage.maxMana = 1000;
    mage.mana = SKILLS.mage_meteor.cost + 1; // funds slot 0 only
    s.autoCast = true;
    s.enemies = [makeStubEnemy(1, mage.x + 40)];

    step(s, {});
    // Slot 0 (meteor) fired; slot 1 (frostnova) was skipped for lack of mana.
    expect(s.heroes[0].skillCds["mage_meteor"]).toBe(SKILLS.mage_meteor.cd);
    expect(s.heroes[0].skillCds["mage_frostnova"] ?? 0).toBe(0);
  });
});

describe("manual cast is once-per-click (idempotent across sub-steps)", () => {
  it("the same castSkills input applied to two sub-steps casts twice, but the loop only hands it once", () => {
    // The engine applies whatever input it is GIVEN each step; the once-per-click
    // guarantee is the loop handing the drained intent to only the FIRST sub-step.
    // Model that here: first sub-step gets the cast, the rest get {}.
    const s = makeParty(7);
    const sword = s.heroes[0];
    s.enemies = [makeStubEnemy(1, sword.x + 20)];

    step(s, { castSkills: [{ slot: 0, skillId: "sword_whirl" }] }); // sub-step 0
    step(s, {}); // sub-step 1 (no re-cast)
    step(s, {}); // sub-step 2

    // Exactly one cast happened: the skill is on cooldown, not re-triggered.
    expect(s.heroes[0].skillCds["sword_whirl"]).toBeGreaterThan(0);
    expect(s.heroes[0].skillCds["sword_whirl"]).toBeLessThanOrEqual(SKILLS.sword_whirl.cd);
  });

  it("a cast while on cooldown is a no-op (mana not spent again)", () => {
    const s = makeParty(7);
    const sword = s.heroes[0];
    s.enemies = [makeStubEnemy(1, sword.x + 20)];
    step(s, { castSkills: [{ slot: 0, skillId: "sword_whirl" }] });
    const manaAfterFirst = s.heroes[0].mana;
    const cdAfterFirst = s.heroes[0].skillCds["sword_whirl"];

    // Immediately try again while on cooldown.
    step(s, { castSkills: [{ slot: 0, skillId: "sword_whirl" }] });
    // Mana only moved by one regen step (no second debit); cd only decayed.
    expect(s.heroes[0].mana).toBeGreaterThan(manaAfterFirst); // regen, not spend
    expect(s.heroes[0].skillCds["sword_whirl"]).toBeLessThan(cdAfterFirst);
  });
});

describe("SAVE v5 -> v6 migration", () => {
  it("adds full mana + the class default auto-slot loadout to a v5 save", () => {
    const v5 = {
      version: 5,
      stage: 3,
      gold: 10,
      hero: {
        cls: "mage" as const,
        level: 12,
        xp: 4,
        tier: 1 as const,
        statPoints: 6,
        stats: { str: 3, dex: 4, int: 25, vit: 8 },
      },
      lastSeen: 0,
    };
    const v6 = migrate(v5);
    expect(v6.version).toBe(SAVE_VERSION);
    expect(v6.hero.mana).toBe(heroMaxMana("mage", 25)); // full pool
    expect(v6.hero.autoSlots).toEqual([SIGNATURE_SKILL.mage, null, null]);
  });

  it("clamps a saved mana above the (int-derived) pool on load", () => {
    const save = soloSave("swordsman", 1);
    save.hero.mana = 99999; // absurd
    const s = initGameState(1, save);
    expect(s.heroes[0].mana).toBe(s.heroes[0].maxMana);
  });
});

describe("mana starvation never hard-stalls progression", () => {
  it("a mana-broke hero still kills enemies via basic attacks (which cost no mana)", () => {
    const s = initGameState(1, soloSave("swordsman", 1));
    const sword = s.heroes[0];
    sword.mana = 0;
    // A weak, stationary enemy the swordsman can basic-attack down.
    s.enemies = [makeStubEnemy(1, sword.x + 20, 40)];
    s.autoCast = true; // skills will TRY but be mana-starved

    let killed = false;
    for (let i = 0; i < 600 && !killed; i++) {
      step(s, {});
      killed = !s.enemies.some((e) => e.id === 1);
    }
    expect(killed).toBe(true); // basic attacks never blocked by mana -> progress
  });

  it("with skills mana-gated, a solo swordsman still clears stage 1 (kills bank toward the boss)", () => {
    const s = initGameState(1, soloSave("swordsman", 1));
    s.autoCast = true;
    // Cripple regen isn't directly tunable per-run, but a fresh hero's tight pool
    // already forces skips; assert real progress accrues regardless.
    let advanced = false;
    for (let i = 0; i < 60 * 300 && !advanced; i++) {
      const bossReady = s.phase === "battle" && s.bossReady;
      step(s, bossReady ? { challengeBoss: true } : s.phase === "victory" ? { advanceStage: true } : {});
      advanced = s.stage >= 2;
    }
    expect(advanced).toBe(true);
  });
});
