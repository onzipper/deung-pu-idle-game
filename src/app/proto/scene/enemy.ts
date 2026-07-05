/**
 * One wandering blob enemy — patrols a short range, squashes on turn-around,
 * flashes + gets knocked back a hair when the hero's sword connects. Keeps
 * the vignette "alive" instead of a static diorama.
 */

import { Container, Graphics } from "pixi.js";
import { PROTO_PALETTE as P, safeRadius } from "./palette";

export interface Enemy {
  container: Container;
  x: number;
  update(dt: number): void;
  /** Flash white + squash + tiny knockback; caller decides hit timing. */
  takeHit(fromLeft: boolean): void;
}

export function buildEnemy(centerX: number, groundY: number, range: number): Enemy {
  const container = new Container();
  const body = new Graphics();
  container.addChild(body);

  let x = centerX;
  let dir = 1;
  const speed = 14;
  let squash = 0; // 0..1, decays — turn-around & hit reaction
  let flash = 0; // 0..1, decays — hit-flash
  let bob = 0;

  function draw(): void {
    body.clear();
    const stretch = 1 + squash * 0.35;
    const squashY = 1 - squash * 0.25;
    const w = 15 * stretch;
    const h = 12.5 * squashY;
    const y = groundY - h * 0.7 + Math.sin(bob) * 0.6;
    const flashMix = flash;
    const bodyColor = flashMix > 0.5 ? 0xffffff : P.enemyBody;

    body.ellipse(0, y, safeRadius(w), safeRadius(h)).fill({ color: bodyColor });
    body
      .ellipse(0, y + h * 0.5, safeRadius(w * 0.8), safeRadius(h * 0.35))
      .fill({ color: P.enemyShade, alpha: 0.5 });
    body.stroke({ color: 0x2a1240, width: 1.6, alpha: 1 - flashMix * 0.6 });

    if (flashMix < 0.6) {
      const eyeDx = dir * 3.2;
      body.circle(-4 + eyeDx, y - 1, safeRadius(2.1)).fill({ color: P.enemyEye });
      body.circle(4 + eyeDx, y - 1, safeRadius(2.1)).fill({ color: P.enemyEye });
      body.circle(-4 + eyeDx, y - 1, safeRadius(0.9)).fill({ color: 0x2a1240 });
      body.circle(4 + eyeDx, y - 1, safeRadius(0.9)).fill({ color: 0x2a1240 });
    }
  }

  draw();

  return {
    container,
    get x() {
      return x;
    },
    update(dt: number) {
      x += dir * speed * dt;
      bob += dt * 6;
      if (x > centerX + range) {
        x = centerX + range;
        dir = -1;
        squash = 1;
      } else if (x < centerX - range) {
        x = centerX - range;
        dir = 1;
        squash = 1;
      }
      squash = Math.max(0, squash - dt * 3.5);
      flash = Math.max(0, flash - dt * 2.5);
      container.x = x;
      draw();
    },
    takeHit(fromLeft: boolean) {
      flash = 1;
      squash = 1;
      x += fromLeft ? 3 : -3;
      dir = fromLeft ? 1 : -1;
    },
  };
}
