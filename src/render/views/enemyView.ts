/**
 * Enemy view: kind-specific silhouette (POC `drawEnemy`) + HP bar. Body shape
 * only depends on `kind` (fixed for the entity's lifetime), so it is drawn once
 * at creation; only the HP bar and position update per frame.
 */

import { Container, Graphics } from "pixi.js";
import type { Enemy, EnemyKind } from "@/engine/entities";
import { GROUND_Y } from "@/render/layout";
import { ENEMY_COLORS, safeRadius } from "@/render/theme";
import { drawHpBar } from "@/render/views/hpBar";

export interface EnemyView extends Container {
  body: Graphics;
  hpBar: Graphics;
  kind: EnemyKind | null;
}

export function createEnemyView(): EnemyView {
  const view = new Container() as EnemyView;
  view.body = new Graphics();
  view.hpBar = new Graphics();
  view.kind = null;
  view.addChild(view.body, view.hpBar);
  return view;
}

/** (Re)draw the body only when `kind` changes (it never does mid-lifetime, but
 * this keeps the view safely reusable if the pool is ever handed a new id). */
function drawBody(g: Graphics, kind: EnemyKind, size: number): void {
  const s = Math.max(0.1, size);
  const color = ENEMY_COLORS[kind];
  g.clear();
  if (kind === "tank") {
    g.roundRect(
      -12 * s,
      GROUND_Y - 30 * s,
      safeRadius(24 * s),
      safeRadius(28 * s),
      4,
    ).fill(color);
  } else if (kind === "ranged") {
    // diamond, tip-up, planted at ground level
    const cy = GROUND_Y - 16;
    g.poly([0, cy - 10 * s, 10 * s, cy, 0, cy + 10 * s, -10 * s, cy], true).fill(color);
  } else {
    // normal / fast: a simple forward-leaning wedge
    g.poly(
      [-15 * s, GROUND_Y - 16, 13 * s, GROUND_Y - 16 - 14 * s, 13 * s, GROUND_Y - 2],
      true,
    ).fill(color);
  }
  // eye dot (all kinds)
  g.circle(-3, GROUND_Y - 17, 2.5).fill({ color: 0x000000, alpha: 0.5 });
}

export function updateEnemyView(view: EnemyView, enemy: Enemy): void {
  view.position.set(enemy.x, 0);

  if (view.kind !== enemy.kind) {
    view.kind = enemy.kind;
    drawBody(view.body, enemy.kind, enemy.size);
  }

  drawHpBar(
    view.hpBar,
    0,
    GROUND_Y - 42 - 8 * enemy.size,
    enemy.hp,
    enemy.maxHp,
    30 * enemy.size,
  );
}
