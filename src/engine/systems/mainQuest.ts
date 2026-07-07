/**
 * MAIN quest line (M8 Wave A, design doc §1 "ห่อ goal-ladder เดิม ไม่แทนที่").
 *
 * A CHAPTER CHAIN — one chapter per world map. Crucially it holds NO progression state
 * of its own (the game's worst bug class = two sources of truth for progression): a
 * chapter's COMPLETION is a PURE DERIVATION of the world unlock state the player already
 * earned. Only the CLAIMED-reward set persists (`hero.mainClaimed`), guarding double-
 * claims across the server's migrate-on-every-save.
 *
 * COMPLETION RULE (per map): the map's boss is beaten. For maps 1..5 this is signalled by
 * the NEXT map's first zone being PERSIST-unlocked (beating map N's boss unlocks map N+1 —
 * `world.onBossRoomCleared`); this reads correctly from ANY save back to v8 (`unlockedZones`
 * has persisted since then), which is what lets the v17 migration "mark-done, no-backpay"
 * an existing deep character. The LAST map has no next map, so it keys off `bossBest`
 * (SAVE v16 — the quest boss is excluded from that record, so it only reflects real clears).
 *
 * PURITY: no RNG, no wall-clock. The derivation + claim are pure state reads; the reward
 * flows through the shared `grantQuestReward` choke. INERT until a claim intent fires.
 */

import { CONFIG } from "@/engine/config";
import { grantQuestReward } from "@/engine/systems/questRewards";
import type { BossClearBest } from "@/engine/systems/hallOfFame";
import type { GameState } from "@/engine/state";

/** A main-quest chapter's static def (from `CONFIG.mainQuest.chapters`). */
export interface MainChapterDef {
  id: string;
  mapId: string;
  reward: { gold?: number; materials?: number; hpPotion?: number; manaPotion?: number };
}

/** The ordered chapter defs (config is the single source of truth). */
export function mainChapterDefs(): readonly MainChapterDef[] {
  return CONFIG.mainQuest.chapters as readonly MainChapterDef[];
}

/** The map that immediately FOLLOWS `mapId` in the world order, or null (last map). */
function nextMapIdOf(mapId: string): string | null {
  const maps = CONFIG.world.maps;
  const i = maps.findIndex((m) => m.id === mapId);
  return i >= 0 && i + 1 < maps.length ? maps[i + 1].id : null;
}

/** The boss stage id that gates `mapId` (its boss-room content stage), or null. */
function bossStageOf(mapId: string): number | null {
  return CONFIG.world.maps.find((m) => m.id === mapId)?.bossStageId ?? null;
}

/**
 * Whether the chapter for `mapId` is COMPLETE, derived purely from persisted progression:
 * for a non-final map, its NEXT map's first zone is persist-unlocked; for the final map,
 * its boss stage has a `bossBest` record. Works on RAW save fields (used by both the live
 * read below and the v17 migration prefill) — takes the two records directly.
 */
export function isMainChapterComplete(
  mapId: string,
  unlockedZones: Record<string, number>,
  bossBest: Record<number, BossClearBest> | undefined,
): boolean {
  const nextMap = nextMapIdOf(mapId);
  if (nextMap) return (unlockedZones[nextMap] ?? 0) >= 1;
  const boss = bossStageOf(mapId);
  return boss !== null && bossBest?.[boss] !== undefined;
}

/**
 * The ids of every chapter whose completion the given progression already implies. Used
 * by the v17 migration to mark an existing character's finished chapters as CLAIMED with
 * NO backpay (mirrors the v16 `goldEarned=0` discipline — a deep save must not suddenly
 * owe a pile of retroactive rewards). Pure; order = chapter order.
 */
export function completedChapterIds(
  unlockedZones: Record<string, number>,
  bossBest: Record<number, BossClearBest> | undefined,
): string[] {
  return mainChapterDefs()
    .filter((c) => isMainChapterComplete(c.mapId, unlockedZones, bossBest))
    .map((c) => c.id);
}

/** A per-chapter view for the UI tracker (derived; read-only). */
export interface MainChapterView {
  id: string;
  mapId: string;
  complete: boolean;
  claimed: boolean;
  /** Complete AND not yet claimed — the reward is available to claim right now. */
  claimable: boolean;
}

/**
 * The solo hero's main-quest chapter states (derived, read-only) — the source the UI's
 * main-quest tracker renders from. `claimed` reads the persisted `hero.mainClaimed`.
 */
export function mainQuestChapters(state: GameState): MainChapterView[] {
  const hero = state.heroes[0];
  const claimed = new Set(hero?.mainClaimed ?? []);
  return mainChapterDefs().map((c) => {
    const complete = isMainChapterComplete(c.mapId, state.unlockedZones, state.bossBest);
    const isClaimed = claimed.has(c.id);
    return { id: c.id, mapId: c.mapId, complete, claimed: isClaimed, claimable: complete && !isClaimed };
  });
}

/**
 * Claim a completed main-quest chapter's reward (the `claimMainReward` intent). No-op
 * (false) for an unknown chapter id, an absent hero, an already-claimed chapter, or a
 * chapter not yet complete. On success: records the id in `hero.mainClaimed`, grants the
 * reward through the shared choke, and emits `questReward`. The main line is client-
 * authoritative + re-derive-capped like gold (design §5 — `mainClaimed` guards dup).
 */
export function claimMainReward(state: GameState, heroIndex: number, chapterId: string): boolean {
  const hero = state.heroes[heroIndex];
  if (!hero) return false;
  const def = mainChapterDefs().find((c) => c.id === chapterId);
  if (!def) return false;
  if (hero.mainClaimed.includes(chapterId)) return false;
  if (!isMainChapterComplete(def.mapId, state.unlockedZones, state.bossBest)) return false;
  hero.mainClaimed.push(chapterId);
  const granted = grantQuestReward(state, def.reward);
  state.events.push({ type: "questReward", source: "main", id: hero.id, questId: chapterId, ...granted });
  return true;
}
