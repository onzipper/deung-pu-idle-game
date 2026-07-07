"use client";

/**
 * Experiment ① — plain animation player. Neutral checkerboard backdrop (no
 * biome), fps/scale/flip controls + play-pause + single-frame step. The
 * simplest possible "does this loop of frames read as a walk cycle" check.
 */

import { useState } from "react";
import { Container } from "pixi.js";
import { buildCheckerboard, type LabStage } from "@/lab/stage";
import { FramePlayer } from "@/lab/spritePlayer";
import type { FrameSet } from "@/lab/frames";
import type { LabExperiment, LabScene } from "@/lab/registry";
import { GROUND_Y, WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";

interface ControlsBag {
  player: FramePlayer;
}

function createScene(stage: LabStage, frames: FrameSet): LabScene {
  const view = new Container();
  view.addChild(buildCheckerboard(WORLD_WIDTH, WORLD_HEIGHT));

  const player = new FramePlayer(frames);
  player.sprite.position.set(WORLD_WIDTH / 2, GROUND_Y);
  view.addChild(player.sprite);

  stage.world.addChild(view);

  return {
    view,
    update(dt) {
      player.update(dt);
    },
    destroy() {
      player.destroy();
      view.parent?.removeChild(view);
      view.destroy({ children: true });
    },
    controls: { player } satisfies ControlsBag,
  };
}

function AnimPlayerControls({ scene }: { scene: LabScene }) {
  const { player } = scene.controls as unknown as ControlsBag;
  const [fps, setFps] = useState(player.getFps());
  const [scale, setScale] = useState(player.getScale());
  const [flip, setFlip] = useState(player.getFlip());
  const [playing, setPlaying] = useState(player.isPlaying());

  return (
    <div className="flex flex-col gap-3 text-xs text-slate-200">
      <label className="flex items-center justify-between gap-2">
        <span>fps</span>
        <input
          type="range"
          min={1}
          max={30}
          step={1}
          value={fps}
          onChange={(e) => {
            const v = Number(e.target.value);
            setFps(v);
            player.setFps(v);
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
            player.setScale(v);
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
            player.setFlip(e.target.checked);
          }}
        />
        <span>พลิกซ้าย-ขวา</span>
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600"
          onClick={() => player.step(-1)}
        >
          ก่อนหน้า
        </button>
        <button
          type="button"
          className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600"
          onClick={() => {
            const p = !playing;
            setPlaying(p);
            player.setPlaying(p);
          }}
        >
          {playing ? "หยุดชั่วคราว" : "เล่น"}
        </button>
        <button
          type="button"
          className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600"
          onClick={() => player.step(1)}
        >
          ถัดไป
        </button>
      </div>
      <p className="text-slate-400">
        {player.frameCount} เฟรม — เฟรมปัจจุบัน: {player.frameName ?? "-"}
      </p>
    </div>
  );
}

export const animPlayerExperiment: LabExperiment = {
  id: "animPlayer",
  title: "① เล่นอนิเมชัน",
  desc: "ไล่ดูชุดเฟรมเป็นอนิเมชันล้วน ๆ (พื้นหลังตาราง ไม่มีฉากเกม) — ปรับ fps / สเกล / พลิกซ้าย-ขวา / เล่น-หยุด / ก้าวทีละเฟรม",
  Controls: AnimPlayerControls,
  createScene,
};
