/**
 * Gold credit choke point (M7.95 "Hall of Fame").
 *
 * Before this module gold was added at four separate sites (farm kill / boss-add
 * kill / boss reward / zone-unlock reward / server-confirmed NPC sale). `creditGold`
 * funnels every POSITIVE gold gain through one path so a lifetime-earned counter
 * (`goldEarned`, SAVE v16 — the HOF "total gold" board) can be maintained without
 * scattering the hook. It is a WRITE-ONLY observer: it never gates or reshapes the
 * economy, so `state.gold` ends up byte-identical to the old `state.gold += n`.
 *
 * SPENDING never routes here — a refine gold cost / potion purchase reduces
 * `state.gold` directly (see step.ts `goldCredit` negative branch, consumables) so
 * `goldEarned` only ever rises. Pure TS, no RNG, no wall-clock.
 */

import { CONFIG } from "@/engine/config";
import type { GameState } from "@/engine/state";

/**
 * Credit `amount` gold to the hero: adds to spendable `state.gold` AND to the
 * lifetime `state.goldEarned` total. Callers pass an already-integral, positive
 * reward (the config gold curves are integers); non-finite / non-positive amounts
 * are ignored so this can never drain gold or the lifetime total.
 */
export function creditGold(state: GameState, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const amt = Math.floor(amount);
  state.gold += amt;
  state.goldEarned += amt;
}

/**
 * Credit a KILL/boss gold reward, scaled by the cohort `goldShareMult` hook (M8 party
 * P1b — each cohort client credits its OWN hero, design §5). The hook is IDENTITY at
 * every party size today (inert; the real curve is a balance-sim task), and the
 * `mult === 1` fast path skips the multiply/round entirely, so a solo (and any current
 * cohort) is byte-identical to a plain `creditGold`. Determinism: `state.heroes.length`
 * is the same on all cohort clients (canonical slot ordering).
 */
export function creditKillGold(state: GameState, base: number): void {
  const mult = CONFIG.party.goldShareMult(state.heroes.length);
  creditGold(state, mult === 1 ? base : Math.round(base * mult));
}
