import { describe, it, expect } from "vitest";
import {
  initGameState,
  step,
  migrate,
  canEvolveHero,
  classChangeQuestFor,
  classChangeQuestId,
  isClassChangeQuestOffered,
  isQuestComplete,
  CONFIG,
  SAVE_VERSION,
  SIGNATURE_SKILL,
  type GameState,
  type Hero,
} from "@/engine";
import { soloSave, makeStubEnemy, clone, forceBoss } from "./helpers";

/**
 * M5 task 5 — class-change quest v1 ("เปลี่ยนคลาสผ่านเควส").
 *
 * The quest is the effort gate that TRIGGERS the tier-1 -> tier-2 evolution (the
 * old gold cost is gone). Objectives count deterministically from the solo hero's
 * own kills / boss defeats (no RNG, no wall-clock). These exercise the offer rule,
 * the accept intent, objective counting (incl. boss), completion -> evolve, the
 * v6 -> v7 migration, and determinism with a quest active.
 */

const GATE = CONFIG.evolution.levelRequired;

/** Index of the kill / killBoss objectives in the class-change quest def. */
function objIndices(hero: Hero): { kill: number; boss: number } {
  const def = classChangeQuestFor(hero.cls);
  return {
    kill: def.objectives.findIndex((o) => o.type === "kill"),
    boss: def.objectives.findIndex((o) => o.type === "killBoss"),
  };
}

/** A battle-ready state at the level gate, no waves spawning (so kills are exact). */
function gateState(cls: "swordsman" | "archer" | "mage" = "swordsman"): GameState {
  const s = initGameState(1, soloSave(cls, 1));
  s.heroes[0].level = GATE;
  s.waveGap = 999; // freeze wave spawns so seeded kills are the only ones
  return s;
}

describe("offer gating", () => {
  it("is offered only at tier 1, at/above the level gate, with no active quest", () => {
    const s = initGameState(1);
    const h = s.heroes[0];
    expect(isClassChangeQuestOffered(h)).toBe(false); // fresh: level 1
    h.level = GATE - 1;
    expect(isClassChangeQuestOffered(h)).toBe(false); // one short of the gate
    h.level = GATE;
    expect(isClassChangeQuestOffered(h)).toBe(true); // gate met
    // With an active quest: not offered.
    const def = classChangeQuestFor(h.cls);
    h.quest = { id: def.id, accepted: true, progress: def.objectives.map(() => 0) };
    expect(isClassChangeQuestOffered(h)).toBe(false);
    // Tier 2: not offered.
    h.quest = null;
    h.tier = 2;
    expect(isClassChangeQuestOffered(h)).toBe(false);
  });
});

describe("acceptQuest intent", () => {
  it("seats an accepted, zero-progress quest and emits questAccepted", () => {
    const s = gateState();
    step(s, { acceptQuest: 0 });
    const h = s.heroes[0];
    expect(h.quest).not.toBeNull();
    expect(h.quest!.accepted).toBe(true);
    expect(h.quest!.id).toBe(classChangeQuestId(h.cls));
    expect(h.quest!.progress.every((p) => p === 0)).toBe(true);
    const evts = s.events.filter((e) => e.type === "questAccepted");
    expect(evts.length).toBe(1);
    const e = evts[0];
    if (e.type !== "questAccepted") throw new Error("unreachable");
    expect(e.id).toBe(h.id);
    expect(e.questId).toBe(h.quest!.id);
  });

  it("is a no-op below the level gate (nothing to accept)", () => {
    const s = initGameState(1); // level 1
    step(s, { acceptQuest: 0 });
    expect(s.heroes[0].quest).toBeNull();
    expect(s.events.some((e) => e.type === "questAccepted")).toBe(false);
  });

  it("re-accepting is a no-op — it never clobbers in-flight progress", () => {
    const s = gateState();
    step(s, { acceptQuest: 0 });
    const h = s.heroes[0];
    const { kill } = objIndices(h);
    h.quest!.progress[kill] = 5; // pretend 5 kills already banked
    step(s, { acceptQuest: 0 }); // second tap
    expect(h.quest!.progress[kill]).toBe(5); // untouched
    // Only the first accept emitted an event (the second was a no-op).
    expect(s.events.some((e) => e.type === "questAccepted")).toBe(false);
  });
});

