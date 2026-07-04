/**
 * Static Thai display labels for engine data keys (POC-style icons/names).
 * Purely cosmetic — never fed back into the engine.
 */

import type { HeroClass, Upgrades } from "@/engine";

export const HERO_LABELS: Record<HeroClass, { name: string; icon: string }> = {
  swordsman: { name: "นักดาบ", icon: "\u{1F5E1}️" }, // 🗡️
  archer: { name: "นักธนู", icon: "\u{1F3F9}" }, // 🏹
  mage: { name: "นักเวท", icon: "✦" }, // ✦
};

export const SKILL_LABELS: Record<HeroClass, { name: string; icon: string }> = {
  swordsman: { name: "หมุนฟัน", icon: "\u{1F300}" }, // 🌀
  archer: { name: "ฝนลูกธนู", icon: "\u{1F327}️" }, // 🌧️ arrow rain
  mage: { name: "อุกกาบาต", icon: "☄️" }, // ☄️
};

export const UPGRADE_LABELS: Record<keyof Upgrades, { name: string; icon: string }> = {
  atk: { name: "พลัง", icon: "⚔️" }, // ⚔️
  speed: { name: "ความเร็ว", icon: "⚡" }, // ⚡
  hp: { name: "พลังชีวิต", icon: "❤️" }, // ❤️
};
