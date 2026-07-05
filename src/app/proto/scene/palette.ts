/**
 * M6.5 art-direction prototype — a DELIBERATELY vivid, saturated SNES/MMX3
 * palette. This intentionally breaks the shipped game's desaturated-scenery
 * rule (see `src/render/README.md`'s "Palette philosophy") to show what the
 * alternate direction looks like. Self-contained: nothing here is imported
 * from `src/render/theme.ts` (this whole route must not import `src/render`).
 */

export const PROTO_PALETTE = {
  // ---- sky (top -> horizon bands, flat rects, no canvas gradients) ----
  skyTop: 0x1450c8,
  skyMid: 0x2f86e8,
  skyLow: 0x7fc4f5,
  skyHorizon: 0xd8f0ff,
  horizonGlow: 0xffe9b0,

  // ---- clouds ----
  cloudFill: 0xffffff,
  cloudShade: 0xcfe9ff,
  cloudOutline: 0x123a66,

  // ---- hills (far -> near) ----
  hillFar: 0x1f9e6d,
  hillFarShade: 0x157a52,
  hillNear: 0x2fd15b,
  hillNearShade: 0x189146,

  // ---- foreground grass strip ----
  grassBase: 0x1c7a3c,
  grassHighlight: 0x3fe06c,
  grassShade: 0x0f5c2b,
  dirt: 0x8a5a34,

  // ---- hero (swordsman, MMX proportions) ----
  heroArmor: 0x2f6fe0,
  heroArmorLight: 0x6fa8ff,
  heroArmorShade: 0x1a3f94,
  heroSkin: 0xffd7a8,
  heroCape: 0xe0343f,
  heroCapeShade: 0x9e1f28,
  heroBoots: 0x1a2140,
  heroSteel: 0xe8eef5,
  heroGold: 0xf2b134,
  heroOutline: 0x0d1030,

  // ---- enemy blob ----
  enemyBody: 0xb84fe0,
  enemyShade: 0x7c2fa0,
  enemyEye: 0xffe066,

  // ---- aura ----
  auraGold: 0xffd873,
  auraGoldDeep: 0xf2b134,
  flameOrange: 0xff7a1a,
  flameRed: 0xff3b1a,
  flameWhite: 0xfff2c9,
  lightning: 0xd8f0ff,
  sparkWhite: 0xffffff,

  // ---- hit fx ----
  hitSpark: 0xffffff,
  hitSparkGold: 0xffe066,

  // ---- HUD ----
  hudTrack: 0x11142a,
  hudBorder: 0x0d1030,
  hpGood: 0x4ade80,
  hpMid: 0xf2b134,
  hpBad: 0xe24b4a,
  hudGold: 0xf2b134,
  hudInk: 0xf4f1ea,
} as const;

/** Clamp any radius/size fed to a Pixi Graphic (the POC negative-radius crash
 * rule — re-declared locally since this route may not import `src/render`). */
export function safeRadius(r: number): number {
  return Math.max(0, r);
}
