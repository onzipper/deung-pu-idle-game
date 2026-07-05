/**
 * Anime/RO-proportioned swordsman ("สัดส่วนคนจริงย่อส่วน" — realistic human
 * proportions, miniaturized; NOT the old MMX3 tiny-chibi rig). ~6.5 head
 * heights, drawn as layered `Graphics` parts (build-once, redraw-on-change —
 * same vocabulary as `src/render/views/heroView.ts`, reimplemented locally
 * since this route may not import `src/render`): silhouette-first hair/head,
 * shoulders/torso, hips/legs, a two-handed-grip sword arm. Clean dark-navy
 * outlines, 2-3 flat tones per region (base + shade + highlight — flat alpha
 * layers, never a canvas/Pixi gradient).
 *
 * THE PAPER-DOLL DEMO: `setGearTier(1|2|3)` swaps armor + weapon geometry on
 * this SAME body — proves the paper-doll concept the brief is judging. Tier 3
 * ("ระดับเทพ") adds the wow beats: star-glint sparkles popping at fixed armor
 * points, a slow diagonal sheen sweep (tiers 2+), and a Super-Saiyan-style
 * blazing aura ON THE WEAPON (additive flame tongues, a flickering outline
 * flare, an occasional energy crackle, faint rising embers) — all pooled/
 * capped particles, real-dt, additive blend, every radius `safeRadius()`-
 * clamped.
 *
 * Unlike the shipped renderer's many-entity pooling discipline, this is a
 * SINGLE throwaway-proto hero: parts are redrawn every `update(dt)` tick
 * (not just on pose change) so continuous gear fx (sheen/flicker/sparkle)
 * can animate smoothly — a deliberate, cheap-at-n=1 simplification, not a
 * pattern to copy into `src/render/`.
 */

import { Container, Graphics } from "pixi.js";
import { PROTO_PALETTE as P, safeRadius } from "./palette";
import { ParticlePool } from "./particlePool";

export type PoseId =
  | "idleA"
  | "idleB"
  | "walk1"
  | "walk2"
  | "walk3"
  | "walk4"
  | "swing1"
  | "swing2"
  | "swing3"
  | "swing4";

export type GearTier = 1 | 2 | 3;

interface LegCfg {
  angle: number; // radians from straight-down; + = forward (toward +x, "facing right")
  lift: number; // 0..1, shortens + hints a mid-swing lifted foot
}

interface PoseCfg {
  armAngle: number;
  armExtend: number;
  torsoLean: number;
  capeSwing: number;
  bodyY: number;
  smear: boolean;
  legFront: LegCfg;
  legBack: LegCfg;
}

const POSES: Record<PoseId, PoseCfg> = {
  idleA: {
    armAngle: -0.25,
    armExtend: 0,
    torsoLean: 0,
    capeSwing: 0,
    bodyY: 0,
    smear: false,
    legFront: { angle: 0.08, lift: 0 },
    legBack: { angle: -0.08, lift: 0 },
  },
  idleB: {
    armAngle: -0.22,
    armExtend: 0,
    torsoLean: 0,
    capeSwing: 0.06,
    bodyY: -1.4,
    smear: false,
    legFront: { angle: 0.05, lift: 0 },
    legBack: { angle: -0.05, lift: 0 },
  },
  walk1: {
    armAngle: -0.32,
    armExtend: 0,
    torsoLean: 0.05,
    capeSwing: 0.35,
    bodyY: -2.2,
    smear: false,
    legFront: { angle: 0.5, lift: 0 },
    legBack: { angle: -0.42, lift: 0.55 },
  },
  walk2: {
    armAngle: -0.24,
    armExtend: 0,
    torsoLean: 0,
    capeSwing: 0.1,
    bodyY: 0,
    smear: false,
    legFront: { angle: 0.15, lift: 0 },
    legBack: { angle: 0.05, lift: 0.15 },
  },
  walk3: {
    armAngle: -0.32,
    armExtend: 0,
    torsoLean: -0.05,
    capeSwing: -0.35,
    bodyY: -2.2,
    smear: false,
    legFront: { angle: -0.42, lift: 0.55 },
    legBack: { angle: 0.5, lift: 0 },
  },
  walk4: {
    armAngle: -0.24,
    armExtend: 0,
    torsoLean: 0,
    capeSwing: -0.1,
    bodyY: 0,
    smear: false,
    legFront: { angle: 0.05, lift: 0.15 },
    legBack: { angle: 0.15, lift: 0 },
  },
  swing1: {
    // anticipation — hoist the greatsword up and back, coil the torso
    armAngle: -2.35,
    armExtend: -3,
    torsoLean: -0.2,
    capeSwing: -0.35,
    bodyY: 2.5,
    smear: false,
    legFront: { angle: -0.12, lift: 0 },
    legBack: { angle: 0.18, lift: 0 },
  },
  swing2: {
    // impact — the big diagonal chop lands, full extend + motion smear
    armAngle: 0.85,
    armExtend: 9,
    torsoLean: 0.24,
    capeSwing: 0.65,
    bodyY: -2.5,
    smear: true,
    legFront: { angle: 0.22, lift: 0 },
    legBack: { angle: -0.16, lift: 0 },
  },
  swing3: {
    // follow-through — blade continues past, weight fully forward
    armAngle: 1.3,
    armExtend: 2,
    torsoLean: 0.1,
    capeSwing: 0.35,
    bodyY: 0,
    smear: false,
    legFront: { angle: 0.1, lift: 0 },
    legBack: { angle: -0.05, lift: 0 },
  },
  swing4: {
    // return to guard
    armAngle: -0.1,
    armExtend: 0,
    torsoLean: 0,
    capeSwing: 0.12,
    bodyY: 0,
    smear: false,
    legFront: { angle: 0.06, lift: 0 },
    legBack: { angle: -0.06, lift: 0 },
  },
};

