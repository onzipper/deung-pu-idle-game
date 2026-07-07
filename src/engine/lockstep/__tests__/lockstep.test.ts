import { describe, it, expect } from "vitest";
import { CONFIG, FIXED_DT, createRng, initGameState, makeHero } from "@/engine";
import type { FrameInput, GameState, HeroClass, HeroStats } from "@/engine";
import {
  INPUT_DELAY_TURNS,
  SUB_STEPS_PER_TURN,
  LockstepClient,
  stateHash,
  type TurnMessage,
} from "@/engine/lockstep";
import { soloSave } from "../../__tests__/helpers";

/**
 * M8 party P3 — headless LOCKSTEP harness. An IN-MEMORY relay drives K simulated
 * clients (2 and 3), each owning its own `GameState` built from the SAME seed +
 * progression payloads, exchanging `TurnMessage`s through a fake relay that REORDERS
 * and DELAYS delivery (seeded jitter) but preserves the per-turn total order (the
 * relay's only job). We assert per-turn `stateHash` equality across clients over long
 * runs while players issue moveTo / attackTarget / setHeroConfig / allocateStat on
 * different lanes; plus the 2-turn input delay, a mid-run join re-seed, and a
 * divergence canary (1-ULP corruption MUST be caught) — see design §§1,7.
 */

// ── cohort builders (deterministic: same seed + payloads ⇒ same state everywhere) ──

interface Progression {
  cls: HeroClass;
  level: number;
  statPoints: number;
  stats: HeroStats;
}

function prog(cls: HeroClass, level = 3, statPoints = 0): Progression {
  return { cls, level, statPoints, stats: { ...CONFIG.stats.base[cls] } };
}

/** Seat an N-hero cohort into a fresh field. Deterministic given (seed, progressions,
 *  stage) — every client calls this identically, so their states start byte-equal. */
function buildCohort(seed: number, progressions: Progression[], stage = 3): GameState {
  const s = initGameState(seed, soloSave(progressions[0].cls, stage));
  s.heroes = progressions.map((p, i) =>
    makeHero(i + 1, p.cls, p.level, 0, 1, p.statPoints, { ...p.stats }),
  );
  s.nextId = progressions.length + 1;
  return s;
}

/** A K-client cohort, each an independent LockstepClient over its own identical state. */
function makeClients(k: number, seed: number, progressions: Progression[], stage = 3): LockstepClient[] {
  return Array.from({ length: k }, () => new LockstepClient(buildCohort(seed, progressions, stage), k));
}

// ── in-memory relay: reorders + per-client delivery delay, same total order per turn ──

interface WireMsg {
  target: number;
  deliveryTurn: number;
  msg: TurnMessage;
}

/**
 * Drive `clients` for `numTurns` turns through a jittering relay. Each turn:
 *  1. deliver all wire msgs due by now, in a SEEDED-SHUFFLED order (reordering);
 *  2. each slot's owner client issues its scripted input (delay-stamped to +2 turns),
 *     broadcasting to peers with a seeded delivery delay in [0, maxDelay];
 *  3. every client executes the turn and we assert their post-turn hashes are EQUAL.
 * Returns client 0's hash trajectory (all clients agree, asserted per turn).
 */
function runRelay(
  clients: LockstepClient[],
  script: (slot: number, turn: number) => FrameInput | null,
  numTurns: number,
  jitterSeed: number,
  maxDelay = INPUT_DELAY_TURNS,
): number[] {
  const rng = createRng(jitterSeed);
  const slotCount = clients.length;
  const wire: WireMsg[] = [];
  const traj: number[] = [];

  for (let t = 0; t < numTurns; t++) {
    // 1. deliver due (shuffled — order must not matter; keyed by executeTurn)
    const due: WireMsg[] = [];
    for (let i = wire.length - 1; i >= 0; i--) {
      if (wire[i].deliveryTurn <= t) due.push(wire.splice(i, 1)[0]);
    }
    for (let i = due.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [due[i], due[j]] = [due[j], due[i]];
    }
    for (const w of due) {
      const ok = clients[w.target].deliver(w.msg);
      expect(ok).toBe(true); // never late: the 2-turn delay is the slack that guarantees it
    }

    // 2. issue this turn's scripted inputs (owner = slot index)
    for (let slot = 0; slot < slotCount; slot++) {
      const input = script(slot, t);
      if (!input) continue;
      const msg = clients[slot].issue(slot, t, input); // self-schedule + relay message
      for (let c = 0; c < slotCount; c++) {
        if (c === slot) continue;
        wire.push({ target: c, deliveryTurn: t + Math.floor(rng.next() * (maxDelay + 1)), msg });
      }
    }

    // 3. execute turn t on every client → hashes MUST match (the determinism proof)
    const hs = clients.map((c) => c.advance());
    for (let c = 1; c < slotCount; c++) expect(hs[c]).toBe(hs[0]);
    traj.push(hs[0]);
  }
  return traj;
}

