/**
 * Procedural MMX3-proportioned swordsman: compact frame, bold dark outline,
 * oversized forearm/boots, confident stance. Built once as a handful of
 * persistent `Graphics` parts (never new pooled display objects per pose —
 * same "build-once, redraw the path" vocabulary as `src/render/views/heroView.ts`,
 * reimplemented locally since this route may not import `src/render`).
 *
 * Two animations, both SNAPPY/stepped (no tweened easing between poses —
 * MMX-style "hold a discrete pose" timing):
 *  - idle breathing: 2 poses, ~260ms hold each
 *  - sword swing: 4 poses (anticipation -> impact/smear -> follow-through ->
 *    return), ~90ms hold each
 */

import { Container, Graphics } from "pixi.js";
import { PROTO_PALETTE as P, safeRadius } from "./palette";

export type PoseId = "idleA" | "idleB" | "swing1" | "swing2" | "swing3" | "swing4";

interface PoseCfg {
  /** Sword-arm rotation in radians, 0 = pointing straight right. */
  armAngle: number;
  /** Extra reach along the arm's own axis (smear length on impact). */
  armExtend: number;
  /** Torso lean in radians (+ = leaning into the swing direction). */
  torsoLean: number;
  /** Cape trail angle offset. */
  capeSwing: number;
  /** Vertical crouch/rise offset (breathing + windup dip). */
  bodyY: number;
  /** Draw a motion-smear wedge behind the blade this pose. */
  smear: boolean;
}

const POSES: Record<PoseId, PoseCfg> = {
  idleA: { armAngle: -0.15, armExtend: 0, torsoLean: 0, capeSwing: 0, bodyY: 0, smear: false },
  idleB: { armAngle: -0.15, armExtend: 0, torsoLean: 0, capeSwing: 0.06, bodyY: -1, smear: false },
  swing1: { armAngle: -1.9, armExtend: -1, torsoLean: -0.12, capeSwing: -0.25, bodyY: 1, smear: false },
  swing2: { armAngle: 0.65, armExtend: 4, torsoLean: 0.18, capeSwing: 0.5, bodyY: -1, smear: true },
  swing3: { armAngle: 1.35, armExtend: 1, torsoLean: 0.05, capeSwing: 0.3, bodyY: 0, smear: false },
  swing4: { armAngle: 0.2, armExtend: 0, torsoLean: 0, capeSwing: 0.1, bodyY: 0, smear: false },
};

export const SWING_SEQUENCE: PoseId[] = ["swing1", "swing2", "swing3", "swing4"];
/** The pose whose hold-frame is the "impact" beat — caller checks overlap here. */
export const SWING_IMPACT_POSE: PoseId = "swing2";

interface HeroParts {
  cape: Graphics;
  legBack: Graphics;
  legFront: Graphics;
  torso: Graphics;
  head: Graphics;
  armSword: Graphics;
  armOff: Graphics;
}

export interface Hero {
  container: Container;
  /** Redraw all parts for this pose (call only on pose CHANGE, not per frame —
   * this is what keeps the animation feeling stepped/snappy instead of tweened). */
  setPose(pose: PoseId): void;
}

const HEIGHT = 40;

function drawLegs(g: Graphics, front: boolean, crouch: number): void {
  g.clear();
  const x = front ? 5 : -5;
  const topY = -HEIGHT * 0.42 + crouch;
  const bootY = -2 + crouch * 0.3;
  // Chunky oversized boot silhouette.
  g.poly([x - 5, topY, x + 5, topY, x + 6, bootY, x + 8, 0, x - 9, 0, x - 6, bootY]).fill({
    color: P.heroBoots,
  });
  g.stroke({ color: P.heroOutline, width: 1.4 });
}

function drawTorso(g: Graphics, cfg: PoseCfg): void {
  g.clear();
  const lean = cfg.torsoLean;
  const y = -HEIGHT * 0.42 + cfg.bodyY;
  const w = 13;
  const h = HEIGHT * 0.42;
  // Chest plate — a bold trapezoid wider at the shoulders, leaning with swing.
  const shiftX = Math.sin(lean) * 4;
  g.poly([
    -w / 2 + shiftX * 0.2,
    y,
    w / 2 + shiftX * 0.2,
    y,
    w / 2 - 1 + shiftX,
    y + h,
    -w / 2 + 1 + shiftX,
    y + h,
  ]).fill({ color: P.heroArmor });
  // Chest highlight seam.
  g.rect(-2 + shiftX * 0.5, y + 4, 4, h - 8).fill({ color: P.heroArmorLight, alpha: 0.7 });
  // Pauldrons (big bold shoulder blocks — the "oversized forearm/armor" MMX read).
  g.circle(-w / 2 - 1 + shiftX * 0.3, y + 3, safeRadius(5.5)).fill({ color: P.heroArmorShade });
  g.circle(w / 2 + 1 + shiftX * 0.3, y + 3, safeRadius(5.5)).fill({ color: P.heroArmorShade });
  g.stroke({ color: P.heroOutline, width: 1.6 });
}

