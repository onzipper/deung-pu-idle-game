/**
 * Projectile view: arrow/bolt (shaft + head, rotated to face their target) and
 * orb/meteor (glowing dot flying to a fixed impact point; meteor adds a falling
 * trail). Colored by `kind` (POC colored by the firing hero's live type instead,
 * but that identity doesn't survive into the pure engine's `Projectile` shape —
 * kind-based color is the M2-faithful simplification the task calls for).
 */

import { Container, Graphics } from "pixi.js";
import type { CombatTarget, Hero, Projectile, ProjectileKind } from "@/engine/entities";
import type { GameState } from "@/engine/state";
import { GROUND_Y } from "@/render/layout";
import { PROJECTILE_COLORS, safeRadius } from "@/render/theme";

export interface ProjectileView extends Container {
  body: Graphics;
  kind: ProjectileKind | null;
}

export function createProjectileView(): ProjectileView {
  const view = new Container() as ProjectileView;
  view.body = new Graphics();
  view.kind = null;
  view.addChild(view.body);
  return view;
}

function findTarget(state: GameState, id: number | null): (Hero | CombatTarget) | null {
  if (id == null) return null;
  for (const h of state.heroes) if (h.id === id) return h;
  for (const e of state.enemies) if (e.id === id) return e;
  if (state.boss && state.boss.id === id) return state.boss;
  return null;
}

function drawBody(g: Graphics, kind: ProjectileKind): void {
  const color = PROJECTILE_COLORS[kind];
  g.clear();
  if (kind === "orb" || kind === "meteor") {
    const r = safeRadius(kind === "meteor" ? 10 : 6);
    if (kind === "meteor") {
      g.moveTo(0, 0)
        .lineTo(-10, -34)
        .stroke({ width: 6, color, alpha: 0.5, cap: "round" });
      g.moveTo(0, 0)
        .lineTo(-6, -22)
        .stroke({ width: 13, color, alpha: 0.22, cap: "round" });
    }
    g.circle(0, 0, r).fill({ color, alpha: 0.95 });
    g.circle(0, 0, safeRadius(r + 6)).fill({ color, alpha: 0.3 });
  } else {
    // arrow / bolt: shaft + triangular head, drawn facing +x (rotated per-frame)
    g.moveTo(-8, 0)
      .lineTo(6, 0)
      .stroke({ width: kind === "bolt" ? 2.5 : 2.5, color, cap: "round" });
    g.poly([10, 0, 4, -3, 4, 3], true).fill(color);
  }
}

export function updateProjectileView(
  view: ProjectileView,
  p: Projectile,
  state: GameState,
): void {
  view.position.set(p.x, p.y);

  if (view.kind !== p.kind) {
    view.kind = p.kind;
    drawBody(view.body, p.kind);
  }

  if (p.kind === "orb" || p.kind === "meteor") {
    view.rotation = 0;
    return;
  }

  // Point-target arrows (arrow-rain skill): face the landing point while falling.
  if (p.kind === "rainArrow") {
    view.rotation = Math.atan2(p.ty - p.y, p.tx - p.x);
    return;
  }

  // Homing kinds: face the current target (or its last-known impact height).
  const target = findTarget(state, p.targetId);
  const ty = target != null ? (p.team === "hero" ? GROUND_Y - 16 : GROUND_Y - 30) : p.y;
  const tx = target?.x ?? p.x + 20;
  view.rotation = Math.atan2(ty - p.y, tx - p.x);
}
