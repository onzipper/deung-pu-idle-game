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

/** Stable id of a class's class-change quest (per-class so M8 can diverge them). */
export function classChangeQuestId(cls: HeroClass): string {
  return `classchange_${cls}`;
}

/** The class-change quest DEF for `cls` (kill N enemies + defeat 1 boss; v1 numbers
 * are shared across classes but the id is per-class). */
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

/** Resolve `hero`'s active-quest def (only the class-change quest exists in v1). */
function activeQuestDef(hero: Hero): QuestDef | null {
  const q = hero.quest;
  if (!q) return null;
  const def = classChangeQuestFor(hero.cls);
  return def.id === q.id ? def : null;
}

/**
 * Is the class-change quest OFFERABLE to `hero` right now? Derived (no stored
 * "offered" object): tier 1, at/above the level gate, and no quest already active.
 * The UI turns this into the "รับเควส" affordance.
 */
export function isClassChangeQuestOffered(hero: Hero): boolean {
  return (
    hero.tier < 2 && hero.level >= CONFIG.evolution.levelRequired && hero.quest === null
  );
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
  if (!hero || !isClassChangeQuestOffered(hero)) return false;
  const def = classChangeQuestFor(hero.cls);
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
