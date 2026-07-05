/**
 * Static per-class/per-stat icons (POC-style, purely cosmetic — never fed
 * back into the engine). Display NAMES/DESCRIPTIONS are NOT here: they live
 * in the `content` message namespace (`messages/th.json` / `messages/en.json`,
 * keyed by these same engine ids) and are resolved with
 * `useTranslations("content")` in the consuming component — see
 * `src/ui/README.md`'s "Content i18n pattern" section.
 */

import type { HeroClass } from "@/engine";

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
