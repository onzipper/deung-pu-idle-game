"use client";

/**
 * Buff Badge Hub (owner ask 2026-07-09: "มี badge บอกสถานะบัพด้วย เอาบัพทั้งหมด
 * ไปรวมตรงนั้น ไม่ว่าจะสถานะเพิ่ม stat หรือ พิเศษจากอะไรก็ตาม") — ONE consolidated
 * HUD spot for every ACTIVE buff, replacing the old skill-bar-local War Cry chip
 * (`SkillBar.tsx`'s retired `BuffChipRow`) with a single extensible strip. The
 * badge SET itself is computed by the pure, headlessly-tested
 * `ui/buffs/activeBuffs.ts` (same logic/view split as `WorldBossBanner.tsx` +
 * `ui/worldBoss/schedule.ts`) — this component is presentational glue only.
 *
 * Placement: a slim row in the top HUD status strip, alongside `CohortStatus`/
 * `WorldBossBanner` (same tier — a live status readout, not a modal/settings
 * concern), ABOVE `HudBar` so it never competes for space with the goal card or
 * the skill bar's console dock below. Renders NOTHING while no buff is active
 * (the overwhelming common case), same "zero HUD footprint" idiom as its
 * siblings.
 *
 * Tap a chip -> a small inline tooltip bubble names the buff + its live numbers
 * (same tap-to-toggle / tap-outside-to-close affordance as `InfoTip.tsx` — a
 * lightweight bubble, not a full `ModalPortal` sheet, since this is a glance-
 * level detail, not a form/flow).
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { buildActiveBuffBadges, type BuffBadge } from "@/ui/buffs/activeBuffs";
import { useGameStore } from "@/ui/store/gameStore";

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

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-6 items-center gap-1 rounded-full border border-ddp-gold/50 bg-ddp-gold/10 px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-ddp-gold-bright tabular-nums transition-transform duration-100 active:scale-95"
      >
        <span aria-hidden>{badge.icon}</span>
        <span>{t(`chip.${badge.kind}`, params)}</span>
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute top-full left-1/2 z-20 mt-1.5 w-52 -translate-x-1/2 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong p-2 text-[11px] leading-snug font-normal text-ddp-ink shadow-(--ddp-shadow-panel)"
        >
          {t(`detail.${badge.kind}`, params)}
        </span>
      )}
    </span>
  );
}

export function BuffBadgeHub() {
  const heroesLength = useGameStore((s) => s.heroes.length);
  const atkBuffMult = useGameStore((s) => s.heroes[0]?.atkBuffMult ?? 1);
  const atkBuffTimer = useGameStore((s) => s.heroes[0]?.atkBuffTimer ?? 0);

  const badges = buildActiveBuffBadges({ heroesLength, atkBuffMult, atkBuffTimer });
  if (badges.length === 0) return null;

  return (
    <div role="status" className="flex w-full flex-wrap items-center justify-center gap-1.5">
      {badges.map((badge) => (
        <BuffChip key={badge.id} badge={badge} />
      ))}
    </div>
  );
}
