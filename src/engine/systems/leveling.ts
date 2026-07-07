/**
 * Hero XP + levels (M5 "Character XP + Level system", 86d3jv7m3).
 *
 * XP comes from KILLS only, applied where kills resolve (see combat.resolveDeaths
 * / boss.onBossKilled) so it accrues naturally through `step()` — including the
 * client-side offline-idle replay, which needs no special path. Every ALIVE hero
 * gains equal XP per kill; DEAD heroes earn nothing (a gentle keep-them-alive
 * incentive that never punishes idle play). NO RNG is drawn here — kills are
 * deterministic, so the seeded stream stays reserved for wave composition.
 *
 * Levels grant a small atk/hp bonus (systems/stats) that COMPOUNDS with the three
 * upgrade lines. A level-up recomputes the hero's max HP and heals by the gained
 * headroom (a small feel-good bump), and emits a transient `levelUp` event for
 * render/UI juice (nothing in the engine consumes it).
 */

import { CONFIG } from "@/engine/config";
import { heroMaxHpOf } from "@/engine/systems/stats";
import { markLevelCap } from "@/engine/systems/hallOfFame";
import { aliveHeroes } from "@/engine/systems/targeting";
import type { Hero } from "@/engine/entities";
import type { GameState } from "@/engine/state";

const LV = CONFIG.leveling;

/**
 * Grant `amount` XP to a single hero, resolving every level-up it triggers (a big
 * boss reward can span several levels). Clamps at `levelCap`, where XP stops
 * accruing (no dangling overflow that a future cap-raise would surprise-cash-in).
 */
export function grantHeroXp(state: GameState, hero: Hero, amount: number): void {
  if (hero.level >= LV.levelCap) return;
  hero.xp += amount;
  while (hero.level < LV.levelCap && hero.xp >= LV.xpToLevel(hero.level)) {
    hero.xp -= LV.xpToLevel(hero.level);
    hero.level++;
    // Grant this level's base-stat points (M5 "Base stats"); the player allocates
    // them via the allocateStat intent, or auto-allocate dumps them into the
    // class primary stat.
    hero.statPoints += CONFIG.stats.pointsPerLevel;
    // Recompute max HP at the new level (using allocated vit) and heal by the
    // added headroom.
    const newMax = heroMaxHpOf(hero);
    hero.hp += newMax - hero.maxHp;
    hero.maxHp = newMax;
    state.events.push({
      type: "levelUp",
      id: hero.id,
      cls: hero.cls,
      level: hero.level,
    });
  }
  if (hero.level >= LV.levelCap) {
    hero.xp = 0;
    // M7.95 HOF tiebreaker: stamp the FIRST time the hero hits the cap (once).
    markLevelCap(state);
  }
}

/** Award kill XP to every ALIVE hero (dead heroes earn nothing). */
export function grantKillXp(state: GameState, amount: number): void {
  for (const h of aliveHeroes(state)) grantHeroXp(state, h, amount);
}
