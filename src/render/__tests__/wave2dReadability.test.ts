/**
 * R4.5 Wave 2D readability/mobile polish (issue #69) — combined Wave-2 slice
 * guards. This is a TUNING + regression pass over the ground composition
 * (`environment/forestRoad.ts`, Wave 2B), the world props (`environment/
 * mapProps.ts`, Wave 2C), the contact shadow (`views/entityShadow.ts`, Wave
 * 1), and the depth-scale policy (`worldDepth/depthBand.ts`) — no new visual
 * elements, everything here checks knob VALUES.
 *
 * We can't screenshot headlessly, so "reads at a glance on mobile" is encoded
 * as geometry/contrast arithmetic instead:
 *   (a) contrast — the contact shadow (near-black, `views/entityShadow.ts`)
 *       must stay distinguishable from every map2-farm depth-tone strip, at
 *       BOTH the noon-identity palette AND the deep-night palette extreme
 *       (`worldDepth/dayNight.ts`'s keyframes) — otherwise the shadow melts
 *       into the ground and stops reading as "planted feet".
 *   (b) the foreground grass strip (Wave 2C) stays a shin's worth of band —
 *       re-asserts `mapProps.test.ts`'s bound so a future knob edit on either
 *       side of the stack can't silently blow through it.
 *   (c) prop density — standing-prop + grass-clump counts per zone stay
 *       inside the Wave-2 spec's authored inventory range, across ALL 5 map2
 *       farm zones (the existing `mapProps.test.ts` only spot-checks zone 3).
 *   (d) the near grass strip's solid coverage never rises out of the
 *       nearest depth-tone strip's own band — it decorates the near strip,
 *       it never competes with (covers) the ground where the 2B road is most
 *       visible.
 *   (e) the depth-scale policy pin lives in
 *       `worldDepth/__tests__/worldDepthDepthBand.test.ts` (see that file).
 */

import { describe, expect, it } from "vitest";
import { biomeForZone } from "@/render/environment/biomes";
import { forestRoadStrips } from "@/render/environment/forestRoad";
import {
  foregroundStripBand,
  GRASS_D_MAX,
  GRASS_D_MIN,
  GRASS_MAX,
  GRASS_MIN,
  mapPropLayout,
  type MapPropSpec,
} from "@/render/environment/mapProps";
import { GROUND_Y } from "@/render/layout";
import { SHADOW_INNER_ALPHA, SHADOW_OUTER_ALPHA } from "@/render/views/entityShadow";
import { DEPTH_OFFSET_FAR, DEPTH_OFFSET_NEAR } from "@/render/worldDepth/depthBand";
import { samplePalette } from "@/render/worldDepth/dayNight";
import type { Zone } from "@/engine";

function map2Farm(zoneIdx: number): Zone {
  return { mapId: "map2", zoneIdx, kind: "farm", stage: zoneIdx };
}
const ZONES = [1, 2, 3, 4, 5];

// ---------------------------------------------------------------------------
// (a) shadow-vs-strip contrast
// ---------------------------------------------------------------------------

/** Perceptual relative luminance (0-255 scale) — `colorUtils.ts` has no such
 * helper (it only does HSL lerp/darken), so this stays local per the brief's
 * fallback. Standard broadcast weights; precision doesn't matter here, only
 * monotonic "how bright does this read" ordering. */
function relativeLuminance(color: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Component-wise multiply — the SAME math a Pixi `tint` applies to a
 * container's children (`GameRenderer`'s `hosts.background.tint =
 * palette.ambientTint`, which is what `forestRoad`'s strips actually ride at
 * night — they live in `Environment`'s `background` container, NOT the
 * relieved `entities` tint `dayNight.ts` documents for actors). */
function applyTint(color: number, tint: number): number {
  const cr = (color >> 16) & 0xff;
  const cg = (color >> 8) & 0xff;
  const cb = color & 0xff;
  const tr = (tint >> 16) & 0xff;
  const tg = (tint >> 8) & 0xff;
  const tb = tint & 0xff;
  return ((Math.round((cr * tr) / 255) << 16) | (Math.round((cg * tg) / 255) << 8) | Math.round((cb * tb) / 255)) >>> 0;
}

// The shadow is `PALETTE.shadow` = pure black — its own luminance is always 0
// regardless of any container tint (0 × anything = 0). So "does the shadow
// read against this strip" is a COMPOSITE question: how much luminance does
// stacking the (near-black, low-alpha) shadow over the strip actually remove?
// `delta = lum(stripTone) × shadowAlpha` (black contributes 0, the backdrop
// contributes `lum × (1-alpha)`). We check the shadow's WEAKEST alpha
// (`SHADOW_OUTER_ALPHA`, the wide faint skirt) — the worst case for
// visibility — so a strip this delta clears reads under the skirt AND the
// stronger stacked core (`SHADOW_INNER_ALPHA`) alike.
const SHADOW_WORST_ALPHA = SHADOW_OUTER_ALPHA;
void SHADOW_INNER_ALPHA; // documents the stronger (core, composited ~0.30) alpha exists — not the worst case, unused here.

