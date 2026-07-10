"use client";

/**
 * Shared seam for the codegen game-icon set (issue #60). These icons render the
 * item/skill's INHERENT look (filled silhouette + metallic/glass gradient + a soft
 * family-color glow) — the HD-pixel-hybrid direction from the owner's ref sheet
 * (`docs/ui-reference-map.md` §"6. ITEMS", §"5. SKILL ICONS"). NOT the older thin
 * gold-line chrome set in `../icons.tsx` (that stays for HUD chrome).
 *
 * Rules baked in here (so every icon obeys them for free):
 *  - viewBox 0 0 24 24 → crisp at any px; size comes from `className` (`h-full w-full`
 *    default) so a 24px inventory tile and an 80px detail pane share one source.
 *  - NO `<filter>` / `<image>` / external refs / raster data URIs (perf + the two
 *    Pixi/SVG crashes in `docs/known-traps.md`); glow is a soft `radialGradient`
 *    ellipse, never a blur filter.
 *  - Gradient def ids MUST be per-instance-unique: the same icon paints ~100× in one
 *    inventory DOM, and duplicate ids make `url(#..)` cross-reference the wrong
 *    instance. `useIconIds` derives them from React's `useId()` (sanitised of the
 *    colons `useId` emits, which break CSS `url(#..)` resolution).
 *  - Pure/presentational: no store reads, no side effects.
 */

import { useId, type ReactNode } from "react";

export interface IconProps {
  /** Sizing/color hook; defaults to fill the parent tile. */
  className?: string;
}

/**
 * Per-instance-unique gradient/def id map. `useId()` output carries colons
 * (`:r0:`) that are legal in an HTML id but break `url(#..)` fragment lookups in
 * some engines — strip them, then namespace each requested slot name.
 */
export function useIconIds<K extends string>(...names: K[]): Record<K, string> {
  const base = useId().replace(/[^a-zA-Z0-9]/g, "");
  const out = {} as Record<K, string>;
  for (const n of names) out[n] = `ic${base}-${n}`;
  return out;
}

/** The shared `<svg>` shell: fixed 24-unit viewBox, className-driven size, decorative. */
export function IconSvg({
  className = "h-full w-full",
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={`block ${className}`}
    >
      {children}
    </svg>
  );
}
