"use client";

/**
 * Base-stat panel (M5 "Base stats"): per-stat +buttons, an unspent-points badge,
 * and the combat-power ("พลังต่อสู้") readout for the solo hero. All numbers come
 * from the throttled `HeroSummary` snapshot; a +tap queues an `allocateStat`
 * intent (drained once per real frame, like evolve). The auto-allocate ON/OFF
 * toggle itself lives in the consolidated `BotSettingsModal.tsx` (owner UX
 * consolidation, 2026-07-07) — this panel still READS `autoAllocate` (below)
 * to disable manual +taps while it's on, since auto owns the primary stat then.
 *
 * M7.9 stat-tap-fix (UAT "กดไม่ค่อยติด"): the store now ACCUMULATES same-frame
 * taps instead of last-wins (see `PendingInput.allocateStat`'s doc), so no tap
 * is silently dropped on a slow/low-fps frame. On TOP of that, this panel reads
 * `optimisticStatSpend` to render the spend INSTANTLY — `hero.statPoints`/
 * `hero.stats[stat]` only update on the next ~10Hz throttled snapshot
 * (`CONFIG.uiSyncHz`), which felt "dead" for up to ~100ms and invited re-taps.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { StatKey } from "@/engine";
import type { HeroSummary } from "@/ui/store/gameStore";
import { useGameStore } from "@/ui/store/gameStore";

/** Fixed display order (str/dex/int/vit). */
const STAT_ORDER: readonly StatKey[] = ["str", "dex", "int", "vit"];

/** How long one floating "+1" rise-and-fade plays (matches `animate-refine-rise`
 * in globals.css — reused as-is, no new visual language). */
const RISE_MS = 1100;
/** Cap on simultaneously-rising "+1" toasts per row — a mashed button shouldn't
 * grow this unboundedly (oldest evicted first, same pattern as `dropFeed`). */
const MAX_RISERS = 3;

let riserSeq = 0;

