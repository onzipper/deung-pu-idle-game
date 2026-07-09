"use client";

/**
 * R2-W1 "sweep แผงตาม mockup" — a labeled progress bar (HP/MP/EXP/generic).
 * Colors follow the EXISTING bar conventions already shipped in
 * `SkillBar.tsx`'s per-hero HP/mana/XP bars (emerald→red HP, sky→rose mana
 * under a 25% threshold, gold EXP) — this primitive doesn't invent a new
 * palette, it just makes the pattern reusable. Presentational only: caller
 * computes `value`/`max`, this component clamps + colors + renders. Value
 * text is tabular-nums and NEVER tweened (the bar's fill width may transition
 * — that's a visual affordance, not a numeric interpolation of the reported
 * value).
 */

import type { ReactNode } from "react";

export type StatBarVariant = "hp" | "mp" | "exp" | "neutral";

export interface StatBarProps {
  variant: StatBarVariant;
  value: number;
  max: number;
  label?: ReactNode;
  /** Right-aligned readout, e.g. "120/300" — caller formats, this just places it. */
  valueText?: ReactNode;
  height?: "sm" | "md";
  className?: string;
}

const HEIGHT_CLASS: Record<NonNullable<StatBarProps["height"]>, string> = {
  sm: "h-1.5",
  md: "h-2.5",
};

function fillClass(variant: StatBarVariant, pct: number): string {
  switch (variant) {
    case "hp":
      return pct > 35 ? "bg-emerald-400" : "bg-red-500";
    case "mp":
      return pct < 25 ? "animate-pulse bg-rose-400" : "bg-sky-400";
    case "exp":
      return "bg-gradient-to-r from-ddp-gold to-ddp-gold-bright";
    case "neutral":
    default:
      return "bg-ddp-ink-muted";
  }
}

function valueTextClass(variant: StatBarVariant, pct: number): string {
  if (variant === "mp") return pct < 25 ? "text-rose-300" : "text-sky-300/90";
  if (variant === "hp") return pct > 35 ? "text-emerald-300" : "text-red-300";
  return "text-ddp-ink-muted";
}

export function StatBar({
  variant,
  value,
  max,
  label,
  valueText,
  height = "md",
  className = "",
}: StatBarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;

  return (
    <div className={`flex w-full flex-col gap-0.5 ${className}`}>
      {(label || valueText) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <span className="text-[10px] font-semibold tracking-wide text-ddp-ink-muted uppercase">
              {label}
            </span>
          )}
          {valueText && (
            <span
              className={`text-[11px] leading-none font-semibold tabular-nums ${valueTextClass(variant, pct)}`}
            >
              {valueText}
            </span>
          )}
        </div>
      )}
      <div className={`w-full overflow-hidden rounded-full bg-black/50 ${HEIGHT_CLASS[height]}`}>
        <div
          className={`h-full rounded-full transition-[width] duration-200 ${fillClass(variant, pct)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
