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
import { getTargets } from "@/engine/systems/targeting";
import type { CombatTarget } from "@/engine/entities";
import type { GameState } from "@/engine/state";
import type { FrameInput } from "@/engine/core/step";

/** The current zone's walkable x range for a moveTo clamp (mirrors combat's bounds). */
function walkBounds(state: GameState): [min: number, max: number] {
  const map = CONFIG.world.maps.find((m) => m.id === state.location.mapId);
  const fieldWidth = map?.fieldWidth ?? 900;
  return [CONFIG.hunt.heroMinX, fieldWidth - CONFIG.hunt.fieldRightMargin];
}

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
    state.events.push({ type: "commandCancelled" });
  }

  if (input.moveTo && Number.isFinite(input.moveTo.x)) {
    const [minX, maxX] = walkBounds(state);
    const x = clamp(input.moveTo.x, minX, maxX);
    h.command = { kind: "move", x };
    state.events.push({ type: "moveOrdered", x });
  }

  if (input.attackTarget) {
    const target = findAliveTarget(state, input.attackTarget.id);
    if (target) {
      h.command = { kind: "attack", targetId: target.id };
      state.events.push({ type: "targetLocked", id: target.id });
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
    const d = h.command.x - h.x;
    if (Math.abs(d) <= CONFIG.manual.arriveEps) {
      h.command = null;
      continue;
    }
    h.x += Math.abs(d) <= stepPx ? d : Math.sign(d) * stepPx;
  }
}
