/**
 * Town NPC anchors — SINGLE SOURCE OF TRUTH for where the two named town
 * actors stand (ป้าปุ๊ the merchant / ลุงดึ๋ง the refine smith) plus their
 * tap-interaction radius (world/engine units, same space as `render/layout.ts`'s
 * `WORLD_WIDTH`/`GROUND_Y`).
 *
 * Render-side only for now (M7.x "Town NPCs" task): `views/npcView.ts` reads
 * this to position the two rigs, `GameRenderer.hitTestNpc()` reads it for tap
 * hit-testing. A later engine/bot-routing wave is expected to import this
 * SAME constant (or mirror it exactly, same convention `zoneGates.ts` already
 * uses for engine-derived-but-render-owned geometry) rather than re-deriving
 * its own x positions — keep this the ONE place these numbers live.
 *
 * Placement: both sit well clear of the town zone's walkable edges
 * (`CONFIG.hunt.heroMinX` = 55 on the left; town has no left gate archway —
 * see `zoneGateProps.ts` — and its single right gate sits around x ≈ 876) so
 * neither overlaps the gate props or crowds the hero's spawn/walk path.
 */

export type TownNpcId = "npc:pahpu" | "npc:lungdueng";

export interface TownNpcAnchor {
  id: TownNpcId;
  /** Thai display name for the floating name plate. */
  name: string;
  /** World-x anchor (feet position); world-y is always the town's `GROUND_Y`. */
  x: number;
  /** Horizontal tap-interaction half-width (world units). */
  radius: number;
}

/** The ONE exported constant — keep every anchor position in this single
 * array so render/engine/UI all agree on where these two actors stand. */
export const TOWN_NPCS: readonly TownNpcAnchor[] = [
  { id: "npc:pahpu", name: "ป้าปุ๊", x: 230, radius: 42 },
  { id: "npc:lungdueng", name: "ลุงดึ๋ง", x: 560, radius: 42 },
] as const;

export function townNpcAnchor(id: TownNpcId): TownNpcAnchor {
  const a = TOWN_NPCS.find((n) => n.id === id);
  if (!a) throw new Error(`unknown town npc id: ${id}`);
  return a;
}
