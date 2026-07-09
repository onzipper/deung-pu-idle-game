import { describe, expect, it } from "vitest";
import { terrainForZone, terrainPresetForZone } from "@/render/worldDepth/terrainZone";
import { GROUND_Y, WORLD_WIDTH } from "@/render/layout";
import type { Zone } from "@/engine";

const GATE_L = 55;
const GATE_R = 876;

const town: Zone = { mapId: "map1", zoneIdx: 0, kind: "town", stage: 1 };
const boss: Zone = { mapId: "map1", zoneIdx: 6, kind: "boss", stage: 5 };

/** A spread of farm zones across every real map (ids incl. "asura"). */
function farmZones(): Zone[] {
  const zones: Zone[] = [];
  for (const mapId of ["map1", "map2", "map3", "map4", "map5", "map6", "asura"]) {
    const count = mapId === "asura" ? 10 : 5;
    for (let i = 1; i <= count; i++) zones.push({ mapId, zoneIdx: i, kind: "farm", stage: i });
  }
  return zones;
}

describe("worldDepth terrain-per-zone", () => {
  it("town and boss zones are EXACTLY flat everywhere", () => {
    for (const zone of [town, boss]) {
      expect(terrainPresetForZone(zone)).toBe("flat");
      const t = terrainForZone(zone);
      for (let x = -20; x <= WORLD_WIDTH + 20; x += 3.5) {
        expect(t.groundY(x)).toBe(GROUND_Y);
      }
    }
  });

  it("farm presets are deterministic and actually vary across zones", () => {
    const zones = farmZones();
    const presets = zones.map((z) => terrainPresetForZone(z));
    for (const z of zones) {
      // Stable per zone key across repeated calls.
      expect(terrainPresetForZone(z)).toBe(terrainPresetForZone(z));
    }
    const distinct = new Set(presets);
    expect(distinct.size).toBeGreaterThanOrEqual(2); // the hash really spreads
    expect(presets.some((p) => p !== "flat")).toBe(true); // at least one rolls
  });

  it("every farm zone flattens to exactly GROUND_Y at BOTH gates", () => {
    for (const z of farmZones()) {
      const t = terrainForZone(z);
      expect(t.groundY(GATE_L)).toBe(GROUND_Y);
      expect(t.groundY(GATE_R)).toBe(GROUND_Y);
    }
  });

  it("stays within a couple px of GROUND_Y right next to the gates", () => {
    for (const z of farmZones()) {
      const t = terrainForZone(z);
      for (let dx = -10; dx <= 10; dx++) {
        expect(Math.abs(t.groundY(GATE_L + dx) - GROUND_Y)).toBeLessThan(2);
        expect(Math.abs(t.groundY(GATE_R + dx) - GROUND_Y)).toBeLessThan(2);
      }
    }
  });

  it("is continuous THROUGH the envelope (|Δy| per 1px < 1.5)", () => {
    for (const z of farmZones()) {
      const t = terrainForZone(z);
      let prev = t.groundY(0);
      for (let x = 1; x <= WORLD_WIDTH; x++) {
        const y = t.groundY(x);
        expect(Math.abs(y - prev)).toBeLessThan(1.5);
        prev = y;
      }
    }
  });

  it("a rolling zone's terrain really shows THROUGH mid-field (envelope opens up)", () => {
    const nonFlat = farmZones().find((z) => terrainPresetForZone(z) !== "flat");
    expect(nonFlat).toBeDefined();
    const t = terrainForZone(nonFlat!);
    let maxDev = 0;
    // Sample the middle, comfortably > 90px from both gates.
    for (let x = 200; x <= 700; x += 2) maxDev = Math.max(maxDev, Math.abs(t.groundY(x) - GROUND_Y));
    expect(maxDev).toBeGreaterThan(5); // it's not secretly flat in the middle
  });

  it("polyline re-samples THROUGH the envelope (matches groundY point-for-point)", () => {
    const z = farmZones().find((zz) => terrainPresetForZone(zz) !== "flat")!;
    const t = terrainForZone(z);
    for (const step of [24, 100]) {
      const pts = t.polyline(step);
      expect(pts[0]).toBe(0);
      expect(pts[pts.length - 2]).toBe(WORLD_WIDTH);
      for (let i = 0; i < pts.length; i += 2) {
        expect(pts[i + 1]).toBe(t.groundY(pts[i]));
      }
    }
  });

  it("caches per zone key: same zone → same Terrain instance", () => {
    const z: Zone = { mapId: "map3", zoneIdx: 99, kind: "farm", stage: 11 };
    const a = terrainForZone(z);
    const b = terrainForZone(z);
    expect(a).toBe(b);
    // A different zone is a different instance.
    const c = terrainForZone({ mapId: "map3", zoneIdx: 98, kind: "farm", stage: 11 });
    expect(c).not.toBe(a);
  });
});
