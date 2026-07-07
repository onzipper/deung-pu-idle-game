/**
 * UAT "ซื้อคืน" (buy-back) — re-purchase an accidentally-SOLD item from ป้าปุ๊
 * within the server's 3-day window, at the price it was originally sold for.
 * Same "POST first, only mutate local state on success" rule as
 * `sellFlow.ts`/`refineFlow.ts`: `ShopPanel.tsx`'s third tab is the only
 * caller.
 *
 * On success the returned item (same wire shape as an inventory-GET item) is
 * merged into the local inventory slice (reusing the exact same
 * `mergeInventory` the drop-claim flush uses) and the SIGNED (negative)
 * `goldCredit` intent is queued — the same signed path `refineFlow.ts` uses
 * for its cost deduction. On failure this pushes a `notices.buyback.<reason>`
 * toast (`NoticeToast.tsx`) itself, so `ShopPanel.tsx`'s row stays thin.
 *
 * KNOWN MVP gap (mirrors `refineFlow.ts`'s server-authoritative-gold doc):
 * there is no cross-module "flush the autosave now" hook reachable from this
 * layer — `GameClient.tsx` owns the only live engine-state closure that can
 * serialize a fresh `SaveData`, and wiring a new store-flag round-trip there
 * (à la `requestReload`/`updateReloadRequested`) is out of this task's
 * src/ui-only scope. Like refine/sell today, the server's gold check reads
 * whatever it last received from the ≤30s autosave cadence — an accepted,
 * already-shipped tradeoff, not a new one introduced here.
 */

import { fetchBuybackList as getBuybackList, postBuyback } from "@/ui/gear/api";
import type { BuybackListItemWire } from "@/ui/gear/types";
import { useGameStore } from "@/ui/store/gameStore";

export type BuybackListEntry = BuybackListItemWire;

/** Every reason the server contract defines, plus this layer's own
 * `"network"` (fetch/parse failure). Anything unrecognized collapses to
 * `"unknown"` so a stale client never crashes on a future server reason. */
export type BuybackReason =
  | "notFound"
  | "expired"
  | "insufficientGold"
  | "bagFull"
  | "network"
  | "unknown";

const KNOWN_REASONS: ReadonlySet<string> = new Set([
  "notFound",
  "expired",
  "insufficientGold",
  "bagFull",
]);

/** Pure reason normalizer (headlessly testable) — picks the
 * `notices.buyback.<reason>` i18n key `executeBuyback` pushes on failure. */
export function normalizeBuybackReason(raw: string | undefined): BuybackReason {
  if (raw === "network") return "network";
  return raw != null && KNOWN_REASONS.has(raw) ? (raw as BuybackReason) : "unknown";
}

export interface BuybackCountdown {
  /** i18n key suffix under `shop.buybackCountdown.*`, or `"expired"` — a row
   * showing `"expired"` should be treated as already gone (the server list
   * is soonest-to-expire-first and already unexpired-only at fetch time, but
   * a still-open panel can outlive an entry's window). */
  unit: "days" | "hours" | "minutes" | "expired";
  params: { d?: number; h?: number; m?: number };
}

/**
 * Pure, wall-clock countdown formatter (UI layer may read `Date.now()` —
 * CLAUDE.md's determinism rule is scoped to the ENGINE only). Coarse
 * days+hours while a day or more remains, hours+minutes once under a day,
 * and minutes-only once under an hour — deliberately MORE precise as the
 * window closes, per spec ("minutes-level at the end").
 */
export function formatBuybackCountdown(
  expiresAtIso: string,
  nowMs: number = Date.now(),
): BuybackCountdown {
  const expiresMs = Date.parse(expiresAtIso);
  const remainingMs = expiresMs - nowMs;
  if (!Number.isFinite(expiresMs) || remainingMs <= 0) return { unit: "expired", params: {} };

  const totalMinutes = Math.floor(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days >= 1) return { unit: "days", params: { d: days, h: hours } };
  if (hours >= 1) return { unit: "hours", params: { h: hours, m: minutes } };
  return { unit: "minutes", params: { m: minutes } };
}

/** GET the buy-back list. Returns `null` on a network/parse failure so the
 * tab can tell "genuinely empty" apart from "couldn't load" (retry tap). */
export async function fetchBuybackList(): Promise<BuybackListEntry[] | null> {
  const res = await getBuybackList();
  return res ? res.items : null;
}

export interface BuybackFlowResult {
  ok: boolean;
  reason?: BuybackReason;
}

/**
 * POST the re-purchase, then on success append the returned item to the
 * local inventory slice + queue the signed (negative) `goldCredit` intent.
 * On failure, pushes the mapped `notices.buyback.<reason>` toast and returns
 * the normalized reason (the row uses this only to clear its own busy state
 * — the toast IS the user-facing error surface here, unlike RefinePanel's
 * inline `apiError.*` copy).
 */
export async function executeBuyback(soldItemId: string): Promise<BuybackFlowResult> {
  const res = await postBuyback(soldItemId);
  const store = useGameStore.getState();

  if (!res.ok) {
    const reason = normalizeBuybackReason(res.reason);
    store.pushNotice(`buyback.${reason}`);
    return { ok: false, reason };
  }

  store.mergeInventory([res.item]);
  if (res.goldDelta) store.creditGold(res.goldDelta);
  return { ok: true };
}
