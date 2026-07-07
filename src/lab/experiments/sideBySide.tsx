"use client";

/**
 * Experiment ③ — the drawn sprite standing beside a REAL procedural monster
 * (`@/render/views/enemyView`, same module the live game uses) on a real
 * biome background, to compare scale/color-tone/motion rhythm directly.
 *
 * `enemyView` turned out NOT state-coupled beyond a plain `Enemy` entity
 * literal + a `dt`/`events`/`mapId` context (see `EnemyFrameContext`) — no
 * fallback to a trimmed local copy was needed (the plan's flagged risk did
 * not materialize). A tiny stub `Enemy` is built here and given a gentle
 * manual x-wobble each frame (real hunt-field wander is an internal engine
 * system, not exported) so the rig's idle motion isn't perfectly frozen.
 */

import { useMemo, useState } from "react";
import { Container } from "pixi.js";
import type { Enemy, EnemyKind } from "@/engine";
import { BiomeScene } from "@/render/environment/BiomeScene";
import { biomeForZone } from "@/render/environment/biomes";
import { createEnemyView, updateEnemyView, type EnemyView } from "@/render/views/enemyView";
import { GROUND_Y, WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";
import { buildCheckerboard, type LabStage } from "@/lab/stage";
import { FramePlayer } from "@/lab/spritePlayer";
import type { FrameSet } from "@/lab/frames";
import type { LabExperiment, LabScene } from "@/lab/registry";
import { listZoneOptions, makeStubState, zoneLabel } from "@/lab/zones";

const ENEMY_KINDS: EnemyKind[] = ["normal", "fast", "tank", "ranged"];
const KIND_LABEL: Record<EnemyKind, string> = {
  normal: "normal (กร้านต์)",
  fast: "fast (วิ่งเร็ว)",
  tank: "tank (หนัก)",
  ranged: "ranged (ระยะไกล)",
};

function makeEnemyStub(kind: EnemyKind, x: number): Enemy {
  return {
    id: 1,
    kind,
    x,
    y: 0,
    hp: 80,
    maxHp: 80,
    atk: 10,
    speed: 60,
    size: 1,
    behavior: kind === "ranged" ? "ranged" : "melee",
    range: kind === "ranged" ? 220 : 0,
    cd: 0,
    engageOffset: 0,
    homeX: x,
    aggressive: false,
    aggroRadius: 0,
    engaged: false,
  };
}

interface ControlsBag {
  player: FramePlayer;
  zones: ReturnType<typeof listZoneOptions>;
  getZoneIndex(): number;
  setZoneIndex(i: number): void;
  getShowBiome(): boolean;
  setShowBiome(v: boolean): void;
  getKind(): EnemyKind;
  setKind(k: EnemyKind): void;
}

const ENEMY_BASE_X = WORLD_WIDTH / 2 - 90;
const SPRITE_X = WORLD_WIDTH / 2 + 90;

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
  let mapId = zones[0]?.mapId ?? "map1";

  function mountZone(i: number): void {
    biomeScene?.destroy();
    biomeScene = null;
    biomeLayer.removeChildren();
    const zone = zones[i];
    mapId = zone.mapId;
    state.location = { mapId: zone.mapId, zoneIdx: zone.zoneIdx };
    state.stage = zone.stage;
    const resolved = biomeForZone(zone);
    biomeScene = new BiomeScene(resolved, zone, state);
    biomeLayer.addChild(biomeScene.view);
  }
  mountZone(0);

  let kind: EnemyKind = "normal";
  let enemy = makeEnemyStub(kind, ENEMY_BASE_X);
  const enemyView: EnemyView = createEnemyView();
  view.addChild(enemyView);

  const player = new FramePlayer(frames);
  player.sprite.position.set(SPRITE_X, GROUND_Y);
  view.addChild(player.sprite);

  stage.world.addChild(view);

  let t = 0;
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
    getKind: () => kind,
    setKind: (k: EnemyKind) => {
      kind = k;
      // A kind change needs a fresh rig build (buildRig only re-runs on a
      // kind change — see enemyView's own guard) — swap the whole entity so
      // its EnemyView `kind` field is forced to re-detect the change.
      enemy = makeEnemyStub(kind, enemy.x);
    },
  };
  biomeLayer.visible = showBiome;
  checker.visible = !showBiome;

  return {
    view,
    update(dt) {
      player.update(dt);
      biomeScene?.update(dt, 0, state);
      t += dt;
      // Gentle idle wobble (real hunt-field wander is engine-internal, not
      // exported) so the rig isn't perfectly frozen — feeds `updateEnemyView`
      // a real, small x-velocity each frame.
      enemy.x = ENEMY_BASE_X + Math.sin(t * 0.8) * 6;
      updateEnemyView(enemyView, enemy, { dt, events: [], mapId });
    },
    destroy() {
      biomeScene?.destroy();
      player.destroy();
      enemyView.destroy({ children: true });
      view.parent?.removeChild(view);
      view.destroy({ children: true });
    },
    controls: controls as unknown as Record<string, unknown>,
  };
}

function SideBySideControls({ scene }: { scene: LabScene }) {
  const c = scene.controls as unknown as ControlsBag;
  const [zoneIdx, setZoneIdxState] = useState(c.getZoneIndex());
  const [showBiome, setShowBiomeState] = useState(c.getShowBiome());
  const [kind, setKindState] = useState(c.getKind());
  const [fps, setFps] = useState(c.player.getFps());
  const [scale, setScale] = useState(c.player.getScale());

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
      <label className="flex flex-col gap-1">
        <span>มอนพร็อกซีเดอรัล</span>
        <select
          className="rounded bg-slate-800 px-2 py-1"
          value={kind}
          onChange={(e) => {
            const v = e.target.value as EnemyKind;
            setKindState(v);
            c.setKind(v);
          }}
        >
          {ENEMY_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
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
        <span>สเกลสไปรต์</span>
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
    </div>
  );
}

export const sideBySideExperiment: LabExperiment = {
  id: "sideBySide",
  title: "③ ยืนข้างมอน",
  desc: "วางสไปรต์ที่วาดยืนข้างมอน procedural ของเกมจริง บนฉาก biome เดียวกัน — เทียบสเกล/โทนสี/จังหวะ",
  Controls: SideBySideControls,
  createScene,
};
