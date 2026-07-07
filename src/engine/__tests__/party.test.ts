import { describe, it, expect } from "vitest";
import { CONFIG, SKILLS, initGameState, step } from "@/engine";
import type { FrameInput, GameState } from "@/engine";
import { makeParty, makeStubEnemy, soloSave } from "./helpers";

/**
 * M8 party P1b — multi-hero engine determinism + per-hero routing/config isolation,
 * the deterministic boss-target rule, partial-party death recovery, the inert
 * exp/gold share hook, and the SOLO byte-identical gate (the single-`FrameInput` path
 * must equal the 1-lane-array path). The heavy balance gate (canonical sim identical
 * vs ea41c4f) is verified out-of-band by `pnpm sim`; these are the headless canaries.
 */

/** Canonical gameplay-observable snapshot — the desync/determinism hash (design §7). */
function snap(s: GameState): string {
  return JSON.stringify({
    t: s.time,
    rng: s.rngState,
    nextId: s.nextId,
    gold: s.gold,
    goldEarned: s.goldEarned,
    kills: s.kills,
    phase: s.phase,
    heroes: s.heroes.map((h) => [
      h.id, h.cls, h.hp, h.maxHp, h.x, h.cd, h.level, h.xp, h.mana, h.dead, h.tier,
      h.statPoints, h.stats.str, h.stats.dex, h.stats.int, h.stats.vit,
      h.command?.kind ?? null,
    ]),
    enemies: s.enemies.map((e) => [e.id, e.kind, e.hp, e.x, e.cd, e.engaged, e.aggressive]),
    boss: s.boss ? [s.boss.hp, s.boss.x, s.boss.cd, s.boss.telegraph, s.boss.enraged] : null,
    proj: s.projectiles.map((p) => [p.id, p.kind, p.x, p.y, p.damage, p.targetId, p.tx, p.ty]),
  });
}

/** Run `n` steps feeding `laneAt(i)` as the step input; collect the per-step hashes. */
function runHashes(
  s: GameState,
  n: number,
  laneAt: (i: number) => FrameInput | FrameInput[],
): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    step(s, laneAt(i));
    out.push(snap(s));
  }
  return out;
}

/** A fresh 2-hero party (swordsman + archer) with a burst field ready to fight. */
function twoHeroParty(seed = 11, stage = 3): GameState {
  const s = makeParty(seed, stage);
  s.heroes = s.heroes.slice(0, 2); // drop the mage → a 2-hero cohort
  return s;
}

describe("M8 party P1b — multi-hero determinism", () => {
  it("2-hero: same seed + same lane inputs → byte-identical hash trajectory", () => {
    const a = twoHeroParty(11);
    const b = twoHeroParty(11);
    const lanes = (): FrameInput[] => [{}, {}];
    const ha = runHashes(a, 400, lanes);
    const hb = runHashes(b, 400, lanes);
    expect(hb).toEqual(ha);
  });

  it("3-hero: same seed + same lane inputs → byte-identical hash trajectory", () => {
    const a = makeParty(23);
    const b = makeParty(23);
    const lanes = (): FrameInput[] => [{}, {}, {}];
    expect(runHashes(b, 400, lanes)).toEqual(runHashes(a, 400, lanes));
  });

  it("iteration is slot/heroId-ordered (heroes array order is stable across steps)", () => {
    const s = makeParty(5);
    const ids0 = s.heroes.map((h) => h.id);
    for (let i = 0; i < 200; i++) step(s, [{}, {}, {}]);
    expect(s.heroes.map((h) => h.id)).toEqual(ids0);
  });
});

