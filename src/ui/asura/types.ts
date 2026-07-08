/**
 * "ตำราตำนาน" tome + legendary craft (endgame v1.2/v1.3) — UI-side wire shapes
 * crossing the `/api/asura/*` HTTP boundary. Same convention as
 * `ui/gear/types.ts`: a network-boundary DTO redeclared here, never a reach
 * into `@/server/**`.
 */

import type { ItemInstanceWire } from "@/ui/gear/types";

/** POST /api/asura/sigil (daily z10 ตราอสูร claim) — the server stamps the
 * Bangkok day so a repeat same-day call is rejected (`alreadyClaimed`), never
 * double-banked. `reason` is a generic string; `ui/asura/tomeFlow.ts` narrows
 * it to the known contract reasons for i18n lookup (falls back to "unknown"). */
export type AsuraSigilApiResult = { ok: true } | { ok: false; reason: string };

/** POST /api/asura/craft (the tome recipe) — `instanceId` is the sacrificed
 * t10 class weapon; on success the server mints the bind-on-craft legendary
 * and returns it (same wire shape as an equip/claim response's `item`). */
export type AsuraCraftApiResult =
  | { ok: true; item: ItemInstanceWire }
  | { ok: false; reason: string };

/** POST /api/asura/awaken ("ปลุกพลัง") — GUARANTEED +1 on an owned legendary.
 * The server debits stones (authoritative `Character.materials`) + checks gold
 * (save-blob balance) and returns the new +level plus the signed deltas the
 * client applies via its `materialsDelta` + gold intents (the refine shape). */
export type AsuraAwakenApiResult =
  | {
      ok: true;
      refineLevel: number;
      materials: number;
      materialsDelta: number;
      goldDelta: number;
      cost: { gold: number; stones: number };
    }
  | { ok: false; reason: string };
