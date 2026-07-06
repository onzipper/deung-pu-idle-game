/**
 * Visual palette — ported from the POC's CSS custom properties
 * (`poc-html/idle-brawler-poc.html` `:root` block) so the Pixi rebuild matches
 * the POC's look. Colors live here only; no other render module should hardcode
 * a hex value.
 *
 * NOTE: these are Pixi color numbers (0xRRGGBB), not CSS strings — Pixi
 * Graphics fills take numbers directly, sidestepping the POC's
 * `getComputedStyle(...).trim() || '#fff'` CSS-var fallback dance entirely.
 */

import type { HeroClass, EnemyKind, ProjectileKind } from "@/engine/entities";

export const PALETTE = {
  arenaSky: 0x151a30,
  arenaGround: 0x1e2542,
  gridLine: 0xffffff, // drawn at low alpha over the ground
  ivory: 0xf4f1ea,
  muted: 0x8b93c7,
  gold: 0xf2b134,
  hpGood: 0x5dcaa5,
  hpBad: 0xe24b4a,
  warn: 0xff5a5a,
  boss: 0x8b7ff0,
  bossLight: 0xb3a9ff,
  deadHero: 0x3a4270,
  shadow: 0x000000,

  // ---- M4 fx-only accents (damage numbers / flashes / bursts) ----
  /** Neutral flash target color for the hit-flash filter (lerp-to-white). */
  flashWhite: 0xffffff,
  /** Normal-attack damage number color (enemy/boss taking a basic hit). */
  dmgNormal: 0xf4f1ea,
  /** Damage-taken-by-hero number color. */
  dmgHeroTaken: 0xff6b6b,
  /** Skill-sourced damage number / impact accent color. */
  dmgSkill: 0xffe066,
  /** Kill-pop burst + gold-gained text color. */
  killGold: 0xf2b134,
  /** Boss enrage aura / telegraph-intensify accent. */
  enrageAura: 0xff3b3b,

  // ---- PROCEDURAL V2 silhouette accents (task 86d3k2nj3) ----
  /** Thin dark line stroked around armor/robe/silhouette shapes so entities
   * "pop" off the desaturated scenery (art-direction rule in `README.md`) —
   * a flat near-navy, not pure black, so it reads as an outline rather than
   * a hard cutout. Shared across hero/enemy/boss rigs. */
  outline: 0x11142a,
  /** Neutral metal accent for blades/crossguards/arrowheads/staff bands —
   * shared across weapon glyphs so armament reads as "the same material"
   * regardless of hero class. */
  steel: 0xd7deee,

  // ---- M7 gear paper-doll accents (task 86d3... gear-wow pass) ----
  /** Rare-tier gear trim/gem accent (common gear reuses `steel` above; epic
   * uses `gearEpic` below) — a cool icy-blue jewel tone so a glance at the
   * rig signals rarity band regardless of class. */
  gearRare: 0x4fc3f7,
  /** Epic-tier gear trim/gem accent — warm gold-orange, distinct from the
   * evolution accent's plain `gold` above (this is a GEAR rarity signal, not
   * the hero-tier evolution one) and from `gearRare`'s cool blue. */
  gearEpic: 0xffb347,
  /** Tier-6/epic weapon "Super Saiyan" aura flame tones (footgun 10: solid
   * flame colors on NORMAL blend, never additive over bright scenes) — two
   * flat tones (outer/core) standing in for a flame gradient without one,
   * plus a dark ember outline. */
  auraFlame: 0xff7a1a,
  auraFlameCore: 0xffd23f,
  auraFlameDark: 0x7a2c00,

  // ---- M7.5 world-gate accents (zone-edge archways, fast-travel portal, boss
  // door) ----
  /** Fast-travel portal swirl — an arcane blue-violet jewel tone, deliberately
   * distinct from every combat/skill accent so a channel reads as "travel",
   * not "a spell". Footgun 10: solid on NORMAL blend + a darker outline,
   * never additive. */
  travelPortal: 0x5a7dff,
  /** Bright icy core at the swirl's center (grows with channel progress). */
  travelPortalCore: 0xbfe0ff,
  /** Dark outline/ember-equivalent for the portal swirl shapes. */
  travelPortalDark: 0x1c2050,
  /** Chain accent on a locked boss door. */
  doorChain: 0x2a2a30,
} as const;

/** Hero class -> {body, light (armor/weapon highlight), shade (hood/robe
 * undertone, armor recess)} color — the "2-3 flat tones per part" layering
 * the art brief calls for, all plain fills/alpha (no gradients). */
export const HERO_COLORS: Record<HeroClass, { body: number; light: number; shade: number }> = {
  swordsman: { body: 0x35d0c0, light: 0x7ce8dd, shade: 0x1f8f83 },
  archer: { body: 0xb8e04a, light: 0xe3f59a, shade: 0x7a9e2e },
  mage: { body: 0xc77dff, light: 0xe6c9ff, shade: 0x8a4fc2 },
};

/** Enemy kind -> body color (POC grunt/runner/tank/shooter). */
export const ENEMY_COLORS: Record<EnemyKind, number> = {
  normal: 0xf07a52, // grunt
  fast: 0xf5c542, // runner
  tank: 0xc9542f,
  ranged: 0xe56ba8, // shooter
};

/** Projectile kind -> body color (falls back to owner's color where the POC
 * colored per-attack rather than per-kind; arrow/orb use the firing hero's
 * class color, so callers may override this default). */
export const PROJECTILE_COLORS: Record<ProjectileKind, number> = {
  arrow: PALETTE.ivory,
  orb: PALETTE.ivory,
  meteor: HERO_COLORS.mage.light,
  bolt: 0xff9ecb,
  // arrow-rain skill projectiles (engine kind "rainArrow") — archer class light
  rainArrow: HERO_COLORS.archer.light,
};

/** Clamp any radius/size fed to a Pixi Graphic (POC negative-radius crash rule). */
export function safeRadius(r: number): number {
  return Math.max(0, r);
}
