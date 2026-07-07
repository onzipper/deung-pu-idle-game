/**
 * Quest framework v1 (M5 "เปลี่ยนคลาสผ่านเควส", ROADMAP task 5).
 *
 * The class-change quest is the TRIGGER for the tier-1 -> tier-2 evolution (it
 * replaced the old gold cost — quest EFFORT is the gate now). This module owns:
 *   - the per-class quest DEF (catalog data, from CONFIG.quest.classChange),
 *   - the OFFER rule (derived: tier 1, level gate met, no active quest),
 *   - the `acceptQuest` intent (creates the accepted instance on the solo hero),
 *   - objective COUNTING — `advanceQuestObjective`, called from the deterministic
 *     combat resolve at the SAME sites that emit `kill` / `bossDefeated`.
 *
 * DETERMINISM: objectives count off the hero's own kills / boss defeats — no RNG
 * (the seeded stream stays wave-composition-only) and no wall-clock. We advance at
 * the combat EMISSION SITES rather than reading `state.events`, so the engine's
 * one-way event rule (systems never READ events) stays intact; the quest events we
 * push here (`questAccepted` / `questObjectiveProgress` / `questCompleted`) flow
 * out to UI/juice exactly like every other event.
 *
 * FORWARD-COMPAT (M8): see entities `QuestObjective` doc for the documented
 * extension points (more objective types, a per-hero quest LOG, rewards/chains).
 */

import { CONFIG } from "@/engine/config";
import type { Hero, HeroClass, QuestDef, QuestObjectiveType } from "@/engine/entities";
import type { GameState } from "@/engine/state";

/** Stable id of a class's class-change (tier-1 -> tier-2) quest. */
export function classChangeQuestId(cls: HeroClass): string {
  return `classchange_${cls}`;
}

/** Stable id of a class's tier-2 -> tier-3 quest (M7.9 "Grand Expansion"). */
export function tier3QuestId(cls: HeroClass): string {
  return `tier3_${cls}`;
}

/** The class-change quest DEF for `cls` (kill N enemies + defeat 1 boss; v1 numbers
 * are shared across classes but the id is per-class). Objectives count ANYWHERE. */
export function classChangeQuestFor(cls: HeroClass): QuestDef {
  const q = CONFIG.quest.classChange;
  return {
    id: classChangeQuestId(cls),
    objectives: [
      { type: "kill", count: q.kills },
      { type: "killBoss", count: q.bossKills },
    ],
  };
}

/**
 * The tier-3 quest DEF for `cls` (M7.9 REDESIGN, owner "option ข" 2026-07-08): a SINGLE
 * MAP-SCOPED kill objective in the ICE-TUNDRA FRONTIER (map4 zone 1, s16) — NO boss
 * objective (the old map2-boss backtrack is gone) and NO refine condition. The objective
 * is scoped to `killMapId` (map4); because accepting the quest grants preview access to
 * ONLY map4 zone 1 (`systems/world.questGrantsZoneAccess` — zones 2+ stay gated behind
 * the s15 boss), a map-scope on `killMapId` is effectively "map4 zone 1 only": a tier-2
 * hero cannot reach the deeper map4 zones during the quest, so no zoneIdx scope is needed.
 */
export function tier3QuestFor(cls: HeroClass): QuestDef {
  const q = CONFIG.quest.tier3;
  return {
    id: tier3QuestId(cls),
    objectives: [{ type: "kill", count: q.kills, mapId: q.killMapId }],
  };
}

/**
 * The evolution quest DEF that gates `hero`'s NEXT tier change: the class-change quest
 * at tier 1, the tier-3 quest at tier 2, none at tier 3 (fully evolved). This is the
 * single place the tier -> quest mapping lives (used by the offer/accept/complete
 * paths + the save normalisers).
 */
export function evolutionQuestFor(cls: HeroClass, tier: 1 | 2 | 3): QuestDef | null {
  if (tier === 1) return classChangeQuestFor(cls);
  if (tier === 2) return tier3QuestFor(cls);
  return null;
}

/** Resolve `hero`'s active-quest def (the evolution quest matching its tier + id). */
function activeQuestDef(hero: Hero): QuestDef | null {
  const q = hero.quest;
  if (!q) return null;
  const def = evolutionQuestFor(hero.cls, hero.tier);
  return def && def.id === q.id ? def : null;
}