export const WALK_SEQUENCE: PoseId[] = ["walk1", "walk2", "walk3", "walk4"];
export const SWING_SEQUENCE: PoseId[] = ["swing1", "swing2", "swing3", "swing4"];
/** The pose whose hold-frame is the "impact" beat — caller checks overlap here. */
export const SWING_IMPACT_POSE: PoseId = "swing2";

/** Feet-to-crown height in local units (~6 head-heights at this scale — a
 * touch bigger-headed than strict anime ratio, deliberately, so the face/
 * hair silhouette still reads at small on-screen sizes). */
const HEIGHT = 74;
const SHOULDER_Y = -HEIGHT * 0.74;
const WAIST_Y = -HEIGHT * 0.5;
const HIP_Y = -HEIGHT * 0.43;
const LEG_LEN = -HIP_Y;
const HEAD_R = 8.4;
const HEAD_Y = -HEIGHT + HEAD_R - 1;
const HIP_OFFSET = 6.5;
const SHOULDER_OFFSET = 13;

interface GearGeom {
  clothColor: number;
  clothShade: number;
  clothHighlight: number;
  trim: number | null;
  hasPauldrons: boolean;
  pauldronR: number;
  hasCape: boolean;
  capeColor: number;
  capeShade: number;
  capeScale: number;
  bootColor: number;
  bladeColor: number;
  bladeShade: number;
  hiltColor: number;
  gemColor: number | null;
  bladeLenMul: number;
  bladeWidthMul: number;
  sheen: boolean;
  blaze: boolean;
  sparkle: boolean;
}

const GEAR: Record<GearTier, GearGeom> = {
  1: {
    clothColor: P.t1Cloth,
    clothShade: P.t1ClothShade,
    clothHighlight: P.t1ClothHighlight,
    trim: null,
    hasPauldrons: false,
    pauldronR: 0,
    hasCape: false,
    capeColor: 0,
    capeShade: 0,
    capeScale: 0,
    bootColor: P.t1Boot,
    bladeColor: P.t1Blade,
    bladeShade: P.t1BladeShade,
    hiltColor: P.t1Hilt,
    gemColor: null,
    bladeLenMul: 1,
    bladeWidthMul: 1,
    sheen: false,
    blaze: false,
    sparkle: false,
  },
  2: {
    clothColor: P.t2Armor,
    clothShade: P.t2ArmorShade,
    clothHighlight: P.t2ArmorHighlight,
    trim: P.t2Trim,
    hasPauldrons: true,
    pauldronR: 6.5,
    hasCape: true,
    capeColor: P.t2Cape,
    capeShade: P.t2CapeShade,
    capeScale: 1,
    bootColor: P.t2Boot,
    bladeColor: P.t2Blade,
    bladeShade: P.t2BladeShade,
    hiltColor: P.t2Hilt,
    gemColor: P.t2Gem,
    bladeLenMul: 1.3,
    bladeWidthMul: 1.15,
    sheen: true,
    blaze: false,
    sparkle: false,
  },
  3: {
    clothColor: P.t3Armor,
    clothShade: P.t3ArmorShade,
    clothHighlight: P.t3ArmorHighlight,
    trim: P.t3Trim,
    hasPauldrons: true,
    pauldronR: 8,
    hasCape: true,
    capeColor: P.t3Cape,
    capeShade: P.t3CapeShade,
    capeScale: 1.35,
    bootColor: P.t3Boot,
    bladeColor: P.t3Blade,
    bladeShade: P.t3BladeShade,
    hiltColor: P.t3Hilt,
    gemColor: P.t3Gem,
    bladeLenMul: 1.75,
    bladeWidthMul: 1.4,
    sheen: true,
    blaze: true,
    sparkle: true,
  },
};