// A floor near 0 would let a literal `0x000000` strip (the Wave-2B bug this
// PR fixes — `adjustLightness` clamped to L=0 on map2's darkest farm bases)
// slip through with delta=0; the real post-fix minimum (deep night, zone 5,
// far strip) is ≈0.43 — the floor sits comfortably below that with margin.
const CONTRAST_DELTA_FLOOR = 0.3;

describe("R4.5 Wave 2D — contact shadow never melts into a forest-road strip", () => {
  const NOON_TINT = samplePalette(0.25).ambientTint; // เที่ยง — identity, 0xffffff
  const NIGHT_TINT = samplePalette(0.75).ambientTint; // กลางคืน — deep-night extreme

  it("every strip, every map2 farm zone, clears the delta floor at noon AND at night", () => {
    expect(NOON_TINT).toBe(0xffffff);
    for (const z of ZONES) {
      const biome = biomeForZone(map2Farm(z));
      const strips = forestRoadStrips(biome, GROUND_Y);
      for (const s of strips) {
        const noonLum = relativeLuminance(applyTint(s.color, NOON_TINT));
        const nightLum = relativeLuminance(applyTint(s.color, NIGHT_TINT));
        expect(noonLum * SHADOW_WORST_ALPHA).toBeGreaterThanOrEqual(CONTRAST_DELTA_FLOOR);
        expect(nightLum * SHADOW_WORST_ALPHA).toBeGreaterThanOrEqual(CONTRAST_DELTA_FLOOR);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// (b) foreground strip stays a shin's worth of band (re-assert 2C's bound)
// ---------------------------------------------------------------------------

describe("R4.5 Wave 2D — foreground grass strip re-asserted shin bound", () => {
  it("strip height stays <=28px and inside the near half of the depth band", () => {
    const { top, bottom } = foregroundStripBand(GROUND_Y);
    const bandBottom = GROUND_Y + DEPTH_OFFSET_NEAR;
    expect(bottom - top).toBeLessThanOrEqual(28);
    expect(top).toBeGreaterThan(GROUND_Y);
    expect(bottom).toBeGreaterThan(bandBottom);
  });
});

// ---------------------------------------------------------------------------
// (c) prop density bound, all 5 map2 farm zones (pins the hash layout)
// ---------------------------------------------------------------------------

describe("R4.5 Wave 2D — prop inventory stays in-spec across every map2 farm zone", () => {
  it("4-6 trees, 3-4 rocks, exactly 1 lamp/sign/gateFragment, grass in [GRASS_MIN, GRASS_MAX]", () => {
    for (const z of ZONES) {
      const { standing, grass } = mapPropLayout(map2Farm(z));
      const count = (k: MapPropSpec["kind"]) => standing.filter((s) => s.kind === k).length;
      expect(count("tree")).toBeGreaterThanOrEqual(4);
      expect(count("tree")).toBeLessThanOrEqual(6);
      expect(count("rock")).toBeGreaterThanOrEqual(3);
      expect(count("rock")).toBeLessThanOrEqual(4);
      expect(count("lamp")).toBe(1);
      expect(count("sign")).toBe(1);
      expect(count("gateFragment")).toBe(1);
      expect(grass.length).toBeGreaterThanOrEqual(GRASS_MIN);
      expect(grass.length).toBeLessThanOrEqual(GRASS_MAX);
      for (const cl of grass) {
        expect(cl.d).toBeGreaterThanOrEqual(GRASS_D_MIN);
        expect(cl.d).toBeLessThanOrEqual(GRASS_D_MAX);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// (d) near grass strip vs the 2B road — overlap seam
// ---------------------------------------------------------------------------

describe("R4.5 Wave 2D — near grass strip decorates the NEAR tone strip only", () => {
  it("the grass strip's blade-tip apex never rises above the near depth-tone strip's own top", () => {
    // Both `forestRoadStrips` (2B) and `foregroundStripBand` (2C) derive from
    // the SAME `DEPTH_OFFSET_*` envelope, so this is a structural guard, not
    // a coincidence — it fails loudly if a future knob edit on either side
    // (STRIP_COUNT, TUFT_MAX_H, DEPTH_OFFSET_NEAR) breaks the containment.
    const biome = biomeForZone(map2Farm(3));
    const strips = forestRoadStrips(biome, GROUND_Y);
    const nearStripTop = strips[strips.length - 1]!.top;
    const { top: bladeTipTop } = foregroundStripBand(GROUND_Y);
    expect(bladeTipTop).toBeGreaterThanOrEqual(nearStripTop);
    // And well clear of the FAR edge of the band entirely (sanity: it's a
    // near-only decoration, not a full-band overlay).
    expect(bladeTipTop).toBeGreaterThan(GROUND_Y + DEPTH_OFFSET_FAR);
  });
});
