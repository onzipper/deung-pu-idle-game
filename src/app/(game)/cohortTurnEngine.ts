/**
 * M8 party P4b — the CLIENT-SIDE lockstep turn scheduler for an active cohort.
 *
 * This is the render-loop counterpart to `@/engine/lockstep`'s pure `LockstepClient`:
 * it owns the turn/sub-step CADENCE (when to issue my input, when to execute a turn's
 * sub-steps) but delegates the actual `step()` + event collection back to the caller
 * (`GameClient.frame()`) through the `CohortTickIO` seam — because the engine's own
 * `executeTurn()`/`LockstepClient.advance()` run all 6 sub-steps in a burst and leave
 * only the LAST sub-step's `state.events` on the state, which would drop 5/6 of the
 * render/audio events (see the lockstep module header). So the scheduling lives here,
 * out of the frozen engine, and stays PURE (no React/Pixi/store imports) and testable.
 *
 * ── Three bugs this replaces (the first live 2-player cohort test froze solid) ───────
 *  1. FREEZE. The old loop only executed a turn once its FULL lane set had arrived, but
 *     every client's FIRST issued `TurnMessage` is stamped `executeTurn = INPUT_DELAY_TURNS`
 *     (2) — so turns 0 and 1 could NEVER become executable (no message ever targets
 *     them) and the whole sim hung on turn 0 forever. FIX: the constructor PRE-SEEDS the
 *     buffer for turns `0..INPUT_DELAY_TURNS-1` with a FULL idle lane map (every cohort
 *     index → `{}`). Every client does this identically, so turn 0 executes immediately
 *     and deterministically everywhere. Real issued input only ever lands on turn >= 2.
 *  2. LOST TAPS. The old loop drained `pendingInput` every rAF frame but only placed it
 *     into a `TurnMessage` on the ~100ms turn boundary — ~83% of taps were discarded.
 *     FIX: `drainInput()` is called ONLY at issue boundaries (once per `TURN_MS`), so a
 *     tap accumulated in the store between boundaries is never silently dropped.
 *  3. SELF-LANE OVERWRITE. The old loop stamped `executeTurn` off the EXECUTE cursor
 *     (`cohortTurn`), which stalls when a peer lane is late — so a fresh issue could
 *     collide with an already-buffered self lane. FIX: issue is driven by its OWN
 *     monotonic `issueTurn` counter, fully decoupled from the execute cursor.
 *  4. 100ms POSITION JUMPS. The old loop ran all 6 sub-steps of a turn in one burst per
 *     100ms frame, so heroes teleported in 100ms hops (solo advances one sub-step per
 *     rAF frame and looks smooth). FIX: sub-steps are metered out by a real-dt
 *     accumulator (`execAccumMs`), typically 1-2 per rAF frame — smooth like solo.
 *
 * ── Why local scheduling can't break determinism ────────────────────────────────────
 * The engine only ever sees ASSEMBLED per-slot lane vectors, applied on sub-step 0 (the
 * remaining 5 sub-steps run all-idle `[]`, matching the solo client's established rule —
 * see the lockstep module header). Those vectors are keyed by `executeTurn`, so no matter
 * how fast/slow/bursty a given client's local rAF loop runs, every client assembles the
 * SAME lanes for the SAME turn ⇒ the same `step()` sequence ⇒ byte-identical state. This
 * scheduler only decides WHEN a client runs each already-determined sub-step; it can
 * never change WHAT gets run. Lanes are applied on sub-step 0 ONLY because discrete
 * intents are "applied once per drained input" — feeding a turn's `allocateStat` to all 6
 * sub-steps would allocate 6×.
 */

import {
  INPUT_DELAY_TURNS,
  SUB_STEPS_PER_TURN,
  TURN_MS,
  type TurnMessage,
} from "@/engine/lockstep";
import { MAX_SUBSTEPS } from "@/engine/core/loop";
import type { FrameInput } from "@/engine";

/** Real-time length of ONE lockstep sub-step (100ms / 6 ≈ 16.67ms — one `FIXED_DT`). */
export const SUB_STEP_MS = TURN_MS / SUB_STEPS_PER_TURN;

/** When a peer lane is genuinely late, the execute accumulator is clamped to at most one
 *  turn's worth of debt while stalled — so recovery on the late lane's arrival runs ONE
 *  turn's catch-up, never an unbounded burst that would teleport the field forward. */
export const STALL_DEBT_CAP_MS = TURN_MS;