interface HeroParts {
  cape: Graphics;
  legBack: Graphics;
  legFront: Graphics;
  torso: Graphics;
  hair: Graphics;
  head: Graphics;
  armSword: Graphics;
  armOff: Graphics;
}

export interface Hero {
  container: Container;
  /** Store the target pose (cheap — drawing happens in `update()`). */
  setPose(pose: PoseId): void;
  setGearTier(tier: GearTier): void;
  /** Advance timers + redraw every part this tick (see file header — this
   * single-entity proto trades the shipped renderer's "redraw only on pose
   * change" discipline for continuously-animated gear fx). */
  update(dt: number): void;
}

function sheenEnvelope(frac: number, phase: number, width: number): number {
  let d = Math.abs(frac - phase);
  d = Math.min(d, 1 - d); // wrap
  return Math.max(0, 1 - d / width);
}

function drawLeg(g: Graphics, hipX: number, cfg: LegCfg, bootColor: number): void {
  g.clear();
  const len = LEG_LEN * (1 - cfg.lift * 0.3);
  const footX = hipX + Math.sin(cfg.angle) * len;
  const footY = HIP_Y + Math.cos(cfg.angle) * len - cfg.lift * 3;
  g.moveTo(hipX, HIP_Y);
  g.lineTo(footX, footY);
  g.stroke({ color: P.heroSkinShade, width: 9.5, cap: "round" });
  g.moveTo(hipX - 1.4, HIP_Y);
  g.lineTo(footX - 1.4, footY - 1.4);
  g.stroke({ color: P.heroSkin, width: 3, cap: "round", alpha: 0.5 });
  // Boot wedge oriented along the leg's own direction — chunky, reads
  // clearly as a foot even at small on-screen sizes.
  const dx = Math.sin(cfg.angle);
  const dy = Math.cos(cfg.angle);
  const px = -dy;
  const py = dx;
  g.poly([
    footX + px * 5,
    footY + py * 5,
    footX + dx * 12 + px * 3.2,
    footY + dy * 12 + py * 3.2,
    footX + dx * 12 - px * 3.8,
    footY + dy * 12 - py * 3.8,
    footX - px * 5,
    footY - py * 5,
  ]).fill({ color: bootColor });
  g.stroke({ color: P.heroOutline, width: 1.8 });
}

function drawHair(g: Graphics, cfg: PoseCfg): void {
  g.clear();
  const shiftX = Math.sin(cfg.torsoLean) * 6;
  const y = HEAD_Y + cfg.bodyY;
  // Back mass (behind/around the head silhouette read) — a full bowl-ish
  // cap, not thin antenna-like spikes, so it reads as HAIR from a distance.
  g.poly([
    -9.5 + shiftX,
    y + 1,
    -9.5 + shiftX,
    y - 3,
    -6 + shiftX,
    y - 8,
    0 + shiftX,
    y - 9.5,
    6.5 + shiftX,
    y - 7.5,
    9.5 + shiftX,
    y - 2,
    9.5 + shiftX,
    y + 2,
    5 + shiftX,
    y - 1.5,
    -1 + shiftX,
    y - 0.5,
    -6 + shiftX,
    y + 4,
  ]).fill({ color: P.heroHair });
  // Two short, wide top tufts (chunky, not spiky/antenna).
  g.poly([-4 + shiftX, y - 8, -1.5 + shiftX, y - 13, 1 + shiftX, y - 8]).fill({ color: P.heroHair });
  g.poly([2 + shiftX, y - 7.5, 5 + shiftX, y - 12, 6.5 + shiftX, y - 7]).fill({ color: P.heroHair });
  // A long side lock down past the jaw for silhouette interest.
  g.poly([-9 + shiftX, y - 1, -10.5 + shiftX, y + 9, -6.5 + shiftX, y + 6, -7 + shiftX, y]).fill({
    color: P.heroHair,
  });
  g.poly([-8 + shiftX, y - 2, -9.5 + shiftX, y + 5, -7.5 + shiftX, y + 2]).fill({
    color: P.heroHairHighlight,
    alpha: 0.85,
  });
  g.stroke({ color: P.heroOutline, width: 1.5 });
}

