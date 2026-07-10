/**
 * Manual play (M7.8 "Manual Play") — apply the player's tap intents onto the solo
 * hero's transient `command` slot. RO-style: `moveTo` (tap the ground → walk to x)
 * and `attackTarget` (tap a monster → engage it) override auto-hunt; `cancelCommand`
 * clears any active command. All arrive through `pendingInput` as `FrameInput`
 * intents (paving M8 lockstep). The command is HONOURED by systems/combat's hunt
 * movement and OVERRIDDEN by the boss phase's forced combat.
 *
 * PURITY / DETERMINISM: no RNG (the seeded stream stays wave-composition only), no
 * wall-clock. The command lives on the (never-persisted) live hero — transient state
 * that must NOT reach `SaveData` (toSaveData picks only progression/economy).
 */

import { CONFIG } from "@/engine/config";
import { FIXED_DT } from "@/engine/core/loop";
import { clamp } from "@/engine/core/math";
import { dhypot } from "@/engine/core/dmath";
import { getTargets } from "@/engine/systems/targeting";
import { fieldRect } from "@/engine/systems/plane";
import type { CombatTarget } from "@/engine/entities";
import type { GameState } from "@/engine/state";
import type { FrameInput } from "@/engine/core/step";

/** A live (hp > 0) attackable target with `id`, or null — the attackTarget validity gate. */
function findAliveTarget(state: GameState, id: number): CombatTarget | null {
  for (const t of getTargets(state)) if (t.id === id && t.hp > 0) return t;
  return null;
}

/**
 * Apply this frame's manual-play intents onto the solo hero's command slot.
 *
 * Applied AFTER the world/consumable intents, in a fixed order so a same-frame
 * combination resolves deterministically: `cancelCommand` first (clears any
 * command), then `moveTo`, then `attackTarget` (the newest valid command WINS, so
 * a later command replaces an earlier one — the "replaced by a newer command" rule).
 *
 *  - `moveTo {x}`: clamp x to the zone's walkable bounds, set a MOVE command, emit
 *    `moveOrdered {clampedX}`. Non-finite x is ignored.
 *  - `attackTarget {id}`: if the id names a LIVE target set an ATTACK command + emit
 *    `targetLocked {id}`; an invalid / dead / despawned id is IGNORED (clears
 *    nothing — the current command survives).
 *  - `cancelCommand`: clear the command (emit `commandCancelled` only if one existed).
 */
export function applyManualCommand(state: GameState, lanes: FrameInput[]): void {
  // M8 party P1b: `lanes[i]` drives `heroes[i]`'s command slot. Solo (one lane / one
  // hero) is the old `state.heroes[0]` path exactly — byte-identical.
  for (let i = 0; i < state.heroes.length; i++) {
    applyOneCommand(state, i, lanes[i] ?? {});
  }
}

/** Apply one lane's manual-play intents onto `heroes[heroIdx]`'s command slot. */
function applyOneCommand(state: GameState, heroIdx: number, input: FrameInput): void {
  const h = state.heroes[heroIdx];
  if (!h) return;

  if (input.cancelCommand && h.command) {
    h.command = null;
    state.events.push({ type: "commandCancelled", heroIdx });
  }

  if (input.moveTo && Number.isFinite(input.moveTo.x)) {
    // FREE-FIELD (Phase 1): clamp the tap to the per-map play FIELD rect (THE shared seam) —
    // x to the hunt/walk bounds (byte-identical), y to the depth-field edges.
    const field = fieldRect(state.location.mapId);
    const x = clamp(input.moveTo.x, field.minX, field.maxX);
    // OPTIONAL depth-row y. CLAMP it into the field at intake (owner reminder #1: never trust
    // the caller — the UI already inverts the tap to a field row, but a stale/older/malicious
    // client could send anything). A non-finite y is treated as ABSENT → an x-only command,
    // byte-identical to pre-y (same shape, same event).
    const rawY = input.moveTo.y;
    const y =
      typeof rawY === "number" && Number.isFinite(rawY)
        ? clamp(rawY, field.minY, field.maxY)
        : undefined;
    if (y === undefined) {
      h.command = { kind: "move", x };
      state.events.push({ type: "moveOrdered", x, heroIdx });
    } else {
      h.command = { kind: "move", x, y };
      state.events.push({ type: "moveOrdered", x, y, heroIdx });
    }
  }

  if (input.attackTarget) {
    const target = findAliveTarget(state, input.attackTarget.id);
    if (target) {
      h.command = { kind: "attack", targetId: target.id };
      state.events.push({ type: "targetLocked", id: target.id, heroIdx });
    }
    // Invalid / dead / despawned id -> ignore gracefully (clears nothing).
  }
}

