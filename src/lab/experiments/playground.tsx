"use client";

/**
 * Experiment ⑤ — เดินเล่น ("playground"). Tap/click anywhere on the stage and
 * the sprite walks there (constant px/s knob); drag (pointer held down) makes
 * it follow continuously — mouse and touch behave identically since this
 * rides Pixi's own federated pointer events (`stage.world.eventMode =
 * "static"` + a hitArea spanning the whole logical stage), not a DOM
 * listener, so no `GameClient`/App Router wiring is needed.
 *
 * Unlike experiments ①-④, this one needs TWO frame groups at once (a
 * walk-like one + an idle/sit-like one) — `LabScreen`'s shared picker only
 * ever hands `createScene` a single `FrameSet`, so this experiment loads the
 * FULL asset library itself (`@/lab/frames`'s `loadLibrary`/`loadFrameSet`,
 * fire-and-forget from `createScene`, same "never blocks the caller, resolve
 * later" convention as `townLlama.ts`'s own `load()`) and picks groups by
 * name via `@/lab/frameGroupHeuristics` — a name containing "walk"/"stand"
 * with the most frames for walking, "idle"/"sit" for standing still; with no
 * separate idle match it just freezes the walk set's own first frame instead
 * (`PlaygroundRig.update()`'s no-`idlePlayer` branch).
 *
 * Movement is x-only (constant `GROUND_Y`) — this codebase's whole render
 * layer is a single-lane side view (hero/enemies/town NPCs/the llama all only
 * ever move along x), so a tapped point's y is deliberately ignored rather
 * than introducing 2D movement nothing else in the game has.
 */

import { useState } from "react";
import { Container, Graphics, Rectangle, Text, type FederatedPointerEvent } from "pixi.js";
import { buildCheckerboard, type LabStage } from "@/lab/stage";
import { FramePlayer } from "@/lab/spritePlayer";
import { applyScaleMode, loadFrameSet, loadLibrary, type FrameSet } from "@/lab/frames";
import { pickIdleGroupKey, pickWalkGroupKey } from "@/lab/frameGroupHeuristics";
import type { LabExperiment, LabScene } from "@/lab/registry";
import { GROUND_Y, WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";

// ---- knobs --------------------------------------------------------------
const WALK_SPEED_DEFAULT = 90; // px/s
const SCALE_DEFAULT = 2;
const MOVE_MARGIN = 30;
const MOVE_MIN_X = MOVE_MARGIN;
const MOVE_MAX_X = WORLD_WIDTH - MOVE_MARGIN;
const ARRIVE_EPS = 1;
const WANDER_MIN_S = 1.5;
const WANDER_MAX_S = 3.5;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** The moving-sprite half of the scene — frame-set-agnostic (works with
 * whichever walk/idle groups the heuristic picked, or none yet while the
 * library is still loading). */
class PlaygroundRig {
  readonly view = new Container();
  private walkPlayer: FramePlayer | null = null;
  private idlePlayer: FramePlayer | null = null;
  private posX = WORLD_WIDTH / 2;
  private targetX = WORLD_WIDTH / 2;
  private moving = false;
  private wanderTimer = rand(WANDER_MIN_S, WANDER_MAX_S);
  walkSpeed = WALK_SPEED_DEFAULT;
  scale = SCALE_DEFAULT;
  wander = false;

  constructor() {
    this.view.position.set(this.posX, GROUND_Y);
  }

  /** Swaps in the resolved walk (required) + idle (optional) frame sets —
   * called once the library scan resolves. Destroys any prior players first
   * (defensive; `createScene` only calls this once per scene lifetime). */
  setFrameSets(walk: FrameSet, idle: FrameSet | null): void {
    this.walkPlayer?.destroy();
    this.idlePlayer?.destroy();
    this.walkPlayer = new FramePlayer(walk);
    this.walkPlayer.setScale(this.scale);
    this.view.addChild(this.walkPlayer.sprite);
    if (idle) {
      this.idlePlayer = new FramePlayer(idle);
      this.idlePlayer.setScale(this.scale);
      this.idlePlayer.sprite.visible = false;
      this.view.addChild(this.idlePlayer.sprite);
    } else {
      this.idlePlayer = null;
    }
  }

  setTarget(x: number): void {
    this.targetX = Math.max(MOVE_MIN_X, Math.min(MOVE_MAX_X, x));
  }

  setScaleKnob(v: number): void {
    this.scale = v;
    this.walkPlayer?.setScale(v);
    this.idlePlayer?.setScale(v);
  }

  update(dt: number): void {
    if (!this.walkPlayer) return;

    if (this.wander && !this.moving) {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.setTarget(rand(MOVE_MIN_X, MOVE_MAX_X));
        this.wanderTimer = rand(WANDER_MIN_S, WANDER_MAX_S);
      }
    }

    const dx = this.targetX - this.posX;
    const wasMoving = this.moving;
    if (Math.abs(dx) > ARRIVE_EPS) {
      this.moving = true;
      const dir = Math.sign(dx);
      const step = Math.min(Math.abs(dx), this.walkSpeed * dt);
      this.posX += dir * step;
      this.view.position.x = this.posX;
      const flip = dir < 0; // faces right by default, flips scale.x toward movement
      this.walkPlayer.setFlip(flip);
      this.idlePlayer?.setFlip(flip);
    } else {
      this.moving = false;
    }

    if (this.moving !== wasMoving) {
      if (this.idlePlayer) {
        this.walkPlayer.sprite.visible = this.moving;
        this.idlePlayer.sprite.visible = !this.moving;
        this.walkPlayer.setPlaying(this.moving);
        this.idlePlayer.setPlaying(!this.moving);
      } else if (this.moving) {
        this.walkPlayer.setPlaying(true);
      } else {
        // No separate idle/sit group — freeze on the walk set's own first
        // frame rather than leaving it paused mid-stride.
        this.walkPlayer.setPlaying(false);
        this.walkPlayer.step(-this.walkPlayer.frameIndex);
      }
    }

    this.walkPlayer.update(dt);
    this.idlePlayer?.update(dt);
  }

  destroy(): void {
    this.walkPlayer?.destroy();
    this.idlePlayer?.destroy();
    this.view.destroy({ children: true });
  }
}