function drawHead(g: Graphics, cfg: PoseCfg): void {
  g.clear();
  const shiftX = Math.sin(cfg.torsoLean) * 5;
  const y = HEAD_Y + cfg.bodyY;
  g.circle(shiftX, y, safeRadius(HEAD_R)).fill({ color: P.heroSkin });
  g.ellipse(shiftX, y + HEAD_R * 0.55, safeRadius(HEAD_R * 0.85), safeRadius(HEAD_R * 0.4)).fill({
    color: P.heroSkinShade,
    alpha: 0.5,
  });
  // Face hint: brow line + two eyes reading toward facing direction + a
  // simple mouth mark — enough to read as "a person," not fine portraiture.
  const faceDx = 3;
  g.circle(shiftX + faceDx - 2.6, y + 0.6, safeRadius(1.5)).fill({ color: P.heroEye });
  g.circle(shiftX + faceDx + 2.6, y + 0.6, safeRadius(1.5)).fill({ color: P.heroEye });
  g.circle(shiftX + faceDx - 2.6, y + 0.1, safeRadius(0.55)).fill({ color: 0xffffff, alpha: 0.9 });
  g.circle(shiftX + faceDx + 2.6, y + 0.1, safeRadius(0.55)).fill({ color: 0xffffff, alpha: 0.9 });
  g.moveTo(shiftX + faceDx - 2, y + 4.2);
  g.lineTo(shiftX + faceDx + 2, y + 4.2);
  g.stroke({ color: P.heroSkinShade, width: 1, alpha: 0.7 });
  g.stroke({ color: P.heroOutline, width: 1.4 });
}

function drawCape(g: Graphics, cfg: PoseCfg, gear: GearGeom): void {
  g.clear();
  if (!gear.hasCape) return;
  const s = gear.capeScale;
  // Anchored a few units BEHIND center (toward -x, away from the facing/
  // sword-arm side) so it clears the torso silhouette and actually reads as
  // a cape rather than hiding fully behind the body.
  const anchorX = -5 * s;
  const y0 = SHOULDER_Y + 2 + cfg.bodyY;
  const sway = cfg.capeSwing * 18 * s;
  g.poly([
    anchorX - 9 * s,
    y0,
    anchorX + 7 * s,
    y0,
    anchorX + 6 * s + sway * 0.6,
    y0 + 28 * s,
    anchorX - 3 * s + sway,
    y0 + 38 * s,
    anchorX - 12 * s + sway * 1.3,
    y0 + 24 * s,
  ]).fill({ color: gear.capeColor });
  g.poly([
    anchorX - 4 * s,
    y0 + 5 * s,
    anchorX + 3 * s,
    y0 + 5 * s,
    anchorX + sway * 0.5,
    y0 + 30 * s,
  ]).fill({
    color: gear.capeShade,
    alpha: 0.8,
  });
  g.stroke({ color: P.heroOutline, width: 1.4, alpha: 0.6 });
}

