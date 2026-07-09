"use client";

/**
 * R2-W2 "fullscreen HUD" — the mockup's bottom-edge strip: a full-width thin
 * EXP bar with a small local-clock readout pinned to its bottom-right corner.
 * Sits at the TRUE bottom of the viewport, below the skill dock (see
 * `GameHud.tsx`'s bottom overlay region) — `env(safe-area-inset-bottom)` is
 * applied here (the actual bottom-most HUD element) rather than on the dock
 * above it.
 *
 * EXP fraction reads the SAME `hero.xpProgress`/`atLevelCap` fields
 * `HeroPortraitCard`/`StatPanel` already use — no new engine/store read path.
 * The clock is a plain client-local `Date` read, refreshed on an interval
 * (never a direct `Date.now()` call in the render body — React's purity rule
 * forbids that, same convention `UpdateBanner.tsx` follows for its own
 * wall-clock check).
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useGameStore } from "@/ui/store/gameStore";

/** Minute-resolution display — no need to tick faster than this. */
const CLOCK_REFRESH_MS = 15_000;

function formatClock(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function ExpClockStrip() {
  const hero = useGameStore((s) => s.heroes[0]);
  const t = useTranslations("panels");

  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount seed (see UpdateBanner.tsx's identical pattern)
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), CLOCK_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  if (!hero) return null;
  const pct = hero.atLevelCap
    ? 100
    : Math.max(0, Math.min(1, hero.xpProgress)) * 100;

  return (
    <div
      className="relative w-full"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div
        role="progressbar"
        aria-label={t("expBarLabel")}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1 w-full overflow-hidden bg-black/60"
      >
        <div
          className="h-full bg-gradient-to-r from-ddp-gold to-ddp-gold-bright transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="pointer-events-none absolute left-1.5 bottom-1 rounded bg-black/55 px-1 text-[10px] leading-tight font-semibold text-ddp-ink-muted">
        {t("expBarLabel")}{" "}
        <span className="tabular-nums text-ddp-gold">{pct.toFixed(1)}%</span>
      </span>
      {now && (
        <span className="pointer-events-none absolute right-1.5 bottom-1 rounded bg-black/55 px-1 text-[10px] leading-tight font-semibold tabular-nums text-ddp-ink-muted">
          {formatClock(now)}
        </span>
      )}
    </div>
  );
}
