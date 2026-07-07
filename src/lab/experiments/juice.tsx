"use client";

/**
 * Experiment ④ — juice playground. Fires a hit-flash(tint) / squash-bounce /
 * shake / death-fade at the drawn sprite via buttons — each tween lives in
 * THIS file (deliberately not wired to `@/render/fx/FxController`, which is
 * a stateful, event-driven controller built for the real `GameState`/event
 * stream; a standalone dev sandbox has no business pulling that in). Footgun
 * 10 respected: the hit-flash is a plain (non-additive) tint lerp toward a
 * warm-red hit color, never an additive white overlay.
 */

import { useState } from "react";
import { Container, Sprite } from "pixi.js";
import { buildCheckerboard, type LabStage } from "@/lab/stage";
import { FramePlayer } from "@/lab/spritePlayer";
import type { FrameSet } from "@/lab/frames";
import type { LabExperiment, LabScene } from "@/lab/registry";
import { GROUND_Y, WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Squash(down) -> overshoot-stretch(up) -> settle, one 0..1 curve. */
function squashCurve(p: number): { sx: number; sy: number } {
  if (p < 0.3) {
    const k = p / 0.3;
    return { sx: 1 + 0.35 * k, sy: 1 - 0.3 * k };
  }
  if (p < 0.6) {
    const k = (p - 0.3) / 0.3;
    return { sx: 1.35 - 0.55 * k, sy: 0.7 + 0.5 * k };
  }
  const k = (p - 0.6) / 0.4;
  return { sx: 0.8 + 0.2 * k, sy: 1.2 - 0.2 * k };
}

const HIT_COLOR = 0xff5a5a; // PALETTE.warn — flat tint, never additive
const HIT_DURATION = 0.15;
const SQUASH_DURATION = 0.32;
const SHAKE_DURATION = 0.28;
const FADE_DURATION = 0.4;
const FADE_HOLD = 0.3;

type FadePhase = "out" | "hold" | "in";

class JuiceRig {
  private hitT: number | null = null;
  private squashT: number | null = null;
  private shakeT: number | null = null;
  private fade: { t: number; phase: FadePhase } | null = null;

  constructor(
    private readonly rig: Container,
    private readonly sprite: Sprite,
    private readonly restX: number,
    private readonly restY: number,
  ) {}

  triggerHit(): void {
    this.hitT = 0;
  }
  triggerSquash(): void {
    this.squashT = 0;
  }
  triggerShake(): void {
    this.shakeT = 0;
  }
  triggerDeathFade(): void {
    this.fade = { t: 0, phase: "out" };
  }

  update(dt: number): void {
    if (this.hitT !== null) {
      this.hitT += dt;
      const p = Math.min(1, this.hitT / HIT_DURATION);
      this.sprite.tint = lerpColor(HIT_COLOR, 0xffffff, p);
      if (p >= 1) this.hitT = null;
    }

    if (this.squashT !== null) {
      this.squashT += dt;
      const p = Math.min(1, this.squashT / SQUASH_DURATION);
      const s = squashCurve(p);
      this.rig.scale.set(s.sx, s.sy);
      if (p >= 1) {
        this.squashT = null;
        this.rig.scale.set(1, 1);
      }
    }

    if (this.shakeT !== null) {
      this.shakeT += dt;
      const p = Math.min(1, this.shakeT / SHAKE_DURATION);
      const amp = (1 - p) * 8;
      this.rig.position.set(
        this.restX + (Math.random() * 2 - 1) * amp,
        this.restY + (Math.random() * 2 - 1) * amp,
      );
      if (p >= 1) {
        this.shakeT = null;
        this.rig.position.set(this.restX, this.restY);
      }
    }

    if (this.fade) {
      const f = this.fade;
      f.t += dt;
      if (f.phase === "out") {
        const p = Math.min(1, f.t / FADE_DURATION);
        this.sprite.alpha = 1 - p;
        if (p >= 1) {
          f.t = 0;
          f.phase = "hold";
        }
      } else if (f.phase === "hold") {
        if (f.t >= FADE_HOLD) {
          f.t = 0;
          f.phase = "in";
        }
      } else {
        const p = Math.min(1, f.t / FADE_DURATION);
        this.sprite.alpha = p;
        if (p >= 1) this.fade = null;
      }
    }
  }
}

interface ControlsBag {
  player: FramePlayer;
  rig: JuiceRig;
}

function createScene(stage: LabStage, frames: FrameSet): LabScene {
  const view = new Container();
  view.addChild(buildCheckerboard(WORLD_WIDTH, WORLD_HEIGHT));

  const restX = WORLD_WIDTH / 2;
  const restY = GROUND_Y;
  const rigContainer = new Container();
  rigContainer.position.set(restX, restY);
  view.addChild(rigContainer);

  const player = new FramePlayer(frames);
  // Position relative to `rigContainer`'s own origin (0,0) — NOT world space
  // — squash/shake below scale/offset `rigContainer` around that shared
  // origin, which coincides with the anchor-bottom-center ground contact
  // point (footgun 1: never pre-subtract a pivot in path data; here there's
  // simply no pivot at all, so plain scale/position stay safe).
  player.sprite.position.set(0, 0);
  rigContainer.addChild(player.sprite);

  const rig = new JuiceRig(rigContainer, player.sprite, restX, restY);

  stage.world.addChild(view);

  return {
    view,
    update(dt) {
      player.update(dt);
      rig.update(dt);
    },
    destroy() {
      player.destroy();
      view.parent?.removeChild(view);
      view.destroy({ children: true });
    },
    controls: { player, rig } satisfies ControlsBag,
  };
}

function JuiceControls({ scene }: { scene: LabScene }) {
  const { player, rig } = scene.controls as unknown as ControlsBag;
  const [fps, setFps] = useState(player.getFps());
  const [scale, setScale] = useState(player.getScale());

  return (
    <div className="flex flex-col gap-3 text-xs text-slate-200">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded bg-red-800 px-2 py-1 hover:bg-red-700"
          onClick={() => rig.triggerHit()}
        >
          hit-flash
        </button>
        <button
          type="button"
          className="rounded bg-amber-800 px-2 py-1 hover:bg-amber-700"
          onClick={() => rig.triggerSquash()}
        >
          squash-bounce
        </button>
        <button
          type="button"
          className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600"
          onClick={() => rig.triggerShake()}
        >
          shake
        </button>
        <button
          type="button"
          className="rounded bg-violet-800 px-2 py-1 hover:bg-violet-700"
          onClick={() => rig.triggerDeathFade()}
        >
          death-fade
        </button>
      </div>
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
    </div>
  );
}

export const juiceExperiment: LabExperiment = {
  id: "juice",
  title: "④ Juice playground",
  desc: "ยิง juice ใส่สไปรต์ที่วาด: hit-flash (tint) / squash-bounce / shake / death-fade",
  Controls: JuiceControls,
  createScene,
};
