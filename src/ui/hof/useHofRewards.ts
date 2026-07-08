"use client";

/**
 * HOF seasonal rewards — the mount-once fetch of `GET /api/hof/rewards`
 * (same "mount fetch, no polling" idiom as `AccountSection.tsx`), hoisted out
 * of the old `ChampionsSection.tsx` so `HallOfFamePanel.tsx` can feed the ONE
 * response into the podium strip (`PodiumStrip.tsx`), the unclaimed-awards
 * banner, AND the live-list title cross-reference (`titleForCharInBoard`)
 * without three separate network calls. Independent of the panel's per-board
 * `/api/hof` cache (`hofQueryKey`) — this one never re-fetches per tab.
 */

import { useEffect, useState } from "react";
import { fetchHofRewards } from "@/ui/hof/rewardsApi";
import type { HofRewardsWire } from "@/ui/hof/rewardsTypes";

export type HofRewardsFetchState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ok"; data: HofRewardsWire };

export function useHofRewards(): HofRewardsFetchState {
  const [state, setState] = useState<HofRewardsFetchState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchHofRewards(null, controller.signal).then((res) => {
      if (res.kind === "aborted") return;
      if (res.kind === "error") {
        setState({ kind: "error" });
        return;
      }
      setState({ kind: "ok", data: res.data });
    });
    return () => controller.abort();
  }, []);

  return state;
}
