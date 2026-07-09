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
 * A touch target is `h-11 w-11` (44px, the game-ux skill's hard minimum);
 * `accent` picks which existing HUD-button accent language to reuse (gold for
 * HOF-tier "special" entries, fuchsia for the legendary tome, neutral for
 * everything else) — no new color vocabulary invented.
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
      className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-(--ddp-radius-md) border shadow-(--ddp-shadow-btn) transition-all duration-100 active:translate-y-0.5 active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-40 ${ACCENT_CLASS[accent]}`}
    >
      <span aria-hidden className="flex h-5 w-5 items-center justify-center text-lg leading-none">
        {icon}
      </span>
      {badge}
    </button>
  );
}
