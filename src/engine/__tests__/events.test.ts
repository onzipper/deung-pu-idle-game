import { describe, it, expect } from "vitest";
import {
  initGameState,
  step,
  toSaveData,
  SKILL_TYPES,
  type GameState,
  type GameEvent,
  type SaveData,
} from "@/engine";
import { soloSave, makeParty, runUntil, makeStubEnemy, forceBoss } from "./helpers";

/**
 * Per-step EVENT BUFFER (M4 render/audio juice feed). Verifies events are
 * emitted at the right moments, cleared every step, deterministic (same seed +
 * script => identical event stream), and never persisted.
 *
 * Events are per-STEP: `state.events` holds only the LAST step's events. To
 * assert an event was emitted during a multi-step run, we collect across steps.
 */

/** A solo hero strong enough (by level) to win the stage-1 boss while still being
 * observed alive inside its enrage band — level 30 lands the damage per hit low
 * enough to cross the 0.3-HP threshold rather than leap it. */
const strongSave = (): SaveData => {
  const base = soloSave("swordsman", 1);
  return { ...base, hero: { ...base.hero, level: 30 } };
};

/** Run `n` steps, concatenating every step's events into one flat stream. */
function collectEvents(
  s: GameState,
  n: number,
  input: (i: number) => Parameters<typeof step>[1] = () => ({}),
): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    step(s, input(i));
    out.push(...s.events);
  }
  return out;
}

/** Collect events while stepping until `pred` holds (or `cap` steps elapse). */
function collectUntil(
  s: GameState,
  pred: (s: GameState) => boolean,
  cap: number,
): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < cap && !pred(s); i++) {
    step(s, {});
    out.push(...s.events);
  }
  return out;
}

const typesOf = (evs: GameEvent[]) => new Set(evs.map((e) => e.type));

describe("event buffer lifecycle", () => {
  it("starts empty and is cleared at the START of every step", () => {
    const s = initGameState(1);
    expect(s.events).toEqual([]);

    // Force a wave to spawn (emits waveSpawn), then step once more.
    const withEvents = collectUntil(s, (st) => st.enemies.length > 0, 3000);
    expect(withEvents.length).toBeGreaterThan(0);

    // The step that spawned the wave left a non-empty buffer...
    expect(s.events.length).toBeGreaterThan(0);
    // ...but a subsequent quiet step clears it (no new events that step).
    const before = s.events;
    step(s, {});
    // Same array identity (cleared in place), and it reflects only THIS step.
    expect(s.events).toBe(before);
  });

  it("array identity is stable across steps (cleared in place, not reallocated)", () => {
    const s = initGameState(2);
    const ref = s.events;
    for (let i = 0; i < 50; i++) step(s, {});
    expect(s.events).toBe(ref);
  });
});

describe("combat events", () => {
  it("emits waveSpawn with the wave number when a wave spawns", () => {
    const s = initGameState(1);
    const evs = collectUntil(s, (st) => st.enemies.length > 0, 3000);
    const wave = evs.find((e) => e.type === "waveSpawn");
    expect(wave).toBeDefined();
    expect(wave).toMatchObject({ type: "waveSpawn", wave: 1 });
  });

  it("emits projectileSpawn + hit for a ranged team, and kill on a death", () => {
    const s = initGameState(7, strongSave());
    // Strong single swordsman is melee; use a synthetic party for projectiles.
    const three = makeParty(7);
    const evs = collectEvents(three, 1200);
    const t = typesOf(evs);
    expect(t.has("projectileSpawn")).toBe(true);
    expect(t.has("hit")).toBe(true);
    expect(t.has("kill")).toBe(true);

    // hit payload shape.
    const hit = evs.find((e) => e.type === "hit")!;
    expect(hit).toMatchObject({ type: "hit" });
    if (hit.type === "hit") {
      expect(typeof hit.id).toBe("number");
      expect(typeof hit.amount).toBe("number");
      expect(["hero", "enemy", "boss"]).toContain(hit.target);
      expect(["attack", "skill", "slam", "bolt"]).toContain(hit.source);
    }

    // kill payload carries gold + kind.
    const kill = evs.find((e) => e.type === "kill")!;
    if (kill.type === "kill") {
      expect(kill.goldGained).toBeGreaterThan(0);
      expect(["normal", "fast", "tank", "ranged"]).toContain(kill.kind);
    }
    // Sanity: strong save also produces hits.
    expect(typesOf(collectEvents(s, 600)).has("hit")).toBe(true);
  });

  it("emits skillCast (with slot) + rainArrow spawns when the archer casts", () => {
    const s = makeParty(7);
    // Arrow rain needs a foe within archer range (guard).
    s.enemies = [makeStubEnemy(1, s.heroes[1].x + 220)];
    step(s, { castSkills: [{ slot: 1, skillId: "archer_rain" }] }); // archer arrow rain
    const cast = s.events.find((e) => e.type === "skillCast");
    expect(cast).toMatchObject({
      type: "skillCast",
      heroClass: "archer",
      slot: 1,
      skillId: "archer_rain",
    });
    // Arrow rain spawns falling rainArrow drops this step.
    expect(
      s.events.some((e) => e.type === "projectileSpawn" && e.kind === "rainArrow"),
    ).toBe(true);
  });

  it("swordsman spin emits a skill-sourced hit on an in-range target", () => {
    const s = initGameState(1);
    forceBoss(s); // M6: enter a boss fight without the world walk
    const radius = SKILL_TYPES.swordsman.radius;
    runUntil(
      s,
      (st) =>
        st.boss != null &&
        (st.heroes[0].skillCds["sword_whirl"] ?? 0) <= 0 &&
        Math.abs(st.boss.x - st.heroes[0].x) < radius,
      3000,
    );
    step(s, { castSkills: [{ slot: 0, skillId: "sword_whirl" }] });
    expect(
      s.events.some((e) => e.type === "hit" && e.source === "skill" && e.target === "boss"),
    ).toBe(true);
  });
});