function drawTorso(g: Graphics, cfg: PoseCfg, gear: GearGeom, sheenPhase: number): void {
  g.clear();
  const lean = cfg.torsoLean;
  const y = SHOULDER_Y + cfg.bodyY;
  const wTop = 27;
  const wBot = 20;
  const h = WAIST_Y - SHOULDER_Y;
  const shiftX = Math.sin(lean) * 4;
  const poly = [
    -wTop / 2 + shiftX * 0.2,
    y,
    wTop / 2 + shiftX * 0.2,
    y,
    wBot / 2 - 1 + shiftX,
    y + h,
    -wBot / 2 + 1 + shiftX,
    y + h,
  ];
  g.poly(poly).fill({ color: gear.clothColor });
  g.rect(-3 + shiftX * 0.5, y + h * 0.35, 6, h * 0.5).fill({
    color: gear.clothHighlight,
    alpha: 0.6,
  });
  g.rect(-wTop / 2 + shiftX * 0.2, y + h - 3, wTop, 3).fill({ color: gear.clothShade, alpha: 0.6 });
  if (gear.trim) {
    g.rect(-wTop / 2 + 1 + shiftX * 0.2, y + 1.5, wTop - 2, 1.6).fill({ color: gear.trim });
  }
  if (gear.hasPauldrons) {
    g.circle(-wTop / 2 - 1.5 + shiftX * 0.3, y + 3, safeRadius(gear.pauldronR)).fill({
      color: gear.clothShade,
    });
    g.circle(wTop / 2 + 1.5 + shiftX * 0.3, y + 3, safeRadius(gear.pauldronR)).fill({
      color: gear.clothShade,
    });
    g.circle(-wTop / 2 - 1.5 + shiftX * 0.3, y + 1.5, safeRadius(gear.pauldronR * 0.5)).fill({
      color: gear.clothHighlight,
      alpha: 0.7,
    });
    g.circle(wTop / 2 + 1.5 + shiftX * 0.3, y + 1.5, safeRadius(gear.pauldronR * 0.5)).fill({
      color: gear.clothHighlight,
      alpha: 0.7,
    });
    if (gear.pauldronR > 7) {
      // Tier-3 spiked pauldron accents.
      g.poly([
        -wTop / 2 - 1.5 + shiftX * 0.3,
        y + 3 - gear.pauldronR,
        -wTop / 2 - 3.5 + shiftX * 0.3,
        y - 2 - gear.pauldronR,
        -wTop / 2 + 0.5 + shiftX * 0.3,
        y + 1 - gear.pauldronR,
      ]).fill({ color: gear.trim ?? gear.clothHighlight });
      g.poly([
        wTop / 2 + 1.5 + shiftX * 0.3,
        y + 3 - gear.pauldronR,
        wTop / 2 + 3.5 + shiftX * 0.3,
        y - 2 - gear.pauldronR,
        wTop / 2 - 0.5 + shiftX * 0.3,
        y + 1 - gear.pauldronR,
      ]).fill({ color: gear.trim ?? gear.clothHighlight });
    }
  }
  g.stroke({ color: P.heroOutline, width: 1.7 });

  // Slow diagonal sheen sweep (tiers 2+, flat alpha band only — no gradient).
  if (gear.sheen) {
    const bandCount = 5;
    for (let i = 0; i < bandCount; i++) {
      const frac = i / bandCount;
      const a = sheenEnvelope(frac, sheenPhase, 0.14) * 0.35;
      if (a <= 0.01) continue;
      const bx = -wTop / 2 + shiftX * 0.2 + frac * wTop;
      g.poly([bx - 1.4, y, bx + 1.4, y, bx - 1 + shiftX * 0.4, y + h, bx - 3.8 + shiftX * 0.4, y + h]).fill(
        { color: 0xffffff, alpha: a },
      );
    }
  }
}

function drawArmOff(g: Graphics, cfg: PoseCfg): void {
  g.clear();
  // Off-hand reaches across to join the grip low on the hilt (two-handed
  // read) rather than swinging as an independent free limb.
  const shoulderX = -SHOULDER_OFFSET;
  const shoulderY = SHOULDER_Y + 6 + cfg.bodyY;
  const angle = cfg.armAngle;
  const armLen = 17;
  const handX = shoulderX + Math.cos(angle) * armLen * 0.55;
  const handY = shoulderY + Math.sin(angle) * armLen * 0.55 + 7;
  g.moveTo(shoulderX, shoulderY);
  g.lineTo(handX, handY);
  g.stroke({ color: P.heroSkinShade, width: 7.5, cap: "round" });
  g.circle(handX, handY, safeRadius(4.2)).fill({ color: P.heroSkin });
  g.stroke({ color: P.heroOutline, width: 1.4 });
}

export interface SwordGeom {
  shoulderX: number;
  shoulderY: number;
  handX: number;
  handY: number;
  angle: number;
  bladeLen: number;
  bx: number;
  by: number;
}

