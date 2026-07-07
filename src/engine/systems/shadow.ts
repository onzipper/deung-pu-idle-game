/**
 * Shadow-body takeover (M8 party P2 — "ร่างเงา", docs/party-design-m8.md §9).
 *
 * When a cohort member disconnects past the soft-pause grace (or was offline when the
 * cohort formed), the ROOM (relay) marks that slot SHADOWED via a replicated
 * `setShadowed` intent synthesized on the slot's own lane; on reconnect it emits the
 * inverse. Every client applies the intent identically, so the flag is deterministic
 * shared state (folded into `stateHash`).
 *
 * A shadowed hero is NOT a special AI: the sim already plays every hero autonomously
 * (idle game — auto-hunt / auto-cast / auto-potion run without any input), so a shadow
 * simply keeps running the SAME systems on its FROZEN `config`. The only added rule is
 * a LANE POLICY, applied in `step()`: a shadowed hero's manual/lead intents are dropped
 * so a stale or haunted client cannot steer a taken-over body. This module owns the
 * flag TRANSITION (with its render event); the neutralization lives in `step()`.
 *
 * PURITY / DETERMINISM: no RNG, no wall-clock. Solo-guarded — a single-hero zone can
 * never be shadowed (there is no party to leave), keeping the solo path byte-identical.
 */

import type { GameState } from "@/engine/state";

/**
 * Apply a replicated `setShadowed` transition to the hero at party slot `heroIdx`.
 *
 *  - SOLO GUARD: no-op when the zone holds a single hero (`heroes.length <= 1`) — a solo
 *    sim can never be shadowed, so the intent is ignored and the solo path is untouched.
 *  - No-op (no event) when the flag already holds `value` — the `heroShadowed` event
 *    fires only on a REAL transition, so a room re-asserting the same state is inert.
 */
export function setShadowed(state: GameState, heroIdx: number, value: boolean): void {
  if (state.heroes.length <= 1) return; // solo can never be a shadow (design §9 + guard)
  const hero = state.heroes[heroIdx];
  if (!hero || hero.shadowed === value) return;
  hero.shadowed = value;
  state.events.push({ type: "heroShadowed", heroIdx, value });
}
