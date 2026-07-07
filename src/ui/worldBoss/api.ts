/**
 * World boss "เสี่ยจ๋อง" — thin `fetch` wrapper over `POST /api/worldboss/claim`.
 * Same tier/shape as `ui/gear/api.ts`'s network wrappers (no engine import, no
 * store access — `GameClient.tsx` owns applying the result).
 */

import type { ItemInstanceWire } from "@/ui/gear/types";

export type WorldBossClaimApiResult =
  | { ok: true; item: ItemInstanceWire; goldCredit: number; materialsTotal: number }
  | { ok: false; reason: string }
  /** Network/parse failure — distinct from a definite server rejection so the
   *  caller knows a retry is worthwhile (mirrors `postEquip`'s `EquipApiResult`
   *  convention, but `null` here since retrying is the caller's own decision). */
  | null;

export async function postWorldBossClaim(
  characterId: string,
  windowId: number,
): Promise<WorldBossClaimApiResult> {
  try {
    const res = await fetch("/api/worldboss/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId, windowId }),
    });
    const json = (await res.json()) as
      | { ok: true; item: ItemInstanceWire; goldCredit: number; materialsTotal: number }
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
