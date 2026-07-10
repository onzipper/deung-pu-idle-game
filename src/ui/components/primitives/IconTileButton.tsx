"use client";

/**
 * R2-W2 "fullscreen HUD" — the icon-only ~40-44px menu-row tile every
 * panel-opening HUD button (`InventoryButton.tsx`, `HallOfFameButton.tsx`,
 * `FriendsButton.tsx`, `CodexButton.tsx`, `SettingsButton.tsx`,
 * `AsuraTomeButton.tsx`, `CharacterButton.tsx`, `WorldMapButton.tsx`,
 * `WarpButton.tsx`) now renders through. Presentational only — callers keep
 * owning their own open/close `useState` + modal mount; this just standardizes
 * the trigger's skin so the top-right icon row reads as ONE consistent
 * control cluster (mockup: a tight grid of icon tiles, not a row of labeled
 * pill buttons).
 *
 * A touch target is `h-11 w-11` (44px, the game-ux skill's hard minimum) from
 * `sm:` up; `accent` picks which existing HUD-button accent language to reuse
 * (gold for HOF-tier "special" entries, fuchsia for the legendary tome,
 * neutral for everything else) — no new color vocabulary invented.
 *
 * Issue #58 wave B (mobile HUD overlap tuning): below `sm:` the tile shrinks
 * to `h-10 w-10` (40px) — a deliberate, SCOPED exception to the 44px house
 * rule, floored at the task brief's explicit "≥40px" minimum, needed because
 * this primitive is the ONLY consumer behind the 10-tile top-right menu row
 * (`GameHud.tsx`) and that row is the tightest vertical-space contender on
 * narrow portrait screens (grid-cols-5 two-row layout — see that file).
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type IconTileAccent = "neutral" | "gold" | "fuchsia" | "sky";

export interface IconTileButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  icon: ReactNode;
  accent?: IconTileAccent;
  /** Small badge rendered top-right (e.g. unread-count) — same convention as
   * `FriendsButton.tsx`'s pending-count pill. */
  badge?: ReactNode;
}

const ACCENT_CLASS: Record<IconTileAccent, string> = {
  neutral:
    "border-ddp-border bg-ddp-panel-strong text-ddp-ink-muted hover:text-ddp-ink hover:brightness-110",
  gold: "border-ddp-gold/50 bg-ddp-gold/10 text-ddp-gold-bright hover:border-ddp-gold hover:bg-ddp-gold/20",
  fuchsia:
    "border-fuchsia-400/50 bg-fuchsia-400/10 text-fuchsia-200 hover:border-fuchsia-400 hover:bg-fuchsia-400/20",
  sky: "border-sky-400/50 bg-sky-400/10 text-sky-300 hover:border-sky-400 hover:bg-sky-400/20",
};

export function IconTileButton({
  icon,
  accent = "neutral",
  badge,
  ...rest
}: IconTileButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-(--ddp-radius-md) border shadow-(--ddp-shadow-btn) transition-all duration-100 active:translate-y-0.5 active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-40 sm:h-11 sm:w-11 ${ACCENT_CLASS[accent]}`}
    >
      <span aria-hidden className="flex h-4 w-4 items-center justify-center text-base leading-none sm:h-5 sm:w-5 sm:text-lg">
        {icon}
      </span>
      {badge}
    </button>
  );
}
