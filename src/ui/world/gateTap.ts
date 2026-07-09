/**
 * Zone-edge gate tap decision (R1 W2 "tappable gates", owner: "อยากให้เป็นการ
 * คลิกที่ตัวเกม เช่นการคลิกที่ประตู") — pure mapping from a
 * `GameRenderer.hitTestGate()` side hit to the SAME action the old ◀ ▶
 * `WalkArrow` buttons fired (`walkToZone`), so a gate tap can never diverge
 * from the arrows' behavior. No React/Pixi here — `GameClient.tsx`'s
 * `onArenaClick` is the only caller, headlessly tested in
 * `__tests__/gateTap.test.ts`.
 */

import type { WorldLocation, WorldNav } from "@/engine";

export type GateTapAction =
  | { kind: "walk"; target: WorldLocation }
  | { kind: "locked"; need: number }
  | { kind: "none" };

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
  return { kind: "walk", target: { mapId: neighbor.zone.mapId, zoneIdx: neighbor.zone.zoneIdx } };
}
