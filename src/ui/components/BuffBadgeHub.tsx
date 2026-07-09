"use client";

/**
 * Buff Badge Hub v3 (owner ask, "ห้ามดันจอ": the strip used to sit IN-FLOW
 * above `HudBar` and pushed the arena/console dock down whenever a buff
 * appeared — banned outright). The badge SET itself is computed by the pure,
 * headlessly-tested `ui/buffs/activeBuffs.ts` (same logic/view split as
 * `WorldBossBanner.tsx` + `ui/worldBoss/schedule.ts`) — this component is
 * presentational glue only, and `activeBuffs.ts` itself is untouched by v3.
 *
 * v3 changes (both approved by the owner):
 *  1. ZERO layout participation — the hub no longer renders as a sibling of
 *     `HudBar`/the arena. `GameHud.tsx` now mounts it as an ABSOLUTE overlay
 *     INSIDE the arena's canvas-slot container (top:8px/left:8px), which is
 *     already `position:relative` for the decorative frame overlay. The
 *     outer wrapper is `pointer-events-none` (never blocks the arena's own
 *     pointerdown/audio-resume listener or hit-testing) with
 *     `pointer-events-auto` restored per chip so tapping still works.
 *  2. Icon-first chips — each buff is now a 32px icon square (thin border,
 *     no text label) with a `conic-gradient` duration-fill ring (CSS mask,
 *     no canvas/asset) that sweeps clockwise as the buff's remaining time
 *     shrinks, plus a tiny corner badge (seconds for timed buffs like War
 *     Cry, the effect percent for buffs with no timer like the party XP
 *     buff, e.g. `activeBuffs.ts` never carries a "total duration" field so
 *     the fill fraction for War Cry is derived here from
 *     `SKILLS.sword_warcry.buffDuration`, the same skill config source the
 *     seconds themselves come from). Tap toggles the SAME source+detail
 *     tooltip copy as before (`buffHub.source.*`/`detail.*`); tooltip opens
 *     LEFT-ALIGNED under the chip (not centered) and stays inside the
 *     arena's `overflow-hidden` bounds since chips now live in its top-left
 *     corner instead of a full-width centered strip.
 *
 * Chip cap (`activeBuffs.ts#capBuffBadges`, unchanged) still holds the row at
 * N total slots (2 mobile / 3 `sm:`+) with a "+N" overflow chip past that —
 * see `OverflowChip`. Renders nothing (zero DOM) with no active buffs.
 *
 * R2-W2 "fullscreen HUD": the hub no longer positions ITSELF (`absolute
 * top-[14%] left-2`) — `GameHud.tsx` now stacks it as a normal flow child
 * directly below `HeroPortraitCard` in the top-left overlay column, so the
 * two never need hand-tuned percentage offsets to avoid colliding. This
 * component only renders the row(s) of chips now.
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type RefObject } from "react";
import { SKILLS } from "@/engine";
import {
  buildActiveBuffBadges,
  capBuffBadges,
  type BuffBadge,
} from "@/ui/buffs/activeBuffs";
import { useAnimatedChips } from "@/ui/buffs/useAnimatedChips";
import { useGameStore } from "@/ui/store/gameStore";

/** War Cry is the only timed (depleting) badge kind today; `activeBuffs.ts`
 * only carries the REMAINING seconds (`params.seconds`), not a total, so the
 * ring's fill fraction is derived here against the skill's own configured
 * `buffDuration` — the single source of truth `skills.ts` reads to set the
 * timer in the first place. Falls back to the raw seconds (ring reads as
 * "full") if the skill entry is ever missing, rather than dividing by zero. */
const WAR_CRY_DURATION_SEC = SKILLS.sword_warcry?.buffDuration ?? 6;

/** Total chip SLOTS (real chips + the overflow chip if one is needed) the row
 * is allowed to use per breakpoint — judged against a 360px mobile viewport
 * fitting two labeled chips + an overflow chip on one line (see the v2 task's
 * width check). Both rows render in the DOM simultaneously; only one is
 * visible at a time via `sm:hidden`/`hidden sm:flex`, so the cap is a pure
 * CSS-breakpoint switch with no resize listener needed. */
const MOBILE_MAX_SLOTS = 2;
const DESKTOP_MAX_SLOTS = 3;

