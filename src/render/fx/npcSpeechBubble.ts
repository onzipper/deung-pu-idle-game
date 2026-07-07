/**
 * Town NPC speech bubble (M7.x "Town NPCs" task) — a single pooled bubble
 * (one at a time, per the spec: only one NPC talks at once) shown above a
 * given NPC's head for ~2.5s real seconds, then fades out. UI-triggered
 * (`GameRenderer.showNpcSpeech(npcId, text)` — the UI wave decides WHEN and
 * WHAT text; this module only knows how to draw + time a bubble).
 *
 * Deliberately does NOT query `Text.width`/`.height` for auto-sizing (the
 * same headless-canvas-metrics footgun `views/__tests__/rig.test.ts`'s doc
 * comment calls out for `getBounds()` recursing into a sibling `Text`) —
 * the background rect is sized from a plain character-count estimate
 * instead, which is plenty for the short lines these bubbles are meant to
 * hold and never needs a canvas 2D context to size itself.
 *
 * No hand-built gradients; the bubble is a flat-fill rounded rect + a small
 * triangular tail, both built fresh only on `show()` (a rare, UI-triggered
 * event — not a per-frame rebuild).
 */

import { Container, Graphics, Text } from "pixi.js";
import { PALETTE, safeRadius } from "@/render/theme";

const DEFAULT_DURATION = 2.5; // real seconds
const FADE_OUT_TAIL = 0.4; // real seconds of the tail spent fading
const PADDING_X = 10;
const BUBBLE_HEIGHT = 34; // fixed, fits up to ~2 wrapped short lines at fontSize 12
const MIN_WIDTH = 64;
const MAX_WIDTH = 200;
const CHAR_WIDTH_ESTIMATE = 7.2; // rough average glyph advance at fontSize 12
const TAIL_H = 8;
const TAIL_HALF_W = 6;

export interface SpeechAnchor {
  x: number;
  y: number;
}

export class NpcSpeechBubble {
  readonly view = new Container();
  private readonly bg = new Graphics();
  private readonly tail = new Graphics();
  private readonly label: Text;
  private age = 0;
  private duration = DEFAULT_DURATION;
  private active = false;

  constructor(layer: Container) {
    this.view.visible = false;
    this.view.addChild(this.bg, this.tail);
    this.label = new Text({
      text: "",
      style: {
        fontSize: 12,
        fontWeight: "600",
        fill: PALETTE.outline,
        fontFamily: "sans-serif",
        align: "center",
        wordWrap: true,
        wordWrapWidth: MAX_WIDTH - PADDING_X * 2,
      },
    });
    this.label.anchor.set(0.5);
    this.view.addChild(this.label);
    layer.addChild(this.view);
  }

  /** Show `text` above `anchor` (world coords — see `NpcView.headAnchor`) for
   * `npcId`; re-triggering (a second `show()` mid-display, even for a
   * different NPC) just restarts the timer on the SAME pooled bubble — only
   * one NPC ever talks at once, per spec. */
  show(anchor: SpeechAnchor, text: string, duration = DEFAULT_DURATION): void {
    this.active = true;
    this.age = 0;
    this.duration = Math.max(0.1, duration);
    this.label.text = text;

    const estWidth = Math.max(
      MIN_WIDTH,
      Math.min(MAX_WIDTH, text.length * CHAR_WIDTH_ESTIMATE + PADDING_X * 2),
    );
    const w = safeRadius(estWidth);
    const h = safeRadius(BUBBLE_HEIGHT);

    this.bg.clear();
    this.bg
      .roundRect(-w / 2, -h - TAIL_H, w, h, 8)
      .fill({ color: PALETTE.ivory, alpha: 0.96 });
    this.bg
      .roundRect(-w / 2, -h - TAIL_H, w, h, 8)
      .stroke({ width: 1.4, color: PALETTE.outline, alpha: 0.85 });

    this.tail.clear();
    this.tail
      .poly([-TAIL_HALF_W, -TAIL_H, TAIL_HALF_W, -TAIL_H, 0, 0], true)
      .fill({ color: PALETTE.ivory, alpha: 0.96 });

    this.label.position.set(0, -h / 2 - TAIL_H);

    this.view.position.set(anchor.x, anchor.y);
    this.view.visible = true;
    this.view.alpha = 1;
  }

  /** Advance the timer by real `dt` seconds — call every frame regardless of
   * `active` (cheap early-out), same convention as every other `fx/` pool. */
  update(dt: number): void {
    if (!this.active) return;
    this.age += Math.max(0, dt);
    if (this.age >= this.duration) {
      this.active = false;
      this.view.visible = false;
      return;
    }
    const remain = this.duration - this.age;
    this.view.alpha = remain < FADE_OUT_TAIL ? Math.max(0, remain / FADE_OUT_TAIL) : 1;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
