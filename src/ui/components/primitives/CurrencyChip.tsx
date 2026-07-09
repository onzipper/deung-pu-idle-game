"use client";

/**
 * R2-W1 "sweep แผงตาม mockup" — a currency/counter pill (gold, refine
 * materials, ดินแดนอสูร essence, …). Mirrors the inline gold/material chips
 * already in `HudBar.tsx`, generalized into a primitive. Presentational only:
 * caller passes the live value in — this component NEVER reads the store and
 * NEVER tweens the digits itself (owner "gold = numerals/borders/CTAs only"
 * rule allows gold TEXT here since it's a numeral, but the number must jump
 * straight to its new value — only the container may pulse, and only when the
 * caller explicitly asks via `pulse`, e.g. from `usePulseOnIncrease`).
 */

import type { ReactNode } from "react";

export type CurrencyChipVariant = "gold" | "violet" | "neutral";

export interface CurrencyChipProps {
  icon: ReactNode;
  value: number | string;
  /** Container-only pulse (e.g. `animate-gold-pulse`) — never applied to the digits alone. */
  pulse?: boolean;
  variant?: CurrencyChipVariant;
  ariaLabel?: string;
  className?: string;
}

const VARIANT_CLASS: Record<CurrencyChipVariant, string> = {
  gold: "border-ddp-gold/30 bg-ddp-gold/10 text-ddp-gold",
  violet: "border-violet-400/25 bg-violet-400/10 text-violet-300",
  neutral: "border-ddp-border-soft bg-black/25 text-ddp-ink",
};

export function CurrencyChip({
  icon,
  value,
  pulse = false,
  variant = "gold",
  ariaLabel,
  className = "",
}: CurrencyChipProps) {
  return (
    <div
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1.5 rounded-(--ddp-radius-md) border px-2.5 py-1.5 ${VARIANT_CLASS[variant]} ${
        pulse ? "animate-gold-pulse" : ""
      } ${className}`}
    >
      <span aria-hidden className="shrink-0">
        {icon}
      </span>
      <span className="text-base font-extrabold tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
    </div>
  );
}
