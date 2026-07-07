/**
 * Town NPC anchors — the render-side view of where the two named town actors stand
 * (ป้าปุ๊ the merchant / ลุงดึ๋ง the refine smith) plus their tap-interaction radius
 * (world/engine units, same space as `render/layout.ts`'s `WORLD_WIDTH`/`GROUND_Y`).
 *
 * SINGLE SOURCE OF TRUTH IS THE ENGINE (M6 town NPCs phase 2): the id / x / radius live
 * in `CONFIG.townNpcs` (engine/config) so the engine owns the geometry the bot walk +
 * phase-3 UI tap gate depend on, and this module DERIVES its `TOWN_NPCS` from it. Render
 * adds only its own presentation concern — the Thai display NAME on the floating plate.
 * The exported shape is unchanged (`views/npcView.ts` reads `townNpcAnchor` to position
 * the rigs; `GameRenderer.hitTestNpc()`/`npcViews` iterate `TOWN_NPCS`), so no consumer
 * changed. `TownNpcId` is re-exported from the engine (its canonical home).
 */

import { CONFIG, type TownNpcId } from "@/engine";

export type { TownNpcId };

export interface TownNpcAnchor {
  id: TownNpcId;
  /** Thai display name for the floating name plate (render presentation only). */
  name: string;
  /** World-x anchor (feet position); world-y is always the town's `GROUND_Y`. */
  x: number;
  /** Horizontal tap-interaction half-width (world units). */
  radius: number;
}

/** Thai display names for the plate (render-only; the engine owns id/x/radius). */
const NPC_NAMES: Record<TownNpcId, string> = {
  "npc:pahpu": "ป้าปุ๊",
  "npc:lungdueng": "ลุงดึ๋ง",
  "npc:elder": "ผู้ใหญ่บ้าน",
};

/** Render anchors DERIVED from the engine's `CONFIG.townNpcs` (x/radius) plus the
 * render-only display name — so render/engine/UI all agree on where these stand. */
export const TOWN_NPCS: readonly TownNpcAnchor[] = CONFIG.townNpcs.map((n) => ({
  id: n.id,
  name: NPC_NAMES[n.id],
  x: n.x,
  radius: n.radius,
}));

export function townNpcAnchor(id: TownNpcId): TownNpcAnchor {
  const a = TOWN_NPCS.find((n) => n.id === id);
  if (!a) throw new Error(`unknown town npc id: ${id}`);
  return a;
}
