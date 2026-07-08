/**
 * HOF seasonal rewards — thin `fetch` wrappers over `/api/hof/rewards`,
 * `/api/hof/claim`, `/api/hof/title` (same tier/shape as `ui/hof/api.ts`'s
 * legacy-board wrapper and `ui/worldBoss/api.ts` — no engine/store access,
 * callers own applying the result).
 */

import type { ItemInstanceWire } from "@/ui/gear/types";
import type { HofRewardsWire } from "./rewardsTypes";

export type HofRewardsFetchResult =
  | { kind: "ok"; data: HofRewardsWire }
  | { kind: "aborted" }
  | { kind: "error" };

export async function fetchHofRewards(
  characterId: string | null,
  signal?: AbortSignal,
): Promise<HofRewardsFetchResult> {
  try {
    const url = characterId
      ? `/api/hof/rewards?characterId=${encodeURIComponent(characterId)}`
      : "/api/hof/rewards";
    const res = await fetch(url, { signal });
    if (!res.ok) return { kind: "error" };
    const data = (await res.json()) as HofRewardsWire;
    return { kind: "ok", data };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return { kind: "aborted" };
    return { kind: "error" };
  }
}

export type HofClaimApiResult =
  | { ok: true; item: ItemInstanceWire }
  | { ok: false; reason: string }
  /** Network/parse failure — distinct from a definite server rejection
   *  (mirrors `postWorldBossClaim`'s convention). */
  | null;

export async function postHofClaim(awardId: string): Promise<HofClaimApiResult> {
  try {
    const res = await fetch("/api/hof/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ awardId }),
    });
    const json = (await res.json()) as
      | { ok: true; item: ItemInstanceWire }
      | { error: string; code?: string };
    if (!res.ok || !("ok" in json) || !json.ok) {
      const reason = "code" in json && json.code ? json.code : "unknown";
      return { ok: false, reason };
    }
    return json;
  } catch {
    return null;
  }
}

export type HofSetTitleApiResult =
  | { ok: true; displayTitle: string | null }
  | { ok: false; reason: string }
  | null;

export async function postHofTitle(titleId: string | null): Promise<HofSetTitleApiResult> {
  try {
    const res = await fetch("/api/hof/title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titleId }),
    });
    const json = (await res.json()) as
      | { ok: true; displayTitle: string | null }
      | { error: string; code?: string };
    if (!res.ok || !("ok" in json) || !json.ok) {
      const reason = "code" in json && json.code ? json.code : "unknown";
      return { ok: false, reason };
    }
    return json;
  } catch {
    return null;
  }
}