/** Next representable double above `x` (a true 1-ULP bump for positive finite x). */
function ulpBump(x: number): number {
  const f = new Float64Array([x]);
  const u = new Uint32Array(f.buffer);
  if (u[0] === 0xffffffff) {
    u[0] = 0;
    u[1] = (u[1] + 1) >>> 0;
  } else {
    u[0] = (u[0] + 1) >>> 0;
  }
  return f[0];
}

const PARTY2: Progression[] = [prog("swordsman"), prog("archer")];
const PARTY3: Progression[] = [prog("swordsman"), prog("archer"), prog("mage", 3, 100)];

// A mixed intent script exercising per-lane routing (moveTo / setHeroConfig /
// allocateStat), scattered so lanes act on different turns.
function mixedScript(): (slot: number, turn: number) => FrameInput | null {
  return (slot, turn) => {
    if (turn < 3 || turn % 25 !== slot % 25) return null;
    if (slot % 3 === 0) return { moveTo: { x: 260 + (turn % 240) } };
    if (slot % 3 === 1) return { setHeroConfig: { autoHunt: (turn >> 3) % 2 === 0, autoCast: true } };
    return { allocateStat: { vit: 1 } }; // slot 2 seeded with statPoints (PARTY3)
  };
}

describe("M8 lockstep harness — turn constants match the design", () => {
  it("100ms turn = 6 sub-steps @ FIXED_DT, 2-turn input delay", () => {
    expect(SUB_STEPS_PER_TURN).toBe(6);
    expect(SUB_STEPS_PER_TURN * FIXED_DT).toBeCloseTo(0.1, 10); // 100ms turn
    expect(INPUT_DELAY_TURNS).toBe(2);
  });
});

describe("M8 lockstep — 2-client relay stays byte-identical over a long run", () => {
  it("2000 turns, reordering + delivery delay, mixed intents → per-turn hashes agree", () => {
    const clients = makeClients(2, 4242, PARTY2);
    const traj = runRelay(clients, mixedScript(), 2000, 0xc0ffee);
    expect(traj).toHaveLength(2000);
    expect(clients[0].hashes).toEqual(clients[1].hashes);
    // sanity: the sim actually MOVED (not a frozen state hashing the same value forever)
    expect(new Set(traj).size).toBeGreaterThan(50);
  });
});

describe("M8 lockstep — 3-client relay stays byte-identical over a long run", () => {
  it("1500 turns, 3 lanes, reordering + delay → all three clients agree every turn", () => {
    const clients = makeClients(3, 9001, PARTY3);
    runRelay(clients, mixedScript(), 1500, 0xbeef);
    expect(clients[1].hashes).toEqual(clients[0].hashes);
    expect(clients[2].hashes).toEqual(clients[0].hashes);
  });
});