/** How many consecutive fully-buffered turns must sit ahead of the execute cursor before
 *  a tick earns ONE bonus sub-step of catch-up. Keeps a small network-jitter backlog from
 *  accumulating latency without ever teleporting (one extra sub-step per tick, gentle). */
export const CATCHUP_BONUS_DEPTH = 2;

/** Wall-clock a cohort may stall at a turn boundary before the HUD shows "waiting"
 *  (design C: "late lane >~2s ⇒ waiting chip"). Moved here from GameClient.tsx. */
export const COHORT_WAITING_MS = 2_000;

/**
 * The seam between this pure scheduler and the impure `GameClient` frame loop. The
 * scheduler decides WHEN to call these; the caller owns the actual store/engine effects.
 */
export interface CohortTickIO {
  /** Drain my one-shot player intent into a `FrameInput`. Called ONLY at issue
   *  boundaries (once per `TURN_MS`), never per rAF frame — so no tap is lost. */
  drainInput(): FrameInput;
  /** Broadcast my issued `TurnMessage` to the relay. Self-delivery is handled internally
   *  (via `deliver`), so this is peers-only from the scheduler's point of view. */
  send(msg: TurnMessage): void;
  /** Run ONE sub-step: the caller does `step(state, lanes)` + collects `state.events`.
   *  `lanes` is the assembled per-slot vector on sub-step 0, and `[]` (all-idle) on the
   *  other 5 sub-steps of a turn. */
  runSubStep(lanes: FrameInput[]): void;
}

/**
 * One cohort client's turn scheduler. Constructed when a cohort ACTIVATES
 * (`GameClient.activateCohort`) and discarded on collapse-to-solo.
 */
export class CohortTurnEngine {
  /** The next turn to EXECUTE (0-based, monotonic) — the execute cursor. */
  turn = 0;
  /** Sub-step within the current turn, 0..SUB_STEPS_PER_TURN-1. Lanes apply at 0. */
  subIndex = 0;

  /** The next turn to ISSUE from (0-based, monotonic). DECOUPLED from `turn`: issuing
   *  never stalls, even while execution is paused waiting on a late peer lane. */
  private issueTurn = 0;
  /** executeTurn → (cohort index → input). A missing slot for a turn = idle `{}`. */
  private readonly buffer = new Map<number, Map<number, FrameInput>>();
  private issueAccumMs = 0;
  private execAccumMs = 0;
  /** `nowMs` at the last tick that actually ran a sub-step (for the waiting chip). */
  private lastProgressAt: number;

  /**
   * Cohort indexes whose owner is SHADOWED (socket dead / hidden tab / left the zone):
   * the scheduler STOPS waiting for their lanes and auto-fills `{}` when assembling a
   * turn (fix A.1 — a shadowed member's paused rAF would otherwise stall the whole
   * cohort forever). CONTENT determinism holds: a shadowed member sends nothing (its
   * client has collapsed to solo on disconnect), so every peer auto-fills the IDENTICAL
   * `{}` — only WHEN each peer unblocks differs, never WHAT executes. And a REAL lane
   * that DID arrive before the shadow (every peer received it via the single ordered
   * relay stream) is always preferred over the auto-fill (see the assembly below), so
   * the edge "shadow arrived after the member's last send" stays deterministic too.
   */
  private readonly shadowedIndexes = new Set<number>();

  constructor(
    private readonly cohortSize: number,
    private readonly myIndex: number,
    nowMs: number,
  ) {
    this.lastProgressAt = nowMs;
    // PRE-SEED turns 0..INPUT_DELAY_TURNS-1 with a FULL idle lane map so they execute
    // immediately and identically on every client — the fix for the total-freeze bug
    // (no real message ever targets these turns; see the module header).
    for (let t = 0; t < INPUT_DELAY_TURNS; t++) {
      const lane = new Map<number, FrameInput>();
      for (let i = 0; i < cohortSize; i++) lane.set(i, {});
      this.buffer.set(t, lane);
    }
  }

  /**
   * File a relay-delivered `TurnMessage` under its `executeTurn` (order/timing of
   * delivery is irrelevant — the 2-turn input delay is the slack that guarantees a
   * lane arrives before its turn executes). Returns `false` for a message whose turn
   * has already run (dropped) so the caller can assert it never happens.
   */
  deliver(msg: TurnMessage): boolean {
    if (msg.executeTurn < this.turn) return false; // too late — turn already ran
    let lane = this.buffer.get(msg.executeTurn);
    if (!lane) {
      lane = new Map();
      this.buffer.set(msg.executeTurn, lane);
    }
    lane.set(msg.slot, msg.input);
    return true;
  }

