"use client";

/**
 * R2-W1 "sweep แผงตาม mockup" — a square gear tile (rarity frame + glow, qty/
 * refine badge slots, selected ring). Presentational only: no store reads, no
 * game imports. Colors come from `src/ui/labels.ts`'s `RARITY_COLORS` /
 * `RARITY_GLOW` / `TIER_BORDER_COLORS` — this component does NOT redefine
 * them (per the ui-reference-map lock). `equipped`/`legendary` are STATE
 * accents layered above the rarity/tier frame (their emerald/fuchsia colors
 * mirror the ones `InventoryPanel.tsx`'s old inline `GridCell` used — not a
 * duplication of the rarity palette, a separate state-color pair).
 *
 * Slots are generic ReactNode so callers compose their own i18n'd badges
 * (equipped ribbon, "NEW" tag, class-req glyph, rarity sparkle, …) without
 * this component knowing about any of those concepts.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { ItemRarity } from "@/engine";
import { ItemIcon } from "@/ui/components/icons/gameIcons";
import { RARITY_COLORS, RARITY_GLOW, TIER_BORDER_COLORS } from "@/ui/labels";

const EQUIPPED_BORDER = "border-emerald-300";
const EQUIPPED_GLOW = "shadow-[0_0_16px_4px_rgba(52,211,153,0.55)]";
const LEGENDARY_BORDER = "border-fuchsia-400/80";
const LEGENDARY_GLOW = "shadow-[0_0_16px_4px_rgba(217,70,239,0.45)]";

function tierBorder(tier: number): string {
  return TIER_BORDER_COLORS[tier] ?? TIER_BORDER_COLORS[6];
}

export interface ItemTileProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  rarity: ItemRarity;
  tier: number;
  /** Wins over `legendary` and the ordinary tier border. */
  equipped?: boolean;
  /** "ตำราตำนาน" legendary accent — loses to `equipped`. */
  legendary?: boolean;
  selected?: boolean;
  ariaLabel?: string;
  /** Center glyph (emoji span or a line icon) — also doubles as the
   * `ItemIcon` fallback when `templateId` isn't in the codegen SVG registry
   * (issue #60), so this must stay the FULL "what to show absent an icon"
   * value, unchanged. */
  glyph: ReactNode;
  glyphClassName?: string;
  /** Item catalog id (issue #60 "codegen icons" consumer wiring) — when
   * provided, `ItemIcon` renders a per-item SVG in its place if the codegen
   * registry has a match; ids outside the registry (or omitted entirely)
   * keep rendering `glyph` verbatim, byte-identical to before this wave. */
  templateId?: string;
  /** Small text under the glyph, e.g. "T3" — caller owns i18n. */
  subLabel?: ReactNode;
  /** "+N" refine text, rendered right after `subLabel` in the emerald refine hue. */
  refineBadge?: ReactNode;
  /** Quantity pill, top-right — omitted entirely when undefined or <= 1. */
  qty?: number;
  /** Full-width ribbon across the top (e.g. "equipped"/"ใส่อยู่"). */
  topRibbon?: ReactNode;
  cornerTopLeft?: ReactNode;
  cornerBottomLeft?: ReactNode;
  cornerBottomRight?: ReactNode;
}

export function ItemTile({
  rarity,
  tier,
  equipped = false,
  legendary = false,
  selected = false,
  ariaLabel,
  glyph,
  glyphClassName = "",
  templateId,
  subLabel,
  refineBadge,
  qty,
  topRibbon,
  cornerTopLeft,
  cornerBottomLeft,
  cornerBottomRight,
  className = "",
  ...rest
}: ItemTileProps) {
  const colors = RARITY_COLORS[rarity];
  const glow = RARITY_GLOW[rarity];
  const borderCls = equipped ? EQUIPPED_BORDER : legendary ? LEGENDARY_BORDER : tierBorder(tier);
  const glowCls = equipped ? EQUIPPED_GLOW : legendary ? LEGENDARY_GLOW : glow;

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={ariaLabel}
      {...rest}
      className={`relative flex min-h-16 min-w-16 flex-col items-center justify-center gap-0.5 rounded-(--ddp-radius-md) border-2 bg-black/40 p-1.5 transition-transform duration-150 ease-out active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${borderCls} ${glowCls} ${
        selected ? "ring-2 ring-ddp-gold-bright" : ""
      } ${className}`}
    >
      {topRibbon && (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 rounded-t-(--ddp-radius-sm) bg-emerald-400 px-0.5 py-0.5 text-center text-[8px] leading-none font-black text-emerald-950"
        >
          {topRibbon}
        </span>
      )}
      {qty !== undefined && qty > 1 && (
        <span
          aria-hidden
          className="absolute top-0.5 right-0.5 rounded-full bg-ddp-gold px-1 text-[8px] leading-none font-black text-[#241705]"
        >
          ×{qty}
        </span>
      )}
      <span aria-hidden className={`text-xl leading-none ${topRibbon ? "mt-2.5" : ""} ${glyphClassName}`}>
        {templateId ? (
          <ItemIcon templateId={templateId} fallback={glyph} className="h-5 w-5" />
        ) : (
          glyph
        )}
      </span>
      {(subLabel || refineBadge) && (
        <span className="text-[9px] font-bold text-ddp-ink-muted">
          {subLabel}
          {refineBadge && <span className="text-emerald-400"> {refineBadge}</span>}
        </span>
      )}
      {cornerTopLeft && (
        <span aria-hidden className="absolute top-0.5 left-0.5 text-[10px] leading-none">
          {cornerTopLeft}
        </span>
      )}
      {cornerBottomLeft && (
        <span aria-hidden className="absolute bottom-0.5 left-0.5 text-[10px] leading-none">
          {cornerBottomLeft}
        </span>
      )}
      {(cornerBottomRight ?? colors.icon) && (
        <span aria-hidden className="absolute bottom-0.5 right-0.5 text-[10px] leading-none">
          {cornerBottomRight ?? colors.icon}
        </span>
      )}
    </button>
  );
}
