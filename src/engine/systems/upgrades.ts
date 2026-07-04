/**
 * Upgrade purchases + auto-upgrade (POC `buyUpgrade` / `tryAutoUpgrade`).
 *
 * Three lines (atk / speed / hp) on independent cost curves (`upgradeCost`).
 * Only the speed line is capped (`SPEED_UPGRADE_CAP`). Buying HP re-syncs every
 * hero's maxHp AND adds the delta to current HP, exactly like the POC (so an
 * HP upgrade is an instant partial heal).
 *
 * Auto-upgrade policy (POC): among the affordable lines, buy the CHEAPEST one,
 * one purchase per tick. The POC ticked this on a 150ms UI interval; we replicate
 * that cadence with `autoUpgradeInterval` so the economy paces identically
 * instead of attempting a buy every 1/60s.
 */

import { CONFIG, SPEED_UPGRADE_CAP } from "@/engine/config";
import { FIXED_DT } from "@/engine/core/loop";
import { heroMaxHp, upgradeCost, type Upgrades } from "@/engine/systems/stats";
import type { GameState } from "@/engine/state";

/** Buy one level of `stat` if affordable and uncapped. Returns whether it bought. */
export function buyUpgrade(state: GameState, stat: keyof Upgrades): boolean {
  if (stat === "speed" && state.upgrades.speed >= SPEED_UPGRADE_CAP) return false;
  const cost = upgradeCost(stat, state.upgrades[stat]);
  if (state.gold < cost) return false;

  state.gold -= cost;
  state.upgrades[stat]++;
  state.events.push({ type: "upgradeBought", line: stat, level: state.upgrades[stat] });

  if (stat === "hp") {
    const m = heroMaxHp(state.upgrades);
    for (const h of state.heroes) {
      const delta = m - h.maxHp;
      h.maxHp = m;
      h.hp += delta;
    }
  }
  return true;
}

/** Cheapest-affordable-first, one buy. No-op unless the toggle is on. */
export function tryAutoUpgrade(state: GameState): void {
  if (!state.autoUpgrade) return;
  const opts: [keyof Upgrades, number][] = [
    ["atk", upgradeCost("atk", state.upgrades.atk)],
    ["hp", upgradeCost("hp", state.upgrades.hp)],
  ];
  if (state.upgrades.speed < SPEED_UPGRADE_CAP) {
    opts.push(["speed", upgradeCost("speed", state.upgrades.speed)]);
  }
  opts.sort((a, b) => a[1] - b[1]);
  for (const [stat, cost] of opts) {
    if (state.gold >= cost) {
      buyUpgrade(state, stat);
      break;
    }
  }
}

/** Drive `tryAutoUpgrade` on the POC's fixed cadence (not every fixed step). */
export function processAutoUpgrade(state: GameState): void {
  state.autoUpgradeTimer -= FIXED_DT;
  if (state.autoUpgradeTimer <= 0) {
    tryAutoUpgrade(state);
    state.autoUpgradeTimer = CONFIG.autoUpgradeInterval;
  }
}
