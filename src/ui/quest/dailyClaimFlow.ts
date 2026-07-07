/**
 * M8 quest Wave C — the daily-quest claim flow: POST `/api/quest/daily/claim`
 * FIRST, then queue the engine `claimDaily` intent only after the server
 * confirms (same "POST-first, mutate local state only on success" rule as
 * `ui/gear/refineFlow.ts` — the intent never runs ahead of the server).
 *
 * Response contract (`/api/quest/daily/claim`, Wave B):
 *  - 200 {ok:true}       -> queue `claimDaily` (credits the reward, engine-side).
 *  - 409 already_claimed -> ALSO queue `claimDaily` ("sync quietly" per the task
 *    brief — a stale double-tap, or a cross-device claim; the engine's own
 *    claim guard is a no-op if this client's hero is already marked claimed).
 *  - 400 not_in_roster   -> do nothing; the next autosave/boot response
 *    refreshes the roster (`setDailies`) within ~30s — no urgent retry, matching
 *    the daily system's cozy "presence, not optimization" tone.
 *  - network failure     -> do nothing (same as 400 — the panel's button just
 *    stays clickable for a retry).
 */

import { useGameStore } from "@/ui/store/gameStore";

export type DailyClaimResult = "claimed" | "alreadyClaimed" | "notInRoster" | "network";

export async function claimDailyQuest(questId: string): Promise<DailyClaimResult> {
  try {
    const res = await fetch("/api/quest/daily/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questId }),
    });
    if (res.ok) {
      useGameStore.getState().queueClaimDaily(questId);
      return "claimed";
    }
    if (res.status === 409) {
      useGameStore.getState().queueClaimDaily(questId); // sync quietly
      return "alreadyClaimed";
    }
    return "notInRoster";
  } catch {
    return "network";
  }
}