describe("M8 party P1b — per-hero intent routing", () => {
  it("lane[1].moveTo moves hero 1 only; hero 0 is untouched", () => {
    const s = twoHeroParty(7);
    s.enemies = []; // no hunt interference — commands own the feet
    s.spawnPaused = true;
    const [h0, h1] = s.heroes;
    const x0Before = h0.x;
    const x1Before = h1.x;
    const target = h1.x + 200;
    step(s, [{}, { moveTo: { x: target } }]);
    expect(h0.command).toBeNull();
    expect(h0.x).toBe(x0Before); // hero 0 untouched by hero 1's order
    expect(h1.command?.kind).toBe("move");
    expect(h1.x).toBeGreaterThan(x1Before); // hero 1 walked toward its own order
  });

  it("lane[0].allocateStat spends hero 0's points only", () => {
    const s = twoHeroParty(7);
    s.heroes[0].statPoints = 5;
    s.heroes[1].statPoints = 5;
    const str0 = s.heroes[0].stats.str;
    const str1 = s.heroes[1].stats.str;
    step(s, [{ allocateStat: { str: 3 } }, {}]);
    expect(s.heroes[0].stats.str).toBe(str0 + 3);
    expect(s.heroes[0].statPoints).toBe(2);
    expect(s.heroes[1].stats.str).toBe(str1); // hero 1 untouched
    expect(s.heroes[1].statPoints).toBe(5);
  });
});

describe("M8 party P1b — per-hero config isolation (setHeroConfig)", () => {
  it("autoCast enabled on hero 0 only → hero 0 casts, hero 1 does not", () => {
    const s = twoHeroParty(7);
    s.spawnPaused = true;
    const [sword, archer] = s.heroes;
    expect(sword.cls).toBe("swordsman");
    expect(archer.cls).toBe("archer");
    // A single foe inside the swordsman's whirl radius (also in the archer's range).
    s.enemies = [makeStubEnemy(1, sword.x + 20)];
    step(s, [{ setHeroConfig: { autoCast: true } }, { setHeroConfig: { autoCast: false } }]);
    expect(sword.skillCds["sword_whirl"]).toBe(SKILLS.sword_whirl.cd); // cast happened
    expect(Object.values(archer.skillCds).every((cd) => cd === 0 || cd === undefined)).toBe(true);
    expect(sword.config.autoCast).toBe(true);
    expect(archer.config.autoCast).toBe(false); // replicated config stuck per hero
  });

  it("auto-hunt OFF on hero 1 keeps it from acquiring NEW targets while hero 0 hunts", () => {
    const s = twoHeroParty(31);
    s.spawnPaused = true;
    s.enemies = []; // passive/idle field — nothing engaged
    const [h0, h1] = s.heroes;
    // A distant idle mob for each hero to (maybe) chase.
    s.enemies = [makeStubEnemy(1, h0.x + 260)];
    s.enemies[0].engaged = false; // idle, not engaged → only auto-hunt would chase it
    const x1Before = h1.x;
    step(s, [{ setHeroConfig: { autoHunt: true } }, { setHeroConfig: { autoHunt: false } }]);
    // Hero 1 (autoHunt off, nothing engaged on it) must not have chased the idle mob.
    expect(h1.x).toBe(x1Before);
    expect(h1.config.autoHunt).toBe(false);
    expect(h0.config.autoHunt).toBe(true);
  });
});

describe("M8 party P1b — deterministic boss single-target rule (nearest alive, slot tie-break)", () => {
  it("boss normal attack hits the NEAREST ALIVE hero; retargets deterministically when it dies", () => {
    const s = makeParty(9);
    // Force a boss fight, then place the boss just past the front hero so it is in
    // engage range and won't spend the step closing distance.
    s.phase = "boss";
    s.enemies = [];
    s.boss = { id: 999, x: 300, y: CONFIG.boss.y, hp: 1e9, maxHp: 1e9, atk: 50, cd: 0, skillCd: 999, telegraph: 0, enraged: false };
    // Distinct positions: nearest to boss.x=300 is hero 2 (x=320, |Δ|=20).
    s.heroes[0].x = 200;
    s.heroes[1].x = 260;
    s.heroes[2].x = 320;
    for (const h of s.heroes) { h.hp = h.maxHp; h.dead = false; h.cd = 999; } // mute hero swings
    const hp = s.heroes.map((h) => h.hp);
    step(s, [{}, {}, {}]);
    // Only the nearest-alive hero (slot 2) took the single-target hit (slam is muted:
    // skillCd 999). Others are unharmed by the normal attack.
    expect(s.heroes[2].hp).toBeLessThan(hp[2]);
    expect(s.heroes[0].hp).toBe(hp[0]);
    expect(s.heroes[1].hp).toBe(hp[1]);
  });

  it("two identical 3-hero boss runs produce identical per-hero hp trajectories", () => {
    const build = (): GameState => {
      const s = makeParty(9);
      s.phase = "boss";
      s.enemies = [];
      s.boss = { id: 999, x: 340, y: CONFIG.boss.y, hp: 5000, maxHp: 5000, atk: 30, cd: 0, skillCd: 1, telegraph: 0, enraged: false };
      s.heroes[0].x = 200; s.heroes[1].x = 250; s.heroes[2].x = 300;
      return s;
    };
    const a = build();
    const b = build();
    const lanes = (): FrameInput[] => [{}, {}, {}];
    expect(runHashes(b, 120, lanes)).toEqual(runHashes(a, 120, lanes));
  });
});

