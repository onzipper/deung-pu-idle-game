/**
 * DAILY quests (M8 Wave A, design doc §2 "presence ไม่ใช่ optimal-play").
 *
 * A per-hero roster of 3 daily quests. The ROSTER is chosen SERVER-side (seeded from
 * serverDay + user material) and fed in through the `setDailies` intent — the engine
 * never reads calendar time (purity). This module owns:
 *   - `setHeroDailies` : install / refresh a hero's roster (a new serverDay resets it),
 *   - `advanceDailyProgress` : deterministic counting at the combat/economy choke points
 *     (NOT reading `state.events` — same one-way rule as the evolution quest),
 *   - `claimDaily` : the guarded reward claim (progress met + not already claimed).
 *
 * DETERMINISM / SIM-INERT: no RNG, no wall-clock. Every path is a no-op until the server
 * feeds a roster (`hero.dailies.quests` empty), so the balance sim — which never calls
 * `setDailies` — is byte-identical (progress counting iterates an empty roster).
 */

import { CONFIG } from "@/engine/config";
import { grantQuestReward, type QuestReward } from "@/engine/systems/questRewards";
import type { DailyObjectiveType, DailyQuest, Hero } from "@/engine/entities";
import type { GameState } from "@/engine/state";

/** A resolved daily-quest catalog entry (type + target + reward), or null for an unknown id. */
export interface DailyDef {
  type: DailyObjectiveType;
  target: number;
  reward: QuestReward;
}

/** Resolve a daily template's def from the CONFIG catalog by id (null if unknown). */
export function dailyDef(id: string): DailyDef | null {
  const cat = CONFIG.dailyQuests.catalog as Record<string, DailyDef | undefined>;
  return cat[id] ?? null;
}

/** Whether a daily instance has met its target (pure read for the UI claim affordance). */
export function isDailyComplete(dq: DailyQuest): boolean {
  const def = dailyDef(dq.id);
  return def !== null && dq.progress >= def.target;
}

/**
 * Install / refresh `hero`'s daily roster (the `setDailies` intent). `questIds` is the
 * server-chosen roster (clamped to `rosterSize`, unknown ids dropped). If `serverDay`
 * MATCHES the hero's current day this is an idempotent reconcile — matching quests KEEP
 * their progress/claimed (so a boot re-feed never wipes today's progress); if it is a
 * NEW day the roster resets (fresh progress/claims). No-op-safe on an absent hero.
 */
export function setHeroDailies(hero: Hero | undefined, serverDay: number, questIds: string[]): void {
  if (!hero) return;
  if (!Number.isFinite(serverDay)) return;
  const day = Math.floor(serverDay);
  const valid = questIds.filter((id) => dailyDef(id) !== null).slice(0, CONFIG.dailyQuests.rosterSize);
  const sameDay = hero.dailies.serverDay === day;
  hero.dailies = {
    serverDay: day,
    quests: valid.map((id): DailyQuest => {
      const prev = sameDay ? hero.dailies.quests.find((q) => q.id === id) : undefined;
      return prev
        ? { id, progress: prev.progress, claimed: prev.claimed }
        : { id, progress: 0, claimed: false };
    }),
  };
}

/**
 * Advance every hero's daily quests of `type` by `amount` (default 1), capped at each
 * quest's target. Called from the SAME deterministic emission sites the evolution quest
 * hooks (kill / boss / shop / refine) — never from `state.events`. Emits `dailyProgress`
 * ONLY on the COMPLETE transition (throttled — no per-kill flood). Iterates ALL heroes in
 * slot order (party-safe, mirrors `advanceQuestObjective`); solo is the single-hero path.
 */
export function advanceDailyProgress(state: GameState, type: DailyObjectiveType, amount = 1): void {
  if (amount <= 0) return;
  for (const hero of state.heroes) {
    for (const dq of hero.dailies.quests) {
      const def = dailyDef(dq.id);
      if (!def || def.type !== type) continue;
      if (dq.progress >= def.target) continue; // already complete — nothing to do
      const before = dq.progress;
      dq.progress = Math.min(def.target, dq.progress + amount);
      if (before < def.target && dq.progress >= def.target) {
        state.events.push({
          type: "dailyProgress",
          id: hero.id,
          questId: dq.id,
          progress: dq.progress,
          target: def.target,
          complete: true,
        });
      }
    }
  }
}

/**
 * Claim a completed daily's reward (the `claimDaily` intent). No-op (false) if the hero/
 * quest is missing, the def is unknown, it is already claimed, or progress is short of the
 * target. On success: marks claimed, grants the reward through the shared choke point, and
 * emits `questReward`. The SERVER re-validates the claim (server-authoritative day + unique
 * constraint, design §2) — this is the client-side prediction.
 */
export function claimDaily(state: GameState, heroIndex: number, questId: string): boolean {
  const hero = state.heroes[heroIndex];
  if (!hero) return false;
  const dq = hero.dailies.quests.find((q) => q.id === questId);
  if (!dq || dq.claimed) return false;
  const def = dailyDef(questId);
  if (!def || dq.progress < def.target) return false;
  dq.claimed = true;
  const granted = grantQuestReward(state, def.reward);
  state.events.push({ type: "questReward", source: "daily", id: hero.id, questId, ...granted });
  return true;
}
