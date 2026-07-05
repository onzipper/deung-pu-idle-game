/**
 * MMX-style in-canvas HUD mock: a chunky segmented HP bar + a gold counter.
 * Drawn with Graphics/Text directly into the world (not DOM) — the
 * zone-name-card / font demo lives in the DOM overlay instead (`ProtoScene.tsx`).
 */

import { Container, Graphics, Text } from "pixi.js";
import { PROTO_PALETTE as P, safeRadius } from "./palette";

export interface Hud {
  container: Container;
  update(hpFrac: number, gold: number): void;
}

const SEGMENTS = 8;
const BAR_X = 10;
const BAR_Y = 10;
const BAR_W = 100;
const BAR_H = 10;

export function buildHud(): Hud {
  const container = new Container();
  const track = new Graphics();
  const fill = new Graphics();
  const ticks = new Graphics();
  const coin = new Graphics();
  const goldText = new Text({
    text: "0",
    style: { fontFamily: "sans-serif", fontWeight: "700", fontSize: 11, fill: P.hudInk },
  });
  goldText.position.set(BAR_X + 16, BAR_Y + BAR_H + 4);
  coin.circle(BAR_X + 6, BAR_Y + BAR_H + 9, safeRadius(5)).fill({ color: P.hudGold });
  coin.stroke({ color: P.hudBorder, width: 1.4 });

  container.addChild(track, fill, ticks, coin, goldText);

  // Static chrome (track + segment dividers) drawn once.
  track
    .roundRect(BAR_X - 2, BAR_Y - 2, BAR_W + 4, BAR_H + 4, 2)
    .fill({ color: P.hudTrack })
    .stroke({ color: P.hudBorder, width: 2 });
  for (let i = 1; i < SEGMENTS; i++) {
    const x = BAR_X + (BAR_W / SEGMENTS) * i;
    ticks.rect(x, BAR_Y, 1, BAR_H).fill({ color: P.hudBorder, alpha: 0.8 });
  }

  return {
    container,
    update(hpFrac: number, gold: number) {
      const frac = Math.max(0, Math.min(1, hpFrac));
      const color = frac > 0.5 ? P.hpGood : frac > 0.25 ? P.hpMid : P.hpBad;
      fill.clear();
      fill.rect(BAR_X, BAR_Y, safeRadius(BAR_W * frac), BAR_H).fill({ color });
      goldText.text = String(Math.floor(gold));
    },
  };
}
