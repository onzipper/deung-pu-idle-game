/**
 * Static per-class/per-stat icons (POC-style, purely cosmetic — never fed
 * back into the engine). Display NAMES/DESCRIPTIONS are NOT here: they live
 * in the `content` message namespace (`messages/th.json` / `messages/en.json`,
 * keyed by these same engine ids) and are resolved with
 * `useTranslations("content")` in the consuming component — see
 * `src/ui/README.md`'s "Content i18n pattern" section.
 */

import type { GearSlot, HeroClass, ItemRarity } from "@/engine";

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