/** Smoothly ticks a countdown DOWN in real time between throttled (~10Hz)
 * snapshot updates instead of visually stair-stepping — mirrors
 * `SkillBar.tsx`'s identically-named helper (kept as its own copy here since
 * the two components are otherwise decoupled; not worth a shared-hook file
 * for one 20-line effect). Resyncs its baseline whenever `remaining` changes
 * (a fresh snapshot value, including a brand-new cast resetting it back up). */
function useSmoothCountdown(remaining: number): number {
  const [display, setDisplay] = useState(remaining);

  useEffect(() => {
    if (remaining <= 0) {
      const resetId = setTimeout(() => setDisplay(0), 0);
      return () => clearTimeout(resetId);
    }
    const startedAt = performance.now();
    const startValue = remaining;
    const resetId = setTimeout(() => setDisplay(remaining), 0);
    const tickId = setInterval(() => {
      const elapsedSec = (performance.now() - startedAt) / 1000;
      setDisplay(Math.max(0, startValue - elapsedSec));
    }, 100);
    return () => {
      clearTimeout(resetId);
      clearInterval(tickId);
    };
  }, [remaining]);

  return display;
}

/** Shared outside-tap-to-close affordance for both `BuffChip` and
 * `OverflowChip`'s tooltip bubble (same idiom as `InfoTip.tsx`). */
function useTapOutsideToClose(open: boolean, onClose: () => void, rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onClose, rootRef]);
}

function BuffChip({ badge }: { badge: BuffBadge }) {
  const t = useTranslations("buffHub");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  // War Cry's `seconds` param ticks smoothly between snapshots for the same
  // "feel" reason `SkillBar.tsx` interpolates its own cooldown sweeps; every
  // other badge kind's params are already display-ready as-is.
  const smoothSeconds = useSmoothCountdown(
    badge.kind === "warCry" ? Number(badge.params.seconds) : 0,
  );
  const params =
    badge.kind === "warCry"
      ? { ...badge.params, seconds: Math.max(0, Math.ceil(smoothSeconds)) }
      : badge.params;

  useTapOutsideToClose(open, () => setOpen(false), rootRef);

  // Ring fill = fraction of duration REMAINING (1 = just cast, 0 = about to
  // fall off) — the conic-gradient's dark slice grows clockwise as this
  // shrinks. Buffs with no timer (party XP: active as long as the cohort
  // holds) never deplete, so their ring stays fully lit and the corner badge
  // shows the effect percent instead of a countdown.
  const isTimed = badge.kind === "warCry";
  const fraction = isTimed
    ? WAR_CRY_DURATION_SEC > 0
      ? Math.max(0, Math.min(1, smoothSeconds / WAR_CRY_DURATION_SEC))
      : 0
    : 1;
  const cornerText = isTimed
    ? String(Math.max(0, Math.ceil(smoothSeconds)))
    : `${typeof badge.params.percent === "number" ? badge.params.percent : 0}%`;
  const darkDeg = (1 - fraction) * 360;
  const label = `${t(`source.${badge.sourceKey}`, params)} · ${t(`chip.${badge.kind}`, params)}`;

  return (
    <span ref={rootRef} className="relative inline-flex shrink-0 pointer-events-auto">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={label}
        className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-md border border-ddp-gold/50 bg-ddp-panel-strong/90 shadow-(--ddp-shadow-panel) transition-transform duration-100 active:scale-95"
      >
        {/* Duration-fill mask (owner-approved "radial clockwise" ring) —
            transparent lets the panel bg + icon show through for the
            REMAINING slice; the dark slice covers elapsed time. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `conic-gradient(rgba(0,0,0,0.62) 0deg ${darkDeg}deg, transparent ${darkDeg}deg 360deg)`,
          }}
        />
        <span aria-hidden className="relative text-base leading-none">
          {badge.icon}
        </span>
        <span
          aria-hidden
          className="pointer-events-none absolute -right-1 -bottom-1 rounded-full bg-black/80 px-1 text-[8px] leading-tight font-bold tabular-nums text-ddp-gold-bright"
        >
          {cornerText}
        </span>
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute top-full left-0 z-20 mt-1.5 w-52 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong p-2 text-[11px] leading-snug font-normal text-ddp-ink shadow-(--ddp-shadow-panel)"
        >
          <span className="mb-1 block font-bold text-ddp-gold-bright">
            {t(`source.${badge.sourceKey}`, params)}
          </span>
          {t(`detail.${badge.kind}`, params)}
        </span>
      )}
    </span>
  );
}

/** The "+N" overflow chip (UX-audit weakness #4 fix) — collapses whatever
 * `capBuffBadges` bumped past the row's slot cap into one compact chip that
 * opens a small tooltip sheet listing each hidden buff's full detail line. */
function OverflowChip({ badges }: { badges: readonly BuffBadge[] }) {
  const t = useTranslations("buffHub");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useTapOutsideToClose(open, () => setOpen(false), rootRef);

  return (
    <span ref={rootRef} className="relative inline-flex shrink-0 pointer-events-auto">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t("overflowChip", { count: badges.length })}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-ddp-border-soft bg-black/50 text-[10px] font-bold tabular-nums text-ddp-ink-muted transition-transform duration-100 active:scale-95"
      >
        {t("overflowChip", { count: badges.length })}
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute top-full left-0 z-20 mt-1.5 w-56 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong p-2 text-[11px] leading-snug font-normal text-ddp-ink shadow-(--ddp-shadow-panel)"
        >
          <span className="mb-1 block font-bold text-ddp-gold-bright">{t("overflowTitle")}</span>
          <ul className="flex flex-col gap-1.5">
            {badges.map((b) => (
              <li key={b.id} className="flex items-start gap-1">
                <span aria-hidden>{b.icon}</span>
                <span>{t(`detail.${b.kind}`, b.params)}</span>
              </li>
            ))}
          </ul>
        </span>
      )}
    </span>
  );
}

