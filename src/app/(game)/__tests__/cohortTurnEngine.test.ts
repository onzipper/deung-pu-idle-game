import { describe, expect, it } from "vitest";
import type { FrameInput } from "@/engine";
import { INPUT_DELAY_TURNS, SUB_STEPS_PER_TURN, TURN_MS, type TurnMessage } from "@/engine/lockstep";
import {
  CATCHUP_BONUS_DEPTH,
  CohortTurnEngine,
  COHORT_WAITING_MS,
  STALL_DEBT_CAP_MS,
  SUB_STEP_MS,
  type CohortTickIO,
} from "../cohortTurnEngine";

// ── Fake IO recorder ────────────────────────────────────────────────────────────────
// Mirrors partySession.test.ts's style: a hand-driven harness with recorded outputs and
// a scripted `drainInput`, ticked with hand-advanced `nowMs`. No real socket/engine.

interface Recorder {
  io: CohortTickIO;
  sent: TurnMessage[];
  subSteps: FrameInput[][]; // each runSubStep's `lanes` argument
  drainCalls: number;
}

function makeRecorder(
  script: (call: number) => FrameInput,
  onSend?: (msg: TurnMessage) => void,
): Recorder {
  const sent: TurnMessage[] = [];
  const subSteps: FrameInput[][] = [];
  const rec: Recorder = {
    sent,
    subSteps,
    drainCalls: 0,
    io: {
      drainInput: () => script(rec.drainCalls++),
      send: (msg) => {
        sent.push(msg);
        onSend?.(msg);
      },
      runSubStep: (lanes) => subSteps.push(lanes),
    },
  };
  return rec;
}

const idle = (): FrameInput => ({});

// ── (1)(2) pre-seed unfreeze + cross-wired lane sequences deep-equal ─────────────────

describe("CohortTurnEngine pre-seed unfreeze (the total-freeze bug)", () => {
  it("two cross-wired engines both advance past turn 0 and match lane sequences", () => {
    // Cross-wire: each engine's send is delivered to the OTHER; self-delivery is internal.
    // (Recorders are declared first; their `send` closures reference the engines lazily.)
    // Distinct scripted inputs per slot so we'd notice any lane mixing.
    const scriptA = (n: number): FrameInput => ({ moveTo: { x: 100 + n } });
    const scriptB = (n: number): FrameInput => ({ moveTo: { x: 900 + n } });
    const recA = makeRecorder(scriptA, (m) => engB.deliver(m));
    const recB = makeRecorder(scriptB, (m) => engA.deliver(m));
    const engA = new CohortTurnEngine(2, 0, 0);
    const engB = new CohortTurnEngine(2, 1, 0);

    // Tick BOTH by one 16ms step per loop iteration (interleaved) for 400ms.
    let now = 0;
    for (let t = 0; t < 25; t++) {
      now += 16;
      engA.tick(16, now, recA.io);
      engB.tick(16, now, recB.io);
    }

    expect(engA.turn).toBeGreaterThan(0);
    expect(engB.turn).toBeGreaterThan(0);
    expect(recA.subSteps.length).toBeGreaterThan(0);
    expect(recB.subSteps.length).toBeGreaterThan(0);
    // Both clients executed the SAME assembled lanes in the SAME order (determinism).
    const n = Math.min(recA.subSteps.length, recB.subSteps.length);
    expect(recA.subSteps.slice(0, n)).toEqual(recB.subSteps.slice(0, n));
    // Sub-step 0 of turn 0 is the pre-seeded all-idle vector on BOTH.
    expect(recA.subSteps[0]).toEqual([{}, {}]);
  });
});

// ── (3) drainInput cadence: once per ~100ms, not per frame ───────────────────────────

describe("CohortTurnEngine issue cadence", () => {
  it("drains input ~once per 100ms across 60 x 16ms ticks (not per frame)", () => {
    const rec = makeRecorder(idle);
    const eng = new CohortTurnEngine(2, 0, 0);
    let now = 0;
    for (let t = 0; t < 60; t++) {
      now += 16;
      eng.tick(16, now, rec.io);
    }
    // 60 * 16 = 960ms -> 9 full 100ms boundaries.
    expect(rec.drainCalls).toBeGreaterThanOrEqual(9);
    expect(rec.drainCalls).toBeLessThanOrEqual(10);
  });

  it("(4) one 250ms tick issues 2 messages with consecutive executeTurns, 2nd drains fresh", () => {
    const seen: number[] = [];
    const rec = makeRecorder((n) => {
      seen.push(n);
      return { moveTo: { x: n } };
    });
    const eng = new CohortTurnEngine(2, 0, 0);
    eng.tick(250, 250, rec.io);
    expect(rec.sent.length).toBe(2);
    expect(rec.sent[0].executeTurn).toBe(0 + INPUT_DELAY_TURNS);
    expect(rec.sent[1].executeTurn).toBe(1 + INPUT_DELAY_TURNS);
    // Second issue drained a FRESH input (call index 1).
    expect(rec.sent[1].input).toEqual({ moveTo: { x: 1 } });
    expect(seen).toEqual([0, 1]);
  });
});

