/**
 * A fully self-contained visual for ONE resolved biome: sky + horizon glow +
 * clouds (fixed/calm) -> far silhouette parallax -> ground (flat band, OR a
 * terrain-tracking polygon + sky-sliver backing strip for a genuinely
 * non-flat farm zone — see `opts.terrain` on the constructor below) + near
 * prop parallax (conforming to the same terrain when active) -> ambient
 * particles -> optional weather tint -> (boss rooms only) fixed gate-pillar/
 * lintel framing + vignette, see `bossArena.ts`. `Environment` owns up to two
 * of these at once (current + incoming) so it can crossfade by alpha alone on
 * a biome OR terrain-flag change.
 */

import { Container } from "pixi.js";
import type { Zone } from "@/engine";
import type { GameState } from "@/engine/state";
import { CONFIG } from "@/engine/config";
import type { ResolvedBiome } from "@/render/environment/biomes";
import { BLEED_X, GROUND_BLEED, GROUND_Y, SKY_BLEED, WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";
import { AmbientField } from "@/render/environment/ambientParticles";
import { buildBossArenaFraming } from "@/render/environment/bossArena";
import {
  buildGroundBackingStrip,
  buildGroundBand,
  buildGroundPolygon,
} from "@/render/environment/groundBand";
import { buildGroundPropsChunk } from "@/render/environment/groundProps";
import { buildForestRoad, forestRoadActiveForZone } from "@/render/environment/forestRoad";
import { CloudField } from "@/render/environment/clouds";
import { ParallaxLayer } from "@/render/environment/ParallaxLayer";
import { buildSilhouetteChunk } from "@/render/environment/silhouettes";
import { buildHorizonGlow, buildSkyBands } from "@/render/environment/sky";
import { buildZoneGateProps, type ZoneGateProps } from "@/render/environment/zoneGateProps";
import type { Terrain } from "@/render/worldDepth/terrain";
import { terrainPresetForZone } from "@/render/worldDepth/terrainZone";

/** Small off-screen padding for the far/near PARALLAX layers (silhouettes,
 * ground-prop clumps) and ambient particles — separate from, and much
 * smaller than, the sky/ground BASE FILL's own `BLEED_X` bleed (R2.5 "Game
 * Screen" W1): a fullscreen ultra-wide/portrait screen reveals a wide flat
 * sky/ground band far past the zone's own 900-wide edges, but tiling
 * silhouette/prop scenery all the way out there would blow up per-biome
 * chunk counts for content nobody's eye lingers on out there — a plain sky/
 * ground band reads fine at the far bleed edges. Exported (W3): the ground-
 * layer tests build `buildGroundPolygon`/`buildGroundBackingStrip` at the
 * SAME span this class uses internally, without duplicating the magic
 * numbers. */
export const MARGIN = 60;
const FAR_CHUNK_W = 180;
const NEAR_CHUNK_W = 110;
/** Sky/ground BASE FILL depth — extends `GROUND_BLEED` below the playfield
 * (R2.5 W1) so a tall portrait screen's footroom never runs out of ground.
 * Exported for the SAME test-parity reason as `MARGIN` above. */
export const GROUND_DEPTH = WORLD_HEIGHT - GROUND_Y + GROUND_BLEED;
/** Ground-polygon/backing-strip sample spacing (px) — mirrors `/lab`
 * experiment ⑨'s `GROUND_POLY_STEP`. */
const GROUND_POLY_STEP = 24;

// ---- ดินแดนอสูร (ASURA) daily HOT-ZONE ambience (endgame v1) — a subtle golden
// ember drift layered ON TOP of the zone's own (violet-blood) particle field,
// active ONLY while standing in today's hot farm zone (`state.asuraHotZone`,
// see `engine/systems/asura.ts::asuraRewardMult` — the SAME comparison this
// mirrors: `zone.mapId === CONFIG.asura.mapId && zone.kind === "farm" &&
// zone.zoneIdx === state.asuraHotZone`). Built ONLY for an asura farm-zone
// `BiomeScene` instance (every other map/zone pays zero cost — the field is
// simply never constructed, a graceful structural no-op). A DISTINCT warm
// gold (not the zone's own crimson/violet ember) so "this zone is hot today"
// reads as its own signal at a glance. ----
const HOT_ZONE_EMBER_COLOR = 0xffd76a;
const HOT_ZONE_EMBER_DENSITY = 7;

function chunkCount(chunkWidth: number): number {
  return Math.ceil((WORLD_WIDTH + MARGIN * 2) / chunkWidth) + 2;
}

export class BiomeScene {
  readonly view = new Container();
  private readonly far: ParallaxLayer;
  private readonly near: ParallaxLayer;
  private readonly clouds: CloudField;
  private readonly ambient: AmbientField;
  private readonly gateProps: ZoneGateProps;
  /** ASURA daily hot-zone ember overlay — non-null ONLY when this instance IS
   * an asura farm zone (see the module-level doc comment above); every other
   * biome never builds it (zero extra cost). */
  private readonly hotZoneEmbers: AmbientField | null;
  /** This scene's own farm-zone index — only meaningful when `hotZoneEmbers`
   * is non-null (see above). */
  private readonly hotZoneIdx: number;

  /**
   * `opts.terrain` (W3 "โลกมีมิติ" ground promotion): undefined = today's flat
   * `buildGroundBand` rect, byte-identical (the terrain feature is OFF
   * upstream in `Environment`). When a `Terrain` IS supplied, this
   * constructor still checks `terrainPresetForZone(zone)` itself (defense in
   * depth — never trusts a caller to have already filtered): town/boss zones
   * and any farm zone that hash-picked the "flat" preset (`terrainZone.ts`'s
   * intentional variety pool) keep the plain rect too; only a genuinely
   * non-flat farm zone gets `buildGroundPolygon` + `buildGroundBackingStrip`
   * (see `groundBand.ts`'s doc comment) and conforms its near ground-props
   * layer to the slope via `ParallaxLayer`'s optional `conformY`.
   */
  constructor(
    readonly biome: ResolvedBiome,
    zone: Zone,
    state: GameState,
    opts?: { terrain?: Terrain },
  ) {
    // Sky base fill spans -SKY_BLEED..GROUND_Y (R2.5 W1) — much taller than
    // the far/near parallax's own small MARGIN buffer, so a fullscreen tall
    // screen's sky headroom never runs out before the Pixi `Application`'s
    // own flat backgroundColor would show through.
    const sky = buildSkyBands(
      biome.sky.top,
      biome.sky.bottom,
      -BLEED_X,
      -SKY_BLEED,
      WORLD_WIDTH + BLEED_X * 2,
      GROUND_Y + SKY_BLEED,
    );
    const horizonGlow = buildHorizonGlow(biome.sky.horizon, -BLEED_X, WORLD_WIDTH + BLEED_X * 2, GROUND_Y);
    this.view.addChild(sky, horizonGlow);

    this.clouds = new CloudField(biome.sky.horizon, WORLD_WIDTH, GROUND_Y);
    this.view.addChild(this.clouds.view);

    this.far = new ParallaxLayer(FAR_CHUNK_W, chunkCount(FAR_CHUNK_W), (index) =>
      buildSilhouetteChunk({
        chunkWidth: FAR_CHUNK_W,
        index,
        baselineY: GROUND_Y - 2,
        shape: biome.far.shape,
        far: biome.far,
      }),
    );
    this.far.view.position.x = -MARGIN;
    this.view.addChild(this.far.view);

    // Ground base fill widens by BLEED_X on each side (R2.5 W1) — the near
    // ground-props layer below stays at the smaller MARGIN buffer (see that
    // constant's own doc comment); `terrain.groundY` clamps internally to the
    // zone's own width, so sampling this far past it just extends the
    // nearest edge height flatly (`groundBand.ts`'s doc comment).
    const groundX = -BLEED_X;
    const groundWidth = WORLD_WIDTH + BLEED_X * 2;
    const terrain = opts?.terrain;
    const terrainActive = terrain !== undefined && terrainPresetForZone(zone) !== "flat";

    let nearConformY: ((localCenterX: number) => number) | undefined;
    if (terrainActive && terrain) {
      // Sky-sliver guard strip FIRST (behind), then the polygon fill on top
      // — see `groundBand.ts`'s doc comment.
      this.view.addChild(buildGroundBackingStrip(biome, groundX, GROUND_Y, groundWidth));
      this.view.addChild(
        buildGroundPolygon(biome, terrain, groundX, GROUND_Y, groundWidth, GROUND_DEPTH, GROUND_POLY_STEP),
      );
      // Local->world: `near.view` (below) sits at (-MARGIN, GROUND_Y) inside
      // this own (world-space) `view`, so a chunk-local center x maps to
      // world x via `localCenterX - MARGIN`; the value this returns is
      // near.view-LOCAL (world y minus the layer's own GROUND_Y offset).
      nearConformY = (localCenterX: number) => terrain.groundY(localCenterX - MARGIN) - GROUND_Y;
    } else {
      this.view.addChild(buildGroundBand(biome, groundX, GROUND_Y, groundWidth, GROUND_DEPTH));
    }

    // Forest Road ground composition (R4.5 Wave 2B, #69) — map2 farm zones
    // ONLY (gated + defended here at the single composition site; every other
    // map/zone stays byte-identical). Sits ON TOP of the ground fill but BELOW
    // the near ground-props layer, so bushes/rocks draw over the road. Static,
    // built once — never touched in `update()`.
    if (forestRoadActiveForZone(zone)) {
      this.view.addChild(
        buildForestRoad(biome, zone, GROUND_Y, groundX, groundWidth, terrainActive ? terrain : undefined),
      );
    }

    this.near = new ParallaxLayer(
      NEAR_CHUNK_W,
      chunkCount(NEAR_CHUNK_W),
      () => buildGroundPropsChunk({ chunkWidth: NEAR_CHUNK_W, bandDepth: GROUND_DEPTH, biome }),
      nearConformY,
    );
    this.near.view.position.set(-MARGIN, GROUND_Y);
    this.view.addChild(this.near.view);

    if (biome.weatherTint) {
      // Matches the widened sky/ground span above (R2.5 W1) — otherwise the
      // weather tint would visibly stop short of the bleed edges on a
      // fullscreen wide/tall screen, seaming against the untinted sky/ground.
      const tint = buildSkyBands(
        biome.weatherTint.color,
        biome.weatherTint.color,
        -BLEED_X,
        -SKY_BLEED,
        WORLD_WIDTH + BLEED_X * 2,
        SKY_BLEED + WORLD_HEIGHT + GROUND_BLEED,
      );
      tint.alpha = biome.weatherTint.alpha;
      this.view.addChild(tint);
    }

    this.ambient = new AmbientField(
      biome.particle.kind,
      biome.particle.color,
      biome.particle.density,
      WORLD_WIDTH,
      biome.particle.kind === "ember" || biome.particle.kind === "smoke" ? GROUND_Y - 160 : 10,
      biome.particle.kind === "ember" || biome.particle.kind === "smoke" ? GROUND_Y - 10 : GROUND_Y - 6,
    );
    this.view.addChild(this.ambient.view);

    // ASURA daily hot-zone ember overlay (see module doc comment) — built only
    // for an asura FARM zone; every other zone/map leaves this permanently
    // null (no field, no per-frame cost).
    const isAsuraFarmZone = zone.kind === "farm" && zone.mapId === CONFIG.asura.mapId;
    this.hotZoneIdx = zone.zoneIdx;
    this.hotZoneEmbers = isAsuraFarmZone
      ? new AmbientField(
          "ember",
          HOT_ZONE_EMBER_COLOR,
          HOT_ZONE_EMBER_DENSITY,
          WORLD_WIDTH,
          GROUND_Y - 160,
          GROUND_Y - 10,
        )
      : null;
    if (this.hotZoneEmbers) {
      this.hotZoneEmbers.view.visible = false;
      this.view.addChild(this.hotZoneEmbers.view);
    }

    // Boss-room-only arena framing (M6 task 2): fixed-position gate pillars +
    // lintel + a stepped-alpha vignette, added ON TOP of the biome's own
    // (already darker/more-intense) scenery — "a place, not an effect spam".
    if (biome.special === "bossRoom") {
      for (const g of buildBossArenaFraming(biome, WORLD_WIDTH, WORLD_HEIGHT, GROUND_Y)) {
        this.view.addChild(g);
      }
    }

    // Zone-edge gate archways / grand boss door (M7.5 "ประตูคือตัวกลาง") — fixed
    // screen position like `bossArena.ts`'s framing above, built once here.
    this.gateProps = buildZoneGateProps(zone, biome, GROUND_Y, this.view, state);
  }

  /** `speedMul` scales the far/near "world travel" scroll only — clouds and
   * ambient particles keep their own calm, constant real-time pace. `state`
   * drives the boss door's live locked/unlocked look (the ONLY continuous,
   * not-build-once part of this scene — see `zoneGateProps.ts`). */
  update(dt: number, speedMul: number, state: GameState): void {
    this.far.update(dt, this.biome.scrollSpeed.far * speedMul);
    this.near.update(dt, this.biome.scrollSpeed.near * speedMul);
    this.clouds.update(dt);
    this.ambient.update(dt);
    if (this.hotZoneEmbers) {
      const active = state.asuraHotZone !== null && state.asuraHotZone === this.hotZoneIdx;
      this.hotZoneEmbers.view.visible = active;
      if (active) this.hotZoneEmbers.update(dt);
    }
    this.gateProps.refreshLock(state);
    this.gateProps.update(dt);
  }

  destroy(): void {
    this.far.destroy();
    this.near.destroy();
    this.clouds.destroy();
    this.ambient.destroy();
    this.hotZoneEmbers?.destroy();
    this.gateProps.destroy();
    this.view.destroy({ children: true });
  }
}