type ChipSlot = { kind: "badge"; badge: BuffBadge } | { kind: "overflow"; badges: readonly BuffBadge[] };

/** One capped, animated chip row for a given slot budget — `BuffBadgeHub`
 * renders two of these (mobile cap + desktop cap) and lets CSS breakpoints
 * pick which is visible, so the cap never needs a JS resize listener. */
function BuffBadgeRow({
  badges,
  maxSlots,
  className,
}: {
  badges: readonly BuffBadge[];
  maxSlots: number;
  className: string;
}) {
  const { visible, overflow } = capBuffBadges(badges, maxSlots);
  const slots = [
    ...visible.map((badge) => ({ key: badge.id, item: { kind: "badge", badge } as ChipSlot })),
    ...(overflow.length > 0
      ? [{ key: "__overflow__", item: { kind: "overflow", badges: overflow } as ChipSlot }]
      : []),
  ];
  const chips = useAnimatedChips(slots);

  return (
    <div className={`items-start gap-1.5 ${className}`}>
      {chips.map((c) => (
        <span
          key={c.key}
          className={`inline-flex shrink-0 transition-all duration-150 ease-out ${
            c.phase === "idle" ? "scale-100 opacity-100" : "scale-90 opacity-0"
          }`}
        >
          {c.item.kind === "overflow" ? (
            <OverflowChip badges={c.item.badges} />
          ) : (
            <BuffChip badge={c.item.badge} />
          )}
        </span>
      ))}
    </div>
  );
}

export function BuffBadgeHub() {
  const heroesLength = useGameStore((s) => s.heroes.length);
  const atkBuffMult = useGameStore((s) => s.heroes[0]?.atkBuffMult ?? 1);
  const atkBuffTimer = useGameStore((s) => s.heroes[0]?.atkBuffTimer ?? 0);

  const badges = buildActiveBuffBadges({ heroesLength, atkBuffMult, atkBuffTimer });
  if (badges.length === 0) return null;

  // `pointer-events-none` on the row itself so this never blocks the arena's
  // own pointerdown listener; each chip restores `pointer-events-auto` itself.
  return (
    <div role="status" className="pointer-events-none">
      <BuffBadgeRow badges={badges} maxSlots={MOBILE_MAX_SLOTS} className="flex sm:hidden" />
      <BuffBadgeRow badges={badges} maxSlots={DESKTOP_MAX_SLOTS} className="hidden sm:flex" />
    </div>
  );
}