// ── (5) no 6-burst: steady ticks run <= 2 sub-steps each ─────────────────────────────

describe("CohortTurnEngine smooth execution (no 100ms burst)", () => {
  it("steady ~16.7ms ticks run at most 2 sub-steps per tick", () => {
    const recA = makeRecorder(idle, (m) => engB.deliver(m));
    const recB = makeRecorder(idle, (m) => engA.deliver(m));
    const engA = new CohortTurnEngine(2, 0, 0);
    const engB = new CohortTurnEngine(2, 1, 0);
    let now = 0;
    let maxPerTick = 0;
    for (let t = 0; t < 120; t++) {
      now += SUB_STEP_MS;
      const before = recA.subSteps.length;
      engA.tick(SUB_STEP_MS, now, recA.io);
      engB.tick(SUB_STEP_MS, now, recB.io);
      maxPerTick = Math.max(maxPerTick, recA.subSteps.length - before);
    }
    expect(maxPerTick).toBeLessThanOrEqual(2);
    expect(maxPerTick).toBeGreaterThan(0);
  });
});

// ── (6) withheld peer lane -> stall, then bounded recovery ────────────────────────────

describe("CohortTurnEngine stall + bounded recovery", () => {
  it("a withheld peer lane stalls execution; on arrival recovery is debt-capped", () => {
    const rec = makeRecorder(idle);
    const eng = new CohortTurnEngine(2, 0, 0); // cohort of 2, but slot 1 never arrives
    // Advance past the pre-seeded turns 0..1 (fully idle-buffered) so we sit at turn 2
    // waiting on the missing slot-1 lane. Give it plenty of time.
    let now = 0;
    for (let t = 0; t < 40; t++) {
      now += SUB_STEP_MS;
      eng.tick(SUB_STEP_MS, now, rec.io);
    }
    // Executed exactly the 2 pre-seeded turns (12 sub-steps), then stuck at turn 2.
    expect(eng.turn).toBe(INPUT_DELAY_TURNS);
    const afterStall = rec.subSteps.length;
    expect(afterStall).toBe(INPUT_DELAY_TURNS * SUB_STEPS_PER_TURN);

    // The missing slot-1 lane finally arrives for turn 2.
    eng.deliver({ slot: 1, executeTurn: 2, input: {} });
    const before = rec.subSteps.length;
    now += SUB_STEP_MS;
    eng.tick(SUB_STEP_MS, now, rec.io);
    const ran = rec.subSteps.length - before;
    // Debt was clamped to STALL_DEBT_CAP_MS while stalled -> bounded catch-up.
    expect(ran).toBeGreaterThan(0);
    expect(ran).toBeLessThanOrEqual(STALL_DEBT_CAP_MS / SUB_STEP_MS + 1);
  });
});

// ── (7) backlog catch-up + long-run cadence averages TURN_MS/turn ────────────────────

describe("CohortTurnEngine catch-up + long-run cadence", () => {
  it("drains a pre-delivered backlog and averages ~TURN_MS per turn over a long run", () => {
    const rec = makeRecorder(idle);
    const eng = new CohortTurnEngine(2, 0, 0);
    // Pre-deliver slot-1 lanes far ahead (slot 0 self-delivers via issue). A fully
    // pre-buffered peer means execution is gated by real-time cadence, not by lanes —
    // the catch-up bonus keeps a jitter backlog from accumulating latency.
    for (let turn = INPUT_DELAY_TURNS; turn < 200; turn++) {
      eng.deliver({ slot: 1, executeTurn: turn, input: {} });
    }
    let now = 0;
    for (let t = 0; t < 400; t++) {
      now += SUB_STEP_MS;
      eng.tick(SUB_STEP_MS, now, rec.io);
    }
    // 400 * SUB_STEP_MS of real time -> ~400/6 turns if cadence holds ~TURN_MS/turn.
    const elapsedMs = 400 * SUB_STEP_MS;
    const expectedTurns = elapsedMs / TURN_MS;
    // A generous band: confirms it drains substantially AND never runs away (no teleport).
    expect(eng.turn).toBeGreaterThanOrEqual(Math.floor(expectedTurns * 0.8));
    expect(eng.turn).toBeLessThanOrEqual(Math.ceil(expectedTurns * 1.4) + 2);
  });
});

