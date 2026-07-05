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
