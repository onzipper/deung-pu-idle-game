/**
 * Small shared CSS-drawn icons (no emoji glyph dependency — Windows 10 footgun
 * #4). `Coin` mirrors the inline markup already duplicated in `HudBar.tsx`/
 * `ShopPanel.tsx`; `MaterialIcon` is new (M7.6 ตีบวก — the refine-material
 * counter, a rough ore/shard chunk distinct in shape+color from the round gold
 * coin so the two currencies never get confused at a glance). The R1 W1
 * inline-SVG "gold-line" icon set lives further down this file.
 */

import type { ReactNode } from "react";

export function Coin({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`relative inline-block shrink-0 rounded-full border-2 border-amber-600 bg-amber-400 shadow-[inset_0_-2px_2px_rgba(0,0,0,0.25)] ${className}`}
    >
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black leading-none text-amber-700">
        ฿
      </span>
    </span>
  );
}

/** A faceted ore/shard chunk — a rotated square with a clipped corner (via a
 * second overlapping rotated square, both flat-fill, no canvas/Pixi gradients)
 * so it reads as a rough mineral chunk rather than a coin or gem. */
export function MaterialIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <span aria-hidden className={`relative inline-block shrink-0 ${className}`}>
      <span
        className="absolute inset-[8%] rotate-45 rounded-[2px] border-2 border-violet-700 bg-violet-400 shadow-[inset_1px_1px_1px_rgba(255,255,255,0.35),inset_-1px_-1px_2px_rgba(0,0,0,0.3)]"
        style={{ clipPath: "polygon(0 0, 100% 20%, 80% 100%, 15% 85%)" }}
      />
    </span>
  );
}

/* -----------------------------------------------------------------------
 * R1 "โลกใหม่ หน้าตาใหม่" (W1 design system) — a small set of inline-SVG
 * "gold-line" chrome icons: stroke `currentColor` (color comes from the
 * consumer, e.g. `text-ddp-boss-light` in `PanelHeader.tsx`), 24x24 viewBox,
 * simple 2px-stroke line style (NOT painted/ornate — that's a deliberate
 * contrast with the jewel-tone entity art, matching the chrome-vs-scenery
 * split in render/README.md's binding art direction). Not wired into every
 * surface yet — available for callers to adopt incrementally.
 * --------------------------------------------------------------------- */

interface LineIconProps {
  className?: string;
}

const LINE_ICON_BASE = "h-5 w-5";

function LineIcon({
  className = LINE_ICON_BASE,
  children,
}: LineIconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

/** Shop / merchant stall — ป้าปุ๊'s shop panel. */
export function ShopIcon({ className }: LineIconProps) {
  return (
    <LineIcon className={className}>
      <path d="M4 9l1.5-5h13L20 9" />
      <path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9z" />
      <path d="M9 13a3 3 0 0 0 6 0" />
    </LineIcon>
  );
}

/** Bag / inventory. */
export function BagIcon({ className }: LineIconProps) {
  return (
    <LineIcon className={className}>
      <path d="M8 8V6a4 4 0 0 1 8 0v2" />
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M9 12v2M15 12v2" />
    </LineIcon>
  );
}

/** Skill / spell — a cast bolt. */
export function SkillIcon({ className }: LineIconProps) {
  return (
    <LineIcon className={className}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </LineIcon>
  );
}

/** Quest — a scroll. */
export function QuestIcon({ className }: LineIconProps) {
  return (
    <LineIcon className={className}>
      <path d="M6 4h9a3 3 0 0 1 3 3v13" />
      <path d="M6 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12" />
      <path d="M9 9h6M9 13h6" />
    </LineIcon>
  );
}

/** Boss — a crown. */
export function BossIcon({ className }: LineIconProps) {
  return (
    <LineIcon className={className}>
      <path d="M4 18h16" />
      <path d="M5 18l-1-9 4 3 4-6 4 6 4-3-1 9z" />
    </LineIcon>
  );
}

/** Settings — a gear. */
export function SettingsIcon({ className }: LineIconProps) {
  return (
    <LineIcon className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </LineIcon>
  );
}

/** Friends — two people. */
export function FriendsIcon({ className }: LineIconProps) {
  return (
    <LineIcon className={className}>
      <circle cx="8" cy="9" r="3" />
      <path d="M2 20a6 6 0 0 1 12 0" />
      <circle cx="17" cy="8" r="2.5" />
      <path d="M14.5 20a5.5 5.5 0 0 1 7.5-4.2" />
    </LineIcon>
  );
}

/** Map — a folded travel map (used by `FastTravelPicker.tsx`'s header). */
export function MapIcon({ className }: LineIconProps) {
  return (
    <LineIcon className={className}>
      <path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2z" />
      <path d="M9 4v14M15 6v14" />
    </LineIcon>
  );
}