// ── (8) waiting flips only after COHORT_WAITING_MS, clears on resume ──────────────────

describe("CohortTurnEngine waiting flag", () => {
  it("waiting stays false before the stall threshold, flips after, and clears on resume", () => {
    const rec = makeRecorder(idle);
    const eng = new CohortTurnEngine(2, 0, 0); // slot 1 withheld
    // Consume the pre-seeded turns first.
    let now = 0;
    for (let t = 0; t < 20; t++) {
      now += SUB_STEP_MS;
      const { waiting } = eng.tick(SUB_STEP_MS, now, rec.io);
      expect(waiting).toBe(false); // lastProgressAt is recent -> not yet "waiting"
    }
    // Now stall for well over COHORT_WAITING_MS of wall time (no sub-step runs).
    let sawWaiting = false;
    for (let t = 0; t < 40; t++) {
      now += 100;
      const { waiting } = eng.tick(100, now, rec.io);
      if (now - 0 > COHORT_WAITING_MS) sawWaiting ||= waiting;
    }
    expect(sawWaiting).toBe(true);
    // Deliver the missing lane -> resumes -> waiting clears.
    eng.deliver({ slot: 1, executeTurn: INPUT_DELAY_TURNS, input: {} });
    now += 100;
    const res = eng.tick(100, now, rec.io);
    expect(res.waiting).toBe(false);
  });
});

// ── (9) deliver drops a message whose turn already ran ────────────────────────────────

describe("CohortTurnEngine deliver drop-late", () => {
  it("returns false and drops a message for an already-executed turn", () => {
    // Cross-wire so turns actually advance.
    const recA = makeRecorder(idle, (m) => engB.deliver(m));
    const recB = makeRecorder(idle, (m) => engA.deliver(m));
    const engA = new CohortTurnEngine(2, 0, 0);
    const engB = new CohortTurnEngine(2, 1, 0);
    let now = 0;
    for (let t = 0; t < 60; t++) {
      now += SUB_STEP_MS;
      engA.tick(SUB_STEP_MS, now, recA.io);
      engB.tick(SUB_STEP_MS, now, recB.io);
    }
    expect(engA.turn).toBeGreaterThan(0);
    // A late message for turn 0 (long since executed) is dropped.
    expect(engA.deliver({ slot: 1, executeTurn: 0, input: {} })).toBe(false);
    // A message for the current cursor is still accepted.
    expect(engA.deliver({ slot: 1, executeTurn: engA.turn, input: {} })).toBe(true);
  });
});

// ── (10) issue continues during an execution stall (strictly increasing executeTurns) ─

describe("CohortTurnEngine issue continues during a stall", () => {
  it("keeps issuing my lane with strictly increasing executeTurns while execution is stalled", () => {
    const rec = makeRecorder(idle);
    const eng = new CohortTurnEngine(2, 0, 0); // slot 1 withheld -> execution stalls at turn 2
    let now = 0;
    for (let t = 0; t < 30; t++) {
      now += 50; // 30 * 50ms = 1500ms -> 15 issue boundaries
      eng.tick(50, now, rec.io);
    }
    expect(rec.sent.length).toBeGreaterThanOrEqual(14);
    for (let i = 1; i < rec.sent.length; i++) {
      expect(rec.sent[i].executeTurn).toBe(rec.sent[i - 1].executeTurn + 1);
    }
    expect(rec.sent.every((m) => m.slot === 0)).toBe(true);
    // Execution never advanced past the pre-seeded turns (peer lane never arrived).
    expect(eng.turn).toBe(INPUT_DELAY_TURNS);
    expect(CATCHUP_BONUS_DEPTH).toBeGreaterThan(0); // referenced for coverage of the export
  });
});

// ── (11) shadowed-slot auto-fill (fix A.1) ────────────────────────────────────────────