describe("objective counting", () => {
  it("counts each enemy kill and emits questObjectiveProgress on increment", () => {
    const s = gateState();
    step(s, { acceptQuest: 0 });
    const h = s.heroes[0];
    const { kill } = objIndices(h);

    // Seed one already-dead enemy; resolveDeaths banks it as a kill this step.
    s.enemies.push(makeStubEnemy(s.nextId++, 400, 0));
    step(s, {});
    expect(h.quest!.progress[kill]).toBe(1);
    const prog = s.events.filter((e) => e.type === "questObjectiveProgress");
    expect(prog.length).toBe(1);
    const e = prog[0];
    if (e.type !== "questObjectiveProgress") throw new Error("unreachable");
    expect(e.objectiveIndex).toBe(kill);
    expect(e.progress).toBe(1);
    expect(e.count).toBe(CONFIG.quest.classChange.kills);
  });

  it("does NOT count kills before the quest is accepted", () => {
    const s = gateState();
    s.enemies.push(makeStubEnemy(s.nextId++, 400, 0));
    step(s, {}); // no quest yet
    expect(s.heroes[0].quest).toBeNull();
    expect(s.events.some((e) => e.type === "questObjectiveProgress")).toBe(false);
  });

  it("counts a boss defeat toward the killBoss objective", () => {
    const s = gateState();
    step(s, { acceptQuest: 0 });
    const h = s.heroes[0];
    const { boss } = objIndices(h);

    // Meet the kill goal directly, then trigger the boss defeat via the real path.
    h.quest!.progress[objIndices(h).kill] = CONFIG.quest.classChange.kills;
    forceBoss(s); // M6: enter a boss fight without the world walk
    expect(s.phase).toBe("boss");
    s.boss!.hp = 0;
    step(s, {}); // resolveDeaths -> onBossKilled -> killBoss objective++

    expect(h.quest!.progress[boss]).toBe(CONFIG.quest.classChange.bossKills);
    expect(isQuestComplete(h)).toBe(true);
    expect(s.events.some((e) => e.type === "questCompleted")).toBe(true);
  });
});

describe("completion enables the class change without gold", () => {
  it("a completed quest makes canEvolveHero true and evolve succeeds at 0 gold", () => {
    const s = gateState();
    step(s, { acceptQuest: 0 });
    const h = s.heroes[0];
    const { kill, boss } = objIndices(h);
    h.quest!.progress[kill] = CONFIG.quest.classChange.kills;
    h.quest!.progress[boss] = CONFIG.quest.classChange.bossKills;

    expect(isQuestComplete(h)).toBe(true);
    expect(canEvolveHero(s, h)).toBe(true);

    s.gold = 0;
    step(s, { evolveHero: 0 });
    expect(h.tier).toBe(2);
    expect(h.quest).toBeNull();
    expect(s.gold).toBe(0);
  });
});

describe("migrate v6 -> v7", () => {
  it("a pre-v7 tier-1 hero at the gate is re-offered (quest null)", () => {
    const v6 = {
      version: 6,
      stage: 5,
      gold: 100,
      hero: { cls: "archer" as const, level: 20, xp: 0, tier: 1 as const },
      lastSeen: 0,
    };
    const v7 = migrate(v6);
    expect(v7.version).toBe(SAVE_VERSION);
    expect(v7.hero.quest).toBeNull();
    // Re-offer is derived from level/tier on load, so null is correct here.
  });

  it("a pre-v7 tier-2 hero has no quest", () => {
    const v7 = migrate({ version: 6, hero: { cls: "mage" as const, level: 30, xp: 0, tier: 2 as const } });
    expect(v7.hero.quest).toBeNull();
  });

  it("preserves an accepted, in-progress v7 quest (idempotent — the server won't wipe it)", () => {
    const id = classChangeQuestId("swordsman");
    const v7in = {
      version: 7,
      stage: 6,
      gold: 0,
      hero: {
        cls: "swordsman" as const,
        level: 18,
        xp: 0,
        tier: 1 as const,
        statPoints: 0,
        stats: { ...CONFIG.stats.base.swordsman },
        mana: CONFIG.mana.base,
        autoSlots: [SIGNATURE_SKILL.swordsman, null, null],
        quest: { id, accepted: true, progress: [12, 0] },
      },
      lastSeen: 0,
    };
    const out = migrate(v7in);
    expect(out.hero.quest).toEqual({ id, accepted: true, progress: [12, 0] });
    expect(migrate(out)).toEqual(out); // idempotent
  });

  it("drops a foreign / unknown quest id to null", () => {
    const out = migrate({
      version: 7,
      hero: {
        cls: "mage" as const,
        level: 18,
        xp: 0,
        tier: 1 as const,
        quest: { id: "classchange_swordsman", accepted: true, progress: [5, 0] },
      },
    });
    expect(out.hero.quest).toBeNull(); // wrong class' quest id -> re-offer
  });
});

describe("determinism with a quest in the run", () => {
  it("a byte-identical clone advances identically while a quest counts kills", () => {
    const a = initGameState(4242, soloSave("swordsman", 2));
    a.autoCast = true;
    a.heroes[0].level = GATE;
    step(a, { acceptQuest: 0 });
    expect(a.heroes[0].quest).not.toBeNull();

    // Run a real battle so the quest counts real kills, then clone mid-run.
    for (let i = 0; i < 400; i++) step(a, {});
    const b = clone(a);
    for (let i = 0; i < 2000; i++) {
      step(a, {});
      step(b, {});
    }
    expect(a.heroes[0].quest).toEqual(b.heroes[0].quest);
    expect(a.kills).toBe(b.kills);
    expect(a.rngState).toBe(b.rngState);
  });
});
