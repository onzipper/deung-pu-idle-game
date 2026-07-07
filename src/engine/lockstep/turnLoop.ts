/**
 * M8 party P3 — pure LOCKSTEP turn executor (design §1). Dependency-free (engine
 * `step()` + `stateHash` only) so the future real client wraps `LockstepClient`
 * DIRECTLY: it is the exact algorithm every client runs to keep 2-3 shared-cohort
 * sims byte-identical over a "dumb" relay.
 *
 * ── The turn model (design §1) ──────────────────────────────────────────────────
 *  - A TURN is 100 ms = `SUB_STEPS_PER_TURN` (6) fixed `FIXED_DT` (1/60 s) sub-steps.
 *  - Each player emits ONE `FrameInput` lane per turn (idle players emit `{}` — an
 *    ack "I did nothing", which still lets peers advance). Lane index === party slot
 *    === hero index (canonical order on every client).
 *  - INPUT DELAY = `INPUT_DELAY_TURNS` (2): an intent ISSUED at turn T is scheduled to
 *    EXECUTE at turn `T + 2` (≈200 ms). By the time a client executes turn E, every
 *    peer's lane for E was issued at E-2 and has already arrived (unless a packet is
 *    truly late) — the sim never stalls waiting on the network under normal jitter.
 *
 * ── Sub-step input placement (contract CLARIFICATION — read this) ────────────────
 * The turn's collected lanes are applied on the FIRST sub-step ONLY; the remaining 5
 * sub-steps run all-idle (`[]`). This mirrors the SOLO client's established rule
 * (`GameClient` hands the drained input to sub-step 0, then `{}`) and is REQUIRED for
 * correctness: discrete intents are documented "applied once per drained input" —
 * feeding a turn's `allocateStat:{str:3}` to all 6 sub-steps would allocate 18 points.
 * Idempotent intents (`moveTo` re-sets the same command; `castSkills` re-blocks on
 * cooldown) are unaffected, and a `moveTo` command PERSISTS on the hero across the
 * turn's 6 sub-steps (transient hero.command isn't cleared), so the hero keeps walking
 * the whole turn. Determinism is preserved either way (all clients do the same thing);
 * this placement additionally keeps gameplay identical to solo. See the report note.
 */

import { step } from "@/engine/core/step";
import type { FrameInput } from "@/engine/core/step";
import type { GameState } from "@/engine/state";
import { stateHash } from "@/engine/lockstep/stateHash";

/** Fixed sub-steps per lockstep turn (100 ms @ FIXED_DT 1/60). */
export const SUB_STEPS_PER_TURN = 6;
/** Turn length in ms (design §1; adaptive later, engine untouched). */
export const TURN_MS = 100;
/** Input delay in turns: intent issued at T executes at T + this (design §1). */
export const INPUT_DELAY_TURNS = 2;

/** One `FrameInput` per party slot for a turn (canonical slot order). A short/absent
 *  lane is padded to idle `{}` by `step()`; an empty array = all-idle. */
export type TurnLanes = FrameInput[];

/** A single opaque relay message: player `slot` issues `input` to EXECUTE at
 *  `executeTurn` (the delay is stamped at issue time by `LockstepClient.issue`). The
 *  relay treats `input` as an opaque payload — it never parses game state. */
export interface TurnMessage {
  slot: number;
  executeTurn: number;
  input: FrameInput;
}

/**
 * Advance `state` by exactly ONE turn: 6 fixed sub-steps, the turn's `lanes` applied
 * to sub-step 0, the rest idle (see the module header for why). Pure w.r.t. inputs —
 * mutates and returns `state` (like `step`). This is the atom every client shares.
 */
export function executeTurn(state: GameState, lanes: TurnLanes): GameState {
  for (let sub = 0; sub < SUB_STEPS_PER_TURN; sub++) {
    step(state, sub === 0 ? lanes : EMPTY_LANES);
  }
  return state;
}
/** Shared all-idle lane array for sub-steps 1..5 (never mutated). */
const EMPTY_LANES: TurnLanes = [];

/**
 * Run `numTurns` turns off a per-turn input MATRIX (`lanesAt(turn) => TurnLanes`,
 * ALREADY the execute-turn schedule), collecting the post-turn `stateHash` of each
 * turn. This is the low-level driver the harness + a future replay-validator use to
 * reproduce a transcript headlessly. Turn indices are 0-based; hash `out[i]` is the
 * state AFTER turn `i` executed.
 */
