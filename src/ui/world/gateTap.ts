/**
 * Zone-edge gate tap decision (R1 W2 "tappable gates", owner: "อยากให้เป็นการ
 * คลิกที่ตัวเกม เช่นการคลิกที่ประตู") — pure mapping from a
 * `GameRenderer.hitTestGate()` side hit to the SAME action the old ◀ ▶
 * `WalkArrow` buttons fired (`walkToZone`), so a gate tap can never diverge
 * from the arrows' behavior. No React/Pixi here — `GameClient.tsx`'s
 * `onArenaClick` is the only caller, headlessly tested in
 * `__tests__/gateTap.test.ts`.
 *
 * Owner UX round (2026-07-09) "เดินไปที่ประตูก่อน แล้วค่อยวาป": a "walk" action
 * now also carries `gateX` — the SAME anchor `render/environment/zoneGates.ts`'s
 * `gateX()` draws the archway at — so `GameClient.tsx` can arm a `gateTrip`
 * (`./gateTrip.ts`) that walks the hero there FIRST instead of transitioning
 * immediately. `gateAnchorX` below is that formula re-derived from the
 * shared, public `CONFIG` alone (ui may only reach the engine through
 * `@/engine` — the render-side helper isn't importable here).
 */

import { CONFIG } from "@/engine";
import type { WorldLocation, WorldNav } from "@/engine";

export type GateTapAction =
  | { kind: "walk"; target: WorldLocation; gateX: number }
  | { kind: "locked"; need: number }
  | { kind: "none" };

/** Mirrors `render/environment/zoneGates.ts`'s `gateX()` exactly (same two
 * `CONFIG.hunt` fields + each map's `fieldWidth`) — kept in lockstep with the
 * render side by both reading off the SAME public `CONFIG` object, not by
 * importing one from the other. */
export function gateAnchorX(mapId: string, side: "left" | "right"): number {
  if (side === "left") return CONFIG.hunt.heroMinX;
  const map = CONFIG.world.maps.find((m) => m.id === mapId);
  return (map?.fieldWidth ?? 900) - CONFIG.hunt.fieldRightMargin;
}

/**
 * `nav` = the SAME `worldNav(state)` read `WalkControls.tsx`'s old arrows
 * used to decide enablement; `side` = which gate was tapped
 * (`hitTestGate()`'s result); `kills`/`killGoal` = the CURRENT zone's live
 * unlock progress (`state.kills` / `CONFIG.killGoal(nav.current.stage)` —
 * the exact values the HUD's `hud.zoneUnlockLabel` gauge reads), only
 * meaningful when the neighbor turns out locked.
 *
 * `"none"` covers every case a `WalkArrow` would have rendered DISABLED with
 * no click handler at all: no neighbor (frontier edge / town's missing left
 * gate) or mid-travel — a tap there does nothing, same as before.
 */
export function resolveGateTap(
  nav: WorldNav,
  side: "left" | "right",
  kills: number,
  killGoal: number,
): GateTapAction {
  const neighbor = side === "left" ? nav.left : nav.right;
  if (!neighbor || nav.traveling) return { kind: "none" };
  if (!neighbor.unlocked) return { kind: "locked", need: Math.max(0, killGoal - kills) };
  return {
    kind: "walk",
    target: { mapId: neighbor.zone.mapId, zoneIdx: neighbor.zone.zoneIdx },
    // The gate being tapped lives on the CURRENT zone's edge (`nav.current`),
    // not the destination's — both maps use the same fieldWidth today so this
    // is a distinction without a difference in practice, but correct either way.
    gateX: gateAnchorX(nav.current.mapId, side),
  };
}
