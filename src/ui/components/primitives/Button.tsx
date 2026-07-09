"use client";

/**
 * R1 "โลกใหม่ หน้าตาใหม่" (W1 design system) — the 3-tier button primitive.
 * Presentational only: no store reads, no game imports; callers wire
 * `onClick`/`disabled`/etc via normal button props (this just owns the skin).
 *
 * - `primary` — gold fill, dark text: the ONE main CTA per surface (matches
 *   the "gold = numerals/values/borders/CTAs only" hard rule — gold fill
 *   text is dark ink, never gold-on-gold).
 * - `secondary` — purple (`--ddp-boss`) outline: the general-purpose action
 *   button (close, cancel, secondary choice).
 * - `danger` — red outline: destructive actions (sell, delete, …).
 *
 * Motion: transform/box-shadow only, 150ms ease-out, `active:scale-95` press
 * feedback, `focus-visible` ring for keyboard/controller nav. Respects
 * `prefers-reduced-motion` globally via globals.css (no per-component logic
 * needed). Touch target is `min-h-11` (44px) per the game-ux skill's
 * desktop+mobile rule — never shrink below that via `className`.
 */

import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const BASE_CLASS =
  "font-display inline-flex min-h-11 items-center justify-center gap-1.5 rounded-(--ddp-radius-md) px-3 text-xs font-bold tracking-wide transition-[transform,opacity,box-shadow] duration-150 ease-out active:scale-95 disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ddp-gold-bright focus-visible:ring-offset-2 focus-visible:ring-offset-ddp-panel-strong";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "border border-ddp-gold-border bg-ddp-gold text-[#241705] shadow-(--ddp-shadow-btn) hover:bg-ddp-gold-bright disabled:bg-ddp-gold/40 disabled:text-[#241705]/50",
  secondary:
    "border border-ddp-boss/60 bg-ddp-boss/10 text-ddp-boss-light hover:bg-ddp-boss/20 disabled:opacity-40",
  danger:
    "border border-ddp-bad/60 bg-ddp-bad/10 text-ddp-bad hover:bg-ddp-bad/20 disabled:opacity-40",
};

export function Button({
  variant = "primary",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={`${BASE_CLASS} ${VARIANT_CLASS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
