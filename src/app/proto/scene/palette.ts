/**
 * M6.5 art-direction prototype ROUND 2 — locked direction (docs/GDD.md "Art
 * Direction"): SMOOTH vector rendering only (pixel mode rejected + removed),
 * anime/RO-proportioned hero, paper-doll gear tiers, weapon-borne Super-Saiyan
 * aura on the top gear tier. Self-contained: nothing here is imported from
 * `src/render/theme.ts` (this whole route must not import `src/render`).
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

  // ---- hero: body base (shared across every gear tier) ----
  heroSkin: 0xffdcb4,
  heroSkinShade: 0xe0a97a,
  heroHair: 0x2b1c14,
  heroHairHighlight: 0x4f3521,
  heroEye: 0x2c4f9c,
  heroOutline: 0x120f22,

  // ---- gear tier 1: ธรรมดา (plain cloth/leather) ----
  t1Cloth: 0x8a6a44,
  t1ClothShade: 0x5c4527,
  t1ClothHighlight: 0xb08a5c,
  t1Boot: 0x3a2a1c,
  t1Blade: 0xb7bec8,
  t1BladeShade: 0x848c96,
  t1Hilt: 0x6b4a2c,

  // ---- gear tier 2: หายาก (visible armor, ornate sword) ----
  t2Armor: 0x3a6fd8,
  t2ArmorShade: 0x1a3f94,
  t2ArmorHighlight: 0x8fc0ff,
  t2Trim: 0xf2b134,
  t2Boot: 0x1a2140,
  t2Cape: 0x9e2530,
  t2CapeShade: 0x6b1620,
  t2Blade: 0xe8eef5,
  t2BladeShade: 0xaebbd0,
  t2Hilt: 0xf2b134,
  t2Gem: 0x3ad6ff,

  // ---- gear tier 3: ระดับเทพ (full ornate armor + blazing greatsword) ----
  t3Armor: 0xe8c34a,
  t3ArmorShade: 0xa8862a,
  t3ArmorHighlight: 0xfff2c9,
  t3Trim: 0xbfe8ff,
  t3Boot: 0x2a2340,
  t3Cape: 0x5a1f8a,
  t3CapeShade: 0x351155,
  t3Blade: 0xf3f0ff,
  t3BladeShade: 0xc9c0e8,
  t3Hilt: 0xe8c34a,
  t3Gem: 0xff3b6a,
  t3Sparkle: 0xffffff,
  t3SparkleGold: 0xffe066,

  // ---- weapon aura (tier 3 only — the Super-Saiyan blade treatment) ----
  auraGold: 0xffd873,
  auraGoldDeep: 0xf2b134,
  flameOrange: 0xff7a1a,
  flameRed: 0xff3b1a,
  flameWhite: 0xfff2c9,
  lightning: 0xd8f0ff,
  emberDim: 0xffb35c,

  // ---- enemy blob ----
  enemyBody: 0xb84fe0,
  enemyShade: 0x7c2fa0,
  enemyEye: 0xffe066,

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
