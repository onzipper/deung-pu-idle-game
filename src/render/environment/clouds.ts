/**
 * A handful of slow-drifting cloud silhouettes crossing the sky. Built once
 * (a small cluster of overlapping circles per cloud) and only repositioned
 * per frame; wraps horizontally forever. Deliberately ignores the
 * battle/boss scroll-speed multiplier — clouds are the calm, ambient backdrop
 * layer, not part of the "world travel" illusion the ground/far layers give.
 */

import { Container, Graphics } from "pixi.js";
import { safeRadius } from "@/render/theme";

const CLOUD_COUNT = 4;
/** World px/real-second — slow and constant. */
const CLOUD_SPEED = 4;

interface CloudSlot {
  view: Graphics;
  x: number;
  y: number;
  scale: number;
}

export class CloudField {
  readonly view = new Container();
  private readonly clouds: CloudSlot[];
  private readonly worldWidth: number;

  constructor(color: number, worldWidth: number, skyHeight: number) {
    this.worldWidth = worldWidth;
    this.clouds = Array.from({ length: CLOUD_COUNT }, (_, i) => {
      const g = new Graphics();
      const puffs: Array<[number, number, number]> = [
        [0, 0, 14],
        [16, 2, 11],
        [-15, 3, 10],
        [6, -5, 9],
      ];
      for (const [px, py, pr] of puffs) {
        g.circle(px, py, safeRadius(pr)).fill({ color, alpha: 0.16 });
      }
      const x = (i / CLOUD_COUNT) * worldWidth + Math.random() * 60;
      const y = 20 + Math.random() * (skyHeight * 0.45);
      const scale = 0.8 + Math.random() * 0.9;
      g.position.set(x, y);
      g.scale.set(scale);
      this.view.addChild(g);
      return { view: g, x, y, scale };
    });
  }

  update(dt: number): void {
    const wrapMargin = 80;
    for (const cloud of this.clouds) {
      cloud.x -= CLOUD_SPEED * dt;
      if (cloud.x < -wrapMargin) cloud.x += this.worldWidth + wrapMargin * 2;
      cloud.view.position.x = cloud.x;
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
