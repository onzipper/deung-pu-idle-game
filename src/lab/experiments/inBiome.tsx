"use client";

/**
 * Experiment ② — the drawn sprite standing on a REAL game biome (reuses
 * `BiomeScene`/`biomeForZone` from `src/render/environment` verbatim, per the
 * plan's confirmed reuse point). A dropdown picks any configured zone;
 * a checkbox swaps the biome out for the neutral checkerboard so the sprite
 * can be compared in isolation too.
 *
 * The `GameState` `BiomeScene` needs (for its boss-door lock look) is a
 * throwaway `initGameState()` stub with every map force-unlocked — this is a
 * dev-only preview, never real save/game state, and nothing here is ever
 * persisted or fed back into `@/engine`.
 */

import { useMemo, useState } from "react";
import { Container } from "pixi.js";
import type { Zone } from "@/engine";
import { BiomeScene } from "@/render/environment/BiomeScene";
import { biomeForZone } from "@/render/environment/biomes";
import { GROUND_Y, WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";
import { buildCheckerboard, type LabStage } from "@/lab/stage";
import { FramePlayer } from "@/lab/spritePlayer";
import type { FrameSet } from "@/lab/frames";
import type { LabExperiment, LabScene } from "@/lab/registry";
import { listZoneOptions, makeStubState, zoneLabel } from "@/lab/zones";

interface ControlsBag {
  player: FramePlayer;
  zones: Zone[];
  getZoneIndex(): number;
  setZoneIndex(i: number): void;
  getShowBiome(): boolean;
  setShowBiome(v: boolean): void;
}

function createScene(stage: LabStage, frames: FrameSet): LabScene {
  const view = new Container();
  const checker = buildCheckerboard(WORLD_WIDTH, WORLD_HEIGHT);
  view.addChild(checker);

  const biomeLayer = new Container();
  view.addChild(biomeLayer);

  const state = makeStubState();
  const zones = listZoneOptions();
  let zoneIdx = 0;
  let biomeScene: BiomeScene | null = null;
  let showBiome = true;

  function mountZone(i: number): void {
    biomeScene?.destroy();
    biomeScene = null;
    biomeLayer.removeChildren();
    const zone = zones[i];
    state.location = { mapId: zone.mapId, zoneIdx: zone.zoneIdx };
    state.stage = zone.stage;
    const resolved = biomeForZone(zone);
    biomeScene = new BiomeScene(resolved, zone, state);
    biomeLayer.addChild(biomeScene.view);
  }
  mountZone(0);

  const player = new FramePlayer(frames);
  // Stand well clear of the zone-edge gate props (heroMinX / fieldRightMargin
  // fence in ~55..876) — centered reads cleanly against every biome.
  player.sprite.position.set(WORLD_WIDTH / 2, GROUND_Y);
  view.addChild(player.sprite);

  stage.world.addChild(view);

  const controls: ControlsBag = {
    player,
    zones,
    getZoneIndex: () => zoneIdx,
    setZoneIndex: (i: number) => {
      zoneIdx = Math.max(0, Math.min(zones.length - 1, i));
      mountZone(zoneIdx);
      biomeLayer.visible = showBiome;
      checker.visible = !showBiome;
    },
    getShowBiome: () => showBiome,
    setShowBiome: (v: boolean) => {
      showBiome = v;
      biomeLayer.visible = showBiome;
      checker.visible = !showBiome;
    },
  };
  biomeLayer.visible = showBiome;
  checker.visible = !showBiome;

  return {
    view,
    update(dt) {
      player.update(dt);
      biomeScene?.update(dt, 0, state);
    },
    destroy() {
      biomeScene?.destroy();
      player.destroy();
      view.parent?.removeChild(view);
      view.destroy({ children: true });
    },
    controls: controls as unknown as Record<string, unknown>,
  };
}

function InBiomeControls({ scene }: { scene: LabScene }) {
  const c = scene.controls as unknown as ControlsBag;
  const [zoneIdx, setZoneIdxState] = useState(c.getZoneIndex());
  const [showBiome, setShowBiomeState] = useState(c.getShowBiome());
  const [fps, setFps] = useState(c.player.getFps());
  const [scale, setScale] = useState(c.player.getScale());
  const [flip, setFlip] = useState(c.player.getFlip());

  const zoneOptions = useMemo(() => c.zones.map((z, i) => ({ i, label: zoneLabel(z) })), [c.zones]);

  return (
    <div className="flex flex-col gap-3 text-xs text-slate-200">
      <label className="flex flex-col gap-1">
        <span>ฉาก (biome)</span>
        <select
          className="rounded bg-slate-800 px-2 py-1"
          value={zoneIdx}
          onChange={(e) => {
            const v = Number(e.target.value);
            setZoneIdxState(v);
            c.setZoneIndex(v);
          }}
        >
          {zoneOptions.map((o) => (
            <option key={o.i} value={o.i}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={showBiome}
          onChange={(e) => {
            setShowBiomeState(e.target.checked);
            c.setShowBiome(e.target.checked);
          }}
        />
        <span>แสดงฉากเกมจริง (ปิด = ตารางเปล่า)</span>
      </label>
      <label className="flex items-center justify-between gap-2">
        <span>fps</span>
        <input
          type="range"
          min={1}
          max={30}
          value={fps}
          onChange={(e) => {
            const v = Number(e.target.value);
            setFps(v);
            c.player.setFps(v);
          }}
        />
        <span className="w-8 text-right tabular-nums">{fps}</span>
      </label>
      <label className="flex items-center justify-between gap-2">
        <span>สเกล</span>
        <input
          type="range"
          min={0.5}
          max={6}
          step={0.1}
          value={scale}
          onChange={(e) => {
            const v = Number(e.target.value);
            setScale(v);
            c.player.setScale(v);
          }}
        />
        <span className="w-8 text-right tabular-nums">{scale.toFixed(1)}</span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={flip}
          onChange={(e) => {
            setFlip(e.target.checked);
            c.player.setFlip(e.target.checked);
          }}
        />
        <span>พลิกซ้าย-ขวา</span>
      </label>
    </div>
  );
}

export const inBiomeExperiment: LabExperiment = {
  id: "inBiome",
  title: "② ฉากเกมจริง",
  desc: "วางสไปรต์ยืนบนฉาก biome จริงของเกม (เลือกด่านได้) — เช็คว่าโทนสี/ความคมชัดเข้ากับฉากไหม",
  Controls: InBiomeControls,
  createScene,
};
