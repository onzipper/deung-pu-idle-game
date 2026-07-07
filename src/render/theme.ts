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

  // ---- M7.7 "Skill Spectacle" per-class skill-fx accents (task 86d3k...) ----
  // Distinct from the rig body tones in `HERO_COLORS` (which stay put — this
  // is the SKILL VFX's own accent language, not a rig recolor): each class
  // gets a dedicated palette so a glance at a cast reads "sword" vs "archer"
  // vs "mage" even before the shape resolves. Footgun 10 everywhere here:
  // flat/solid on NORMAL blend + a darker outline/underlayer, never additive.
  /** Sword signature/ultimate: wide crimson slash arcs + ground cracks, hot
   * metal palette (distinct from the swordsman rig's own teal). */
  swordCrimson: 0xff4d3d,
  /** Molten glow riding a ground crack's edge. */
  swordEmber: 0xff7a3c,
  /** Dark scorched crack fill / outline underlayer. */
  swordCrackDark: 0x430f08,
  /** Archer signature/ultimate: a richer, more saturated emerald than the
   * pale `HERO_COLORS.archer.light` — reserved for the bigger rain-curtain
   * sweep so it reads distinctly "heavier" than the everyday hit tracer. */
  archerEmerald: 0x2ecc71,
  /** Wind/feather glint gold accent riding the curtain sweep. */
  archerGoldGlint: 0xe8c86b,
  /** Mage signature/ultimate sky event: an azure accent alongside the
   * existing arcane violet (`HERO_COLORS.mage`) for cataclysm's sky-darken +
   * impact. */
  mageAzure: 0x5ad1ff,
  /** Cataclysm's brief sky-darken overlay tint — a dark arcane violet-black,
   * flat alpha only (footgun 10: never additive over the daytime biome sky). */
  skyDarkTint: 0x140026,

  // ---- M7.8 "Manual Play" command feedback accents (tap-to-move / tap-to-
  // attack) — deliberately distinct from every combat/skill/travel accent so
  // a player-issued order reads as "your command", not a spell or an aggro
  // cue. Footgun 10: flat/solid on NORMAL blend + a darker outline, never
  // additive. ----
  /** Ground click-marker ripple (`moveOrdered`) — a cool jewel-tone teal. */
  orderMove: 0x4fd1c5,
  orderMoveDark: 0x144a44,
  /** Target-lock reticle + lock-on pulse (`targetLocked`) — a warm amber,
   * distinct from `dmgSkill`'s pale yellow and `warn`'s red-alert tone. */
  orderAttack: 0xffd23f,
  orderAttackDark: 0x6b4c00,

  // ---- M7.6+ refine-prestige ladder (+8/+9/+10, `fx/refinePrestige.ts`) ----
  // Same jewel-tone "aura flame" FAMILY as `auraFlame*` above (never a
  // clashing new hue) but a brighter, whiter-hot variant — a heavily refined
  // piece should read as "hotter/rarer", not a different material. Kept
  // visually distinct from the plain `auraFlame*` tones so a +10 refined
  // tier-3 weapon never gets mistaken for a naturally-rolled tier-6/epic one
  // (owner spec) even though `gearAura.ts`'s base flames are shared.
  refinePrestige: 0xffe9a8,
  refinePrestigeCore: 0xfffbe0,
  refinePrestigeDark: 0x8a5a00,

  // ---- M7.9 "Grand Expansion" tier-3 skill-4 spectacle accents (each MUST
  // clearly out-spectacle its own class's tier-2 ultimate above). Footgun 10
  // everywhere here too: flat/solid on NORMAL blend + a darker underlayer,
  // never additive over the bright biome sky. ----
  /** Skyfall's lightning bolts — a white-hot electric blue-white, deliberately
   * breaking from the sword's crimson/ember family so a field-wide lightning
   * strike reads distinctly from the quake's ground shockwave (the ground
   * cracks/scorch it also spawns still ride `swordEmber`/`swordCrackDark`). */
  swordLightningCore: 0xf5f9ff,
  swordLightningGlow: 0x7fd8ff,
  /** Archer STORM's sky event: a dark green-tinted storm cast (distinct from
   * the mage's violet/azure sky-events) + a near-black-green silhouette
   * accent for the arrow-swarm band sweeping the top of the sky. */
  archerStormSky: 0x0d2b12,
  archerSwarmDark: 0x13210f,
  /** Mage APOCALYPSE's held sky-darken tint — a touch deeper than
   * cataclysm's `skyDarkTint`, read mainly via a bigger alpha + a much
   * longer hold (still "the mage's sky event", not a new hue family). */
  mageVoidTint: 0x0d001f,

  // ---- M7.9 gear paper-doll ladder, tiers 7-10 (continuing `GEAR_TIER_SCALE`
  // past t6's "huge & อลัง" ceiling — see `heroView.ts`'s `drawApexOrnament`).
  // A shared cool white-violet "beyond max" glow, distinct from the rarity-
  // tinted t6 flare/accent so a glance signals "past the old ceiling"
  // regardless of the piece's rolled rarity. ----
  gearApex: 0xd6c8ff,
  gearApexCore: 0xffffff,

  // ---- Owner request: War Cry ATK-buff aura (`fx/warCryAura.ts`) — a
  // party-wide status effect (any class can carry `hero.atkBuffTimer`), so
  // this is deliberately its OWN crimson/ember family rather than reusing a
  // single class's gear-aura tint — must read distinctly from the sword's
  // weapon-tier flame (`auraFlame*`), the per-class gear-aura colors
  // (emerald/azure/flame), and refine-prestige's pale gold-white. Footgun 10:
  // flat/solid on NORMAL blend + a darker outline, never additive. ----
  warCryAura: 0xe8283e,
  warCryCore: 0xff9a5c,
  warCryDark: 0x4a0810,

  // ---- Town NPCs (render task: ป้าปุ๊/ลุงดึ๋ง real actors) ----
  /** ป้าปุ๊'s apron + market-stall awning — a warm, saturated rust-orange so
   * she pops off the desaturated town scenery per the art-direction rule. */
  npcApron: 0xd9823f,
  npcApronShade: 0x8a4a1f,
  /** Stall wood posts/counter (neutral warm brown, NOT the awning accent). */
  npcStallWood: 0x6b4a2a,
  /** Basket weave accent sitting on the stall counter. */
  npcBasket: 0xb8823f,
  /** ลุงดึ๋ง's tunic + anvil-adjacent skin tones (cool soot-grey so the ember
   * accent below reads as the warm contrast, per the smith brief). */
  npcSmithTunic: 0x5a6270,
  npcSmithTunicShade: 0x33394a,
  /** Anvil body (near-black worked iron) + its top-face highlight. */
  npcAnvil: 0x2a2a30,
  npcAnvilHighlight: 0x555a66,
  /** Hammer-strike spark — a bright ember accent, flat/solid (footgun 10:
   * normal blend, never additive over the daytime town sky). */
  npcEmberSpark: 0xffb14a,
  /** Soft pulsing "แตะได้" (tappable) affordance ring at an NPC's feet —
   * deliberately distinct from every combat/order/travel accent so it never
   * reads as a quest marker or a hit cue, just a gentle invitation. */
  npcAffordance: 0xffd76b,
  /** Shared warm skin tone for both town NPCs' head/hands. */
  npcSkin: 0xe0b48a,
} as const;