function drawHead(g: Graphics, cfg: PoseCfg): void {
  g.clear();
  const y = -HEIGHT * 0.42 - 8 + cfg.bodyY;
  const shiftX = Math.sin(cfg.torsoLean) * 5;
  g.circle(shiftX, y, safeRadius(6.5)).fill({ color: P.heroSkin });
  // Open-face helm dome + brim + small plume, bold chunky shapes.
  g.poly([
    -7 + shiftX,
    y - 1,
    7 + shiftX,
    y - 1,
    8 + shiftX,
    y - 6,
    0 + shiftX,
    y - 9,
    -8 + shiftX,
    y - 6,
  ]).fill({ color: P.heroArmor });
  g.rect(-8 + shiftX, y - 1, 16, 2).fill({ color: P.heroArmorLight });
  g.poly([0 + shiftX, y - 9, 2 + shiftX, y - 15, -1 + shiftX, y - 12]).fill({ color: P.heroCape });
  g.stroke({ color: P.heroOutline, width: 1.4 });
}

function drawCape(g: Graphics, cfg: PoseCfg): void {
  g.clear();
  const y0 = -HEIGHT * 0.42 + 2 + cfg.bodyY;
  const sway = cfg.capeSwing * 14;
  g.poly([-6, y0, 6, y0, 4 + sway * 0.6, y0 + 16, -2 + sway, y0 + 22, -8 + sway * 1.4, y0 + 14]).fill(
    { color: P.heroCape },
  );
  g.poly([-2, y0 + 4, 3, y0 + 4, 1 + sway * 0.5, y0 + 18]).fill({
    color: P.heroCapeShade,
    alpha: 0.8,
  });
  g.stroke({ color: P.heroOutline, width: 1.2, alpha: 0.6 });
}

function drawArmOff(g: Graphics, cfg: PoseCfg): void {
  g.clear();
  const y = -HEIGHT * 0.42 + 6 + cfg.bodyY;
  const shiftX = Math.sin(cfg.torsoLean) * -3;
  g.roundRect(-9 + shiftX, y, 5, 11, 2).fill({ color: P.heroArmorShade });
  g.circle(-6.5 + shiftX, y + 12, safeRadius(3)).fill({ color: P.heroSkin });
  g.stroke({ color: P.heroOutline, width: 1.2 });
}

function drawArmSword(g: Graphics, cfg: PoseCfg): void {
  g.clear();
  const shoulderX = 6;
  const shoulderY = -HEIGHT * 0.42 + 5 + cfg.bodyY;
  const angle = cfg.armAngle;
  const armLen = 9;
  const handX = shoulderX + Math.cos(angle) * armLen;
  const handY = shoulderY + Math.sin(angle) * armLen;

  // Bold, oversized forearm (the MMX "big forearm" read) as a thick capsule.
  g.moveTo(shoulderX, shoulderY);
  g.lineTo(handX, handY);
  g.stroke({ color: P.heroArmor, width: 5.5, cap: "round" });
  g.circle(handX, handY, safeRadius(3.2)).fill({ color: P.heroSkin });

  // Blade: length grows with `armExtend` (the swing's reach), steel + gold hilt.
  const bladeLen = 15 + cfg.armExtend;
  const bx = handX + Math.cos(angle) * bladeLen;
  const by = handY + Math.sin(angle) * bladeLen;
  const perpX = -Math.sin(angle) * 1.6;
  const perpY = Math.cos(angle) * 1.6;
  g.poly([
    handX + perpX,
    handY + perpY,
    bx + perpX * 0.4,
    by + perpY * 0.4,
    bx - perpX * 0.4,
    by - perpY * 0.4,
    handX - perpX,
    handY - perpY,
  ]).fill({ color: P.heroSteel });
  // Gold crossguard + hilt nub at the hand.
  g.circle(handX, handY, safeRadius(2)).fill({ color: P.heroGold });

  if (cfg.smear) {
    // Motion-smear wedge trailing the blade on the impact pose — flat alpha,
    // no gradient; this is the "anticipation + smear frame" the brief asks for.
    const trailAngle = angle - 0.9;
    const tx = handX + Math.cos(trailAngle) * bladeLen * 0.8;
    const ty = handY + Math.sin(trailAngle) * bladeLen * 0.8;
    g.poly([handX, handY, bx, by, tx, ty]).fill({ color: P.heroSteel, alpha: 0.35 });
    g.poly([handX, handY, bx, by, tx, ty]).fill({ color: P.flameWhite, alpha: 0.18 });
  }

  g.stroke({ color: P.heroOutline, width: 1.3 });
}

export function buildHero(): Hero {
  const container = new Container();
  const cape = new Graphics();
  const legBack = new Graphics();
  const legFront = new Graphics();
  const torso = new Graphics();
  const head = new Graphics();
  const armOff = new Graphics();
  const armSword = new Graphics();
  // z-order: cape behind everything, back leg, off-arm, torso, front leg over
  // torso hem, head, sword arm drawn last so the blade reads on top.
  container.addChild(cape, legBack, armOff, torso, legFront, head, armSword);
  const parts: HeroParts = { cape, legBack, legFront, torso, head, armSword, armOff };

  function apply(pose: PoseId): void {
    const cfg = POSES[pose];
    const crouch = cfg.bodyY;
    drawLegs(parts.legBack, false, crouch);
    drawLegs(parts.legFront, true, crouch);
    drawCape(parts.cape, cfg);
    drawTorso(parts.torso, cfg);
    drawHead(parts.head, cfg);
    drawArmOff(parts.armOff, cfg);
    drawArmSword(parts.armSword, cfg);
  }

  apply("idleA");

  return {
    container,
    setPose: apply,
  };
}

export const HERO_HEIGHT = HEIGHT;