describe("CohortTurnEngine shadowed-slot auto-fill (fix A.1)", () => {
  it("a never-sending index stalls both peers until shadowed, then both advance with {} auto-fill", () => {
    // Distinct scripts per live slot so any lane mixing would show; slot 2 has NO engine
    // (its owner's tab is hidden / socket dead) -> it never delivers a lane.
    const scriptA = (n: number): FrameInput => ({ moveTo: { x: 100 + n } });
    const scriptB = (n: number): FrameInput => ({ moveTo: { x: 900 + n } });
    const recA = makeRecorder(scriptA, (m) => engB.deliver(m));
    const recB = makeRecorder(scriptB, (m) => engA.deliver(m));
    const engA = new CohortTurnEngine(3, 0, 0);
    const engB = new CohortTurnEngine(3, 1, 0);

    let now = 0;
    const tickBoth = (n: number) => {
      for (let t = 0; t < n; t++) {
        now += SUB_STEP_MS;
        engA.tick(SUB_STEP_MS, now, recA.io);
        engB.tick(SUB_STEP_MS, now, recB.io);
      }
    };

    tickBoth(60);
    // Both stall at the first non-preseeded turn: slot 2's lane never arrives.
    expect(engA.turn).toBe(INPUT_DELAY_TURNS);
    expect(engB.turn).toBe(INPUT_DELAY_TURNS);

    engA.setSlotShadowed(2, true);
    engB.setSlotShadowed(2, true);
    tickBoth(60);

    // Both unblock and advance now that slot 2's lane is auto-filled.
    expect(engA.turn).toBeGreaterThan(INPUT_DELAY_TURNS);
    expect(engB.turn).toBeGreaterThan(INPUT_DELAY_TURNS);
    // Same assembled lanes in the same order on BOTH clients (content determinism).
    const n = Math.min(recA.subSteps.length, recB.subSteps.length);
    expect(recA.subSteps.slice(0, n)).toEqual(recB.subSteps.slice(0, n));
    // Every sub-step-0 lane vector (length 3) auto-fills index 2 as idle {}.
    for (const lanes of recA.subSteps) {
      if (lanes.length === 3) expect(lanes[2]).toEqual({});
    }
  });

  it("prefers a REAL delivered lane for a shadowed index over the {} auto-fill", () => {
    const recA = makeRecorder(idle, (m) => engB.deliver(m));
    const recB = makeRecorder(idle, (m) => engA.deliver(m));
    const engA = new CohortTurnEngine(3, 0, 0);
    const engB = new CohortTurnEngine(3, 1, 0);
    // Slot 2 delivered a distinctive REAL lane for turn INPUT_DELAY to BOTH peers (every
    // client gets the same relay-ordered send) and THEN went shadowed — later turns have
    // no slot-2 lane, so they auto-fill {}.
    const realLane: FrameInput = { moveTo: { x: 222 } };
    engA.deliver({ slot: 2, executeTurn: INPUT_DELAY_TURNS, input: realLane });
    engB.deliver({ slot: 2, executeTurn: INPUT_DELAY_TURNS, input: realLane });
    engA.setSlotShadowed(2, true);
    engB.setSlotShadowed(2, true);

    let now = 0;
    for (let t = 0; t < 60; t++) {
      now += SUB_STEP_MS;
      engA.tick(SUB_STEP_MS, now, recA.io);
      engB.tick(SUB_STEP_MS, now, recB.io);
    }

    // Turn INPUT_DELAY's sub-step-0 vector uses the REAL lane (not {}).
    const atT = recA.subSteps[INPUT_DELAY_TURNS * SUB_STEPS_PER_TURN];
    expect(atT[2]).toEqual(realLane);
    // A later turn with no delivered slot-2 lane auto-fills {}.
    const later = recA.subSteps[(INPUT_DELAY_TURNS + 1) * SUB_STEPS_PER_TURN];
    expect(later[2]).toEqual({});
    // Determinism holds across the preference + auto-fill mix.
    const n = Math.min(recA.subSteps.length, recB.subSteps.length);
    expect(recA.subSteps.slice(0, n)).toEqual(recB.subSteps.slice(0, n));
  });

  it("un-shadowing makes the scheduler wait for that index's REAL lanes again", () => {
    const rec = makeRecorder(idle);
    const eng = new CohortTurnEngine(3, 0, 0);
    // Slots 1 and 2 shadowed from the start -> only slot 0 (self-delivered) is required,
    // so execution runs freely on real-time cadence.
    eng.setSlotShadowed(1, true);
    eng.setSlotShadowed(2, true);
    let now = 0;
    const tick = (n: number) => {
      for (let t = 0; t < n; t++) {
        now += SUB_STEP_MS;
        eng.tick(SUB_STEP_MS, now, rec.io);
      }
    };
    tick(60);
    const advanced = eng.turn;
    expect(advanced).toBeGreaterThan(INPUT_DELAY_TURNS);

    // Un-shadow slot 1: it now needs slot 1's real lane again, which never arrives. Any
    // turn already IN FLIGHT (subIndex>0) finishes its no-lane sub-steps first (at most one
    // more turn), then execution FREEZES — it never advances thereafter.
    eng.setSlotShadowed(1, false);
    tick(60);
    const stalledAt = eng.turn;
    expect(stalledAt).toBeLessThanOrEqual(advanced + 1);
    tick(60);
    expect(eng.turn).toBe(stalledAt); // frozen: slot 1's real lane never comes
  });
});