function swordGeom(cfg: PoseCfg, gear: GearGeom): SwordGeom {
  const shoulderX = SHOULDER_OFFSET;
  const shoulderY = SHOULDER_Y + 5 + cfg.bodyY;
  const angle = cfg.armAngle;
  const armLen = 18;
  const handX = shoulderX + Math.cos(angle) * armLen;
  const handY = shoulderY + Math.sin(angle) * armLen;
  const bladeLen = (28 + cfg.armExtend) * gear.bladeLenMul;
  const bx = handX + Math.cos(angle) * bladeLen;
  const by = handY + Math.sin(angle) * bladeLen;
  return { shoulderX, shoulderY, handX, handY, angle, bladeLen, bx, by };
}

function drawArmSword(
  g: Graphics,
  cfg: PoseCfg,
  gear: GearGeom,
  geom: SwordGeom,
  flicker: number,
): void {
  g.clear();
  const { shoulderX, shoulderY, handX, handY, angle, bladeLen, bx, by } = geom;

  // Bold oversized forearm.
  g.moveTo(shoulderX, shoulderY);
  g.lineTo(handX, handY);
  g.stroke({ color: gear.clothColor, width: 9, cap: "round" });
  g.circle(handX, handY, safeRadius(4.4)).fill({ color: P.heroSkin });

  const perpX = -Math.sin(angle) * (3.6 * gear.bladeWidthMul);
  const perpY = Math.cos(angle) * (3.6 * gear.bladeWidthMul);
  g.poly([
    handX + perpX,
    handY + perpY,
    bx + perpX * 0.35,
    by + perpY * 0.35,
    bx - perpX * 0.35,
    by - perpY * 0.35,
    handX - perpX,
    handY - perpY,
  ]).fill({ color: gear.bladeColor });
  // Center fuller/highlight line.
  g.poly([
    handX + perpX * 0.25,
    handY + perpY * 0.25,
    bx + perpX * 0.08,
    by + perpY * 0.08,
    bx - perpX * 0.08,
    by - perpY * 0.08,
    handX - perpX * 0.25,
    handY - perpY * 0.25,
  ]).fill({ color: gear.bladeShade, alpha: 0.5 });

  // Crossguard + hilt.
  const guardLen = 6.5 * gear.bladeWidthMul;
  g.moveTo(handX + perpX * 0.5 - Math.cos(angle) * guardLen * 0.3, handY + perpY * 0.5)
    .lineTo(handX - perpX * 0.5 - Math.cos(angle) * guardLen * 0.3, handY - perpY * 0.5)
    .stroke({ color: gear.hiltColor, width: 3.4 });
  g.circle(handX, handY, safeRadius(2.8)).fill({ color: gear.hiltColor });
  if (gear.gemColor) {
    g.circle(handX, handY, safeRadius(1.4)).fill({ color: gear.gemColor });
  }

  if (cfg.smear) {
    const trailAngle = angle - 0.9;
    const tx = handX + Math.cos(trailAngle) * bladeLen * 0.8;
    const ty = handY + Math.sin(trailAngle) * bladeLen * 0.8;
    g.poly([handX, handY, bx, by, tx, ty]).fill({ color: gear.bladeColor, alpha: 0.32 });
    g.poly([handX, handY, bx, by, tx, ty]).fill({ color: P.flameWhite, alpha: 0.16 });
  }

  g.stroke({ color: P.heroOutline, width: 1.4 });

  // Tier-3: flickering additive outline flare hugging the blade edge — the
  // "barely contained" read. Flat alpha only, layered on top of the outline.
  if (gear.blaze) {
    const flareAlpha = 0.35 + flicker * 0.5;
    g.poly([
      handX + perpX * 1.3,
      handY + perpY * 1.3,
      bx + perpX * 0.55,
      by + perpY * 0.55,
      bx - perpX * 0.55,
      by - perpY * 0.55,
      handX - perpX * 1.3,
      handY - perpY * 1.3,
    ]).fill({ color: Math.random() < 0.5 ? P.flameOrange : P.flameWhite, alpha: flareAlpha * 0.4 });
    g.poly([
      handX + perpX * 1.05,
      handY + perpY * 1.05,
      bx + perpX * 0.42,
      by + perpY * 0.42,
      bx - perpX * 0.42,
      by - perpY * 0.42,
      handX - perpX * 1.05,
      handY - perpY * 1.05,
    ]).stroke({ color: P.flameOrange, width: 1 + flicker, alpha: flareAlpha });
  }

  // Sheen sweep along the blade (tiers 2+).
  if (gear.sheen) {
    // (drawn by caller via sheenPhase-aware overlay below to keep this
    // function focused on geometry — see `drawBladeSheen`.)
  }
}

