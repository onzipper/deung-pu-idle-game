/**
 * "ตำราตำนาน" tome + legendary craft (endgame v1.2/v1.3) — thin `fetch`
 * wrappers over `/api/asura/*` (server zone, read-only from here). Same tier
 * as `ui/gear/api.ts`'s `postRefine`/`postBuyback` — non-2xx resolves to
 * `{ ok: false, reason }` rather than throwing.
 */

import type {
  AsuraAwakenApiResult,
  AsuraCraftApiResult,
  AsuraSigilApiResult,
} from "@/ui/asura/types";
import type { ItemInstanceWire } from "@/ui/gear/types";

/** POST /api/asura/sigil — claim today's daily z10 ตราอสูร sigil. */
export async function postClaimAsuraSigil(): Promise<AsuraSigilApiResult> {
  try {
    const res = await fetch("/api/asura/sigil", { method: "POST" });
    if (res.ok) return { ok: true };
    const json = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    const reason = json?.code ?? json?.error ?? "unknown";
    return { ok: false, reason };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** POST /api/asura/craft — sacrifice the t10 class weapon at `instanceId` for
 * the crafted legendary (server-validated: ownership, tier, class, slot). */
export async function postCraftLegendary(instanceId: string): Promise<AsuraCraftApiResult> {
  try {
    const res = await fetch("/api/asura/craft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId }),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok: true; item: ItemInstanceWire }
      | { error?: string; code?: string }
      | null;
    if (!res.ok || !json || !("ok" in json) || !json.ok) {
      const reason =
        json && "code" in json && json.code
          ? json.code
          : json && "error" in json && json.error
            ? json.error
            : "unknown";
      return { ok: false, reason };
    }
    return { ok: true, item: json.item };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** POST /api/asura/awaken — GUARANTEED +1 ("ปลุกพลัง") on the legendary at
 * `instanceId` (server-validated: ownership, kind legendary, +5 cap, funds).
 * Non-2xx resolves to `{ ok: false, reason }` via the route's `code` field
 * (falls back to `error`, then "unknown") — same shape as `postRefine`. */
export async function postAwakenLegendary(instanceId: string): Promise<AsuraAwakenApiResult> {
  try {
    const res = await fetch("/api/asura/awaken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId }),
    });
    const json = (await res.json().catch(() => null)) as
      | Omit<Extract<AsuraAwakenApiResult, { ok: true }>, "ok">
      | { error?: string; code?: string }
      | null;
    if (!res.ok || !json) {
      const reason =
        json && "code" in json && json.code
          ? json.code
          : json && "error" in json && json.error
            ? json.error
            : "unknown";
      return { ok: false, reason };
    }
    return { ok: true, ...(json as Omit<Extract<AsuraAwakenApiResult, { ok: true }>, "ok">) };
  } catch {
    return { ok: false, reason: "network" };
  }
}