interface ControlsBag {
  getWalkSpeed(): number;
  setWalkSpeed(v: number): void;
  getScale(): number;
  setScale(v: number): void;
  getWander(): boolean;
  setWander(v: boolean): void;
}

function createScene(stage: LabStage, _frames: FrameSet): LabScene {
  void _frames; // this experiment loads its OWN two groups — see doc comment above

  const view = new Container();
  view.addChild(buildCheckerboard(WORLD_WIDTH, WORLD_HEIGHT));
  view.addChild(new Graphics().rect(0, GROUND_Y, WORLD_WIDTH, 2).fill(0x3a4a3a));

  const hintText = new Text({
    text: "กำลังโหลดชุดเฟรมจากคลัง...",
    style: { fill: 0xffe28a, fontSize: 13 },
  });
  hintText.anchor.set(0.5, 0);
  hintText.position.set(WORLD_WIDTH / 2, 8);
  view.addChild(hintText);

  const rig = new PlaygroundRig();
  view.addChild(rig.view);

  stage.world.addChild(view);

  // Whole-stage tap/drag surface. Pixi's own federated events (NOT a DOM
  // listener) so mouse and touch behave identically for free.
  stage.world.eventMode = "static";
  stage.world.hitArea = new Rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  let dragging = false;
  function onDown(e: FederatedPointerEvent): void {
    dragging = true;
    rig.setTarget(e.getLocalPosition(stage.world).x);
  }
  function onMove(e: FederatedPointerEvent): void {
    if (!dragging) return; // drag-to-follow only while the pointer is held
    rig.setTarget(e.getLocalPosition(stage.world).x);
  }
  function onUp(): void {
    dragging = false;
  }
  stage.world.on("pointerdown", onDown);
  stage.world.on("pointermove", onMove);
  stage.world.on("pointerup", onUp);
  stage.world.on("pointerupoutside", onUp);

  void (async () => {
    const { groups } = await loadLibrary();
    const walkKey = pickWalkGroupKey(groups);
    if (!walkKey) {
      hintText.text = "ยังไม่มีชุดเฟรม — อัปโหลดที่แผงด้านขวาเพื่อเริ่มเล่น";
      return;
    }
    const idleKey = pickIdleGroupKey(groups, walkKey);
    const walkSet = await loadFrameSet(walkKey, groups);
    applyScaleMode(walkSet, true);
    const idleSet = idleKey ? await loadFrameSet(idleKey, groups) : null;
    if (idleSet) applyScaleMode(idleSet, true);
    rig.setFrameSets(walkSet, idleSet);
    hintText.text = idleSet
      ? `แตะ/ลากที่พื้นเพื่อเดิน — เดิน: "${walkKey}" / หยุดนิ่ง: "${idleKey}"`
      : `แตะ/ลากที่พื้นเพื่อเดิน — ใช้ชุด "${walkKey}" ทั้งเดินและหยุดนิ่ง (ค้างที่เฟรมแรก)`;
  })();

  const controls: ControlsBag = {
    getWalkSpeed: () => rig.walkSpeed,
    setWalkSpeed: (v) => {
      rig.walkSpeed = Math.max(10, v);
    },
    getScale: () => rig.scale,
    setScale: (v) => rig.setScaleKnob(Math.max(0.2, v)),
    getWander: () => rig.wander,
    setWander: (v) => {
      rig.wander = v;
    },
  };

  return {
    view,
    update(dt) {
      rig.update(dt);
    },
    destroy() {
      stage.world.off("pointerdown", onDown);
      stage.world.off("pointermove", onMove);
      stage.world.off("pointerup", onUp);
      stage.world.off("pointerupoutside", onUp);
      stage.world.eventMode = "passive";
      stage.world.hitArea = null;
      rig.destroy();
      view.parent?.removeChild(view);
      view.destroy({ children: true });
    },
    controls: controls as unknown as Record<string, unknown>,
  };
}

