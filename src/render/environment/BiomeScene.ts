/**
 * A fully self-contained visual for ONE resolved biome: sky + horizon glow +
 * clouds (fixed/calm) -> far silhouette parallax -> ground band + near prop
 * parallax -> ambient particles -> optional weather tint -> (boss rooms only)
 * fixed gate-pillar/lintel framing + vignette, see `bossArena.ts`. `Environment`
 * owns up to two of these at once (current + incoming) so it can crossfade by
 * alpha alone on a biome change.
 */

import { Container } from "pixi.js";
import type { Zone } from "@/engine";
import type { GameState } from "@/engine/state";
import { CONFIG } from "@/engine/config";
import type { ResolvedBiome } from "@/render/environment/biomes";
import { GROUND_Y, WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";
import { AmbientField } from "@/render/environment/ambientParticles";
import { buildBossArenaFraming } from "@/render/environment/bossArena";
import { buildGroundBand } from "@/render/environment/groundBand";
import { buildGroundPropsChunk } from "@/render/environment/groundProps";
import { CloudField } from "@/render/environment/clouds";
import { ParallaxLayer } from "@/render/environment/ParallaxLayer";
import { buildSilhouetteChunk } from "@/render/environment/silhouettes";
import { buildHorizonGlow, buildSkyBands } from "@/render/environment/sky";
import { buildZoneGateProps, type ZoneGateProps } from "@/render/environment/zoneGateProps";

const MARGIN = 60;
const FAR_CHUNK_W = 180;
const NEAR_CHUNK_W = 110;
const GROUND_DEPTH = WORLD_HEIGHT - GROUND_Y + MARGIN;

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

  constructor(readonly biome: ResolvedBiome, zone: Zone, state: GameState) {
    const sky = buildSkyBands(
      biome.sky.top,
      biome.sky.bottom,
      -MARGIN,
      -MARGIN,
      WORLD_WIDTH + MARGIN * 2,
      GROUND_Y + MARGIN,
    );
    const horizonGlow = buildHorizonGlow(biome.sky.horizon, -MARGIN, WORLD_WIDTH + MARGIN * 2, GROUND_Y);
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

    const groundBand = buildGroundBand(biome, -MARGIN, GROUND_Y, WORLD_WIDTH + MARGIN * 2, GROUND_DEPTH);
    this.view.addChild(groundBand);

    this.near = new ParallaxLayer(NEAR_CHUNK_W, chunkCount(NEAR_CHUNK_W), () =>
      buildGroundPropsChunk({ chunkWidth: NEAR_CHUNK_W, bandDepth: GROUND_DEPTH, biome }),
    );
    this.near.view.position.set(-MARGIN, GROUND_Y);
    this.view.addChild(this.near.view);

    if (biome.weatherTint) {
      const tint = buildSkyBands(
        biome.weatherTint.color,
        biome.weatherTint.color,
        -MARGIN,
        -MARGIN,
        WORLD_WIDTH + MARGIN * 2,
        WORLD_HEIGHT + MARGIN * 2,
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
