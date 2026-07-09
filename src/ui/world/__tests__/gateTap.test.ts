/**
 * R1 W2 "tappable gates" — `resolveGateTap()` must map a gate tap to the
 * EXACT same action the old ◀ ▶ `WalkArrow` buttons produced: an unlocked
 * neighbor queues `walkToZone({mapId, zoneIdx})` (the SAME intent constant
 * `WalkControls.tsx`'s `onWalk` used to fire), a locked one does nothing but
 * report how many kills remain, and every case a disabled arrow used to cover
 * (no neighbor / mid-travel) resolves to `"none"`.
 */

import { describe, expect, it } from "vitest";
import type { WorldNav, Zone } from "@/engine";
import { resolveGateTap } from "@/ui/world/gateTap";

function nav(overrides: Partial<WorldNav>): WorldNav {
  const current: Zone = { mapId: "map1", zoneIdx: 2, kind: "farm", stage: 2 };
  return { current, left: null, right: null, traveling: false, ...overrides };
}

describe("resolveGateTap", () => {
  it("unlocked right neighbor -> walk, target matches the neighbor's own zone", () => {
    const n = nav({
      right: { zone: { mapId: "map1", zoneIdx: 3, kind: "farm", stage: 3 }, unlocked: true },
    });
    const action = resolveGateTap(n, "right", 10, 24);
    expect(action).toEqual({ kind: "walk", target: { mapId: "map1", zoneIdx: 3 } });
  });

  it("unlocked left neighbor -> walk, mirrors the left arrow exactly", () => {
    const n = nav({
      left: { zone: { mapId: "map1", zoneIdx: 1, kind: "farm", stage: 1 }, unlocked: true },
    });
    const action = resolveGateTap(n, "left", 10, 24);
    expect(action).toEqual({ kind: "walk", target: { mapId: "map1", zoneIdx: 1 } });
  });

  it("locked neighbor -> 'locked' with the remaining-kills count, never queues a walk", () => {
    const n = nav({
      right: { zone: { mapId: "map1", zoneIdx: 3, kind: "boss", stage: 5 }, unlocked: false },
    });
    const action = resolveGateTap(n, "right", 18, 24);
    expect(action).toEqual({ kind: "locked", need: 6 });
  });

  it("locked neighbor, kills already >= goal (stale snapshot) -> need clamps to 0, never negative", () => {
    const n = nav({
      right: { zone: { mapId: "map1", zoneIdx: 3, kind: "farm", stage: 3 }, unlocked: false },
    });
    const action = resolveGateTap(n, "right", 30, 24);
    expect(action).toEqual({ kind: "locked", need: 0 });
  });

  it("no neighbor (frontier edge / town's missing left gate) -> 'none'", () => {
    const n = nav({ right: null });
    expect(resolveGateTap(n, "right", 0, 24)).toEqual({ kind: "none" });
  });

  it("mid-travel -> 'none' even with an unlocked neighbor (mirrors the arrow's disabled-while-traveling rule)", () => {
    const n = nav({
      traveling: true,
      right: { zone: { mapId: "map1", zoneIdx: 3, kind: "farm", stage: 3 }, unlocked: true },
    });
    expect(resolveGateTap(n, "right", 24, 24)).toEqual({ kind: "none" });
  });
});