/** Hero class -> {body, light (armor/weapon highlight), shade (hood/robe
 * undertone, armor recess)} color — the "2-3 flat tones per part" layering
 * the art brief calls for, all plain fills/alpha (no gradients). */
export const HERO_COLORS: Record<HeroClass, { body: number; light: number; shade: number }> = {
  swordsman: { body: 0x35d0c0, light: 0x7ce8dd, shade: 0x1f8f83 },
  archer: { body: 0xb8e04a, light: 0xe3f59a, shade: 0x7a9e2e },
  mage: { body: 0xc77dff, light: 0xe6c9ff, shade: 0x8a4fc2 },
};

/** Enemy kind -> body color (POC grunt/runner/tank/shooter). This is the
 * map1/2/3 (+ any frontier-overflow map) look — `views/enemySpecies.ts`
 * resolves map4/5/6's OWN species colors below instead; this table stays the
 * untouched fallback so maps 1-3 render byte-identically to before M7.9's
 * "new mob species" pass. */
export const ENEMY_COLORS: Record<EnemyKind, number> = {
  normal: 0xf07a52, // grunt
  fast: 0xf5c542, // runner
  tank: 0xc9542f,
  ranged: 0xe56ba8, // shooter
};

/** map4/5/6 mob-species base body color per kind (M7.9 "new mob species" —
 * render-only, owner-approved). Each map's 4 kinds keep the SAME silhouette
 * rig/motion personality (`ENEMY_MOTION` in `enemyView.ts` stays keyed by
 * `EnemyKind` only) — only the body color + shape details vary, resolved by
 * `views/enemySpecies.ts`. Picked to stay legible (pop) against that map's own
 * `environment/biomes.ts` ground tones, including map6's near-black grounds —
 * see `ENEMY_SPECIES_ACCENT` below for the glow accents that carry the rest of
 * that legibility work on map6 specifically. */