function PlaygroundControls({ scene }: { scene: LabScene }) {
  const c = scene.controls as unknown as ControlsBag;
  const [walkSpeed, setWalkSpeedState] = useState(c.getWalkSpeed());
  const [scale, setScaleState] = useState(c.getScale());
  const [wander, setWanderState] = useState(c.getWander());

  return (
    <div className="flex flex-col gap-3 text-xs text-slate-200">
      <label className="flex items-center justify-between gap-2">
        <span>ความเร็วเดิน (px/s)</span>
        <input
          type="range"
          min={20}
          max={220}
          step={5}
          value={walkSpeed}
          onChange={(e) => {
            const v = Number(e.target.value);
            setWalkSpeedState(v);
            c.setWalkSpeed(v);
          }}
        />
        <span className="w-10 text-right tabular-nums">{walkSpeed}</span>
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
            setScaleState(v);
            c.setScale(v);
          }}
        />
        <span className="w-8 text-right tabular-nums">{scale.toFixed(1)}</span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={wander}
          onChange={(e) => {
            setWanderState(e.target.checked);
            c.setWander(e.target.checked);
          }}
        />
        <span>เดินเล่นเอง (สุ่มเดินไปมา)</span>
      </label>
      <p className="text-slate-500">
        แตะ/คลิกที่พื้นเพื่อสั่งเดินไปจุดนั้น — กดค้างแล้วลากเพื่อให้ตามนิ้ว/เมาส์ (ใช้ได้ทั้งเดสก์ท็อปและมือถือ)
      </p>
    </div>
  );
}

export const playgroundExperiment: LabExperiment = {
  id: "playground",
  title: "⑤ เดินเล่น",
  desc: "แตะ/คลิกที่พื้นเพื่อให้สไปรต์เดินไปหา — ลากค้างให้ตามนิ้ว/เมาส์ (auto-pick กลุ่มเฟรมเดิน/หยุดนิ่งจากชื่อไฟล์)",
  Controls: PlaygroundControls,
  createScene,
};
