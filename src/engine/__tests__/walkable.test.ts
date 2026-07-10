import { describe, it, expect, afterEach } from "vitest";
import { CONFIG, initGameState, makeHero, step } from "@/engine";
import { fieldRect } from "@/engine/systems/plane";
import {
  clampToPolygon,
  clampToWalkable,
  walkablePolygon,
  type WalkablePolygon,
} from "@/engine/systems/walkable";
import { applyManualCommand, tickTownManualWalk } from "@/engine/systems/manual";
import { dashHeroTo } from "@/engine/systems/dash";

/**
 * WALKABLE AREA v1 (free-field 2.5D, phase 5, docs/world-arc-freefield-v1.md §3).
 *
 * Proves the OPTIONAL per-map walkable-outline machinery WITHOUT shipping any live polygon:
 * every real map stays full-rect (byte-identical), so the polygon path is exercised only via a
 * test FIXTURE temporarily attached to map1's config (restored after each test). Covers the pure
 * resolver (identity inside / nearest-boundary outside / corners), the no-polygon fallback's
 * bit-parity with the old field-rect clamp, determinism, and the real intake paths (moveTo,
 * ninja dash, town walk).
 */

// A rectangle WELL inside map1's field rect (x 55..876, y -64..56) so a polygon clamp is
// visibly distinct from a field-rect clamp: a point at x=500 is inside the field but OUTSIDE
// this outline (x 200..400), so the outline pulls it back to x=400 where the rect would not.
const FIX: WalkablePolygon = [
  { x: 200, y: -30 },
  { x: 400, y: -30 },
  { x: 400, y: 30 },
  { x: 200, y: 30 },
];

/** Temporarily give map1 a walkable outline (config is `as const` but a plain runtime array). */
function setMap1Walkable(poly: WalkablePolygon | undefined): void {
  const m = CONFIG.world.maps[0] as { walkable?: WalkablePolygon };
  if (poly) m.walkable = poly;
  else delete m.walkable;
}

afterEach(() => setMap1Walkable(undefined));

describe("walkable resolver — pure geometry (clampToPolygon)", () => {
  it("inside a point is identity", () => {
    expect(clampToPolygon(FIX, 300, 0)).toEqual({ x: 300, y: 0 });
  });

  it("outside to the right projects onto the right edge", () => {
    expect(clampToPolygon(FIX, 500, 0)).toEqual({ x: 400, y: 0 });
  });

  it("outside to the left projects onto the left edge", () => {
    expect(clampToPolygon(FIX, 100, 10)).toEqual({ x: 200, y: 10 });
  });

  it("outside above (far) projects onto the far edge", () => {
    expect(clampToPolygon(FIX, 300, -100)).toEqual({ x: 300, y: -30 });
  });

  it("a diagonal-outside point snaps to the nearest CORNER", () => {
    expect(clampToPolygon(FIX, 500, -100)).toEqual({ x: 400, y: -30 });
    expect(clampToPolygon(FIX, 100, 100)).toEqual({ x: 200, y: 30 });
  });

  it("a boundary point resolves to itself (distance 0)", () => {
    expect(clampToPolygon(FIX, 400, 0)).toEqual({ x: 400, y: 0 });
  });
});

describe("walkable resolver — determinism", () => {
  it("same input yields the same output (no RNG, no wall-clock)", () => {
    for (const [x, y] of [
      [500, -100],
      [100, 10],
      [301.7, 12.3],
      [-99999, 99999],
    ]) {
      expect(clampToPolygon(FIX, x, y)).toEqual(clampToPolygon(FIX, x, y));
      expect(clampToWalkable("map1", x, y)).toEqual(clampToWalkable("map1", x, y));
    }
  });
});

describe("walkablePolygon — config lookup", () => {
  it("returns undefined when the map defines no outline (every live map, byte-identical)", () => {
    expect(walkablePolygon("map1")).toBeUndefined();
    expect(walkablePolygon("map6")).toBeUndefined();
    expect(walkablePolygon("asura")).toBeUndefined();
    expect(walkablePolygon("nope")).toBeUndefined();
  });

  it("returns the outline when present", () => {
    setMap1Walkable(FIX);
    expect(walkablePolygon("map1")).toEqual(FIX);
  });

  it("treats a degenerate (<3 vertex) outline as absent (fail-safe → rect, never a trap)", () => {
    setMap1Walkable([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(walkablePolygon("map1")).toBeUndefined();
  });
});

describe("clampToWalkable — no-polygon fallback is bit-identical to the field-rect clamp", () => {
  it("matches an INDEPENDENT x/y fieldRect clamp for inside + every outside quadrant", () => {
    const f = fieldRect("map1");
    const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
    const cases: [number, number][] = [
      [300, 0], // inside
      [99999, 0], // x over
      [-99999, 0], // x under
      [300, 99999], // y over
      [300, -99999], // y under
      [99999, 99999], // both over (corner)
      [-99999, -99999], // both under (corner)
      [42.5, -12.25], // fractional inside
    ];
    for (const [x, y] of cases) {
      expect(clampToWalkable("map1", x, y)).toEqual({
        x: clamp(x, f.minX, f.maxX),
        y: clamp(y, f.minY, f.maxY),
      });
    }
  });
});

describe("walkable — intake integration through a fixture outline", () => {
  it("moveTo resolves an out-of-outline tap to the nearest reachable point (command + event)", () => {
    setMap1Walkable(FIX);
    const s = initGameState(1);
    s.spawnPaused = true;
    s.enemies = [];
    step(s, { moveTo: { x: 500, y: 0 } }); // inside the field, outside the outline
    expect(s.heroes[0].command).toEqual({ kind: "move", x: 400, y: 0 });
    const ev = s.events.find((e) => e.type === "moveOrdered");
    expect(ev && ev.type === "moveOrdered" && [ev.x, ev.y]).toEqual([400, 0]);
  });

  it("without an outline, moveTo stays byte-identical (field-rect x/y clamp)", () => {
    const s = initGameState(1);
    s.spawnPaused = true;
    s.enemies = [];
    step(s, { moveTo: { x: 500, y: 0 } });
    // No outline on map1 → the tap is already inside the field rect → identity.
    expect(s.heroes[0].command).toEqual({ kind: "move", x: 500, y: 0 });
  });

  it("ninja dash landing is pulled back onto the outline (2D landing)", () => {
    setMap1Walkable(FIX);
    const s = initGameState(1);
    const hero = makeHero(1, "swordsman");
    hero.x = 300;
    hero.planeY = 0;
    s.heroes = [hero];
    // Land past a synthetic target at x=500 → landX ≈ 518, outside the outline (x max 400).
    const toX = dashHeroTo(s, hero, 500, Infinity, 0);
    expect(toX).toBe(400);
    expect(hero.x).toBe(400);
    expect(hero.planeY).toBe(0);
  });

  it("town walk consumes the outline-clamped command and lands on the boundary", () => {
    setMap1Walkable(FIX);
    const s = initGameState(1);
    const hero = s.heroes[0];
    hero.x = 300;
    hero.planeY = 0;
    applyManualCommand(s, [{ moveTo: { x: 500, y: 0 } }]);
    expect(hero.command).toEqual({ kind: "move", x: 400, y: 0 });
    for (let i = 0; i < 200 && hero.command; i++) tickTownManualWalk(s);
    expect(hero.command).toBeNull();
    expect(hero.x).toBeCloseTo(400, 5);
    expect(hero.planeY).toBeCloseTo(0, 5);
  });
});
