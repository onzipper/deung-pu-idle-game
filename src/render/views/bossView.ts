/**
 * Boss view: big hexagon body (POC `drawBoss`), enrage tint, and a closing
 * "telegraph" ring while `boss.telegraph > 0` warning of the incoming slam AOE.
 * The boss's own HP bar is drawn as the big top-of-arena bar in
 * `GameRenderer`'s overlay layer (POC-faithful), not here.
 */

import { Container, Graphics } from "pixi.js";
import { CONFIG } from "@/engine/config";
import type { Boss } from "@/engine/entities";
import { GROUND_Y } from "@/render/layout";
import { PALETTE, safeRadius } from "@/render/theme";

const CY = GROUND_Y - 30;
const CORE_R = 34;

export interface BossView extends Container {
  body: Graphics;
  telegraphRing: Graphics;
}

export function createBossView(): BossView {
  const view = new Container() as BossView;
  view.body = new Graphics();
  view.telegraphRing = new Graphics();
  view.addChild(view.telegraphRing, view.body);
  return view;
}

export function updateBossView(view: BossView, boss: Boss, elapsedMs: number): void {
  view.position.set(boss.x, 0);

  const color = boss.telegraph > 0 ? PALETTE.warn : PALETTE.boss;
  // Subtle idle pulse while winding up, matching the POC's sin-driven radius.
  const pulse = boss.telegraph > 0 ? 3 * Math.sin(elapsedMs / 40) : 0;
  const r = safeRadius(CORE_R + pulse);

  const g = view.body;
  g.clear();
  g.regularPoly(0, CY, r, 6, Math.PI / 6).fill(color);
  g.circle(0, CY, 10).fill(PALETTE.arenaSky);

  const ring = view.telegraphRing;
  ring.clear();
  if (boss.telegraph > 0) {
    const total = boss.enraged
      ? CONFIG.boss.telegraphEnraged
      : CONFIG.boss.telegraphNormal;
    const frac = total > 0 ? Math.max(0, Math.min(1, boss.telegraph / total)) : 0;
    // Ring closes in from wide (just wound up) to tight (about to land).
    const ringR = safeRadius(CORE_R + 10 + frac * 60);
    const alpha = 0.35 + (1 - frac) * 0.5;
    ring.circle(0, CY, ringR).stroke({ width: 3, color: PALETTE.warn, alpha });
  }
}