/**
 * The walk-only slice of command handling for the TOWN early-return in `step()`
 * (UAT round-3 bug: that branch skips `updateHeroes` — no combat in the safe hub —
 * which silently dropped every `moveTo` there, so tap-the-ground and the phase-3
 * tap-an-NPC-to-approach did nothing in town). Honours a MOVE command at hunt
 * speed, completing within `arriveEps` exactly like combat's handling. An ATTACK
 * command cannot be created in town (no live targets to lock), and a stale one is
 * already cleared on zone arrival, so only MOVE is handled.
 *
 * Yields to the two things that own the hero's feet in town: the bot's own town
 * walk (`state.botWalk` drives `hero.x` directly — "a manual command can't wedge
 * the trip", it waits the walk out) and a fast-travel channel (the hero stands
 * still, mirroring the farm-zone `!channeling` gate on `updateHeroes`). Both are
 * GLOBAL yields that freeze the whole party's town walk, so they gate up front.
 *
 * M8 party P1b: EVERY cohort hero honours its own MOVE command (each member's tap
 * lands on `heroes[myCohortIndex]` via `applyManualCommand`). Solo (one hero)
 * reduces to the old `heroes[0]` path — byte-identical (same guards, same order).
 */
export function tickTownManualWalk(state: GameState): void {
  if (state.botWalk || state.fastTravelCast) return;
  const stepPx = CONFIG.hunt.huntSpeed * FIXED_DT;
  for (const h of state.heroes) {
    if (h.dead) continue;
    if (!h.command || h.command.kind !== "move") continue;
    const cmd = h.command;

    // FREE-FIELD (Phase 1) — HONEST 2D town walk. A move command carrying a depth-row `y` (and a
    // hero that has a `planeY`) walks the STRAIGHT LINE to (x, y) at the walk speed: the per-frame
    // budget `huntSpeed × dt` is split by the normalized direction (via `dhypot`), so a diagonal
    // is NOT faster than an axis-aligned move and BOTH axes arrive together (mirrors combat's
    // hunt-phase honest 2D). Town has NO combat y-steering to consume a sub-eps y residue, so on
    // arrival BOTH axes SNAP to the exact tapped (x, y) — the hero lands precisely on the point.
    // `x`/`y` were field-clamped at intake. The x-ONLY (or no-`planeY`) path below stays
    // BYTE-IDENTICAL to pre-Phase-1.
    if (cmd.y !== undefined && typeof h.planeY === "number") {
      const dx = cmd.x - h.x;
      const dy = cmd.y - h.planeY;
      const dist = dhypot(dx, dy);
      if (dist <= CONFIG.manual.arriveEps) {
        h.x = cmd.x;
        h.planeY = cmd.y;
        h.planeYHold = cmd.y; // LATCH the tapped row (carried into a farm zone; cleared on arrival there)
        h.command = null;
      } else {
        const s = stepPx / dist;
        h.x = h.x + dx * s;
        h.planeY = h.planeY + dy * s;
      }
      continue;
    }

    const d = cmd.x - h.x;
    const xArrived = Math.abs(d) <= CONFIG.manual.arriveEps;
    // y arrives when absent or un-tracked (no planeY) — the x-only path.
    const yArrived = cmd.y === undefined || typeof h.planeY !== "number";
    if (xArrived && yArrived) {
      // R4.5 Wave 1.1 — an x-only walk CLEARS the hold (cmd.y undefined) → pre-Wave-1.1 behaviour.
      h.planeYHold = cmd.y;
      h.command = null;
      continue;
    }
    // Walk x only while it hasn't arrived (x-only path is byte-identical to pre-Phase-1).
    if (!xArrived) h.x += Math.abs(d) <= stepPx ? d : Math.sign(d) * stepPx;
  }
}
