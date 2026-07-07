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

/**
 * Award kill XP to every ALIVE hero (dead heroes earn nothing). In a SAME-ZONE COHORT
 * (heroes.length ≥ 2, docs/party-design-m8.md §3 + answers) each present-and-alive hero's
 * amount is scaled by `party.expKillMult(size, alive)` = the cohort xp BUFF (per extra
 * member) × the EQUAL share of the per-kill pot (killer 1.0 + every OTHER alive hero at
 * `expShareRate`). The engine does NOT attribute a kill to one hero (no lastHitBy), so this
 * credits the design's §5 "equal to every present hero" form — the mean-field of the
 * killer/share split, identical in aggregate when heroes kill at equal rates (the symmetric
 * cohort). SOLO (size 1) → `expKillMult` returns 1 and the `mult === 1` fast path leaves
 * `amount` untouched, so a 1-hero run is BYTE-IDENTICAL. Determinism: `heroes.length` and the
 * alive count are identical on all cohort clients (canonical slot order); only + - * / used.
 */
export function grantKillXp(state: GameState, amount: number): void {
  const alive = aliveHeroes(state);
  const mult = CONFIG.party.expKillMult(state.heroes.length, alive.length);
  const each = mult === 1 ? amount : amount * mult;
  for (const h of alive) grantHeroXp(state, h, each);
}