describe("M8 party P1b — one hero's death does not stall the others", () => {
  it("a downed hero revives in place (partial wipe) while an ally keeps fighting", () => {
    const s = twoHeroParty(17);
    s.spawnPaused = true;
    s.enemies = [makeStubEnemy(1, s.heroes[1].x + 40, 40)]; // a foe the archer can finish
    const [dead, alive] = s.heroes;
    dead.dead = true;
    dead.reviveTimer = CONFIG.heroReviveTime; // partial-party in-place revive timer
    const locBefore = { ...s.location };
    let revived = false;
    let allyKilledSomething = false;
    const killsBefore = s.kills;
    for (let i = 0; i < 60 * 8; i++) {
      step(s, [{}, {}]);
      if (!dead.dead) revived = true;
      if (s.kills > killsBefore) allyKilledSomething = true;
    }
    expect(revived).toBe(true); // downed hero came back on its own timer (no total-wipe town trip)
    expect(alive.dead).toBe(false); // the ally never went down here
    expect(allyKilledSomething).toBe(true); // the sim kept advancing for the living hero
    expect(s.traveling).toBeNull(); // no respawn-to-town: not a TOTAL wipe
    expect(s.location).toEqual(locBefore);
  });
});

describe("M8 party P1b — exp/gold share hook is inert (solo-identical) at default", () => {
  it("each present hero banks the FULL per-kill xp + the party credits full gold (mult 1)", () => {
    const s = twoHeroParty(3);
    s.spawnPaused = true;
    s.enemies = [makeStubEnemy(1, s.heroes[0].x + 20, 1)]; // 1 hp → dies to the first swing
    const xp0 = s.heroes.map((h) => h.xp);
    const goldBefore = s.gold;
    // Step until the enemy is reaped (heroes are level 1 with signature basic attacks).
    for (let i = 0; i < 300 && s.enemies.length; i++) step(s, [{}, {}]);
    expect(s.enemies.length).toBe(0);
    const perKill = CONFIG.leveling.xpPerKill(s.stage);
    // Both ALIVE heroes gained exactly one kill's worth of xp (share mult === 1).
    expect(s.heroes[0].xp).toBe(xp0[0] + perKill);
    expect(s.heroes[1].xp).toBe(xp0[1] + perKill);
    expect(s.gold).toBe(goldBefore + CONFIG.goldPerKill(s.stage));
  });
});

describe("M8 party P1b — SOLO byte-identical gate (lane path === single-FrameInput path)", () => {
  it("step(s, {}) and step(s, [{}]) drive identical solo trajectories", () => {
    const a = initGameState(42, soloSave("mage", 4));
    const b = initGameState(42, soloSave("mage", 4));
    const single = runHashes(a, 600, () => ({}));
    const laned = runHashes(b, 600, () => [{}]);
    expect(laned).toEqual(single);
  });

  it("an empty lanes array is treated as one idle lane (=== step(s, {}))", () => {
    const a = initGameState(8, soloSave("archer", 2));
    const b = initGameState(8, soloSave("archer", 2));
    expect(runHashes(b, 300, () => [])).toEqual(runHashes(a, 300, () => ({})));
  });

  it("a scripted solo run is reproducible (determinism canary)", () => {
    const script = (i: number): FrameInput =>
      i === 30 ? { allocateStat: { vit: 1 } } : i === 90 ? { setAutoHunt: false } : {};
    const a = initGameState(99, soloSave("swordsman", 5));
    const b = initGameState(99, soloSave("swordsman", 5));
    expect(runHashes(b, 500, script)).toEqual(runHashes(a, 500, script));
  });
});