  /**
   * Mark/unmark a cohort index as SHADOWED (see `shadowedIndexes`). Called by GameClient
   * when the relay reports a member shadowed/unshadowed. Un-shadowing makes the scheduler
   * wait for that index's REAL lanes again from the next unexecuted turn onward.
   */
  setSlotShadowed(index: number, shadowed: boolean): void {
    if (shadowed) this.shadowedIndexes.add(index);
    else this.shadowedIndexes.delete(index);
  }

  /** A turn's lane set is COMPLETE once every NON-shadowed index has a real delivered
   *  lane — shadowed indexes are auto-filled `{}` at assembly, so they never block. */
  private laneComplete(lane: Map<number, FrameInput> | undefined): boolean {
    for (let i = 0; i < this.cohortSize; i++) {
      if (this.shadowedIndexes.has(i)) continue;
      if (!lane?.has(i)) return false;
    }
    return true;
  }

  /** Count consecutive fully-buffered (completeness-checked) turns from the execute cursor. */
  private bufferedAhead(): number {
    let n = 0;
    let t = this.turn;
    while (this.laneComplete(this.buffer.get(t))) {
      n++;
      t++;
    }
    return n;
  }

  /**
   * Advance the scheduler by `elapsedMs` of real wall time (`nowMs` = the same clock).
   * Runs the ISSUE phase (emit my lane at each turn boundary) then the EXECUTE phase
   * (meter out sub-steps of already-full turns), and reports whether the HUD should
   * show the "waiting" chip.
   */
  tick(elapsedMs: number, nowMs: number, io: CohortTickIO): { waiting: boolean } {
    // ── ISSUE ── emit my lane once per turn boundary, scheduled INPUT_DELAY_TURNS ahead.
    // A long frame that crosses two boundaries drains twice: the second drain naturally
    // returns an idle-ish input (the store emptied on the first) — no `issuedMine` flag.
    this.issueAccumMs += elapsedMs;
    while (this.issueAccumMs >= TURN_MS) {
      this.issueAccumMs -= TURN_MS;
      const input = io.drainInput();
      const msg: TurnMessage = {
        slot: this.myIndex,
        executeTurn: this.issueTurn + INPUT_DELAY_TURNS,
        input,
      };
      this.deliver(msg); // self-deliver immediately — never wait on the relay echo
      io.send(msg);
      this.issueTurn++;
    }

    // ── EXECUTE ── meter sub-steps out on real time so motion is smooth (not a 100ms burst).
    this.execAccumMs += elapsedMs;
    // Gentle catch-up: a backlog of ready turns earns exactly ONE bonus sub-step this tick.
    if (this.bufferedAhead() >= CATCHUP_BONUS_DEPTH) this.execAccumMs += SUB_STEP_MS;

    let stalledAtBoundary = false;
    let iterations = 0;
    while (this.execAccumMs >= SUB_STEP_MS && iterations < MAX_SUBSTEPS) {
      iterations++;
      if (this.subIndex === 0) {
        const lane = this.buffer.get(this.turn);
        if (!this.laneComplete(lane)) {
          // STALL: a NON-shadowed lane hasn't fully arrived. NEVER treat a missing lane as
          // idle (that would corrupt the slow peer's real next input) — pause and clamp the
          // debt so recovery is bounded to one turn's catch-up. Shadowed indexes never gate
          // here (they auto-fill below), so a hidden/dead member can't freeze the cohort.
          this.execAccumMs = Math.min(this.execAccumMs, STALL_DEBT_CAP_MS);
          stalledAtBoundary = true;
          break;
        }
        const lanes: FrameInput[] = new Array(this.cohortSize);
        // Prefer a REAL delivered lane for every index — including a shadowed index whose
        // last send landed before the shadow (every peer received it via the one ordered
        // stream). Only a shadowed index with NO delivered lane auto-fills `{}`.
        for (let i = 0; i < this.cohortSize; i++) lanes[i] = lane?.get(i) ?? {};
        io.runSubStep(lanes); // lanes apply on sub-step 0 ONLY
      } else {
        io.runSubStep([]); // sub-steps 1..5 are all-idle
      }
      this.execAccumMs -= SUB_STEP_MS;
      this.subIndex++;
      this.lastProgressAt = nowMs;
      if (this.subIndex >= SUB_STEPS_PER_TURN) {
        this.buffer.delete(this.turn);
        this.turn++;
        this.subIndex = 0;
      }
    }

    return {
      waiting: stalledAtBoundary && nowMs - this.lastProgressAt > COHORT_WAITING_MS,
    };
  }
}
