"use client";

/**
 * Mid-session "new patch deployed" banner (owner-approved feature). Sibling
 * of `AnnouncementBanner.tsx` in the SAME top-of-viewport strip — deliberately
 * QUIETER (no shimmer sweep, no auto-dismiss timer, stays put until the
 * player acts) since this isn't a celebratory toast, it's a persistent-but-
 * quiet nudge. Mutually exclusive with `AnnouncementBanner`: hidden whenever
 * a real announcement is queued/showing (owner spec: "announcements play
 * first, update banner stays after") — both components independently read
 * `announcementQueue`, so they naturally never render at the same time.
 *
 * All show/hide DECISION logic is the pure `resolveUpdateBannerDecision`
 * (`ui/updateBanner.ts`); this component only presents it + wires the two
 * buttons into store actions. The dismiss cooldown is wall-clock-based (not
 * event-based), so `now` is tracked as state (set once a minute from a
 * `useEffect`, never read via a direct `Date.now()` call in the render body —
 * React's purity rule bans that) purely to notice "cooldown expired -> show
 * again" — this is a UI-only re-render concern, not game state.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useGameStore } from "@/ui/store/gameStore";
import { CLIENT_BUILD_ID, resolveUpdateBannerDecision } from "@/ui/updateBanner";

/** How often to re-check the dismiss cooldown while a mismatch is dismissed
 * (cosmetic scheduling only — see this file's doc comment). */
const RECHECK_INTERVAL_MS = 60_000;

export function UpdateBanner() {
  const serverBuildId = useGameStore((s) => s.serverBuildId);
  const dismissedAt = useGameStore((s) => s.updateBannerDismissedAt);
  const dismissedForId = useGameStore((s) => s.updateBannerDismissedForId);
  const announcementActive = useGameStore((s) => s.announcementQueue.length > 0);
  const dismiss = useGameStore((s) => s.dismissUpdateBanner);
  const requestReload = useGameStore((s) => s.requestReload);
  const t = useTranslations("updateBanner");

  // `now` lives in state (never a direct `Date.now()` call in the render
  // body — React's purity rule forbids that): set once on mount + refreshed
  // once a minute so a lapsed dismiss cooldown gets noticed (see doc above).
  // `null` pre-effect -> render nothing for that first instant.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // The synchronous `setNow` here is the deliberate "seed the clock on
    // mount" case (same justification as `CharactersScreen.tsx`'s one-shot
    // mount fetch): there's no reactive dependency to resync against — this
    // effect never re-runs — it's just how a render-body-forbidden
    // `Date.now()` read gets into React state at all.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount seed, see above
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), RECHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  if (announcementActive || now === null) return null;

  const decision = resolveUpdateBannerDecision({
    clientBuildId: CLIENT_BUILD_ID,
    serverBuildId,
    dismissedForId,
    dismissedAt,
    now,
  });
  if (decision === "hide") return null;

  // `serverBuildId` is non-null here (a "show" decision requires a mismatch
  // against a real server id) — narrowed for the dismiss handler below.
  const mismatchedId = serverBuildId as string;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-74 flex justify-center px-3 pt-[max(0.5rem,env(safe-area-inset-top))]"
    >
      <div className="pointer-events-auto flex w-full max-w-3xl items-center gap-2 rounded-b-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong px-3 py-1.5 shadow-(--ddp-shadow-panel)">
        <span className="flex-1 text-xs font-bold text-ddp-ink sm:text-sm">{t("message")}</span>
        <button
          type="button"
          title={t("buttonTooltip")}
          onClick={requestReload}
          className="min-h-11 shrink-0 rounded-(--ddp-radius-md) border border-ddp-gold/70 bg-ddp-gold/20 px-3 text-xs font-black text-ddp-gold-bright shadow-(--ddp-shadow-btn) transition-transform duration-100 active:translate-y-0.5 active:scale-[0.97] sm:text-sm"
        >
          {t("button")}
        </button>
        <button
          type="button"
          aria-label={t("closeButton")}
          onClick={() => dismiss(mismatchedId)}
          className="min-h-11 shrink-0 rounded-(--ddp-radius-md) px-2 text-xs font-semibold text-ddp-ink-muted hover:text-ddp-ink"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