export function runTurns(
  state: GameState,
  lanesAt: (turn: number) => TurnLanes,
  numTurns: number,
): number[] {
  const out: number[] = [];
  for (let t = 0; t < numTurns; t++) {
    executeTurn(state, lanesAt(t));
    out.push(stateHash(state));
  }
  return out;
}

/**
 * A single simulated client's lockstep engine — the piece a real networked client
 * wraps directly. It OWNS one `GameState`, buffers per-slot inputs keyed by their
 * EXECUTE turn, and advances turn-by-turn, recording a post-turn hash each time.
 *
 * Determinism guarantees (the whole point):
 *  - Inputs are stored by their `executeTurn`, so relay REORDERING / per-client
 *    DELIVERY DELAY are irrelevant as long as a slot's message for turn E arrives
 *    before this client executes E (the 2-turn delay is the slack that guarantees it).
 *  - A slot with no message for a turn auto-fills idle `{}` — so a turn ALWAYS has a
 *    full, canonical lane vector; two clients with the same delivered set produce the
 *    same lanes ⇒ the same `executeTurn` ⇒ the same hash.
 *
 * NOTE: soft-pause / grace / shadow-body takeover on a genuinely late packet is a
 * CLIENT-loop concern (design §9), out of scope for this determinism harness — here
 * every turn is executed once its lanes are assembled (the relay guarantees arrival).
 */
export class LockstepClient {
  readonly state: GameState;
  readonly slotCount: number;
  /** The next turn this client will execute (0-based, monotonic). */
  turn = 0;
  /** Post-turn hashes, `hashes[i]` = hash after turn `i`. */
  readonly hashes: number[] = [];
  /** executeTurn → (slot → input). A missing slot for a turn = idle `{}`. */
  private readonly buffer = new Map<number, Map<number, FrameInput>>();

  constructor(state: GameState, slotCount: number) {
    this.state = state;
    this.slotCount = slotCount;
  }

  /**
   * A player (this client's own OR a peer's, replayed identically) ISSUES `input` on
   * `slot` at issue-turn `issueTurn`; it is scheduled to execute at
   * `issueTurn + INPUT_DELAY_TURNS`. Returns the `TurnMessage` a real client would hand
   * to the relay to broadcast (with the delay already stamped).
   */
  issue(slot: number, issueTurn: number, input: FrameInput): TurnMessage {
    const executeTurn = issueTurn + INPUT_DELAY_TURNS;
    this.deliver({ slot, executeTurn, input });
    return { slot, executeTurn, input };
  }

  /**
   * Accept a relay-delivered `TurnMessage` (delay already stamped upstream by the
   * sender's `issue`). Order/timing of delivery does not matter — it is filed under
   * its `executeTurn`. A late message for an already-executed turn is dropped loudly
   * via the return flag so the caller (or a test) can assert it never happens.
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

  /** Assemble the canonical per-slot lane vector for `turn` (missing slots → idle). */
  private lanesFor(turn: number): TurnLanes {
    const lane = this.buffer.get(turn);
    const lanes: TurnLanes = new Array(this.slotCount);
    for (let s = 0; s < this.slotCount; s++) lanes[s] = lane?.get(s) ?? {};
    return lanes;
  }

  /**
   * Execute the next pending turn (`this.turn`): assemble lanes, run 6 sub-steps,
   * record + return the post-turn hash, then advance the turn counter and free the
   * consumed lane buffer. This is the client's per-turn tick.
   */
  advance(): number {
    const lanes = this.lanesFor(this.turn);
    executeTurn(this.state, lanes);
    this.buffer.delete(this.turn);
    this.turn++;
    const h = stateHash(this.state);
    this.hashes.push(h);
    return h;
  }

  /** Advance until `this.turn === targetTurn`, returning the hashes produced. */
  runTo(targetTurn: number): number[] {
    const produced: number[] = [];
    while (this.turn < targetTurn) produced.push(this.advance());
    return produced;
  }

  /** The current (pre-next-turn) state hash — the value a client stamps onto its
   *  outgoing `TurnInput` so peers can compare same-tick hashes (design §7). */
  hashNow(): number {
    return stateHash(this.state);
  }
}
