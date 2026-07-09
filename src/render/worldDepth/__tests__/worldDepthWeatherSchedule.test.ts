import { describe, expect, it } from "vitest";
import { weatherFor, WEATHER_WINDOW_MS } from "@/render/worldDepth/weatherSchedule";
import type { WeatherKind } from "@/render/worldDepth/weather";
import type { Zone } from "@/engine";

const farm = (mapId: string, zoneIdx = 1): Zone => ({ mapId, zoneIdx, kind: "farm", stage: 1 });

/** Every kind seen for a zone across `windows` consecutive 20-min buckets. */
function kindsOver(zone: Zone, windows: number): Set<WeatherKind> {
  const seen = new Set<WeatherKind>();
  for (let w = 0; w < windows; w++) seen.add(weatherFor(zone, w * WEATHER_WINDOW_MS));
  return seen;
}

/** Allowed weather per map (mirrors the module's knob table). */
const ALLOWED: Record<string, WeatherKind[]> = {
  map1: ["rain", "leaves"],
  map2: [],
  map3: ["rain"],
  map4: ["snow"],
  map5: [],
  map6: ["ash"],
  asura: ["ash"],
};

describe("worldDepth weather schedule", () => {
  it("is deterministic in (zone, window) and constant within a window", () => {
    const z = farm("map1", 3);
    expect(weatherFor(z, 12345)).toBe(weatherFor(z, 12345));
    // Two instants in the SAME 20-min bucket resolve identically.
    const base = 7 * WEATHER_WINDOW_MS;
    expect(weatherFor(z, base)).toBe(weatherFor(z, base + WEATHER_WINDOW_MS - 1));
    // Handles negative wall-clock without throwing / going out of set.
    expect(ALLOWED.map1.concat("none")).toContain(weatherFor(z, -3 * WEATHER_WINDOW_MS - 5));
  });

  it("only ever returns that map's allowed kinds (plus none)", () => {
    for (const mapId of Object.keys(ALLOWED)) {
      const seen = kindsOver(farm(mapId, 2), 2000);
      const allowedSet = new Set<WeatherKind>([...ALLOWED[mapId], "none"]);
      for (const k of seen) expect(allowedSet.has(k)).toBe(true);
    }
  });

  it("empty-set maps (map2, map5) are ALWAYS clear", () => {
    for (const mapId of ["map2", "map5"]) {
      for (let w = 0; w < 500; w++) {
        expect(weatherFor(farm(mapId, w % 5), w * WEATHER_WINDOW_MS)).toBe("none");
      }
    }
  });

  it("town zones override to the soft rain/leaves set (never their map's weather)", () => {
    // A synthetic town on map6 (whose farms show ash) must NOT show ash.
    const townOnAshMap: Zone = { mapId: "map6", zoneIdx: 0, kind: "town", stage: 26 };
    const seen = kindsOver(townOnAshMap, 2000);
    expect(seen.has("ash")).toBe(false);
    for (const k of seen) expect(["none", "rain", "leaves"]).toContain(k);
    expect(seen.has("rain") || seen.has("leaves")).toBe(true); // override is active
  });

  it("clears roughly half the windows (~50% none, ±10%)", () => {
    for (const z of [farm("map1", 3), farm("map4", 4), farm("map3", 2)]) {
      let none = 0;
      const W = 4000;
      for (let w = 0; w < W; w++) if (weatherFor(z, w * WEATHER_WINDOW_MS) === "none") none++;
      const rate = none / W;
      expect(rate).toBeGreaterThan(0.4);
      expect(rate).toBeLessThan(0.6);
    }
  });

  it("both allowed kinds actually occur for a two-kind map (uniform-ish pick)", () => {
    const seen = kindsOver(farm("map1", 3), 4000);
    expect(seen.has("rain")).toBe(true);
    expect(seen.has("leaves")).toBe(true);
  });
});
