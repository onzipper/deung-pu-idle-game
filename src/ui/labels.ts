/**
 * Static per-class/per-stat icons (POC-style, purely cosmetic — never fed
 * back into the engine). Display NAMES/DESCRIPTIONS are NOT here: they live
 * in the `content` message namespace (`messages/th.json` / `messages/en.json`,
 * keyed by these same engine ids) and are resolved with
 * `useTranslations("content")` in the consuming component — see
 * `src/ui/README.md`'s "Content i18n pattern" section.
 */

import { REFINE, type GearSlot, type HeroClass, type ItemRarity } from "@/engine";

export const HERO_ICONS: Record<HeroClass, string> = {
  swordsman: "\u{1F5E1}️", // 🗡️
  archer: "\u{1F3F9}", // 🏹
  mage: "✦",
};

export const SKILL_ICONS: Record<HeroClass, string> = {
  swordsman: "\u{1F300}", // 🌀
  archer: "\u{1F327}️", // 🌧️ arrow rain
  mage: "☄️",
};

/**
 * Per-SKILL-ID icons (M5 skill framework v2). Keyed by engine skill id. All are
 * pre-2016 emoji so Windows 10 renders a glyph (footgun #4: no Unicode-13+
 * glyphs). A missing id falls back to a neutral marker in the component.
 */
export const SKILL_ICONS_BY_ID: Record<string, string> = {
  // swordsman
  sword_whirl: "\u{1F300}", // 🌀 whirl slash
  sword_warcry: "\u{1F4E3}", // 📣 war cry
  sword_quake: "\u{1F4A5}", // 💥 earthquake
  // archer
  archer_rain: "\u{1F327}️", // 🌧️ arrow rain
  archer_powershot: "\u{1F3AF}", // 🎯 power shot
  archer_barrage: "❇️", // ❇️ explosive shot
  // mage
  mage_meteor: "☄️", // ☄️ meteor
  mage_frostnova: "❄️", // ❄️ frost nova
  mage_cataclysm: "\u{1F525}", // 🔥 cataclysm
};

/** M7 Gear & Drops — per-slot icon (pre-2020 emoji, Win10-safe — footgun #4). */
export const GEAR_SLOT_ICONS: Record<GearSlot, string> = {
  weapon: "\u{2694}", // ⚔
  armor: "\u{1F6E1}", // 🛡
};

/** Per-rarity Tailwind text/border color classes for gear cards + the drop-feed
 * toast (M7). Epic gets the "stronger beat" the drop-feed juice task asks for
 * (brighter gold + the ✨ marker), rare a cool blue, common a neutral grey. */
export const RARITY_COLORS: Record<
  ItemRarity,
  { text: string; border: string; icon: string }
> = {
  common: { text: "text-ddp-ink", border: "border-ddp-border-soft", icon: "" },
  rare: { text: "text-sky-300", border: "border-sky-400/60", icon: "" },
  epic: { text: "text-ddp-gold-bright", border: "border-ddp-gold/70", icon: "\u{2728}" }, // ✨
};

/**
 * Per-TIER border color for the M7.5 inventory grid cell (ascending intensity
 * 1..6) — layered UNDER the rarity glow (`RARITY_GLOW` below): tier reads at a
 * glance ("how strong"), rarity reads as a highlight ("how special"). Tiers
 * beyond 6 (none shipped v1) fall back to the tier-6 color in the component.
 */
export const TIER_BORDER_COLORS: Record<number, string> = {
  1: "border-slate-500/50",
  2: "border-slate-300/60",
  3: "border-sky-400/60",
  4: "border-indigo-400/60",
  5: "border-fuchsia-400/60",
  6: "border-ddp-gold/80",
};

/** Per-rarity glow (box-shadow) for the M7.5 inventory grid cell — plain rgba
 * (no `theme()` arbitrary-value lookups, keeps this robust across the Tailwind
 * v4 CSS-first config). Common gets no glow (tier border carries it alone). */
export const RARITY_GLOW: Record<ItemRarity, string> = {
  common: "",
  rare: "shadow-[0_0_10px_2px_rgba(56,189,248,0.35)]",
  epic: "shadow-[0_0_14px_3px_rgba(250,204,21,0.45)]",
};

/**
 * M7.6+ polish — a gear NAME earns prestige-gold styling once its refine
 * level reaches the "break" band floor (`REFINE.failBands.degradeMax + 1`,
 * i.e. +8 — the point past which every further attempt risks destroying the
 * item outright). Name-text only: stack count/equipped badges and tier
 * borders are untouched (their own conventions elsewhere).
 */
export const PRESTIGE_REFINE_LEVEL = REFINE.failBands.degradeMax + 1; // 8

/**
 * Full replacement classes for a gear NAME span at `refineLevel` (including
 * font-weight — callers should NOT also apply their own `font-bold`), or ""
 * below the threshold (callers keep their existing color/weight). Reuses the
 * existing gold token only — no new color or keyframe. +10 (max refine) gets
 * the same treatment: there's no existing shimmer/glow class that fits
 * inline, truncating name text without restructuring layout, so we don't
 * force one in (see `ddp-announce-shimmer`, which needs an absolute overlay
 * span + relative/overflow-hidden parent — a banner-only convention).
 */
export function prestigeNameClass(refineLevel: number): string {
  return refineLevel >= PRESTIGE_REFINE_LEVEL ? "text-ddp-gold-bright font-black" : "";
}