describe("M8 lockstep — input delay buffer (issue at T executes at T+2)", () => {
  it("a moveTo issued at turn 0 has NO effect until turn 2 executes", () => {
    const c = new LockstepClient(buildCohort(77, PARTY2), 2);
    c.state.spawnPaused = true;
    c.state.enemies = []; // nothing to hunt — only a command moves the feet
    const h1 = c.state.heroes[1];
    const startX = h1.x;
    c.issue(1, 0, { moveTo: { x: startX + 300 } }); // scheduled for turn 0+2

    c.advance(); // turn 0 — input not yet due
    expect(h1.x).toBe(startX);
    expect(h1.command).toBeNull();
    c.advance(); // turn 1 — still buffered
    expect(h1.x).toBe(startX);
    expect(h1.command).toBeNull();
    c.advance(); // turn 2 — the delayed input fires
    expect(h1.command?.kind).toBe("move");
    expect(h1.x).toBeGreaterThan(startX);
  });

  it("delivery-timing JITTER within the delay budget cannot change the outcome", () => {
    // Same scripted inputs, two different relay jitter seeds → identical trajectories,
    // because a client keys inputs by executeTurn (delivery order/timing is irrelevant).
    const script = mixedScript();
    const a = runRelay(makeClients(2, 555, PARTY2), script, 400, 0x1111);
    const b = runRelay(makeClients(2, 555, PARTY2), script, 400, 0x9999);
    expect(b).toEqual(a);
  });
});

describe("M8 lockstep — mid-run join re-seeds at a boundary and hash-converges", () => {
  it("client 3 joins; all three re-seed from progression payloads and match thereafter", () => {
    // Phase 1: a 2-hero cohort runs a while, byte-identical.
    const two = makeClients(2, 314, PARTY2);
    runRelay(two, () => null, 120, 0x2222);
    expect(two[0].hashes).toEqual(two[1].hashes);

    // Phase 2: coordinated re-seed at a zone boundary (design §4 — no snapshot transfer;
    // every client rebuilds the SAME 3-hero field from the agreed seed + progression
    // payloads). Client 3 joins here.
    const reseedSeed = 0xabcd;
    const three = [0, 1, 2].map(
      () => new LockstepClient(buildCohort(reseedSeed, PARTY3), 3),
    );
    // Immediately after the re-seed, all three states are byte-equal.
    expect(three[1].hashNow()).toBe(three[0].hashNow());
    expect(three[2].hashNow()).toBe(three[0].hashNow());

    // Phase 3: run the 3-cohort — convergence holds every turn (runRelay asserts it).
    runRelay(three, mixedScript(), 600, 0x3333);
    expect(three[1].hashes).toEqual(three[0].hashes);
    expect(three[2].hashes).toEqual(three[0].hashes);
  });
});

describe("M8 lockstep — divergence canary (the hash is not blind)", () => {
  it("a 1-ULP corruption of one client's hero.x is caught within a few turns", () => {
    const clean = new LockstepClient(buildCohort(2024, PARTY2), 2);
    const dirty = new LockstepClient(buildCohort(2024, PARTY2), 2);
    // Byte-equal before tampering.
    expect(dirty.hashNow()).toBe(clean.hashNow());

    // Corrupt exactly one representable step in a HASHED float.
    const h0 = dirty.state.heroes[0];
    const before = h0.x;
    h0.x = ulpBump(h0.x);
    expect(h0.x).not.toBe(before);

    // The hash reflects the 1-ULP change IMMEDIATELY — proof it folds full precision.
    expect(dirty.hashNow()).not.toBe(clean.hashNow());

    // And it stays caught across the next few turns of identical inputs.
    let diverged = false;
    for (let t = 0; t < 5; t++) {
      const hc = clean.advance();
      const hd = dirty.advance();
      if (hc !== hd) diverged = true;
    }
    expect(diverged).toBe(true);
    expect(dirty.hashes).not.toEqual(clean.hashes);
  });

  it("corrupting the shared rngState by 1 also diverges (wave stream sensitivity)", () => {
    const clean = new LockstepClient(buildCohort(7, PARTY3), 3);
    const dirty = new LockstepClient(buildCohort(7, PARTY3), 3);
    dirty.state.rngState = (dirty.state.rngState ^ 1) >>> 0;
    expect(dirty.hashNow()).not.toBe(clean.hashNow());
  });
});

describe("M8 lockstep — stateHash excludes render transients (events + aimX)", () => {
  it("mutating state.events / hero.aimX does NOT change the hash", () => {
    const s = buildCohort(101, PARTY2);
    const h = stateHash(s);
    s.heroes[0].aimX = 12345.678; // render-only facing observer
    s.events.push({ type: "hit", x: 0, y: 0 } as unknown as GameState["events"][number]);
    expect(stateHash(s)).toBe(h);
  });
});
