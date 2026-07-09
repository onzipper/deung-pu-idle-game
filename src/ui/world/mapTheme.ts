/**
 * Per-map themed row/header classes (owner: "ล้อกับธีมแมพ") — anchored to
 * `render/environment/biomes.ts`'s ground tones / `render/theme.ts`'s
 * `BOSS_COLORS`, but hand-picked Tailwind utility colors (this module never
 * imports `@/render`). Emoji are pre-2020 Unicode only (footgun #4 — no
 * Windows 10 tofu).
 *
 * Extracted from `FastTravelPicker.tsx` (R1 W4, World Map panel) so both
 * surfaces that reference a map by section carry its accent — the game-ux
 * skill's "section headers/rows that reference a map should carry its
 * accent" rule — without duplicating the color table.
 */

import type { UiZone } from "@/ui/world/zones";

export interface MapTheme {
  emoji: string;
  header: string;
  row: string;
}

export const MAP_THEME: Record<string, MapTheme> = {
  // map1 — โลกมนุษย์: forest greens.
  map1: {
    emoji: "🌲",
    header: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
    row: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/20",
  },
  // map2 — แดนอสูร: demonic crimson.
  map2: {
    emoji: "👹",
    header: "border-rose-500/40 bg-rose-500/10 text-rose-200",
    row: "border-rose-500/30 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20",
  },
  // map3 — พรมแดนเถื่อน: frontier bronze.
  map3: {
    emoji: "⚔️",
    header: "border-amber-600/40 bg-amber-700/10 text-amber-200",
    row: "border-amber-600/30 bg-amber-700/10 text-amber-100 hover:bg-amber-700/20",
  },
  // map4 — ทุนดราน้ำแข็ง: ice blues.
  map4: {
    emoji: "❄️",
    header: "border-sky-400/40 bg-sky-400/10 text-sky-200",
    row: "border-sky-400/30 bg-sky-400/10 text-sky-100 hover:bg-sky-400/20",
  },
  // map5 — ทะเลทรายซากอารยธรรม: desert gold.
  map5: {
    emoji: "🏺",
    header: "border-yellow-500/40 bg-yellow-500/10 text-yellow-200",
    row: "border-yellow-500/30 bg-yellow-500/10 text-yellow-100 hover:bg-yellow-500/20",
  },
  // map6 — นครนรก: infernal near-black + ember.
  map6: {
    emoji: "🔥",
    header: "border-orange-700/50 bg-black/40 text-orange-300",
    row: "border-orange-700/40 bg-black/30 text-orange-200 hover:bg-black/50",
  },
  // asura — ดินแดนอสูร (endgame v1): blood-dark, deliberately more ominous than
  // any other map's theme.
  asura: {
    emoji: "🌋",
    header: "border-red-800/50 bg-red-950/30 text-red-300",
    row: "border-red-800/40 bg-red-950/20 text-red-200 hover:bg-red-950/40",
  },
};

const FALLBACK_THEME: MapTheme = MAP_THEME.map1;

export function themeFor(mapId: string): MapTheme {
  return MAP_THEME[mapId] ?? FALLBACK_THEME;
}

export function stageRangeOf(zones: readonly UiZone[]): { min: number; max: number } {
  const stages = zones.filter((z) => z.kind === "farm").map((z) => z.stage);
  return { min: Math.min(...stages), max: Math.max(...stages) };
}