function StatRow({
  hero,
  stat,
  pendingSpend,
}: {
  hero: HeroSummary;
  stat: StatKey;
  /** Total unspent points already queued (all stats) this "optimistic window" —
   * used to disable the button ahead of the stale snapshot catching up. */
  pendingSpend: number;
}) {
  const allocateStat = useGameStore((s) => s.allocateStat);
  const autoAllocate = useGameStore((s) => s.autoAllocate);
  const optimisticHere = useGameStore((s) => s.optimisticStatSpend[stat] ?? 0);
  const t = useTranslations("stats");

  // Instant local feedback: show the tap's effect before the next throttled
  // snapshot confirms it (reconciled away in `syncFromEngine` — see that
  // action's doc in gameStore.ts).
  const value = hero.stats[stat] + optimisticHere;
  const isPrimary = hero.primaryStat === stat;
  const pointsExhausted = hero.statPoints - pendingSpend <= 0;
  // +1 is available only when there are unspent points (reading the OPTIMISTIC
  // count, not the stale snapshot one, so a mashed button disables cleanly the
  // instant its points run out) and auto-allocate is off (auto owns the
  // primary stat; a manual tap would race it every frame).
  const canAdd = !pointsExhausted && !autoAllocate;

  const [risers, setRisers] = useState<{ id: number }[]>([]);
  const [tapKey, setTapKey] = useState(0);
  // Audit #5 (owner-reported "silence"): while Auto Stat is on, the + button
  // used to just sit there disabled with no explanation. `title` covers desktop
  // hover; this flash covers mobile taps — the button stays TAPPABLE (not the
  // native `disabled` attribute, which would swallow the click entirely) so a
  // tap flashes the "turn off Auto Stat" hint instead of dead silence.
  const [autoHintFlash, setAutoHintFlash] = useState(false);
  const autoHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (autoHintTimer.current) clearTimeout(autoHintTimer.current);
    },
    [],
  );

  const handleClick = () => {
    if (autoAllocate) {
      setAutoHintFlash(true);
      if (autoHintTimer.current) clearTimeout(autoHintTimer.current);
      autoHintTimer.current = setTimeout(() => setAutoHintFlash(false), 1800);
      return;
    }
    if (!canAdd) return;
    allocateStat(stat, 1);
    setTapKey((k) => k + 1);
    setRisers((prev) => [...prev, { id: ++riserSeq }].slice(-MAX_RISERS));
  };

  // Sweep expired risers off the pool (pooled/simple — no per-riser effect).
  useEffect(() => {
    if (risers.length === 0) return;
    const timer = window.setTimeout(() => {
      setRisers((prev) => prev.slice(1));
    }, RISE_MS);
    return () => window.clearTimeout(timer);
  }, [risers]);

  return (
    <div className="flex items-center gap-2 rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/40 px-2.5 py-1.5">
      <div className="flex flex-col leading-tight">
        <span
          className={`text-xs font-bold ${isPrimary ? "text-ddp-gold-bright" : "text-ddp-ink"}`}
          title={`${t(`full.${stat}`)} — ${t(`effect.${stat}`)}`}
        >
          {t(`names.${stat}`)}
          {isPrimary && (
            <span className="ml-1 align-middle text-[9px] font-semibold text-ddp-gold-bright/80 uppercase">
              {t("primaryTag")}
            </span>
          )}
        </span>
        <span className="text-sm font-bold tabular-nums text-ddp-ink">{value}</span>
      </div>
      {/* Positioning root for the risers + press-flash overlay. The button
          itself is already a 44x44px (`h-11 w-11`) circle — a mobile-safe
          touch target as-is (`min-h-11 min-w-11` below just guards it from
          ever being squashed by a flex neighbor). */}
      <div className="relative ml-auto shrink-0">
        {risers.map((r) => (
          <span
            key={r.id}
            className="animate-refine-rise pointer-events-none absolute inset-x-0 -top-1 text-center text-sm font-bold text-emerald-300"
            aria-hidden="true"
          >
            +1
          </span>
        ))}
        <button
          type="button"
          // Native `disabled` ONLY for the "truly nothing to do" case (no
          // points left, auto off) — while auto-allocate is ON the button
          // stays a real, tappable element (so `handleClick`'s flash-hint
          // branch above actually fires; a `disabled` button eats the click
          // entirely) even though it reads visually the same as disabled.
          disabled={!autoAllocate && pointsExhausted}
          onClick={handleClick}
          title={autoAllocate ? t("autoBlockedHint") : undefined}
          aria-label={t("allocateAria", { stat: t(`full.${stat}`) })}
          className={`relative grid h-11 min-h-11 w-11 min-w-11 place-items-center rounded-full border text-lg font-bold leading-none transition-transform duration-100 active:scale-90 ${
            canAdd
              ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25"
              : autoAllocate
                ? "cursor-pointer border-ddp-border bg-black/30 text-ddp-ink-muted"
                : "cursor-not-allowed border-ddp-border bg-black/30 text-ddp-ink-muted"
          }`}
        >
          {/* Key-remounted flash ring on every accepted tap — instant, visible
              press feedback even before the button's own active:scale-90
              transition finishes (reuses `animate-buy-pulse`, same juice
              vocabulary as the points badge below). Not gated on `canAdd`:
              the tap that spends the LAST point still deserves its flash even
              though the button is disabled the instant after. */}
          {tapKey > 0 && (
            <span
              key={tapKey}
              className="animate-buy-pulse pointer-events-none absolute inset-0 rounded-full bg-emerald-400/30"
              aria-hidden="true"
            />
          )}
          <span className="relative">+</span>
          {autoHintFlash && (
            <span
              role="tooltip"
              className="absolute bottom-full left-1/2 z-20 mb-1.5 w-36 -translate-x-1/2 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong p-1.5 text-[10px] leading-snug font-normal whitespace-normal text-ddp-ink shadow-(--ddp-shadow-panel)"
            >
              {t("autoBlockedHint")}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

export function StatPanel() {
  const heroes = useGameStore((s) => s.heroes);
  const optimisticStatSpend = useGameStore((s) => s.optimisticStatSpend);
  const t = useTranslations("stats");

  // Solo gameplay: the stat panel drives the single active character.
  const hero = heroes[0];
  if (!hero) return null;

  const pendingSpend = Object.values(optimisticStatSpend).reduce(
    (sum, n) => sum + (n ?? 0),
    0,
  );
  const displayedPoints = Math.max(0, hero.statPoints - pendingSpend);

  return (
    // R2-W2 "fullscreen HUD": `stat-panel` moved to `CharacterButton.tsx`'s
    // `character-menu` trigger — this panel now lives inside a modal
    // (`CharacterPanel.tsx`), not the always-visible HUD flow, so it no
    // longer carries an onboarding anchor of its own.
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold tracking-wider text-ddp-ink-muted uppercase">
        {t("title")}
      </span>

      {displayedPoints > 0 && (
        <span
          className="animate-buy-pulse rounded-full border border-ddp-gold/60 bg-ddp-gold/15 px-2.5 py-1 text-xs font-bold text-ddp-gold-bright tabular-nums"
          title={t("pointsTitle")}
        >
          {t("pointsBadge", { count: displayedPoints })}
        </span>
      )}

      <span className="rounded-full border border-ddp-border-soft bg-black/50 px-2.5 py-1 text-xs font-bold text-ddp-ink tabular-nums">
        {t("combatPower")}: {hero.combatPower.toLocaleString()}
      </span>

      <div className="flex flex-wrap gap-1.5">
        {STAT_ORDER.map((stat) => (
          <StatRow key={stat} hero={hero} stat={stat} pendingSpend={pendingSpend} />
        ))}
      </div>
    </div>
  );
}