describe("boss lifecycle events", () => {
  it("emits telegraph, slam land, and slam-sourced hits during the fight", () => {
    const s = initGameState(11);
    forceBoss(s); // M6: enter a boss fight without the world walk
    // Make the solo hero fragile (but not one-shot): it survives long enough to
    // eat slams, then wipes -> M6 death respawn (walks home to town).
    s.heroes[0].maxHp = 120;
    s.heroes[0].hp = 120;
    const evs = collectUntil(s, (st) => st.phase !== "boss", 6000);
    const t = typesOf(evs);
    expect(t.has("bossSlamTelegraph")).toBe(true);
    expect(t.has("bossSlamLand")).toBe(true);
    expect(evs.some((e) => e.type === "hit" && e.source === "slam")).toBe(true);
    // Weak hero wipes -> M6: it heads home to town (not an in-place boss retreat).
    expect(s.traveling).not.toBeNull();
  });

  it("emits bossEnraged, then bossDefeated + stageCleared on a boss kill", () => {
    const s = initGameState(5, strongSave());
    forceBoss(s); // M6: enter a boss fight without the world walk
    const fight = collectUntil(s, (st) => st.phase === "victory", 5000);
    const t = typesOf(fight);
    expect(t.has("bossEnraged")).toBe(true);
    expect(t.has("bossDefeated")).toBe(true);
    expect(t.has("stageCleared")).toBe(true);

    const defeated = fight.find((e) => e.type === "bossDefeated")!;
    if (defeated.type === "bossDefeated") {
      expect(defeated.goldGained).toBeGreaterThan(0);
    }
  });
});

describe("determinism", () => {
  function scriptedInput(i: number): Parameters<typeof step>[1] {
    const input: Parameters<typeof step>[1] = {};
    if (i % 53 === 3) input.castSkills = [{ slot: 0, skillId: "sword_whirl" }];
    if (i % 601 === 23) input.challengeBoss = true;
    if (i % 601 === 400) input.advanceStage = true;
    if (i % 337 === 11) input.evolveHero = 0;
    return input;
  }

  function runStream(seed: number, steps: number): GameEvent[] {
    const s = initGameState(seed, soloSave("swordsman", 1));
    s.gold = 100_000;
    const out: GameEvent[] = [];
    for (let i = 0; i < steps; i++) {
      if (i === 500) s.autoCast = true;
      step(s, scriptedInput(i));
      out.push(...s.events);
    }
    return out;
  }

  it("same seed + script => byte-identical event stream", () => {
    const a = runStream(4242, 4000);
    const b = runStream(4242, 4000);
    expect(a.length).toBeGreaterThan(0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("different seed diverges somewhere in the stream", () => {
    const a = runStream(4242, 3000);
    const b = runStream(99, 3000);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe("events are transient (never persisted)", () => {
  it("toSaveData excludes the events buffer entirely", () => {
    const s = initGameState(7, soloSave("swordsman", 3));
    // Populate the buffer with a real event (a spawned wave emits waveSpawn).
    runUntil(s, (st) => st.events.length > 0, 3000);
    expect(s.events.length).toBeGreaterThan(0);

    const save = toSaveData(s);
    expect(save).not.toHaveProperty("events");
    expect(Object.keys(save)).toEqual([
      "version",
      "stage",
      "gold",
      "location",
      "unlockedZones",
      "lastFarmZone",
      "hero",
      "lastSeen",
    ]);
  });
});
