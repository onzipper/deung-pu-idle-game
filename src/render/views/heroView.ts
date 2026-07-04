/**
 * Hero view: simple stick figure (POC `drawHero`, ported to Pixi Graphics),
 * per-class weapon glyph, HP bar, and a revive-countdown ghost while dead.
 */

import { Container, Graphics, Text } from "pixi.js";
import { CONFIG, HERO_TYPES } from "@/engine/config";
import type { Hero } from "@/engine/entities";
import { GROUND_Y } from "@/render/layout";
import { HERO_COLORS, PALETTE, safeRadius } from "@/render/theme";
import { drawHpBar } from "@/render/views/hpBar";

const HIP_Y = GROUND_Y - 22;
const HEAD_Y = GROUND_Y - 48;
const FEET_Y = GROUND_Y - 6;
const HEAD_R = 6;

export interface HeroView extends Container {
  body: Graphics;
  hpBar: Graphics;
  reviveRing: Graphics;
  reviveLabel: Text;
}

export function createHeroView(): HeroView {
  const view = new Container() as HeroView;
  view.body = new Graphics();
  view.hpBar = new Graphics();
  view.reviveRing = new Graphics();
  view.reviveLabel = new Text({
    text: "",
    style: {
      fontSize: 12,
      fontWeight: "700",
      fill: PALETTE.ivory,
      fontFamily: "monospace",
    },
  });
  view.reviveLabel.anchor.set(0.5);
  view.reviveLabel.position.set(0, HEAD_Y - 18);
  view.addChild(view.body, view.reviveRing, view.hpBar, view.reviveLabel);
  return view;
}

/** Redraw an existing hero view in place for the current frame's state. */
export function updateHeroView(view: HeroView, hero: Hero): void {
  view.position.set(hero.x, 0);

  const colors = HERO_COLORS[hero.cls];
  const bodyColor = hero.dead ? PALETTE.deadHero : colors.body;

  const g = view.body;
  g.clear();
  g.alpha = hero.dead ? 0.45 : 1;

  // legs + spine
  g.moveTo(0, HIP_Y).lineTo(-7, FEET_Y);
  g.moveTo(0, HIP_Y).lineTo(7, FEET_Y);
  g.stroke({ width: 2.4, color: bodyColor, cap: "round" });
  g.moveTo(0, HEAD_Y + 6)
    .lineTo(0, HIP_Y)
    .stroke({ width: 2.4, color: bodyColor, cap: "round" });
  g.circle(0, HEAD_Y, HEAD_R).fill(bodyColor);

  if (!hero.dead) {
    drawWeapon(g, hero.cls, colors.light, bodyColor);
  }

  drawHpBar(view.hpBar, 0, GROUND_Y - 58, hero.hp, hero.maxHp);
  view.hpBar.visible = !hero.dead;

  // Revive countdown: ghost ring depleting as reviveTimer counts down to 0.
  view.reviveRing.clear();
  if (hero.dead) {
    const frac = Math.max(0, Math.min(1, hero.reviveTimer / CONFIG.heroReviveTime));
    const r = safeRadius(14);
    view.reviveRing
      .arc(0, HEAD_Y, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
      .stroke({ width: 2, color: PALETTE.muted, cap: "round" });
    view.reviveLabel.text = hero.reviveTimer > 0 ? hero.reviveTimer.toFixed(1) : "";
  } else {
    view.reviveLabel.text = "";
  }
}

function drawWeapon(
  g: Graphics,
  cls: Hero["cls"],
  accent: number,
  bodyColor: number,
): void {
  const t = HERO_TYPES[cls];
  if (t.attack === "melee") {
    // sword: arm + blade
    const bx = 12;
    const by = HEAD_Y - 2;
    g.moveTo(0, HEAD_Y + 8)
      .lineTo(bx, by)
      .stroke({ width: 2.4, color: bodyColor, cap: "round" });
    g.moveTo(bx, by)
      .lineTo(bx + 10, by - 16)
      .stroke({ width: 3, color: accent, cap: "round" });
  } else if (t.attack === "arrow") {
    // bow: arm + drawn arc
    const bx = 11;
    g.moveTo(0, HEAD_Y + 8)
      .lineTo(bx, HEAD_Y + 4)
      .stroke({ width: 2.4, color: bodyColor, cap: "round" });
    g.arc(bx + 3, HEAD_Y + 4, 11, -1.1, 1.1).stroke({ width: 1.6, color: accent });
  } else {
    // staff: arm + shaft + orb
    const sx = 11;
    g.moveTo(0, HEAD_Y + 8)
      .lineTo(sx, HEAD_Y + 4)
      .stroke({ width: 2.4, color: bodyColor, cap: "round" });
    g.moveTo(sx, HEAD_Y - 14)
      .lineTo(sx, GROUND_Y - 16)
      .stroke({ width: 2.4, color: bodyColor, cap: "round" });
    g.circle(sx, HEAD_Y - 16, 5).fill({ color: accent, alpha: 0.9 });
    // hood/collar
    g.poly([-6, HEAD_Y - 4, 6, HEAD_Y - 4, 0, HEAD_Y - 15]).fill(bodyColor);
  }
}
