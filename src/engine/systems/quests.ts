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
 * The tier-3 quest DEF for `cls` (M7.9 REDESIGN, owner "option ข" 2026-07-08; M7.9b boss
 * objective, owner 2026-07-08): TWO MAP-SCOPED objectives in the ICE-TUNDRA FRONTIER
 * (map4) — (1) a kill grind in zone 1 (s16), then (2) defeat the map4 boss (the quest-
 * scaled "young" Glacial Sovereign). NO refine condition; the old map2-boss backtrack is
 * gone. Both objectives are scoped to `killMapId` (map4). Accepting the quest grants
 * DERIVED access to ONLY map4 zone 1 (`systems/world.questGrantsZoneAccess`); once the
 * kill objective completes that grant EXTENDS to map4's boss room (zones 2-5 stay gated
 * behind the s15 boss), so no zoneIdx scope is needed — a tier-2 hero can only reach the
 * frontier field + (kills-done) the boss room while the quest is held.
 *
 * ORDER MATTERS: objective 0 = kill, objective 1 = killBoss. The access-grant + boss-scale
 * logic (systems/world + this module's `isTier3QuestBossFight`) reads them positionally.
 */
export function tier3QuestFor(cls: HeroClass): QuestDef {
  const q = CONFIG.quest.tier3;
  return {
    id: tier3QuestId(cls),
    objectives: [
      { type: "kill", count: q.kills, mapId: q.killMapId },
      { type: "killBoss", count: q.bossKills, mapId: q.killMapId },
    ],
  };
}

/**
 * Is the solo hero in the tier-3 quest's "go fight the young Sovereign" phase? True when a
 * TIER-2 hero holds the accepted tier-3 quest with the KILL objective banked but the
 * KILLBOSS objective still pending. LOCATION-INDEPENDENT (drives the boss-room access grant
 * + the challenge affordance from the frontier). Keys off QUEST STATE, not hero tier alone:
 * a post-quest tier-3 hero has consumed the quest (hero.quest === null), so this is false
 * and it gets the REAL s20 boss. Deterministic (pure state read, no RNG/wall-clock).
 */
export function isTier3BossObjectiveActive(state: GameState): boolean {
  const hero = state.heroes[0];
  if (!hero || hero.tier !== 2) return false;
  const q = hero.quest;
  if (!q || !q.accepted || q.id !== tier3QuestId(hero.cls)) return false;
  const def = tier3QuestFor(hero.cls);
  const killIdx = def.objectives.findIndex((o) => o.type === "kill");
  const bossIdx = def.objectives.findIndex((o) => o.type === "killBoss");
  if (killIdx < 0 || bossIdx < 0) return false;
  const killDone = (q.progress[killIdx] ?? 0) >= def.objectives[killIdx].count;
  const bossDone = (q.progress[bossIdx] ?? 0) >= def.objectives[bossIdx].count;
  return killDone && !bossDone;
}

/**
 * Is the CURRENT boss fight the tier-3 quest's young-Sovereign fight (i.e. should the boss
 * spawn with the quest-override scales)? `isTier3BossObjectiveActive` AND the hero is in the
 * quest's kill-map (map4) — a boss fight only ever happens in a boss room, so the map check
 * pins it to the map4 Sovereign. Used by `systems/boss.startBossFight` to pick the scales.
 */
export function isTier3QuestBossFight(state: GameState): boolean {
  return (
    isTier3BossObjectiveActive(state) &&
    state.location.mapId === CONFIG.quest.tier3.killMapId
  );
}

/**
 * The quest-scaled young-Sovereign hp/atk multipliers if the current boss fight is the
 * tier-3 quest boss, else null (the caller then uses the normal bossVariety scales). Pure.
 */
export function tier3QuestBossScale(
  state: GameState,
): { hpScale: number; atkScale: number } | null {
  if (!isTier3QuestBossFight(state)) return null;
  return {
    hpScale: CONFIG.quest.tier3.bossHpScale,
    atkScale: CONFIG.quest.tier3.bossAtkScale,
  };
}

/**
 * Is the CURRENT boss fight serving a tier-1 hero's class-change EXAM (the `killBoss`
 * objective of an accepted, still-pending class-change quest on ANY cohort hero)? A boss
 * fight only ever happens in a boss room, so this + the caller's boss phase pins it to a
 * real fight. Used (with `isTier3QuestBossFight`) to headcount-scale a QUEST boss's HP so a
 * party can't trivialize an evolution exam ("no hiring friends to pass your exam"). Pure.
 */
export function isClassChangeBossFight(state: GameState): boolean {
  for (const hero of state.heroes) {
    if (hero.tier !== 1) continue;
    const q = hero.quest;
    if (!q || !q.accepted || q.id !== classChangeQuestId(hero.cls)) continue;
    const def = classChangeQuestFor(hero.cls);
    const bossIdx = def.objectives.findIndex((o) => o.type === "killBoss");
    if (bossIdx < 0) continue;
    if ((q.progress[bossIdx] ?? 0) < def.objectives[bossIdx].count) return true;
  }
  return false;
}

/**
 * Is the current boss fight a QUEST boss (an evolution exam) rather than a plain STAGE boss?
 * True for the tier-3 young-Sovereign fight OR any cohort hero's pending class-change exam.
 * STAGE bosses (owner: melty-at-headcount is a reward) return false. Drives the party HP
 * headcount scale in `systems/boss.startBossFight`. Pure (no RNG/wall-clock).
 */
export function isQuestBossFight(state: GameState): boolean {
  return isTier3QuestBossFight(state) || isClassChangeBossFight(state);
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
  // M8 party P1b: iterate ALL heroes in slot order so the SHARED cohort state is identical
  // on every client (each hero's own quest advances; each player persists only their own
  // slot). Solo (one hero) is the old `state.heroes[0]` path exactly — byte-identical
  // (same single increment, same single event).
  for (const hero of state.heroes) {
    const q = hero.quest;
    if (!q || !q.accepted) continue;
    const def = activeQuestDef(hero);
    if (!def || isQuestComplete(hero)) continue;

    let changed = false;
    for (let i = 0; i < def.objectives.length; i++) {
      const o = def.objectives[i];
      if (o.type !== type) continue;
      // MAP SCOPE (M7.9 tier-3 quest): a map-scoped objective only counts an event that
      // happened in its map (the tier-3 quest requires map4 kills + a map4-boss kill — the
      // young Sovereign). Unscoped objectives (the tier-2 class-change quest) count anywhere.
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
}
