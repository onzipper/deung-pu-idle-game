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
import { PALETTE, PROJECTILE_COLORS, safeRadius } from "@/render/theme";

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

// ---- arrow-family silhouette (86d3k2t18 "ลูกธนูไม่เหมือนลูกธนูเลย" redesign) ----
// One Graphics, drawn once per kind change (existing build-once-per-kind
// pattern above) — a tapered two-tone shaft (poly, not a bare stroke, so it
// reads as a shaft rather than a dash) + a wider triangular head + 2 angled
// fletching fins at the tail. `bolt` (enemy crossbow bolt) reuses the same
// rig but shorter/no fletching/a dark "menacing" tip instead of steel, so it
// stays instantly distinguishable from a hero arrow at a glance.
const ARROW_TAIL_X = -15;
const ARROW_HEAD_JOIN_X = 6;
const ARROW_TIP_X = 15;
const ARROW_HEAD_HALF_W = 4;
const ARROW_SHAFT_HALF_W_TAIL = 1.3;
const ARROW_SHAFT_HALF_W_HEAD = 0.7;
const ARROW_FIN_SPREAD = 6;
const ARROW_FIN_TIP_OFFSET = 6;

/** `rainArrow` reuses the exact hero-arrow silhouette, just a touch smaller
 * (spec: "same silhouette slightly smaller"); `bolt` is deliberately shorter
 * (a stubbier, more efficient-looking enemy projectile). */
function arrowScaleFor(kind: ProjectileKind): number {
  if (kind === "bolt") return 0.72;
  if (kind === "rainArrow") return 0.85;
  return 1;
}

function drawArrowFamily(g: Graphics, kind: ProjectileKind, color: number): void {
  const s = arrowScaleFor(kind);
  const tailX = ARROW_TAIL_X * s;
  const headJoinX = ARROW_HEAD_JOIN_X * s;
  const tipX = (kind === "bolt" ? ARROW_TIP_X - 2 : ARROW_TIP_X) * s;
  const headHalfW = (kind === "bolt" ? ARROW_HEAD_HALF_W - 1 : ARROW_HEAD_HALF_W) * s;
  const shaftHalfTail = ARROW_SHAFT_HALF_W_TAIL * s;
  const shaftHalfHead = ARROW_SHAFT_HALF_W_HEAD * s;

  // Shaft: a tapered quad (not a bare stroke) so it reads as wood/a shaft,
  // not a dash — one tone (ivory/wood for hero arrows, the kind's own color
  // for a bolt).
  g.poly(
    [
      tailX,
      -shaftHalfTail,
      headJoinX,
      -shaftHalfHead,
      headJoinX,
      shaftHalfHead,
      tailX,
      shaftHalfTail,
    ],
    true,
  ).fill({ color, alpha: kind === "bolt" ? 1 : 0.95 });

  // Head: a wider triangular head, second tone — neutral steel for hero
  // arrows (same "armament is one material" language as `heroView.ts`'s
  // weapon glyphs), a dark near-navy outline tone for the bolt's menacing tip.
  const headColor = kind === "bolt" ? PALETTE.outline : PALETTE.steel;
  g.poly([tipX, 0, headJoinX, -headHalfW, headJoinX, headHalfW], true).fill(headColor);

  if (kind === "bolt") {
    // Enemy bolt: no fletching — a small dark tail knob instead (stubbier,
    // more "fired from a mechanism" than a fletched hero arrow).
    g.circle(tailX + 1.5 * s, 0, safeRadius(1.6 * s)).fill({
      color: PALETTE.outline,
      alpha: 0.9,
    });
    return;
  }

  // Hero arrow / rain arrow: 2 small angled fletching fins at the tail,
  // same shaft tone at reduced alpha (subtle two-tone, no third color).
  const finBaseX = tailX + 2 * s;
  const finTipX = tailX - ARROW_FIN_TIP_OFFSET * s;
  const finSpread = ARROW_FIN_SPREAD * s;
  g.poly(
    [finBaseX, -shaftHalfTail, finTipX, -finSpread, finBaseX + 3 * s, -1.5 * s],
    true,
  ).fill({ color, alpha: 0.75 });
  g.poly(
    [finBaseX, shaftHalfTail, finTipX, finSpread, finBaseX + 3 * s, 1.5 * s],
    true,
  ).fill({ color, alpha: 0.75 });
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
    // arrow / bolt / rainArrow: tapered shaft + triangular head + fletching,
    // drawn facing +x (rotated per-frame in `updateProjectileView()`).
    drawArrowFamily(g, kind, color);
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
