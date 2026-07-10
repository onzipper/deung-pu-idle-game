/**
 * World Arc v1 — data/naming scaffolding ONLY (docs/world-arc-freefield-v1.md §2,
 * epic phase 4 "World Arc scaffolding"). This module names/orders the ten
 * owner-locked arc areas and records a data-only mapping onto today's engine
 * maps (`CONFIG.world.maps`). It is DORMANT BY CONSTRUCTION: nothing reads
 * `WORLD_ARC` for behavior yet — no balance, enemy stats, boss gates, rewards,
 * progression pacing, map ids, zoneStageIds, biomes, or UI strings move as
 * part of this file. It exists so a later phase / UI / render pass has one
 * place to read arc identity from, and so the mapping choice below is visible
 * for owner review.
 *
 * MAPPING CHOICE (smallest reversible default — FOR OWNER REVIEW):
 * areas 1-6 map 1:1 IN ORDER onto today's map1..map6 (map1 -> area 1 Capital
 * Outskirts, ... map6 -> area 6 Hollow Ravine). Areas 7-10 (Crystal Fault,
 * Ashen Gate, Otherworld Verge, Rift Sanctum) are left UNMAPPED (`mapId`
 * undefined) — they describe future maps that do not exist yet.
 *
 * OPEN OWNER QUESTION: this 1:1-in-order mapping is a mismatch on theme —
 * map6's existing "hell city" theme (docs/CODEMAP.md / config comments) reads
 * closer to arc area 8 "Ashen Gate" (burnt frontier / infernal gate edge) than
 * to arc area 6 "Hollow Ravine" (abyss-root ravine / broken terrain). A
 * theme-matched mapping (e.g. map6 -> Ashen Gate, leaving a gap at areas 6-7)
 * is an equally valid alternative with its own mismatches elsewhere. Both are
 * a pure data swap in this file — nothing behavioral depends on the choice
 * yet — so 1:1-in-order was picked as the smallest reversible default; the
 * owner should confirm or override before this mapping is ever read for
 * behavior/UI.
 *
 * ASURA (ดินแดนอสูร): the endgame appendix map (`world.maps[6]`, id "asura",
 * stages 31-40) is explicitly OUTSIDE the World Arc — a parallel hard endgame,
 * not one of the ten arc areas. It never claims an arc `mapId` slot; see the
 * `worldArc.test.ts` guard.
 */

/** An engine map id, as declared in `CONFIG.world.maps[].id` (arc areas 1-6 only; 7-10 are unmapped). */
export type ArcMapId = "map1" | "map2" | "map3" | "map4" | "map5" | "map6";

export interface ArcArea {
  /** 1-10, owner-locked order (the arc's journey from safe edge to otherworld climax). */
  readonly order: number;
  /** snake_case stable id (naming only — never persisted/save-relevant yet). */
  readonly id: string;
  /** Owner-locked English display name. */
  readonly nameEn: string;
  /** One-line mood/identity descriptor, from the spec table (docs/world-arc-freefield-v1.md §2). */
  readonly themeHook: string;
  /** Existing engine map this area currently maps onto, if any (see header note). */
  readonly mapId?: ArcMapId;
}

/** The ten World Arc v1 areas, in owner-locked order. Naming/theme data only. */
export const WORLD_ARC: readonly ArcArea[] = [
  {
    order: 1,
    id: "capital_outskirts",
    nameEn: "Capital Outskirts",
    themeHook: "town gate / safe human edge — safe, warm, populated",
    mapId: "map1",
  },
  {
    order: 2,
    id: "farm_border_road",
    nameEn: "Farm Border Road",
    themeHook: "farm road at the forest edge — working land, first hints of wild",
    mapId: "map2",
  },
  {
    order: 3,
    id: "old_forest_path",
    nameEn: "Old Forest Path",
    themeHook: "deeper forest road — shaded, quiet, watchful",
    mapId: "map3",
  },
  {
    order: 4,
    id: "moonshade_grove",
    nameEn: "Moonshade Grove",
    themeHook: "misty magical forest — beautiful-strange, first magic",
    mapId: "map4",
  },
  {
    order: 5,
    id: "forgotten_shrine",
    nameEn: "Forgotten Shrine",
    themeHook: "ruined shrine / chapel in the woods — melancholy, sacred-broken",
    mapId: "map5",
  },
  {
    order: 6,
    id: "hollow_ravine",
    nameEn: "Hollow Ravine",
    themeHook: "abyss-root ravine / broken terrain — danger, vertigo, broken ground",
    mapId: "map6",
  },
  {
    order: 7,
    id: "crystal_fault",
    nameEn: "Crystal Fault",
    themeHook: "corrupted crystal wilds — alien growth, wrong colors",
  },
  {
    order: 8,
    id: "ashen_gate",
    nameEn: "Ashen Gate",
    themeHook: "burnt frontier / infernal gate edge — scorched, hostile, oppressive",
  },
  {
    order: 9,
    id: "otherworld_verge",
    nameEn: "Otherworld Verge",
    themeHook: "dimensional borderland — reality thinning, dreamlike dread",
  },
  {
    order: 10,
    id: "rift_sanctum",
    nameEn: "Rift Sanctum",
    themeHook: "final rift sanctuary / otherworld climax — climax, otherworldly grandeur",
  },
] as const;

/** Pure lookup: the arc area (if any) mapped onto a given engine map id. Dormant — no callers yet. */
export const arcAreaForMap = (mapId: string): ArcArea | undefined =>
  WORLD_ARC.find((area) => area.mapId === mapId);

// Sanity note (not a runtime assertion — see worldArc.test.ts for the enforced version):
// the asura appendix map id lives at CONFIG.world.maps[6].id ("asura") and is intentionally
// never a WORLD_ARC mapId — it is outside the ten-area arc (endgame appendix).
