import { describe, expect, it } from "vitest";
import {
  IDLE_REVEAL_STATE,
  beatPlanFor,
  refineRevealReducer,
  type HeldRefineValues,
  type RefineRevealState,
} from "@/ui/gear/refineReveal";

const HELD_SUCCESS: HeldRefineValues = {
  outcomeKind: "success",
  refineLevel: 4,
  destroyed: false,
  fortified: false,
  materialsDelta: -12,
  goldDelta: -300,
};

const HELD_BREAK: HeldRefineValues = {
  outcomeKind: "break",
  refineLevel: 0,
  destroyed: true,
  fortified: false,
  materialsDelta: -40,
  goldDelta: -900,
};

describe("refineRevealReducer", () => {
  it("start: idle -> pending, no held value yet", () => {
    const next = refineRevealReducer(IDLE_REVEAL_STATE, { type: "start", totalBeats: 3 });
    expect(next).toEqual({ kind: "pending", totalBeats: 3, held: null, skipRequested: false });
  });

  it("beat: pending -> striking(1) when more beats remain", () => {
    const pending: RefineRevealState = { kind: "pending", totalBeats: 3, held: null, skipRequested: false };
    const next = refineRevealReducer(pending, { type: "beat" });
    expect(next).toEqual({ kind: "striking", beat: 1, totalBeats: 3, held: null, skipRequested: false });
  });

  it("beat: advances striking one at a time up to totalBeats, parking (not revealing) without a held result", () => {
    let state: RefineRevealState = { kind: "striking", beat: 1, totalBeats: 3, held: null, skipRequested: false };
    state = refineRevealReducer(state, { type: "beat" });
    expect(state).toEqual({ kind: "striking", beat: 2, totalBeats: 3, held: null, skipRequested: false });
    state = refineRevealReducer(state, { type: "beat" });
    // Final beat landed, but the network result never arrived yet — the hammer
    // is fully charged and PARKED, not revealing (nothing to show).
    expect(state).toEqual({ kind: "striking", beat: 3, totalBeats: 3, held: null, skipRequested: false });
  });

  it("beat: final beat reveals immediately if the result already landed", () => {
    const striking: RefineRevealState = {
      kind: "striking",
      beat: 2,
      totalBeats: 3,
      held: HELD_SUCCESS,
      skipRequested: false,
    };
    const next = refineRevealReducer(striking, { type: "beat" });
    expect(next).toEqual({ kind: "reveal", held: HELD_SUCCESS });
  });

  it("resultReady: mid-sequence just stashes the held value, no reveal yet", () => {
    const striking: RefineRevealState = { kind: "striking", beat: 1, totalBeats: 3, held: null, skipRequested: false };
    const next = refineRevealReducer(striking, { type: "resultReady", held: HELD_SUCCESS });
    expect(next).toEqual({ kind: "striking", beat: 1, totalBeats: 3, held: HELD_SUCCESS, skipRequested: false });
  });

  it("resultReady: reveals immediately once the hammer is already fully charged (parked at final beat)", () => {
    const parked: RefineRevealState = { kind: "striking", beat: 3, totalBeats: 3, held: null, skipRequested: false };
    const next = refineRevealReducer(parked, { type: "resultReady", held: HELD_BREAK });
    expect(next).toEqual({ kind: "reveal", held: HELD_BREAK });
  });

  it("resultReady: held-values snapshot is carried through untouched (same object, no reshaping)", () => {
    const parked: RefineRevealState = { kind: "striking", beat: 3, totalBeats: 3, held: null, skipRequested: false };
    const next = refineRevealReducer(parked, { type: "resultReady", held: HELD_SUCCESS });
    if (next.kind !== "reveal") throw new Error("expected reveal");
    expect(next.held).toBe(HELD_SUCCESS);
  });

  it("skip: during striking with no held result yet just marks intent (no reveal without an outcome)", () => {
    const striking: RefineRevealState = { kind: "striking", beat: 1, totalBeats: 3, held: null, skipRequested: false };
    const next = refineRevealReducer(striking, { type: "skip" });
    expect(next).toEqual({ kind: "striking", beat: 1, totalBeats: 3, held: null, skipRequested: true });
  });

  it("skip: a skip-marked sequence reveals as soon as the result lands, regardless of beat", () => {
    const skipMarked: RefineRevealState = {
      kind: "striking",
      beat: 1,
      totalBeats: 3,
      held: null,
      skipRequested: true,
    };
    const next = refineRevealReducer(skipMarked, { type: "resultReady", held: HELD_SUCCESS });
    expect(next).toEqual({ kind: "reveal", held: HELD_SUCCESS });
  });

  it("skip: during striking WITH an already-held result jumps straight to reveal", () => {
    const striking: RefineRevealState = {
      kind: "striking",
      beat: 1,
      totalBeats: 3,
      held: HELD_BREAK,
      skipRequested: false,
    };
    const next = refineRevealReducer(striking, { type: "skip" });
    expect(next).toEqual({ kind: "reveal", held: HELD_BREAK });
  });

  it("skip: during reveal retires it early (idle)", () => {
    const revealing: RefineRevealState = { kind: "reveal", held: HELD_SUCCESS };
    const next = refineRevealReducer(revealing, { type: "skip" });
    expect(next).toEqual({ kind: "idle" });
  });

  it("settle: reveal -> idle", () => {
    const revealing: RefineRevealState = { kind: "reveal", held: HELD_SUCCESS };
    const next = refineRevealReducer(revealing, { type: "settle" });
    expect(next).toEqual({ kind: "idle" });
  });

  it("beat/resultReady/skip are no-ops from idle (nothing armed yet)", () => {
    expect(refineRevealReducer(IDLE_REVEAL_STATE, { type: "beat" })).toEqual(IDLE_REVEAL_STATE);
    expect(refineRevealReducer(IDLE_REVEAL_STATE, { type: "resultReady", held: HELD_SUCCESS })).toEqual(
      IDLE_REVEAL_STATE,
    );
    expect(refineRevealReducer(IDLE_REVEAL_STATE, { type: "skip" })).toEqual(IDLE_REVEAL_STATE);
  });
});

describe("beatPlanFor", () => {
  it("safe/degrade bands: 3 beats, no shake", () => {
    expect(beatPlanFor("safe")).toMatchObject({ totalBeats: 3, shake: false });
    expect(beatPlanFor("degrade")).toMatchObject({ totalBeats: 3, shake: false });
  });

  it("break band (+8..+10 risk): 4 beats + shake, longer than the 3-beat bands", () => {
    const plan = beatPlanFor("break");
    expect(plan.totalBeats).toBe(4);
    expect(plan.shake).toBe(true);
    const total = plan.beatDelaysMs.reduce((a, b) => a + b, 0);
    const normalTotal = beatPlanFor("safe").beatDelaysMs.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(normalTotal);
  });

  it("fortified (guaranteed success): shortest sequence, no shake", () => {
    const plan = beatPlanFor("fortified");
    expect(plan.totalBeats).toBe(2);
    expect(plan.shake).toBe(false);
    const total = plan.beatDelaysMs.reduce((a, b) => a + b, 0);
    const normalTotal = beatPlanFor("safe").beatDelaysMs.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(normalTotal);
  });

  it("beatDelaysMs length always matches totalBeats", () => {
    (["safe", "degrade", "break", "fortified"] as const).forEach((band) => {
      const plan = beatPlanFor(band);
      expect(plan.beatDelaysMs.length).toBe(plan.totalBeats);
    });
  });
});
