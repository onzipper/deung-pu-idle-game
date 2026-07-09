"use client";

/**
 * R2-W1 "sweep แผงตาม mockup" — a single tab button. Presentational only: no
 * store reads, no game imports. Active chrome is the PURPLE accent
 * (`--ddp-boss`) per the token spec ("ม่วง = สี chrome/UI" — active
 * tab/panel-header underline/secondary buttons all share this hue; gold stays
 * reserved for numerals/borders/CTAs, see `docs/ui-reference-map.md`).
 *
 * Usually consumed via `TabRow.tsx` rather than directly — exported standalone
 * so a caller with a non-list tab layout can still reuse the exact skin.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface TabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

export function Tab({ active = false, icon, children, className = "", ...rest }: TabProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      {...rest}
      className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-(--ddp-radius-md) border px-2 text-xs font-bold whitespace-nowrap transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ddp-gold-bright ${
        active
          ? "border-ddp-boss bg-ddp-boss/20 text-ddp-boss-light"
          : "border-ddp-border-soft bg-black/25 text-ddp-ink-muted hover:text-ddp-ink"
      } ${className}`}
    >
      {icon && (
        <span aria-hidden className="shrink-0">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}
