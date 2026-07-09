"use client";

/**
 * R1 "โลกใหม่ หน้าตาใหม่" (W1 design system) — the panel title row that pairs
 * with `Panel.tsx`. Purple (`--ddp-boss`) underline accent marks it as chrome
 * (the boss-telegraph purple is promoted to the general accent color this
 * round — see globals.css's token comment). Presentational only: no store
 * reads, no game imports.
 *
 * `icon` is an optional leading slot (pass one of `ui/components/icons.tsx`'s
 * line icons, or an emoji span — callers' choice, this component doesn't
 * care). `actions` is a right-aligned slot, typically the modal's close
 * `Button` — kept as a slot rather than a baked-in `onClose` prop so headers
 * can also host tabs/right-side controls without a second component.
 */

import type { ReactNode } from "react";

export interface PanelHeaderProps {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PanelHeader({ title, icon, actions, className = "" }: PanelHeaderProps) {
  return (
    <div
      className={`flex items-center justify-between gap-2 border-b-2 border-ddp-boss/40 pb-2 ${className}`}
    >
      <h2 className="font-display flex min-w-0 items-center gap-1.5 text-base font-extrabold text-ddp-gold-bright">
        {icon && (
          <span aria-hidden className="shrink-0 text-ddp-boss-light">
            {icon}
          </span>
        )}
        <span className="truncate">{title}</span>
      </h2>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}