function drawBladeSheen(g: Graphics, geom: SwordGeom, phase: number): void {
  const { handX, handY, bx, by } = geom;
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const frac = i / steps;
    const a = sheenEnvelope(frac, phase, 0.12) * 0.55;
    if (a <= 0.02) continue;
    const px = handX + (bx - handX) * frac;
    const py = handY + (by - handY) * frac;
    g.circle(px, py, safeRadius(1.6)).fill({ color: 0xffffff, alpha: a });
  }
}

export function buildHero(): Hero {
  const container = new Container();
  const cape = new Graphics();
  const legBack = new Graphics();
  const legFront = new Graphics();
  const torso = new Graphics();
  const hair = new Graphics();
  const head = new Graphics();
  const armOff = new Graphics();
  const armSword = new Graphics();
  const bladeSheen = new Graphics();
  // NOTE: this is intentionally NORMAL blend, not additive. Additive fire
  // over this scene's bright daytime sky clips every channel straight to
  // white (sky pixels are already high-value, so `add` has nowhere to go
  // but 255,255,255) — tried it, it read as a pale smoke smear, not fire.
  // Solid, high-alpha, flat-fill flame/spark shapes in normal blend read as
  // "blazing" just fine and stay correctly orange/red/white regardless of
  // what's behind them (same flat-alpha-layers vocabulary as everything
  // else here — see `CLAUDE.md`'s "no gradients" rule).
  const weaponFx = new Container();
  const crackle = new Graphics();
  weaponFx.addChild(crackle);

  // z-order: cape behind, back leg, off-arm reaching across, torso, front
  // leg over the hem, head, sword arm + blade on top, blade sheen overlay,
  // then the weapon-fx layer (flame/crackle/embers) on top of all.
  container.addChild(
    cape,
    legBack,
    armOff,
    torso,
    legFront,
    hair,
    head,
    armSword,
    bladeSheen,
    weaponFx,
  );
  const parts: HeroParts = { cape, legBack, legFront, torso, hair, head, armSword, armOff };

  const flamePool = new ParticlePool(weaponFx, 20);
  const emberPool = new ParticlePool(weaponFx, 14);
  const sparklePool = new ParticlePool(container, 10);

  let currentPose: PoseId = "idleA";
  let currentTier: GearTier = 1;
  let t = 0;
  let sheenPhase = 0;
  let flicker = 0;
  let crackleTimer = 1 + Math.random();
  let crackleLife = 0;
  const sparkleTimers = [0.4, 0.9, 1.3, 0.2].map((base) => base + Math.random());
  // Fixed local glint points (pauldron L/R, chest, helm) — approximate, not
  // re-derived from live pose sway (a small drift there is imperceptible and
  // not worth per-frame recomputation for a proto).
  const glintPoints: Array<[number, number]> = [
    [-SHOULDER_OFFSET - 1.5, SHOULDER_Y + 3],
    [SHOULDER_OFFSET + 1.5, SHOULDER_Y + 3],
    [0, (SHOULDER_Y + WAIST_Y) / 2],
    [0, HEAD_Y - 4],
  ];

  function redraw(): void {
    const cfg = POSES[currentPose];
    const gear = GEAR[currentTier];
    drawLeg(parts.legBack, -HIP_OFFSET, { angle: cfg.legBack.angle, lift: cfg.legBack.lift }, gear.bootColor);
    drawLeg(parts.legFront, HIP_OFFSET, { angle: cfg.legFront.angle, lift: cfg.legFront.lift }, gear.bootColor);
    drawCape(parts.cape, cfg, gear);
    drawTorso(parts.torso, cfg, gear, sheenPhase);
    drawHair(parts.hair, cfg);
    drawHead(parts.head, cfg);
    drawArmOff(parts.armOff, cfg);
    const geom = swordGeom(cfg, gear);
    drawArmSword(parts.armSword, cfg, gear, geom, flicker);

    bladeSheen.clear();
    if (gear.sheen) drawBladeSheen(bladeSheen, geom, sheenPhase);

    if (gear.blaze) {
      // Flame tongues licking up off the blade (world-up local direction —
      // valid even when the container is horizontally mirrored for facing).
      if (Math.random() < 26 * (1 / 60)) {
        const frac = Math.random();
        const px = geom.handX + (geom.bx - geom.handX) * frac;
        const py = geom.handY + (geom.by - geom.handY) * frac;
        flamePool.spawn({
          x: px,
          y: py,
          vx: (Math.random() - 0.5) * 16,
          vy: -(30 + Math.random() * 24),
          life: 0.2 + Math.random() * 0.2,
          radius: 2.4 + Math.random() * 2,
          color: Math.random() < 0.5 ? P.flameOrange : P.flameRed,
          gravity: -16,
          drag: 0.3,
          shape: 1,
        });
      }
      if (Math.random() < 6 * (1 / 60)) {
        const frac = Math.random();
        const px = geom.handX + (geom.bx - geom.handX) * frac;
        const py = geom.handY + (geom.by - geom.handY) * frac;
        emberPool.spawn({
          x: px,
          y: py,
          vx: (Math.random() - 0.5) * 8,
          vy: -(14 + Math.random() * 16),
          life: 0.6 + Math.random() * 0.5,
          radius: 0.8 + Math.random() * 0.6,
          color: P.emberDim,
          gravity: -4,
          drag: 0.2,
          alpha: 0.75,
        });
      }
      // Occasional energy crackle near the blade tip.
      crackle.clear();
      if (crackleLife > 0) {
        const jag: number[] = [geom.handX, geom.handY];
        let cx = geom.handX;
        let cy = geom.handY;
        for (let i = 0; i < 4; i++) {
          const f = (i + 1) / 4;
          cx = geom.handX + (geom.bx - geom.handX) * f + (Math.random() - 0.5) * 4;
          cy = geom.handY + (geom.by - geom.handY) * f + (Math.random() - 0.5) * 4;
          jag.push(cx, cy);
        }
        crackle.poly(jag).stroke({ color: P.lightning, width: 1.3, alpha: 0.85 });
        crackle.poly(jag).stroke({ color: P.flameWhite, width: 0.6, alpha: 1 });
      }
    } else {
      crackle.clear();
    }
  }

  redraw();

  return {
    container,
    setPose(pose: PoseId) {
      currentPose = pose;
    },
    setGearTier(tier: GearTier) {
      currentTier = tier;
    },
    update(dt: number) {
      t += dt;
      const gear = GEAR[currentTier];
      if (gear.sheen) {
        sheenPhase = (sheenPhase + dt * 0.16) % 1;
      }
      if (gear.blaze) {
        // Smoothed flicker in [0,1] — a couple of summed sines plus a light
        // random walk so it reads as "unstable energy," not a clean pulse.
        flicker = Math.max(
          0,
          Math.min(
            1,
            0.5 +
              0.28 * Math.sin(t * 17) +
              0.18 * Math.sin(t * 41 + 1.7) +
              (Math.random() - 0.5) * 0.12,
          ),
        );
        crackleTimer -= dt;
        if (crackleTimer <= 0 && crackleLife <= 0) {
          crackleLife = 0.1;
          crackleTimer = 0.9 + Math.random() * 1.1;
        }
        if (crackleLife > 0) crackleLife -= dt;

        for (let i = 0; i < sparkleTimers.length; i++) {
          sparkleTimers[i] -= dt;
          if (sparkleTimers[i] <= 0) {
            sparkleTimers[i] = 1.1 + Math.random() * 1.6;
            const [gx, gy] = glintPoints[i];
            sparklePool.spawn({
              x: gx + (Math.random() - 0.5) * 2,
              y: gy + (Math.random() - 0.5) * 2,
              vx: 0,
              vy: -4 - Math.random() * 3,
              life: 0.35 + Math.random() * 0.2,
              radius: 1.6 + Math.random() * 1,
              color: Math.random() < 0.5 ? P.t3Sparkle : P.t3SparkleGold,
              gravity: 0,
              drag: 0.5,
              shape: 2,
            });
          }
        }
      }
      redraw();
      flamePool.update(dt);
      emberPool.update(dt);
      sparklePool.update(dt);
    },
  };
}

export const HERO_HEIGHT = HEIGHT;
