"use client";

/**
 * Buff Badge Hub v2 (owner ask 2026-07-09: "มี badge บอกสถานะบัพด้วย เอาบัพทั้งหมด
 * ไปรวมตรงนั้น ไม่ว่าจะสถานะเพิ่ม stat หรือ พิเศษจากอะไรก็ตาม") — ONE consolidated
 * HUD spot for every ACTIVE buff. The badge SET itself is computed by the pure,
 * headlessly-tested `ui/buffs/activeBuffs.ts` (same logic/view split as
 * `WorldBossBanner.tsx` + `ui/worldBoss/schedule.ts`) — this component is
 * presentational glue only.
 *
 * v2 follow-up (UX audit + owner's second ask: "อยากให้มีบอกด้วยว่าเป็นบัพจากอะไร
 * ไม่ใช่แบบ atk+ ขึ้นมา งงๆ"):
 *  1. SOURCE-LABELED chips — every chip now reads "{icon} {source} · {effect}"
 *     (e.g. "🤝 ตี้ 3 คน · EXP +20%"), resolving `source.<kind>` from the
 *     badge's new `sourceKey` alongside the existing `chip.<kind>` effect
 *     copy. The tap-tooltip keeps the longer `detail.<kind>` explanation.
 *  2. Visual-consistency fix — the row now lives in the SAME bordered-strip
 *     box family as `CohortStatus`/`WorldBossBanner` (border + soft fill),
 *     not a bare flex row floating in the HUD.
 *  3. Jitter fix — the box reserves a FIXED single-line height (`h-8`)
 *     whenever ≥1 buff is active; chips enter/exit via opacity/scale inside
 *     that fixed box (see `useAnimatedChips.ts`) instead of instantly
 *     snapping the DOM, and the row never wraps (see next point) so it can
 *     never reflow the arena below. Renders NOTHING (zero footprint) with no
 *     buffs at all — same idiom as its siblings.
 *  4. Chip cap — `activeBuffs.ts#capBuffBadges` caps the row at N total slots
 *     (2 on narrow/mobile widths, 3 at `sm:` and up) so it always fits one
 *     line; anything past the cap collapses into a single "+N" overflow chip
 *     that opens a small tap-tooltip sheet listing the rest (same lightweight
 *     bubble affordance as a normal chip's detail — not a full `ModalPortal`,
 *     this is glance-level detail).
 *
 * Placement unchanged: the top HUD status strip, alongside `CohortStatus`/
 * `WorldBossBanner` (same tier), ABOVE `HudBar`.
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  buildActiveBuffBadges,
  capBuffBadges,
  type BuffBadge,
} from "@/ui/buffs/activeBuffs";
import { useAnimatedChips } from "@/ui/buffs/useAnimatedChips";
import { useGameStore } from "@/ui/store/gameStore";

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

  return (
    <span ref={rootRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-6 items-center gap-1 rounded-full border border-ddp-gold/50 bg-ddp-gold/10 px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-ddp-gold-bright tabular-nums transition-transform duration-100 active:scale-95"
      >
        <span aria-hidden>{badge.icon}</span>
        <span>{t(`source.${badge.sourceKey}`, params)}</span>
        <span aria-hidden className="text-ddp-gold/50">
          ·
        </span>
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

/** The "+N" overflow chip (UX-audit weakness #4 fix) — collapses whatever
 * `capBuffBadges` bumped past the row's slot cap into one compact chip that
 * opens a small tooltip sheet listing each hidden buff's full detail line. */
function OverflowChip({ badges }: { badges: readonly BuffBadge[] }) {
  const t = useTranslations("buffHub");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useTapOutsideToClose(open, () => setOpen(false), rootRef);

  return (
    <span ref={rootRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t("overflowChip", { count: badges.length })}
        className="flex min-h-6 items-center rounded-full border border-ddp-border-soft bg-black/30 px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-ddp-ink-muted tabular-nums transition-transform duration-100 active:scale-95"
      >
        {t("overflowChip", { count: badges.length })}
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute top-full right-0 z-20 mt-1.5 w-56 rounded-(--ddp-radius-md) border border-ddp-border bg-ddp-panel-strong p-2 text-[11px] leading-snug font-normal text-ddp-ink shadow-(--ddp-shadow-panel)"
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
    <div className={`items-center justify-center gap-1.5 overflow-hidden ${className}`}>
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

  return (
    <div
      role="status"
      className="flex h-8 w-full items-center justify-center rounded-(--ddp-radius-md) border border-ddp-border-soft bg-black/25 px-2"
    >
      <BuffBadgeRow badges={badges} maxSlots={MOBILE_MAX_SLOTS} className="flex sm:hidden" />
      <BuffBadgeRow badges={badges} maxSlots={DESKTOP_MAX_SLOTS} className="hidden sm:flex" />
    </div>
  );
}