export const ENEMY_SPECIES_COLORS: Record<"map4" | "map5" | "map6", Record<EnemyKind, number>> = {
  // map4 ice tundra: frost-wolf / ice golem / frozen shambler / frost wisp.
  map4: { fast: 0x9fe0ff, tank: 0x4a7fae, normal: 0x6fa8cc, ranged: 0xcdeaff },
  // map5 desert ruins: sand scorpion / sandstone colossus / bandaged mummy /
  // sand-wraith staff caster.
  map5: { fast: 0x2f8f6b, tank: 0xc79148, normal: 0xd8c9a0, ranged: 0x8a6fae },
  // map6 hell city: imp / charcoal brute / ash ghoul / cinder warlock — all
  // deliberately lighter-value than the near-black hell-city grounds so the
  // silhouette itself pops without relying on the glow accent alone.
  map6: { fast: 0x8a2a2a, tank: 0x554842, normal: 0x6b625a, ranged: 0x4a1f3a },
};

/** map4/5/6's "glowing eyes / cold-crystal / ember-crack" accent — a single
 * dedicated hue per map (mirrors `BOSS_COLORS`' body/crown/eye split), layered
 * as flat alpha fills/strokes on the species body, never a gradient. */
export const ENEMY_SPECIES_ACCENT: Record<"map4" | "map5" | "map6", number> = {
  map4: 0x2ec8ff, // cold cyan glow (frost eyes / crystalline edges)
  map5: 0xffd88a, // warm gold glow (mummy/colossus/scorpion eyes)
  map6: 0xff6a2e, // ember orange-red glow (eyes / crack-lines)
};
/** map5's sand-wraith caster gets its own mystical violet eye glow instead of
 * the shared warm-gold accent above (a caster-specific "different magic"
 * read, same one-extra-accent convention `bossThemes.ts` uses per boss). */
export const ENEMY_SPECIES_WRAITH_ACCENT = 0xcfa8ff;

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

/** Boss stage-map identity ids — mirrors `CONFIG.world.maps[].id` (map1..map6,
 * see `engine/config/index.ts`). Kept as a plain string union here (render has
 * no sanctioned import of the engine's map list itself) rather than importing
 * an engine type, matching the existing `zoneGates.ts` convention of mirroring
 * CONFIG-derived shape instead of reaching into engine internals. */
export type BossMapId = "map1" | "map2" | "map3" | "map4" | "map5" | "map6";

/** Boss stage-map -> flat AT-REST identity palette (M7.9 "Grand Expansion" —
 * 6 boss stages, s5/10/15/20/25/30, each themed to its own map's biome accent
 * — see `render/environment/biomes.ts` MAP1..6 — so a glance at the boss rig
 * instantly signals "which world" even before the stage label resolves).
 * Telegraph/enrage tells stay UNIVERSAL (`PALETTE.warn`/`enrageAura`, unchanged
 * in `bossView.ts`) across every boss — only the boss's own idle identity
 * (body/crown/eye) varies here, so "red = danger" keeps reading consistently
 * regardless of which boss is on screen. */
export const BOSS_COLORS: Record<BossMapId, { body: number; crown: number; eye: number }> = {
  // s5 — cave guardian (โลกมนุษย์ ถ้ำมืด): violet-grey stone body, ember-lit horns.
  map1: { body: 0x6a5a94, crown: 0xff8a3d, eye: 0xd9cfff },
  // s10 — demon sovereign (แดนอสูร บัลลังก์อสูร): deep crimson-black, molten horns.
  map2: { body: 0x7a1f22, crown: 0xff5a1e, eye: 0xffb347 },
  // s15 — frontier warlord (พรมแดนเถื่อน ป้อมปราการเถื่อน): bronze/amber, tribal crest.
  map3: { body: 0x9c723a, crown: 0xffb54a, eye: 0xfff0c2 },
  // s20 — glacial sovereign (ทุนดราน้ำแข็ง): pale ice-blue body, icicle crown.
  map4: { body: 0x6fa8cc, crown: 0xdff3ff, eye: 0x9fdfff },
  // s25 — buried pharaoh (ทะเลทรายซากอารยธรรม): sandstone gold, nemes headdress.
  map5: { body: 0xc79148, crown: 0xffcf7a, eye: 0x1f2a4a },
  // s30 — infernal sovereign (นครนรก): near-black ember body, sweeping horns.
  map6: { body: 0x330606, crown: 0xff260e, eye: 0xffab4d },
};
