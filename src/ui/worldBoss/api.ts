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

/** M8.6 SHARED-HP client driver: thin wrappers over the two world-boss endpoints
 * (`server/worldBoss.ts`'s doc). Same tier as `postWorldBossClaim` above — no engine
 * import, no store access; `GameClient.tsx` owns applying the result via the
 * `spawnWorldBoss{hp}` seed / `syncWorldBoss` intents. */
export type WorldBossStateApiResult =
  | { ok: true; windowId: number; hp: number; defeated: boolean }
  | null;

/** `GET /api/worldboss/state?windowId=` — read-only shared-pool level, used to seed a
 * fresh spawn/re-entry at the REAL server value instead of full hp. */
export async function getWorldBossState(windowId: number): Promise<WorldBossStateApiResult> {
  try {
    const res = await fetch(`/api/worldboss/state?windowId=${windowId}`);
    const json = (await res.json()) as
      | { ok: true; windowId: number; hp: number; defeated: boolean }
      | { error: string };
    if (!res.ok || !("ok" in json) || !json.ok) return null;
    return json;
  } catch {
    return null;
  }
}

export type WorldBossDamageApiResult =
  | { ok: true; hp: number; defeated: boolean }
  | { ok: false; reason: string }
  | null;

/** `POST /api/worldboss/damage` — report a damage batch against the shared pool; the
 * response's `hp` feeds the caller's `syncWorldBoss` engine intent. */
export async function postWorldBossDamage(
  windowId: number,
  damage: number,
): Promise<WorldBossDamageApiResult> {
  try {
    const res = await fetch("/api/worldboss/damage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ windowId, damage }),
    });
    const json = (await res.json()) as
      | { ok: true; hp: number; defeated: boolean }
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