/** The LEVEL gate at which `hero`'s next evolution quest is offered (tier-scoped). */
function evolutionQuestLevelGate(tier: 1 | 2 | 3): number | null {
  if (tier === 1) return CONFIG.evolution.levelRequired;
  if (tier === 2) return CONFIG.evolution.tier3.levelRequired;
  return null;
}

/**
 * Is the hero's NEXT evolution quest OFFERABLE right now? Derived (no stored "offered"
 * object): below tier 3, at/above the tier's level gate, and no quest already active.
 * Covers BOTH the tier-1 class-change and the tier-2 tier-3 quest. The UI turns this
 * into the "รับเควส" affordance.
 */
export function isEvolutionQuestOffered(hero: Hero): boolean {
  if (hero.quest !== null) return false;
  const gate = evolutionQuestLevelGate(hero.tier);
  return gate !== null && hero.level >= gate;
}

/**
 * Back-compat: is the TIER-1 class-change quest offerable? (Kept for the existing UI
 * read + tests; `isEvolutionQuestOffered` is the general tier-aware form.)
 */
export function isClassChangeQuestOffered(hero: Hero): boolean {
  return hero.tier === 1 && isEvolutionQuestOffered(hero);
}

/** Is `hero`'s active quest accepted AND every objective met (class change ready)? */
export function isQuestComplete(hero: Hero): boolean {
  const q = hero.quest;
  if (!q || !q.accepted) return false;
  const def = activeQuestDef(hero);
  if (!def) return false;
  return def.objectives.every((o, i) => (q.progress[i] ?? 0) >= o.count);
}

/**
 * Apply the `acceptQuest` intent for the hero at slot `index`. No-op (returns
 * false) if the slot is empty or the quest isn't offerable. On success: seats the
 * accepted instance (progress all-zero) and emits `questAccepted`. Flows through
 * `step()` like any other one-shot intent (applied once per drained input).
 */
export function acceptQuest(state: GameState, index: number): boolean {
  const hero = state.heroes[index];
  if (!hero || !isEvolutionQuestOffered(hero)) return false;
  const def = evolutionQuestFor(hero.cls, hero.tier);
  if (!def) return false;
  hero.quest = { id: def.id, accepted: true, progress: def.objectives.map(() => 0) };
  state.events.push({ type: "questAccepted", id: hero.id, questId: def.id });
  return true;
}

/**
 * Advance every objective of `type` on the SOLO hero's active quest by one (one
 * enemy kill / one boss defeat). No-op unless the hero has an accepted, incomplete
 * quest. Emits `questObjectiveProgress` on each real increment and one
 * `questCompleted` when the final objective fills. Called from combat's
 * deterministic death resolution — see this module's header for why we hook the
 * emission site instead of reading `state.events`.
 */
export function advanceQuestObjective(state: GameState, type: QuestObjectiveType): void {
  const hero = state.heroes[0];
  if (!hero) return;
  const q = hero.quest;
  if (!q || !q.accepted) return;
  const def = activeQuestDef(hero);
  if (!def || isQuestComplete(hero)) return;

  let changed = false;
  for (let i = 0; i < def.objectives.length; i++) {
    const o = def.objectives[i];
    if (o.type !== type) continue;
    // MAP SCOPE (M7.9 tier-3 quest): a map-scoped objective only counts an event that
    // happened in its map (the tier-3 quest requires kills in map3 + a map2-boss kill).
    // Unscoped objectives (the tier-2 class-change quest) count anywhere — unchanged.
    if (o.mapId !== undefined && state.location.mapId !== o.mapId) continue;
    const cur = q.progress[i] ?? 0;
    if (cur >= o.count) continue;
    q.progress[i] = cur + 1;
    changed = true;
    state.events.push({
      type: "questObjectiveProgress",
      id: hero.id,
      questId: q.id,
      objectiveIndex: i,
      progress: q.progress[i],
      count: o.count,
    });
  }
  if (changed && isQuestComplete(hero)) {
    state.events.push({ type: "questCompleted", id: hero.id, questId: q.id });
  }
}
