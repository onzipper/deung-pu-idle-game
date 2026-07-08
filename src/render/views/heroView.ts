/**
 * Hero view: an articulated, procedurally-animated stick figure.
 *
 * Rig (built ONCE per hero id, first sight — same pooling contract as
 * `enemyView.ts`; only `hero.cls` decides geometry/color and it never changes
 * for a given id, so `view.cls` gates a one-time build):
 *
 *   HeroView (pooled Container, position = hero.x each frame)
 *   ├── bodyRoot (Container, pivot+position = feet — the "falls over" unit)
 *   │   ├── legBack / legFront (Graphics, pivot = hip — swing via rotation)
 *   │   └── upperBody (Container, pivot+position = hip — bob/lean/breathe)
 *   │       ├── torso (Graphics: spine + head, + hood for mage)
 *   │       ├── gearArmor (Graphics, M7: equipped-armor accent overlay —
 *   │       │   sibling of torso, rebuilt only on an equip change)
 *   │       ├── offArm (Graphics: plain arm, counter-swings / raises for casts)
 *   │       ├── weaponArm (Graphics: ARM SEGMENT ONLY, drives every attack anim)
 *   │       │   └── gearWeapon (Graphics, M7: equipped weapon head — blade/
 *   │       │       bow/staff — a plain child so it inherits every swing for
 *   │       │       free; rebuilt only on an equip change, see below)
 *   │       └── tierAccent (Graphics: M5 evolution identity accent)
 *   ├── hpBar (Graphics — NOT under bodyRoot: stays upright even mid-fall)
 *   ├── reviveRing (Graphics — ditto: countdown must stay readable)
 *   └── reviveLabel (Text)
 *
 * Every frame after the initial build only mutates transforms (position /
 * rotation / scale / alpha) or `tint` — never re-walks a Graphics path,
 * EXCEPT `gearWeapon`/`gearArmor` (M7 gear paper-doll), which redraw their
 * path but ONLY on the (rare) frame the hero's `equipped.{weapon,armor}`
 * templateId actually changes — see `updateHeroView`'s gear-build gate and
 * the "GEAR PAPER-DOLL" section below. Timing split: locomotion (walk
 * cadence/bob/lean) derives from actual per-frame position delta, so it
 * naturally speeds up with the 1x/2x/3x multiplier (more sub-steps -> bigger
 * delta over the same real `dt`); transient attack/death/revive beats run on
 * REAL seconds (`ctx.dt`), exactly like `fx/`, so they stay equally snappy at
 * any sim speed.
 */

import { Container, Graphics, Text } from "pixi.js";
import { CONFIG } from "@/engine/config";
import { ITEM_TEMPLATES, type ItemRarity } from "@/engine/config/items";
import type { Hero, HeroClass } from "@/engine/entities";
import type { GameEvent } from "@/engine/state";
import { lerpColor } from "@/render/environment/colorUtils";
import { GROUND_Y } from "@/render/layout";
import { HERO_COLORS, PALETTE, safeRadius } from "@/render/theme";
import { drawHpBar } from "@/render/views/hpBar";

// ---------------------------------------------------------------------------
// Rig geometry constants (all POC-faithful absolute Y's, kept exactly as the
// old flat stick figure used — see the module doc comment for why nested
// pivot/position pairs let children keep using these same absolute numbers).
// ---------------------------------------------------------------------------
const HIP_Y = GROUND_Y - 22;
const HEAD_Y = GROUND_Y - 48;
const FEET_Y = GROUND_Y - 6;
const HEAD_R = 6;
const SHOULDER_Y = HEAD_Y + 8;

// ---------------------------------------------------------------------------
// Locomotion tuning (walk cadence derives from `|dx|` over real `dt` — see
// `updateHeroView`; only the smoothing rate below is a plain real-seconds
// constant).
// ---------------------------------------------------------------------------
const WALK_FREQ_BASE = 1.5 * Math.PI * 2;
const WALK_FREQ_RANGE = 3.2 * Math.PI * 2;
const LEG_SWING_MAX = 0.55;
const IDLE_LEG_BACK = 0.1;
const IDLE_LEG_FRONT = -0.1;
const BOB_AMPLITUDE = 3;
const LEAN_WALK = 0.055;
const MARCH_BOB_BOOST = 1.35;
const MARCH_LEAN_BOOST = 1.55;
const ARM_SWING_MAX = 0.32;
const BREATH_SPEED = Math.PI * 0.9;
const BREATH_SCALE_AMPLITUDE = 0.018;
const IDLE_SWAY = 0.02;
const LEAN_SMOOTH = 8; // per-second lerp rate toward the lean target
/** Below this normalized speed, a facing re-derive is skipped (holds the last
 * value) — mirrors `enemyView.ts`'s `AIM_SPEED_THRESHOLD` convention. */
const FACING_SPEED_THRESHOLD = 0.08;
/** Combat-aim deadband (world-px): when the target sits within this of the
 * hero's x (a foe right on top of it), hold facing instead of flipping — stops
 * the rig jittering when |aimX − hero.x| ≈ 0. */
const AIM_FACING_DEADBAND = 8;
/** Minimum seconds between two VELOCITY-driven flips (the no-target walk case).
 * A live combat aim (`hero.aimX`) bypasses this — target facing is authoritative
 * and should stay responsive; this only debounces movement-direction strobing
 * (e.g. an alternating kite servo when the hero has no target to face). */
const FACING_MIN_FLIP_INTERVAL = 0.35;

// ---------------------------------------------------------------------------
// Per-class resting weapon-arm / off-arm angles (radians).
// ---------------------------------------------------------------------------
const REST_ANGLE: Record<HeroClass, number> = {
  swordsman: -0.15,
  archer: -0.35, // held slightly drawn at rest — "always under tension"
  mage: -0.05,
  ninja: -0.22, // low forward dagger guard — "always ready to blink in"
};
const OFFARM_REST = 0.35;

// ---------------------------------------------------------------------------
// M7 GEAR PAPER-DOLL (gear-wow pass): the equipped weapon/armor overlay,
// keyed by `hero.equipped.{weapon,armor}` templateId — separate from
// `hero.tier` (M5 class-EVOLUTION tier, 1|2) above; a gear template's own
// `tier` field (1-6, `@/engine/config/items`) drives THIS section instead.
// Weapon HEAD geometry (blade/bow/staff) lives in `view.gearWeapon` (a child
// of `weaponArm`, sharing its rotation so it swings/lunges with every attack
// anim); armor accents live in `view.gearArmor` (a sibling of `torso` under
// `upperBody`, same absolute-coordinate convention `buildTierAccent` already
// uses). Both are rebuilt ONLY when the equipped templateId actually changes
// (see `updateHeroView`'s `gearWeaponId`/`gearArmorId` edge-gate) — never a
// per-frame path rebuild.
// ---------------------------------------------------------------------------

/** Per-gear-tier visual growth multiplier — "t1 modest -> t6 huge & อลัง"
 * (GDD). Applied to weapon length/radius math, never to a whole container's
 * `scale` (that would also stretch the arm segment). M7.9 "Grand Expansion"
 * continues the ladder past t6 for the new t7-10 gear band (t7-10 item
 * templates land in a parallel engine task; this table + `drawApexOrnament`
 * below key strictly off the numeric `tier` field, so they apply the instant
 * those templates exist without any further render change). */
const GEAR_TIER_SCALE: Record<number, number> = {
  1: 1,
  2: 1.05,
  3: 1.12,
  4: 1.22,
  5: 1.35,
  6: 1.55,
  7: 1.72,
  8: 1.9,
  9: 2.08,
  10: 2.3,
};

/** Shared shoulder-to-hand grip point per class — both the (build-once) arm
 * segment in `buildRig` and the (rebuilt-on-equip-change) weapon head in
 * `buildGearWeapon` anchor off this SAME point, so a weapon head always
 * lines up with its arm regardless of which one last rebuilt. */
const WEAPON_HAND: Record<HeroClass, { x: number; y: number }> = {
  swordsman: { x: 12, y: HEAD_Y - 2 },
  archer: { x: 11, y: HEAD_Y + 4 },
  mage: { x: 11, y: HEAD_Y + 4 },
  // Held low/close — the shortest reach in the game (docs/ninja-design.md §1).
  ninja: { x: 9, y: HEAD_Y + 5 },
};

/** Ninja OFF-hand dagger grip — mirrors the generic off-arm segment's own
 * fixed hand point (`view.offArm`'s `moveTo(0, SHOULDER_Y).lineTo(-9,
 * SHOULDER_Y + 6)` in `buildRig`, drawn for every class). Kept as its own
 * named constant (not derived) so `buildGearWeapon`'s ninja branch and this
 * off-arm line data can never drift apart. */
const NINJA_OFF_HAND = { x: -9, y: SHOULDER_Y + 6 };

/** Rarity -> accent color (common reuses the shared `steel` weapon-material
 * tone; rare/epic get their own jewel accents — see `theme.ts`). */
function rarityAccentColor(rarity: ItemRarity): number {
  if (rarity === "epic") return PALETTE.gearEpic;
  if (rarity === "rare") return PALETTE.gearRare;
  return PALETTE.steel;
}

// ---------------------------------------------------------------------------
// Attack animation durations (REAL seconds) + amplitudes.
// ---------------------------------------------------------------------------
const SWING_DURATION = 0.22;
const SWING_AMPLITUDE = 1.35;
const LUNGE_PX = 5;

// ---------------------------------------------------------------------------
// Ninja dual-dagger basic attack (docs/ninja-design.md §7 "ท่าโจมตีสลับซ้าย-ขวา"):
// a much SHORTER anim than the swordsman's (ninja is "ตีถี่สุดในเกม" — fastest
// cadence in the game), where the lead hand (weaponArm) throws the full slash
// and the off hand (offArm, carrying `gearOffWeapon`) mirrors a smaller
// counter-slash a beat behind — `HeroAnimState.comboIndex` (0/1 parity, NOT
// the swordsman's 0-2 cycle) picks which arm leads THIS swing, alternating
// every attack.
// ---------------------------------------------------------------------------
const NINJA_SLASH_DURATION = 0.15;
const NINJA_SLASH_AMPLITUDE = 1.5;
const NINJA_TRAIL_FRAC = 0.5; // the trailing arm's delta as a fraction of the lead's
const NINJA_LUNGE_PX = 4;

// ---------------------------------------------------------------------------
// Swordsman basic-attack combo (HERO SIGNATURE PASS 86d3k2q8f, item 1): 3
// visually-distinct swings cycling on every basic attack, all sharing the
// SAME `SWING_DURATION` above (render curve varies, game timing doesn't).
// ---------------------------------------------------------------------------
/** Index 2 ("thrust") uses a much smaller arc + a bigger forward lunge. */
const THRUST_SWING_FRAC = 0.35; // fraction of SWING_AMPLITUDE thrust rotates through
const THRUST_LUNGE_MULT = 2.2; // thrust lunges further than a slash
const THRUST_OFFARM_KICK = 0.25; // off-arm/shield braces forward slightly on a thrust

const SPIN_DURATION = 0.4; // matches FxController's swordsman-spin ring

const RELEASE_DURATION = 0.16;
const RELEASE_KICK = 0.55;
/** Archer basic-shot pose alternation (item 8): odd `shotPoseIndex` values
 * loft the bow a little further on release — "bow angle changes only", the
 * projectile itself still flies per the engine's own targeting. */
const HIGH_ARC_EXTRA_KICK = 0.3;
const TRIPLE_GAP = 0.11;
/** Brief draw-and-hold lead-in before the 3 staggered releases (item 9) —
 * a pure render-timing extension (this whole triple anim is already a
 * render-only construct; the engine's 3 arrows all actually spawn
 * synchronously at `t=0` regardless of this cosmetic stagger). */
const TRIPLE_HOLD_LEAD = 0.15;
const TRIPLE_HOLD_DRAW_ANGLE = 0.22;
const TRIPLE_DURATION = TRIPLE_HOLD_LEAD + TRIPLE_GAP * 2 + RELEASE_DURATION;

const STAFF_PULSE_DURATION = 0.28;
const STAFF_RAISE = 0.4;
const STAFF_PULSE_SCALE = 0.1;

const CASTHOLD_DURATION = 0.55;
const CASTHOLD_RISE_FRAC = 0.4;
const CASTHOLD_RAISE = 1.0;
/** Robe/hat flutter amplitude (radians) during cast-hold — item 12. */
const CASTHOLD_SWAY_AMPLITUDE = 0.05;

const DEATH_FALL_DURATION = 0.4;
const DEATH_FALL_ANGLE = 1.4; // ~80°, short of fully flat (stays legible)
const GHOST_ALPHA = 0.5;
const GHOST_TINT = PALETTE.deadHero;
const REVIVE_BOUNCE_DURATION = 0.4;

// ---------------------------------------------------------------------------
// M8 party P6 "render the party": shadow-body ("ร่างเงา") dim + nameplate/
// offline-tag labels. State-driven (reads `hero.shadowed` directly every
// frame, not the `heroShadowed` event — a hero can spawn already-shadowed on
// a re-seed, which the event stream would miss entirely; see `Hero.shadowed`'s
// own doc comment). `shadowProgress` eases toward 0/1 over `SHADOW_FADE_DURATION`
// real seconds UNLESS this is the view's very first frame (state-driven initial
// value — an already-shadowed spawn shows no fade-in pop).
// ---------------------------------------------------------------------------
const SHADOW_ALPHA = 0.45; // bodyRoot alpha floor while fully shadowed
const SHADOW_FADE_DURATION = 0.4; // real seconds, both directions
/** Small pulse (scale/alpha bump) the nameplate plays for a beat when this
 * view is first built (see `!anim.initialized` below) — "a new hero view
 * appeared" (M8 party P6 juice item 4's "name flash" half; the ring-ping half
 * lives in `fx/FxController.ts`'s `updatePartyMembership()`, keyed off the
 * SAME first-sight moment via `Pool`'s own mark-and-sweep convention). */
const JOIN_FLASH_DURATION = 0.6;
const JOIN_FLASH_SCALE = 0.35;
const JOIN_FLASH_ALPHA = 0.15;
const NAMEPLATE_ALPHA = 0.85;
/** Stacked labels above the HP bar (`GROUND_Y - 58`), never overlapping it —
 * the offline tag sits above the nameplate so both can show at once (a
 * shadowed, non-primary ally). */
const NAMEPLATE_Y = GROUND_Y - 72;
const SHADOW_TAG_Y = GROUND_Y - 84;
/** HOF seasonal rewards (docs/hof-rewards-design.md §3 item 2, render wave):
 * the per-season title tag lane — stacked ABOVE the shadow tag (shown for
 * ANY slot, incl. the primary hero, which has neither a nameplate nor a
 * shadow tag competing for room there), so a single fixed Y works for every
 * hero regardless of which of the other two lanes are also active. */
const TITLE_TAG_Y = GROUND_Y - 96;

type AttackKindAnim =
  "swing" | "spin" | "release" | "triple" | "staffPulse" | "castHold" | "dualSlash";

interface AttackAnim {
  kind: AttackKindAnim;
  /** Elapsed real seconds since the anim started. */
  t: number;
  duration: number;
}

interface HeroAnimState {
  initialized: boolean;
  lastX: number;
  walkPhase: number;
  breathPhase: number;
  /** Smoothed lean angle (radians), eased toward its per-frame target. */
  leanCurrent: number;
  /** Last-seen `hero.cd`, used to detect a same-tick cooldown RESET (i.e. "a
   * basic attack just fired") for classes with no dedicated fire event
   * (swordsman melee — archer/mage instead key off `projectileSpawn`). */
  lastCd: number;
  wasDead: boolean;
  /** -1 once the fall has fully played and is just holding its end pose. */
  deathT: number;
  /** -1 once the revive bounce has fully settled. */
  reviveT: number;
  attack: AttackAnim | null;
  /** Swordsman basic-attack combo cycle (0/1/2 = up-slash/down-slash/thrust),
   * advanced once per new "swing" (HERO SIGNATURE PASS item 1). */
  comboIndex: number;
  /** Archer basic-shot pose alternation (0/1 = straight/high-arc), advanced
   * once per new "release" (item 8). */
  shotPoseIndex: number;
  /** Monotonic counter bumped on every `startAttack()` call (any kind) — lets
   * `fx/FxController.ts` detect "a new swordsman swing started THIS frame"
   * from outside via `peekSwordSwing()` without re-deriving the cd-reset
   * tell itself (item 2's per-swing slash crescent). */
  attackSeq: number;
  /** Highest hero tier this view has already built the tier-accent geometry
   * for (M5 evolution) — starts at 1 (no accent); once `hero.tier` exceeds
   * this, `buildTierAccent()`/`buildAuraRing()` run ONCE and this is bumped,
   * same one-time-build-on-edge convention as `initialized`/`wasDead`. Tier
   * only ever increases (single evolution path in M5), so this never needs
   * to un-build anything. */
  tierBuilt: 1 | 2 | 3;
  /**
   * Rig-flip state (open hunting field, 86d3jv7m3 follow-up): the whole rig
   * is drawn facing +x (bow/blade/staff all built on the +x side — see
   * `buildRig`). `1` = default/unflipped (facing +x); `-1` = mirrored (facing
   * -x). PRIMARY driver is now the engine's per-step combat aim (`hero.aimX`) —
   * face the target being fought (so a kiting ranged hero faces + fires at its
   * foe while retreating); it falls back to the hero's OWN movement delta only
   * when NOT in combat (walking a move order / idle). HELD through stationary
   * beats and when a target vanishes (aim goes null, velocity ~0), rather than
   * re-derived every frame off a near-zero velocity.
   */
  facing: 1 | -1;
  /** Seconds since the last VELOCITY-driven facing flip — gates the no-target
   * walk case to `FACING_MIN_FLIP_INTERVAL` so an alternating walk direction
   * can't strobe the rig. A live combat-aim flip resets it (but isn't gated). */
  sinceFlip: number;
  /** M7 gear paper-doll: the LAST-BUILT `hero.equipped.{weapon,armor}`
   * templateId (or `null` for "nothing equipped") — `updateHeroView` rebuilds
   * `gearWeapon`/`gearArmor` only when these no longer match, never per
   * frame. `gearInitialized` forces exactly one build on this view's first
   * frame (covers a save that loads already geared). */
  gearWeaponId: string | null;
  gearArmorId: string | null;
  gearInitialized: boolean;
  /** M8 party P6: eases toward `hero.shadowed ? 1 : 0` over `SHADOW_FADE_DURATION`
   * — 0 = fully normal, 1 = fully dimmed/desaturated. Seeded from `hero.shadowed`
   * on this view's very first frame (no fade-in pop for an already-shadowed
   * spawn) — see `updateHeroView`'s init block. */
  shadowProgress: number;
  /** M8 party P6 "join flash" (item 4): real seconds since the nameplate pulse
   * started, or -1 while inactive. Set to 0 on this view's first-ever frame
   * (`!anim.initialized`) — a fresh view IS "a hero just appeared". */
  joinFlashT: number;
}

export interface HeroView extends Container {
  cls: HeroClass | null;
  bodyRoot: Container;
  legBack: Graphics;
  legFront: Graphics;
  upperBody: Container;
  torso: Graphics;
  offArm: Graphics;
  weaponArm: Graphics;
  /** M7 gear paper-doll: the equipped WEAPON head (blade/bow/staff), a child
   * of `weaponArm` so it inherits every attack anim's rotation/lunge for
   * free — see `buildGearWeapon()`. Rebuilt only when `hero.equipped.weapon`
   * changes (`HeroAnimState.gearWeaponId`). Grows/gains rarity accents with
   * the equipped template's own `tier`/`rarity` (`@/engine/config/items`),
   * independent of `hero.tier` (M5 evolution) below. */
  gearWeapon: Graphics;
  /** Ninja-only (docs/ninja-design.md §7 "มีดคู่สองมือ"): the OFF-hand dagger, a
   * child of `offArm` so it swings with the off-arm's own rotation (the
   * "alternates L/R" attack read needs the off-hand blade to actually move,
   * unlike `swordsman`'s off-arm shield). Mirrors `gearWeapon`'s growth/
   * rebuild convention exactly (`buildGearWeapon`'s ninja branch draws both),
   * but stays permanently empty/invisible for every other class. */
  gearOffWeapon: Graphics;
  /** M7 gear paper-doll: the equipped ARMOR overlay (trim/accents on top of
   * the class's base silhouette), a sibling of `torso` under `upperBody` —
   * see `buildGearArmor()`. Rebuilt only when `hero.equipped.armor` changes. */
  gearArmor: Graphics;
  /** Last-built weapon/armor template's tier/rarity — read by
   * `fx/FxController.ts` (via `getWeaponAnchorPos`/`getArmorAnchorPos`) to
   * decide whether the tier-6/epic weapon aura or tier-5+ armor sparkle
   * should be active for this hero, without re-deriving from `GameState`
   * itself (the view already resolved it while building). Defaults to
   * tier 1 / common (bare rig, pre-M7 look). */
  gearWeaponTier: number;
  gearWeaponRarity: ItemRarity;
  gearArmorTier: number;
  gearArmorRarity: ItemRarity;
  /** Tier-2 (M5 evolution) identity accent — a NEW, separate Graphics (not
   * extra draws into `torso`/`offArm`/`weaponArm`) so the tier-1 rig those
   * build once never needs touching again; see `buildTierAccent()`. Child of
   * `upperBody`, same absolute-coordinate convention as `torso`. Empty/inert
   * until the hero's tier actually flips (see `HeroAnimState.tierBuilt`). */
  tierAccent: Graphics;
  /** Tier-2 subtle idle aura — a ground-anchored ellipse, top-level sibling
   * (like `hpBar`/`reviveRing`) so it stays upright regardless of body
   * lean/death-fall. Built once (always present, invisible at tier 1). */
  auraRing: Graphics;
  hpBar: Graphics;
  reviveRing: Graphics;
  reviveLabel: Text;
  /** M8 party P6: small identity label shown ABOVE non-primary heroes (slot
   * !== 0) only — `Hero` has no name/identity field (engine stays untouched),
   * so the text comes from `HeroFrameContext.displayName`, a value the
   * renderer's own `setHeroDisplayNames()` setter supplies (see
   * `GameRenderer.ts` — the later networking/room wiring calls it on cohort
   * membership change). Empty/hidden until a name is supplied. Top-level
   * sibling (like `hpBar`/`reviveLabel`) so it stays upright and legible
   * regardless of body lean/death-fall/shadow dim. */
  nameplate: Text;
  /** M8 party P6: "ออฟไลน์" tag shown while `hero.shadowed` — state-driven
   * (read directly every frame), stacked above `nameplate` so both can show
   * at once. Top-level sibling, same convention as `nameplate`. */
  shadowTag: Text;
  /** HOF seasonal rewards (docs/hof-rewards-design.md §3 item 2, render wave):
   * the current season's title tag (e.g. "จ้าวยุทธภพ"), shown above ANY hero
   * (incl. the primary/slot-0 hero — "solo players see their own title, that's
   * the flex", per spec) whenever `HeroFrameContext.socialBadge.title` is set.
   * Top-level sibling (like `nameplate`/`shadowTag`), same upright convention. */
  socialTitle: Text;
  anim: HeroAnimState;
}

/** Everything `updateHeroView` needs about "this frame" beyond the entity
 * itself — supplied once per `draw()` by `GameRenderer`, not recomputed per
 * hero. */
export interface HeroFrameContext {
  /** Real (wall-clock) seconds since the previous draw() — drives every
   * transient/attack/death timer, exactly like `fx/`. */
  dt: number;
  /** This hero's index into `state.heroes` — matches `skillCast.slot`. */
  slot: number;
  /** This frame's collected engine events. */
  events: readonly GameEvent[];
  /** True while the formation anchor advanced this frame — the "marching
   * forward" cue (bigger bob + lean). */
  marching: boolean;
  /**
   * M8 party P6: this hero's display name for the nameplate (shown only for
   * `slot !== 0`), or `null`/omitted to hide it. `Hero` has no identity field
   * beyond its numeric `id` (engine stays untouched, per the render-owns-
   * cosmetics rule) — the renderer resolves this from a name map supplied via
   * `GameRenderer.setHeroDisplayNames()`, the hook the later networking/room
   * wiring will call on cohort membership change. Optional so every existing
   * call site (solo hero, `slot: 0`) keeps compiling unchanged.
   */
  displayName?: string | null;
  /**
   * HOF seasonal rewards (docs/hof-rewards-design.md §3, render wave): this
   * hero's current-season social flex, or `null`/omitted for none. `title` is
   * an already-localized Thai string (e.g. "จ้าวยุทธภพ") shown for ANY slot
   * (unlike `displayName`'s non-primary-only nameplate — a solo player sees
   * their own title too). `champion` gates the rank-1 gold aura
   * (`fx/championAura.ts`, driven by `GameRenderer`/`FxController` off the
   * SAME badge map — see `GameRenderer.setHeroSocialBadges()`), read here only
   * to decide the title-tag TEXT, never the aura itself (that's a continuous
   * fx-layer read, not this view's job). Supplied via
   * `GameRenderer.setHeroSocialBadges()`, mirroring `displayName`'s seam.
   */
  socialBadge?: { title: string | null; champion: boolean } | null;
}

export function createHeroView(): HeroView {
  const view = new Container() as HeroView;
  view.cls = null;

  const bodyRoot = new Container();
  bodyRoot.pivot.set(0, FEET_Y);
  bodyRoot.position.set(0, FEET_Y);

  const legBack = new Graphics();
  const legFront = new Graphics();
  legBack.pivot.set(0, HIP_Y);
  legBack.position.set(0, HIP_Y);
  legFront.pivot.set(0, HIP_Y);
  legFront.position.set(0, HIP_Y);

  const upperBody = new Container();
  upperBody.pivot.set(0, HIP_Y);
  upperBody.position.set(0, HIP_Y);

  const torso = new Graphics();
  // Pivot/position pair (cancels at rotation=0, same convention as every
  // other rig container — see the module doc comment) so `torso.rotation`
  // can be nudged a tiny amount for the mage's cast-hold robe/hat flutter
  // (item 12) without disturbing the rest-pose bounds `rig.test.ts` checks.
  torso.pivot.set(0, HEAD_Y);
  torso.position.set(0, HEAD_Y);
  const offArm = new Graphics();
  const weaponArm = new Graphics();
  offArm.pivot.set(0, SHOULDER_Y);
  offArm.position.set(0, SHOULDER_Y);
  weaponArm.pivot.set(0, SHOULDER_Y);
  weaponArm.position.set(0, SHOULDER_Y);

  // Tier-2 (M5 evolution) identity accent — a separate, initially-empty
  // Graphics alongside torso/offArm/weaponArm (never drawn into until the
  // hero's tier actually flips; see `buildTierAccent()`). Starts `visible =
  // false`: an EMPTY Graphics still contributes a bounds point at its own
  // local origin (which resolves near world y≈0 through the parent chain,
  // same footgun class `rig.test.ts` guards against) even with nothing
  // drawn, so a tier-1 hero must exclude it from `bodyRoot.getBounds()`
  // entirely rather than rely on "empty == invisible-ish".
  const tierAccent = new Graphics();
  tierAccent.visible = false;

  // M7 gear paper-doll: `gearWeapon` is a plain (pivot/position default 0,0)
  // child of `weaponArm` — since a child with no pivot/position offset of
  // its own is a transform no-op, drawing into it with the SAME absolute
  // coordinates `buildRig`'s arm-line uses lines up identically (see the
  // module doc comment's "GEAR PAPER-DOLL" section) while still inheriting
  // every attack anim's rotation for free. `gearArmor` is a sibling of
  // `torso` (same convention as `tierAccent` above) so it only follows
  // body lean/bob/breathe, never a swing.
  const gearWeapon = new Graphics();
  weaponArm.addChild(gearWeapon);
  // Ninja-only off-hand dagger — a plain child of `offArm` (same "no
  // pivot/position offset of its own" no-op-transform trick as `gearWeapon`
  // above), so it inherits the off-arm's own swing for free. Starts hidden;
  // `buildGearWeapon`'s ninja branch is the only place that ever draws into
  // or shows it (every other class leaves it permanently empty+invisible —
  // same "empty Graphics must be excluded via visible=false" rule `gearArmor`
  // below already follows).
  const gearOffWeapon = new Graphics();
  gearOffWeapon.visible = false;
  offArm.addChild(gearOffWeapon);
  const gearArmor = new Graphics();
  gearArmor.visible = false; // stays hidden until `buildGearArmor` actually draws something

  upperBody.addChild(torso, gearArmor, offArm, weaponArm, tierAccent);
  bodyRoot.addChild(legBack, legFront, upperBody);

  const hpBar = new Graphics();
  const reviveRing = new Graphics();
  const reviveLabel = new Text({
    text: "",
    style: {
      fontSize: 12,
      fontWeight: "700",
      fill: PALETTE.ivory,
      fontFamily: "monospace",
    },
  });
  reviveLabel.anchor.set(0.5);
  reviveLabel.position.set(0, HEAD_Y - 18);

  // Tier-2 idle aura — ground-anchored, top-level (upright regardless of
  // body lean/death-fall), invisible until `buildAuraRing()` runs.
  const auraRing = new Graphics();
  auraRing.position.set(0, GROUND_Y - 2);
  auraRing.visible = false;

  // M8 party P6: nameplate (non-primary heroes) + shadow "ออฟไลน์" tag — both
  // top-level (upright regardless of body lean/death-fall/shadow dim, same
  // convention as `hpBar`/`reviveLabel`), hidden until `updateHeroView` has
  // something to show.
  const nameplate = new Text({
    text: "",
    style: {
      fontSize: 10,
      fontWeight: "600",
      fill: PALETTE.muted,
      fontFamily: "monospace",
    },
  });
  nameplate.anchor.set(0.5);
  nameplate.position.set(0, NAMEPLATE_Y);
  nameplate.visible = false;

  const shadowTag = new Text({
    text: "ออฟไลน์",
    style: {
      fontSize: 9,
      fontWeight: "600",
      fill: PALETTE.shadowedTint,
      fontFamily: "sans-serif",
    },
  });
  shadowTag.anchor.set(0.5);
  shadowTag.position.set(0, SHADOW_TAG_Y);
  shadowTag.visible = false;

  // HOF seasonal rewards (render wave): title tag, shown for ANY hero slot —
  // see `HeroView.socialTitle`'s doc comment. Gold text (flat fill, no
  // gradient), hidden until `updateHeroView` has a title to show.
  const socialTitle = new Text({
    text: "",
    style: {
      fontSize: 10,
      fontWeight: "700",
      fill: PALETTE.gold,
      fontFamily: "sans-serif",
    },
  });
  socialTitle.anchor.set(0.5);
  socialTitle.position.set(0, TITLE_TAG_Y);
  socialTitle.visible = false;

  view.addChild(
    bodyRoot,
    auraRing,
    hpBar,
    reviveRing,
    reviveLabel,
    nameplate,
    shadowTag,
    socialTitle,
  );

  view.bodyRoot = bodyRoot;
  view.legBack = legBack;
  view.legFront = legFront;
  view.upperBody = upperBody;
  view.torso = torso;
  view.offArm = offArm;
  view.weaponArm = weaponArm;
  view.gearWeapon = gearWeapon;
  view.gearOffWeapon = gearOffWeapon;
  view.gearArmor = gearArmor;
  view.gearWeaponTier = 1;
  view.gearWeaponRarity = "common";
  view.gearArmorTier = 1;
  view.gearArmorRarity = "common";
  view.tierAccent = tierAccent;
  view.auraRing = auraRing;
  view.hpBar = hpBar;
  view.reviveRing = reviveRing;
  view.reviveLabel = reviveLabel;
  view.nameplate = nameplate;
  view.shadowTag = shadowTag;
  view.socialTitle = socialTitle;
  view.anim = {
    initialized: false,
    lastX: 0,
    walkPhase: 0,
    breathPhase: Math.random() * Math.PI * 2, // de-sync the 3 heroes' breathing
    leanCurrent: 0,
    lastCd: 0,
    wasDead: false,
    deathT: -1,
    reviveT: -1,
    attack: null,
    comboIndex: 0,
    shotPoseIndex: 0,
    attackSeq: 0,
    tierBuilt: 1,
    facing: 1,
    sinceFlip: FACING_MIN_FLIP_INTERVAL,
    gearWeaponId: null,
    gearArmorId: null,
    gearInitialized: false,
    shadowProgress: 0,
    joinFlashT: -1,
  };
  return view;
}

/**
 * One-time geometry + color build for `cls` — never touched again after this
 * (only transforms/tint change per frame from here on).
 *
 * IMPORTANT — absolute coordinates only, even though every part below lives
 * inside a container whose `pivot` is also non-zero (hip/shoulder/feet):
 * Pixi's transform is `parent = position + R·(local − pivot)`. Every rig
 * container here is set up with `pivot === position` (see `createHeroView`),
 * which makes it a pure ROTATION-about-that-point with zero net translation
 * at rest — Pixi already performs the `local − pivot` subtraction. Drawing a
 * part's Graphics path pre-subtracted (e.g. `HEAD_Y - HIP_Y`) subtracts the
 * SAME offset a second time, collapsing everything toward world y≈0 (the
 * exact "hero parts floating near the top of the sky" bug this replaced).
 * The fix: every coordinate below is the plain absolute constant
 * (HIP_Y/HEAD_Y/SHOULDER_Y/GROUND_Y), identical to the old flat stick
 * figure's numbers — verified against real Pixi bounds in
 * `src/render/views/__tests__/rig.test.ts`.
 */
function buildRig(view: HeroView, cls: HeroClass): void {
  const colors = HERO_COLORS[cls];

  // Legs: a straight hip->foot segment each; the walk cycle swings them via
  // `.rotation` around the hip pivot set in createHeroView. A small
  // shade-tone boot cap at the foot keeps the silhouette from just fading to
  // a bare line tip.
  for (const leg of [view.legBack, view.legFront]) {
    leg
      .moveTo(0, HIP_Y)
      .lineTo(0, FEET_Y)
      .stroke({ width: 2.6, color: colors.body, cap: "round" });
    leg
      .moveTo(-1.6, FEET_Y)
      .lineTo(1.6, FEET_Y)
      .stroke({ width: 2.6, color: colors.shade, cap: "round" });
  }

  // Torso: class-specific armor/robe/cloak block (drawn first, so it sits
  // BEHIND the spine+head below), then the shared spine+head, then a
  // class-specific head topper (helm/hood/hat) + minimal face. All absolute
  // coordinates — `upperBody.pivot = (0, HIP_Y)` handles the hip rotation;
  // every extra shape here is just another draw call into the SAME `torso`
  // Graphics (no new display objects — build-once/transform-only per the
  // module doc comment).
  const t = view.torso;

  if (cls === "swordsman") {
    // Chest plate + pauldrons — flat armor block over the spine.
    t.roundRect(-4, SHOULDER_Y - 1, 8, HIP_Y - SHOULDER_Y - 3, 2)
      .fill(colors.light)
      .stroke({ width: 1, color: PALETTE.outline, alpha: 0.5 });
    t.circle(-4.5, SHOULDER_Y, 3.2).fill(colors.light);
    t.circle(4.5, SHOULDER_Y, 3.2).fill(colors.light);
  } else if (cls === "archer") {
    // Cloak drape (back triangle) + quiver + fletching pokes, drawn first so
    // the spine/hood render on top of it.
    t.poly([-6, SHOULDER_Y, -10, HIP_Y - 2, -2, HIP_Y + 2, 2, SHOULDER_Y + 2], true).fill(
      {
        color: colors.shade,
        alpha: 0.9,
      },
    );
    t.moveTo(-8, SHOULDER_Y - 2)
      .lineTo(-4, SHOULDER_Y - 15)
      .stroke({ width: 4, color: colors.shade, cap: "round" });
    t.moveTo(-4, SHOULDER_Y - 15)
      .lineTo(-2.5, SHOULDER_Y - 20)
      .stroke({ width: 1.2, color: colors.light, cap: "round" });
    t.moveTo(-4, SHOULDER_Y - 14)
      .lineTo(-5.5, SHOULDER_Y - 19)
      .stroke({ width: 1.2, color: colors.light, cap: "round" });
  } else if (cls === "ninja") {
    // Fitted dark wrap top (narrower than a full robe — "thin agile
    // silhouette" per docs/ninja-design.md §7) + a diagonal dagger-sheath
    // strap, plus a trailing scarf ribbon drawn first so it sits behind the
    // body (-x side, same "drawn first = further back" convention the
    // archer's cloak drape above uses).
    t.poly(
      [-3, SHOULDER_Y, -9, SHOULDER_Y + 9, -4, SHOULDER_Y + 15, -1, SHOULDER_Y + 6],
      true,
    ).fill({ color: colors.shade, alpha: 0.85 });
    t.roundRect(-3.4, SHOULDER_Y - 1, 6.8, HIP_Y - SHOULDER_Y - 2, 2).fill(colors.body);
    t.moveTo(-3, SHOULDER_Y + 1)
      .lineTo(3, HIP_Y - 4)
      .stroke({ width: 1.4, color: colors.shade, alpha: 0.85, cap: "round" });
  } else {
    // Robe body — wide hem stopping above the knee so leg-swing stays
    // legible under it — plus a belt/sash at the waist.
    const hemY = HIP_Y + (FEET_Y - HIP_Y) * 0.45;
    t.poly([-3, SHOULDER_Y, 3, SHOULDER_Y, 9, hemY, -9, hemY], true).fill(colors.body);
    t.moveTo(-9, hemY)
      .lineTo(9, hemY)
      .stroke({ width: 1.4, color: colors.light, alpha: 0.8, cap: "round" });
    t.roundRect(-6, HIP_Y - 3, 12, 3, 1).fill(colors.shade);
    t.circle(0, HIP_Y - 1.5, 1.3).fill(colors.light);
  }

  t.moveTo(0, HEAD_Y + 6)
    .lineTo(0, HIP_Y)
    .stroke({ width: 2.6, color: colors.body, cap: "round" });
  t.circle(0, HEAD_Y, HEAD_R).fill(colors.body);

  if (cls === "swordsman") {
    // Two-tone open-face helm: a light cap over the top half of the head, a
    // short plume, and a thin visor-slit — minimal "there's a face" cue.
    t.poly(arcFanPoints(0, HEAD_Y, HEAD_R + 1, Math.PI, Math.PI * 2), true).fill(
      colors.light,
    );
    t.poly(
      [-2, HEAD_Y - HEAD_R - 1, 2, HEAD_Y - HEAD_R - 1, 0, HEAD_Y - HEAD_R - 8],
      true,
    ).fill(colors.light);
    t.moveTo(-3, HEAD_Y + 1)
      .lineTo(3, HEAD_Y + 1)
      .stroke({ width: 1.3, color: PALETTE.outline, alpha: 0.7, cap: "round" });
  } else if (cls === "archer") {
    // Hood: a shaded back-peak layered behind a body-tone rim, a shadowed
    // "face pocket", and a pair of eye dots peeking out on the +x
    // (heroes-face-right) side.
    t.poly(
      [
        -HEAD_R - 2,
        HEAD_Y + 2,
        HEAD_R - 2,
        HEAD_Y + 2,
        HEAD_R,
        HEAD_Y - HEAD_R - 1,
        -1,
        HEAD_Y - HEAD_R - 7,
        -HEAD_R - 5,
        HEAD_Y - 3,
      ],
      true,
    ).fill(colors.shade);
    t.circle(0, HEAD_Y, HEAD_R + 1).fill(colors.body);
    t.circle(HEAD_R * 0.3, HEAD_Y + 1, HEAD_R * 0.6).fill({
      color: colors.shade,
      alpha: 0.6,
    });
    t.circle(HEAD_R * 0.55, HEAD_Y - 1, 1).fill(PALETTE.outline);
    t.circle(HEAD_R * 0.55, HEAD_Y + 2, 1).fill(PALETTE.outline);
  } else if (cls === "ninja") {
    // Wrapped headband (with two short trailing tails on the -x/back side) +
    // a lower-face mask, a single eye-slit peeking out on the +x
    // (heroes-face-right) side — reads as "shadow-clad", distinct from the
    // archer's hood/mage's hat.
    t.moveTo(-HEAD_R - 1, HEAD_Y - 1)
      .lineTo(HEAD_R + 1, HEAD_Y - 1)
      .stroke({ width: 2.4, color: colors.shade, cap: "round" });
    t.poly(
      [-HEAD_R - 1, HEAD_Y - 1, -HEAD_R - 6, HEAD_Y + 2, -HEAD_R - 3, HEAD_Y - 4],
      true,
    ).fill({ color: colors.shade, alpha: 0.85 });
    t.circle(0, HEAD_Y + 2.5, HEAD_R * 0.72).fill({ color: colors.shade, alpha: 0.55 }); // mask
    t.moveTo(HEAD_R * 0.2, HEAD_Y - 0.5)
      .lineTo(HEAD_R * 0.75, HEAD_Y - 0.5)
      .stroke({ width: 1.2, color: PALETTE.outline, cap: "round" }); // eye-slit
  } else {
    // Pointed hat: flat brim + a forward-leaning cone + a thin band, plus a
    // peeking pair of eye dots below the brim.
    t.poly([-10, HEAD_Y + 1, 10, HEAD_Y + 1, 8, HEAD_Y + 3, -8, HEAD_Y + 3], true).fill(
      colors.shade,
    );
    t.poly([-6, HEAD_Y - 3, 6, HEAD_Y - 3, 1, HEAD_Y - 22], true).fill(colors.body);
    t.moveTo(-4, HEAD_Y - 9)
      .lineTo(4, HEAD_Y - 9)
      .stroke({ width: 1.3, color: colors.light, alpha: 0.8 });
    t.circle(-1, HEAD_Y, 1).fill(PALETTE.outline);
    t.circle(3, HEAD_Y, 1).fill(PALETTE.outline);
  }

  // Off arm: a plain relaxed arm — absolute coordinates (shoulder pivot).
  // Swordsman also gets a small shield strapped to it (off-hand block).
  view.offArm
    .moveTo(0, SHOULDER_Y)
    .lineTo(-9, SHOULDER_Y + 6)
    .stroke({ width: 2.2, color: colors.body, cap: "round" });
  if (cls === "swordsman") {
    view.offArm
      .roundRect(-13.5, SHOULDER_Y + 1, 7, 11, 2)
      .fill(colors.body)
      .stroke({ width: 1, color: PALETTE.outline, alpha: 0.5 });
    view.offArm.circle(-10, SHOULDER_Y + 6.5, 1.4).fill(colors.light);
  }

  // Weapon arm: class-specific ARM SEGMENT ONLY — absolute coordinates
  // (shoulder pivot), same convention as everything above. The weapon HEAD
  // itself (blade/bow/staff) no longer lives here (M7 gear paper-doll): it's
  // drawn into `view.gearWeapon` (a plain child of this SAME Graphics, so it
  // shares this transform for free) by `buildGearWeapon()` below, which is
  // keyed by the hero's EQUIPPED template and rebuilt on every equip change
  // rather than once here — see the "GEAR PAPER-DOLL" module doc comment.
  const g = view.weaponArm;
  if (cls === "swordsman") {
    const hand = WEAPON_HAND.swordsman;
    g.moveTo(0, SHOULDER_Y)
      .lineTo(hand.x, hand.y)
      .stroke({ width: 2.6, color: colors.body, cap: "round" });
  } else if (cls === "archer") {
    const hand = WEAPON_HAND.archer;
    g.moveTo(0, SHOULDER_Y)
      .lineTo(hand.x, hand.y)
      .stroke({ width: 2.4, color: colors.body, cap: "round" });
  } else if (cls === "ninja") {
    const hand = WEAPON_HAND.ninja;
    g.moveTo(0, SHOULDER_Y)
      .lineTo(hand.x, hand.y)
      .stroke({ width: 2.1, color: colors.body, cap: "round" });
  } else {
    const hand = WEAPON_HAND.mage;
    g.moveTo(0, SHOULDER_Y)
      .lineTo(hand.x, hand.y)
      .stroke({ width: 2.4, color: colors.body, cap: "round" });
  }
}

/**
 * M7 gear paper-doll: (re)draw the equipped WEAPON head into
 * `view.gearWeapon` — a child of `weaponArm` (see `createHeroView`), so it
 * inherits every attack anim's rotation/lunge/scale for free without this
 * function knowing anything about attack timing. Called from
 * `updateHeroView` only when `hero.equipped.weapon` actually changes
 * (`HeroAnimState.gearWeaponId`), never per frame. `templateId === null`
 * (nothing equipped) falls back to the plain tier-1/common look — the same
 * bare-weapon glyph every hero has always shown, so an unarmed hero never
 * reads as "no weapon".
 *
 * Growth/ornament escalates with the template's own `tier` (1..6,
 * `@/engine/config/items` — via `GEAR_TIER_SCALE`, NOT `hero.tier`'s M5
 * evolution flag): t1 modest, t6 huge & อลัง (GDD) with an extra flare
 * ornament; `rarity` (common/rare/epic) tints an accent stroke/ornament
 * color (`rarityAccentColor()`) so a glance signals BOTH power band and
 * rarity. Tier-6/epic weapons additionally get the "Super Saiyan" flame aura
 * (`fx/gearAura.ts`, driven continuously from `FxController` via
 * `getWeaponAnchorPos()` below — not drawn here).
 */
/**
 * M7.9 "Grand Expansion": the t7-10 ornament ladder, continuing past the t6
 * break-tier flare (`rarity`-tinted `accent`, drawn by each class branch
 * above/below this) with an escalating halo + orbiting motes in the shared
 * `gearApex`/`gearApexCore` glow family — so a glance signals "past the old
 * t6 ceiling" regardless of the piece's rolled rarity. One shared helper
 * (instead of tripling the branch logic per class) called at each class's
 * own "business end" anchor point (blade tip / bow center / crystal head) —
 * build-once, same convention as every other shape in this function; any
 * continuous per-frame spin/orbit stays `fx/gearAura.ts`'s job, not this
 * one-time path draw. No-op below tier 7 (t1-6 look unchanged). */
function drawApexOrnament(
  g: Graphics,
  tier: number,
  anchor: { x: number; y: number },
  baseR: number,
): void {
  if (tier < 7) return;
  // Deliberately CONSERVATIVE growth relative to `baseR` (already itself
  // tier-scaled via `GEAR_TIER_SCALE`) — this is a halo accent riding the
  // weapon's own footprint, not a second silhouette ballooning past it.
  const step = tier - 6; // 1..4
  const ringR = baseR * (0.45 + step * 0.12); // t7:0.57x .. t10:0.93x baseR
  g.circle(anchor.x, anchor.y, safeRadius(ringR)).stroke({
    width: 1.4 + step * 0.25,
    color: PALETTE.gearApex,
    alpha: 0.5 + (step - 1) * 0.07,
  });
  if (tier >= 8) {
    // A second, tighter inner ring — reads as "layered", not just bigger.
    g.circle(anchor.x, anchor.y, safeRadius(ringR * 0.6)).stroke({
      width: 1,
      color: PALETTE.gearApexCore,
      alpha: 0.6,
    });
  }
  if (tier >= 9) {
    // Orbiting motes fixed at their build-time angle (build-once path — the
    // CONTINUOUS orbit/spin is `fx/gearAura.ts`'s job, not this one-shot draw).
    const moteCount = tier >= 10 ? 5 : 3;
    for (let i = 0; i < moteCount; i++) {
      const a = (Math.PI * 2 * i) / moteCount;
      const mx = anchor.x + Math.cos(a) * ringR * 0.9;
      const my = anchor.y + Math.sin(a) * ringR * 0.9 * 0.5;
      g.circle(mx, my, safeRadius(tier >= 10 ? 2.2 : 1.7)).fill({
        color: PALETTE.gearApexCore,
        alpha: 0.9,
      });
    }
  }
  if (tier >= 10) {
    // Max tier: a brighter outer halo pass — the ladder's visible peak.
    g.circle(anchor.x, anchor.y, safeRadius(ringR * 1.1)).stroke({
      width: 1,
      color: PALETTE.gearApex,
      alpha: 0.35,
    });
  }
}

/** Ninja dagger blade (main OR off hand — see `buildGearWeapon`'s ninja
 * branch), same tapered-poly-via-perpendicular-normal technique as the
 * swordsman's blade above, just shorter/flatter (shortest reach in the game)
 * and mirrorable so the off-hand dagger reads as a natural twin blade rather
 * than a copy-pasted main-hand one. `mirror` flips the blade's x-direction
 * (1 = main hand, points toward +x; -1 = off hand, points toward -x). The
 * main-hand tip formula is mirrored in `weaponAnchorLocal()`'s ninja case
 * below (the tier-6/epic gear-aura anchor hook) — keep the two in sync. */
function drawNinjaDaggerBlade(
  g: Graphics,
  hand: { x: number; y: number },
  mirror: 1 | -1,
  tier: number,
  scale: number,
  rarity: ItemRarity,
  accent: number,
): void {
  const bladeLen = (7 + (tier - 1) * 1.4) * scale * mirror;
  const bladeRise = 9 * scale;
  const tipX = hand.x + bladeLen;
  const tipY = hand.y - bladeRise;
  const dx = tipX - hand.x;
  const dy = tipY - hand.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const px = -ny;
  const py = nx;
  const halfW = 1.5 * (0.9 + scale * 0.1);
  g.poly(
    [
      hand.x + px * halfW,
      hand.y + py * halfW,
      tipX,
      tipY,
      hand.x - px * halfW,
      hand.y - py * halfW,
    ],
    true,
  ).fill(PALETTE.steel);
  const guardLen = 3.2 * scale;
  g.moveTo(hand.x - px * guardLen, hand.y - py * guardLen)
    .lineTo(hand.x + px * guardLen, hand.y + py * guardLen)
    .stroke({ width: 1.6, color: PALETTE.ninjaVioletDark, cap: "round" });
  if (rarity !== "common") {
    g.poly(
      [
        hand.x + px * halfW,
        hand.y + py * halfW,
        tipX,
        tipY,
        hand.x - px * halfW,
        hand.y - py * halfW,
      ],
      true,
    ).stroke({ width: 0.8, color: accent, alpha: 0.85 });
  }
  if (tier >= 6) {
    // "อาวุธใหญ่อลัง" break-tier flare — a small violet wisp off the guard,
    // matching the ninja's own silver-violet fx language (not `swordEmber`).
    const flareLen = guardLen * 1.6;
    g.poly(
      [
        hand.x - px * guardLen,
        hand.y - py * guardLen,
        hand.x - px * flareLen,
        hand.y - py * flareLen - 2,
        hand.x - px * guardLen * 0.7,
        hand.y - py * guardLen * 0.7 - 3,
      ],
      true,
    ).fill(PALETTE.ninjaViolet);
  }
  drawApexOrnament(g, tier, { x: tipX, y: tipY }, Math.abs(bladeLen) * 0.5);
}

function buildGearWeapon(
  view: HeroView,
  cls: HeroClass,
  templateId: string | null,
): void {
  const colors = HERO_COLORS[cls];
  const tpl = templateId ? ITEM_TEMPLATES[templateId] : undefined;
  const tier = tpl?.tier ?? 1;
  const rarity: ItemRarity = tpl?.rarity ?? "common";
  const scale = GEAR_TIER_SCALE[tier] ?? 1;
  const accent = rarityAccentColor(rarity);
  const g = view.gearWeapon;
  g.clear();
  // Ninja-only off-hand dagger (`view.gearOffWeapon`, a child of `offArm` —
  // see `createHeroView`) — every other class leaves it permanently
  // empty+invisible, same "clear + hide" convention `buildGearArmor` uses for
  // an unequipped slot.
  const g2 = view.gearOffWeapon;
  g2.clear();
  g2.visible = cls === "ninja";

  if (cls === "swordsman") {
    const hand = WEAPON_HAND.swordsman;
    // Tapered blade poly, growing in length/rise with tier. Tip position is
    // mirrored in `swordTipLocal()` below (the weapon-trail hook) — keep the
    // two formulas in sync.
    const bladeLen = (12 + (tier - 1) * 2.4) * scale;
    const bladeRise = 20 * scale;
    const tipX = hand.x + bladeLen;
    const tipY = hand.y - bladeRise;
    const dx = tipX - hand.x;
    const dy = tipY - hand.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const px = -ny;
    const py = nx;
    const halfW = 2.2 * (0.9 + scale * 0.1);
    g.poly(
      [
        hand.x + px * halfW,
        hand.y + py * halfW,
        tipX,
        tipY,
        hand.x - px * halfW,
        hand.y - py * halfW,
      ],
      true,
    ).fill(PALETTE.steel);
    const guardLen = 5 * scale;
    g.moveTo(hand.x - px * guardLen, hand.y - py * guardLen)
      .lineTo(hand.x + px * guardLen, hand.y + py * guardLen)
      .stroke({ width: 2.2, color: colors.light, cap: "round" });
    if (rarity !== "common") {
      g.poly(
        [
          hand.x + px * halfW,
          hand.y + py * halfW,
          tipX,
          tipY,
          hand.x - px * halfW,
          hand.y - py * halfW,
        ],
        true,
      ).stroke({ width: 1, color: accent, alpha: 0.85 });
    }
    if (tier >= 6) {
      // "อาวุธใหญ่อลัง" break-tier flare ornament off the crossguard.
      const flareLen = guardLen * 1.7;
      g.poly(
        [
          hand.x - px * guardLen,
          hand.y - py * guardLen,
          hand.x - px * flareLen,
          hand.y - py * flareLen - 3,
          hand.x - px * guardLen * 0.7,
          hand.y - py * guardLen * 0.7 - 4,
        ],
        true,
      ).fill(accent);
      g.poly(
        [
          hand.x + px * guardLen,
          hand.y + py * guardLen,
          hand.x + px * flareLen,
          hand.y + py * flareLen - 3,
          hand.x + px * guardLen * 0.7,
          hand.y + py * guardLen * 0.7 - 4,
        ],
        true,
      ).fill(accent);
    }
    drawApexOrnament(g, tier, { x: tipX, y: tipY }, bladeLen * 0.5);
  } else if (cls === "archer") {
    const hand = WEAPON_HAND.archer;
    const cx = hand.x + 3;
    const cy = hand.y;
    const r = 13 * scale;
    g.arc(cx, cy, r, -1.1, 1.1).stroke({
      width: tier >= 4 ? 2.2 : 1.8,
      color: colors.light,
    });
    const p1x = cx + r * Math.cos(-1.1);
    const p1y = cy + r * Math.sin(-1.1);
    const p2x = cx + r * Math.cos(1.1);
    const p2y = cy + r * Math.sin(1.1);
    const stringX = cx - r * 0.15;
    g.moveTo(p1x, p1y)
      .lineTo(stringX, cy)
      .lineTo(p2x, p2y)
      .stroke({ width: 1, color: PALETTE.steel, alpha: 0.8 });
    const arrowLen = 15 * scale;
    g.moveTo(stringX, cy)
      .lineTo(stringX + arrowLen, cy)
      .stroke({ width: 1.4, color: colors.light, cap: "round" });
    g.poly(
      [
        stringX + arrowLen,
        cy - 2,
        stringX + arrowLen + 4,
        cy,
        stringX + arrowLen,
        cy + 2,
      ],
      true,
    ).fill(PALETTE.steel);
    if (rarity !== "common") {
      // A SECOND `.arc()` call on a Graphics whose pen is already elsewhere
      // (the string/arrow paths just drawn above) blows up `getBounds()` —
      // same footgun class as `Graphics.arc().fill()` (CLAUDE.md #2), just
      // manifesting through `.stroke()`'s miter join instead of a fill
      // collapse. `arcFanPoints()` (point-sampled, no implicit path
      // continuation) sidesteps it entirely — same fix pattern the module
      // already uses for filled arc caps.
      g.poly(arcFanPoints(cx, cy, r, -1.1, 1.1), false).stroke({
        width: 1,
        color: accent,
        alpha: 0.7,
      });
    }
    if (tier >= 6) {
      // Break-tier feathered limb-tip flares.
      g.poly([p1x, p1y, p1x - 3, p1y - 5, p1x + 2, p1y - 3], true).fill(accent);
      g.poly([p2x, p2y, p2x - 3, p2y + 5, p2x + 2, p2y + 3], true).fill(accent);
    }
    drawApexOrnament(g, tier, { x: cx, y: cy }, r * 0.9);
  } else if (cls === "ninja") {
    // Dual daggers (docs/ninja-design.md §7 "มีดคู่สองมือ"): the main-hand
    // blade grows with the equipped tier exactly like every other class's
    // weapon (`view.gearWeapon`, child of `weaponArm`); the off-hand mirror
    // (`view.gearOffWeapon`, child of `offArm`) grows in lockstep off the
    // SAME templateId (one dagger item type, dual-wielded) so both blades
    // always read as matching gear.
    drawNinjaDaggerBlade(g, WEAPON_HAND.ninja, 1, tier, scale, rarity, accent);
    drawNinjaDaggerBlade(g2, NINJA_OFF_HAND, -1, tier, scale, rarity, accent);
  } else {
    const hand = WEAPON_HAND.mage;
    const sx = hand.x;
    const shaftTop = HEAD_Y - 18 - (tier - 1) * 2 * scale;
    const crystalY = shaftTop - 2;
    const crystalR = 3 * scale;
    g.moveTo(sx, shaftTop)
      .lineTo(sx, GROUND_Y - 16)
      .stroke({ width: 2.4, color: colors.body, cap: "round" });
    // Crystal head: layered flat-alpha "glow" rings (no gradients) around a
    // bright core — the cast "pulse" scales `weaponArm` as a whole, so the
    // glow breathes with it for free.
    g.circle(sx, crystalY, safeRadius(crystalR * 2.33)).fill({
      color: colors.light,
      alpha: 0.16,
    });
    g.circle(sx, crystalY, safeRadius(crystalR * 1.67)).fill({
      color: colors.light,
      alpha: 0.32,
    });
    g.circle(sx, crystalY, safeRadius(crystalR)).fill({
      color: colors.light,
      alpha: 0.95,
    });
    g.circle(sx, crystalY, safeRadius(crystalR)).stroke({
      width: 1,
      color: PALETTE.outline,
      alpha: 0.5,
    });
    if (rarity !== "common") {
      g.circle(sx, crystalY, safeRadius(crystalR * 1.67)).stroke({
        width: 1,
        color: accent,
        alpha: 0.7,
      });
    }
    if (tier >= 6) {
      // Break-tier orbiting shard cluster around the crystal head.
      for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
        const ox = Math.cos(a) * crystalR * 2.2;
        const oy = Math.sin(a) * crystalR * 2.2 * 0.6;
        g.circle(sx + ox, crystalY + oy, safeRadius(crystalR * 0.5)).fill({
          color: accent,
          alpha: 0.85,
        });
      }
    }
    drawApexOrnament(g, tier, { x: sx, y: crystalY }, crystalR * 2.2);
  }

  view.gearWeaponTier = tier;
  view.gearWeaponRarity = rarity;
}

/**
 * M7 gear paper-doll: (re)draw the equipped ARMOR accent overlay into
 * `view.gearArmor` — a sibling of `torso` under `upperBody` (same
 * absolute-coordinate convention `buildTierAccent` already uses), so it only
 * follows body lean/bob/breathe, never a swing. Called from
 * `updateHeroView` only when `hero.equipped.armor` changes
 * (`HeroAnimState.gearArmorId`). `templateId === null` clears the overlay —
 * the bare class silhouette `buildRig` already draws is the unarmored look,
 * exactly as it was pre-M7.
 *
 * Tier-5+ armor additionally gets the looping sparkle/glint fx
 * (`fx/gearSparkle.ts`, driven continuously from `FxController` via
 * `getArmorAnchorPos()` below — not drawn here).
 */
function buildGearArmor(view: HeroView, cls: HeroClass, templateId: string | null): void {
  const g = view.gearArmor;
  g.clear();
  if (!templateId) {
    // An EMPTY but VISIBLE Graphics still contributes a bounds point at its
    // own local origin (the exact footgun `tierAccent`'s doc comment warns
    // about) — hide it outright rather than leaving nothing drawn.
    g.visible = false;
    view.gearArmorTier = 1;
    view.gearArmorRarity = "common";
    return;
  }
  g.visible = true;
  const tpl = ITEM_TEMPLATES[templateId];
  const tier = tpl?.tier ?? 1;
  const rarity: ItemRarity = tpl?.rarity ?? "common";
  const scale = GEAR_TIER_SCALE[tier] ?? 1;
  const accent = rarityAccentColor(rarity);

  if (cls === "swordsman") {
    const padR = 3.2 * (0.9 + scale * 0.2);
    g.roundRect(-4 * scale, SHOULDER_Y - 1, 8 * scale, HIP_Y - SHOULDER_Y - 3, 2).stroke({
      width: 1.2,
      color: accent,
      alpha: 0.9,
    });
    g.circle(-4.5, SHOULDER_Y, safeRadius(padR)).stroke({
      width: 1.2,
      color: accent,
      alpha: 0.9,
    });
    g.circle(4.5, SHOULDER_Y, safeRadius(padR)).stroke({
      width: 1.2,
      color: accent,
      alpha: 0.9,
    });
  } else if (cls === "archer") {
    g.circle(-2, SHOULDER_Y - 1, safeRadius(4 * scale)).fill({
      color: accent,
      alpha: 0.18,
    });
    g.circle(-2, SHOULDER_Y - 1, safeRadius(2.4 * scale)).fill({
      color: accent,
      alpha: 0.6,
    });
    g.circle(-2, SHOULDER_Y - 1, safeRadius(1.2)).fill({ color: 0xffffff, alpha: 0.9 });
    g.moveTo(-6, SHOULDER_Y - 2)
      .lineTo(-10, HIP_Y - 2)
      .stroke({ width: 1, color: accent, alpha: 0.75 });
  } else if (cls === "ninja") {
    // Rarity-tinted trim tracing the diagonal dagger-sheath strap
    // (`buildRig`'s ninja torso) + a small clasp at the scarf's shoulder tie.
    g.moveTo(-3 * scale, SHOULDER_Y + 1 * scale)
      .lineTo(3 * scale, HIP_Y - 4 * scale)
      .stroke({ width: 1.2, color: accent, alpha: 0.85 });
    g.circle(-3, SHOULDER_Y, safeRadius(2.2 * scale)).stroke({
      width: 1,
      color: accent,
      alpha: 0.8,
    });
  } else {
    g.circle(0, SHOULDER_Y - 2, safeRadius(4 * scale)).fill({
      color: accent,
      alpha: 0.18,
    });
    g.circle(0, SHOULDER_Y - 2, safeRadius(2.4 * scale)).fill({
      color: accent,
      alpha: 0.6,
    });
    g.circle(0, SHOULDER_Y - 2, safeRadius(1.2)).fill({ color: 0xffffff, alpha: 0.9 });
    g.moveTo(-6, HEAD_Y - 9)
      .lineTo(6, HEAD_Y - 9)
      .stroke({ width: 1.6, color: accent, alpha: 0.9 });
  }

  // M7.9 "Grand Expansion": t7-10 apex halo, class-agnostic (every branch
  // above centers its own accent near `SHOULDER_Y`) — a small continuation
  // of `drawApexOrnament`'s weapon-side ladder so a heavily-geared t7-10 hero
  // reads as "past t6" on the armor silhouette too, not just the weapon.
  if (tier >= 8) {
    const haloR = 5 + (tier - 8) * 1.6;
    g.circle(0, SHOULDER_Y - 3, safeRadius(haloR)).stroke({
      width: 1.2,
      color: PALETTE.gearApex,
      alpha: 0.5,
    });
  }
  if (tier >= 10) {
    g.circle(0, SHOULDER_Y - 3, safeRadius(11)).stroke({
      width: 1,
      color: PALETTE.gearApexCore,
      alpha: 0.6,
    });
  }

  view.gearArmorTier = tier;
  view.gearArmorRarity = rarity;
}

// ---------------------------------------------------------------------------
// Tier-2 (M5 "class advancement / evolution", 86d3jv7m3) identity accent —
// MODEST per-class add-ons (gold trim / small cape / brighter jewel accent)
// plus a shared subtle idle aura, all drawn into the dedicated `tierAccent`/
// `auraRing` Graphics added in `createHeroView` (never touching `torso`/
// `offArm`/`weaponArm`'s already-built paths). Triggered ONCE on the
// `HeroAnimState.tierBuilt` edge in `updateHeroView` below — a hero can
// evolve well after its rig was first built, so this can't ride `buildRig`'s
// cls-gated one-time call. All absolute GROUND_Y-relative coordinates, same
// convention as `buildRig` (see its doc comment for why).
// ---------------------------------------------------------------------------

/** Shared gold accent color for every class's tier-2 trim — reads as "the
 * evolution color" regardless of class, same jewel-tone-against-desaturated-
 * scenery logic the render README's art direction calls for. */
const TIER_ACCENT_GOLD = PALETTE.gold;

/** One-time per-class tier-2 detail pass into `view.tierAccent`. */
function buildTierAccent(view: HeroView, cls: HeroClass): void {
  const colors = HERO_COLORS[cls];
  const g = view.tierAccent;
  g.clear();
  g.visible = true;

  if (cls === "swordsman") {
    // Gold trim tracing the existing chest plate + pauldrons (stroke only —
    // sits on top of the armor fill rather than replacing it), plus a small
    // cape drape behind the body (-x side; heroes face +x).
    g.roundRect(-4, SHOULDER_Y - 1, 8, HIP_Y - SHOULDER_Y - 3, 2).stroke({
      width: 1,
      color: TIER_ACCENT_GOLD,
      alpha: 0.85,
    });
    g.circle(-4.5, SHOULDER_Y, 3.2).stroke({
      width: 1,
      color: TIER_ACCENT_GOLD,
      alpha: 0.85,
    });
    g.circle(4.5, SHOULDER_Y, 3.2).stroke({
      width: 1,
      color: TIER_ACCENT_GOLD,
      alpha: 0.85,
    });
    g.poly([-5, SHOULDER_Y + 1, -12, HIP_Y - 3, -4, HIP_Y + 3], true).fill({
      color: colors.shade,
      alpha: 0.9,
    });
    g.moveTo(-5, SHOULDER_Y + 1)
      .lineTo(-12, HIP_Y - 3)
      .stroke({ width: 1, color: TIER_ACCENT_GOLD, alpha: 0.8 });
  } else if (cls === "archer") {
    // Brighter jewel accent: a small glowing gem clasp at the collar (same
    // layered-alpha "glow" vocabulary the mage's staff crystal uses) plus a
    // thin gold trim line along the cloak edge.
    g.circle(-2, SHOULDER_Y - 1, safeRadius(4)).fill({
      color: TIER_ACCENT_GOLD,
      alpha: 0.18,
    });
    g.circle(-2, SHOULDER_Y - 1, safeRadius(2.4)).fill({
      color: TIER_ACCENT_GOLD,
      alpha: 0.55,
    });
    g.circle(-2, SHOULDER_Y - 1, safeRadius(1.2)).fill({ color: 0xffffff, alpha: 0.9 });
    g.moveTo(-6, SHOULDER_Y - 2)
      .lineTo(-10, HIP_Y - 2)
      .stroke({ width: 1, color: TIER_ACCENT_GOLD, alpha: 0.7 });
  } else if (cls === "ninja") {
    // Gold-trimmed headband (tracing `buildRig`'s ninja headband stroke) +
    // gold tips on the trailing scarf ribbon — the shared "evolution gold"
    // motif, kept modest per the class's thin-silhouette identity.
    g.moveTo(-HEAD_R - 1, HEAD_Y - 1)
      .lineTo(HEAD_R + 1, HEAD_Y - 1)
      .stroke({ width: 1, color: TIER_ACCENT_GOLD, alpha: 0.85 });
    g.circle(-4, SHOULDER_Y + 15, safeRadius(1.4)).fill({
      color: TIER_ACCENT_GOLD,
      alpha: 0.8,
    });
  } else {
    // Brighter jewel accent: a glowing gem brooch at the collar (mirrors the
    // archer's, keeping the "evolution gem" motif consistent) plus a gold
    // band trim over the hat.
    g.circle(0, SHOULDER_Y - 2, safeRadius(4)).fill({
      color: TIER_ACCENT_GOLD,
      alpha: 0.18,
    });
    g.circle(0, SHOULDER_Y - 2, safeRadius(2.4)).fill({
      color: TIER_ACCENT_GOLD,
      alpha: 0.55,
    });
    g.circle(0, SHOULDER_Y - 2, safeRadius(1.2)).fill({ color: 0xffffff, alpha: 0.9 });
    g.moveTo(-6, HEAD_Y - 9)
      .lineTo(6, HEAD_Y - 9)
      .stroke({ width: 1.6, color: TIER_ACCENT_GOLD, alpha: 0.85 });
  }
}

/** Ground-level pulsing aura ellipse half-width/half-height — deliberately
 * flattened (a squashed ellipse, not a circle) so it reads as a glow ON the
 * ground rather than a floating halo. */
const AURA_RX = 14;
const AURA_RY = 5;
/** Breathing pulse range (see `updateHeroView`'s aura block) — kept small so
 * this reads as "subtle idle aura", never a strobe. */
const AURA_BASE_ALPHA = 0.75;
const AURA_ALPHA_RANGE = 0.2;
const AURA_SCALE_RANGE = 0.06;

/** One-time build of the tier-2 idle aura shape into `view.auraRing` —
 * layered flat-alpha ellipses (no gradients) in the hero's own class color
 * plus a thin gold rim, breathing via `alpha`/`scale` only from here on (see
 * `updateHeroView`). */
function buildAuraRing(view: HeroView, cls: HeroClass): void {
  const colors = HERO_COLORS[cls];
  const g = view.auraRing;
  g.clear();
  g.ellipse(0, 0, safeRadius(AURA_RX), safeRadius(AURA_RY)).fill({
    color: colors.light,
    alpha: 0.14,
  });
  g.ellipse(0, 0, safeRadius(AURA_RX * 0.6), safeRadius(AURA_RY * 0.6)).fill({
    color: TIER_ACCENT_GOLD,
    alpha: 0.22,
  });
  g.ellipse(0, 0, safeRadius(AURA_RX), safeRadius(AURA_RY)).stroke({
    width: 1,
    color: TIER_ACCENT_GOLD,
    alpha: 0.35,
  });
}

/** Sampled points around a circular arc, for use with `Graphics.poly()` —
 * deliberately NOT `Graphics.arc().fill()`: an arc has no explicit start
 * `moveTo`, and filling one collapses the shape toward the path's stale
 * pen position (world-origin-ish) instead of the arc's own coordinates.
 * `poly()` always builds a fully explicit, self-contained closed shape, so
 * it can't inherit garbage from whatever was drawn immediately before it. */
function arcFanPoints(
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number,
): number[] {
  const segments = 8;
  const pts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = start + ((end - start) * i) / segments;
    pts.push(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
  }
  return pts;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Small overshoot-then-settle curve for the revive "spring back" bounce. */
function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const d = x - 1;
  return 1 + c3 * d * d * d + c1 * d * d;
}

function startAttack(anim: HeroAnimState, kind: AttackKindAnim): void {
  const duration =
    kind === "swing"
      ? SWING_DURATION
      : kind === "spin"
        ? SPIN_DURATION
        : kind === "release"
          ? RELEASE_DURATION
          : kind === "triple"
            ? TRIPLE_DURATION
            : kind === "staffPulse"
              ? STAFF_PULSE_DURATION
              : kind === "dualSlash"
                ? NINJA_SLASH_DURATION
                : CASTHOLD_DURATION;
  anim.attack = { kind, t: 0, duration };
  anim.attackSeq++;
  if (kind === "swing") anim.comboIndex = (anim.comboIndex + 1) % 3;
  else if (kind === "release") anim.shotPoseIndex = (anim.shotPoseIndex + 1) % 2;
  // Ninja dual-slash: 0/1 parity picks which arm LEADS this swing (see the
  // module doc comment above `NINJA_SLASH_DURATION`) — a separate 2-cycle
  // from the swordsman's 0-2 combo above, reusing the same `comboIndex` field.
  else if (kind === "dualSlash") anim.comboIndex = (anim.comboIndex + 1) % 2;
}

interface AttackFx {
  weaponDelta: number;
  offArmDelta: number;
  bobExtra: number;
  lungeX: number;
  weaponScale: number;
}

/** Resolve this frame's attack-driven deltas: weapon-arm rotation delta,
 * off-arm rotation delta, extra body bob, lunge (root x offset), and a
 * weapon-arm scale multiplier (mage's cast "pulse"). All-neutral once no
 * attack is active. */
function resolveAttack(anim: HeroAnimState, dt: number): AttackFx {
  const out: AttackFx = {
    weaponDelta: 0,
    offArmDelta: 0,
    bobExtra: 0,
    lungeX: 0,
    weaponScale: 1,
  };
  const atk = anim.attack;
  if (!atk) return out;

  atk.t += dt;
  if (atk.t >= atk.duration) {
    anim.attack = null;
    return out;
  }
  const progress = clamp01(atk.t / atk.duration);

  switch (atk.kind) {
    case "swing": {
      // 3 visually-distinct swings cycling on combo index (item 1) — same
      // total `SWING_DURATION` regardless of which one plays; only the
      // rotation curve/lunge differ. 0 = up-slash (swings up), 1 =
      // down-slash (mirrored, swings down), 2 = thrust (small arc, big lunge).
      const swing = Math.sin(progress * Math.PI);
      if (anim.comboIndex === 2) {
        out.weaponDelta = swing * SWING_AMPLITUDE * THRUST_SWING_FRAC;
        out.lungeX = swing * LUNGE_PX * THRUST_LUNGE_MULT;
        out.offArmDelta = -swing * THRUST_OFFARM_KICK; // shield braces forward
      } else {
        const sign = anim.comboIndex === 1 ? -1 : 1;
        out.weaponDelta = sign * swing * SWING_AMPLITUDE;
        out.lungeX = swing * LUNGE_PX;
      }
      break;
    }
    case "spin": {
      out.weaponDelta = progress * Math.PI * 2;
      out.bobExtra = Math.sin(progress * Math.PI) * -2;
      break;
    }
    case "dualSlash": {
      // Ninja alternating L/R dagger strike (docs/ninja-design.md §7):
      // `comboIndex` parity (see `startAttack`) picks which arm LEADS this
      // swing — the lead arm gets the full amplitude, the trailing arm
      // mirrors a smaller counter-slash the OPPOSITE direction (both blades
      // read as cutting, not one arm idling).
      const swing = Math.sin(progress * Math.PI);
      const leadSign = anim.comboIndex === 0 ? 1 : -1;
      out.weaponDelta = leadSign * swing * NINJA_SLASH_AMPLITUDE;
      out.offArmDelta = -leadSign * swing * NINJA_SLASH_AMPLITUDE * NINJA_TRAIL_FRAC;
      out.lungeX = swing * NINJA_LUNGE_PX;
      break;
    }
    case "release": {
      // Straight (pose 0) vs high-arc (pose 1, item 8) — bow-angle-only pose
      // variety; the projectile itself still flies per the engine's targeting.
      const extra = anim.shotPoseIndex === 1 ? HIGH_ARC_EXTRA_KICK : 0;
      out.weaponDelta = -Math.sin(progress * Math.PI) * (RELEASE_KICK + extra);
      break;
    }
    case "triple": {
      // Brief draw-and-hold lead-in (item 9), then the existing 3 staggered
      // kick-pulses, now offset by the hold — the bow stays drawn back
      // between pulses instead of snapping to rest.
      if (atk.t < TRIPLE_HOLD_LEAD) {
        const p = clamp01(atk.t / TRIPLE_HOLD_LEAD);
        out.weaponDelta = -easeOutQuad(p) * TRIPLE_HOLD_DRAW_ANGLE;
        break;
      }
      const tLocal = atk.t - TRIPLE_HOLD_LEAD;
      const pulseIdx = Math.min(2, Math.floor(tLocal / (RELEASE_DURATION + TRIPLE_GAP)));
      const localT = tLocal - pulseIdx * (RELEASE_DURATION + TRIPLE_GAP);
      if (localT <= RELEASE_DURATION) {
        const p = clamp01(localT / RELEASE_DURATION);
        out.weaponDelta = -TRIPLE_HOLD_DRAW_ANGLE - Math.sin(p * Math.PI) * RELEASE_KICK;
      } else {
        out.weaponDelta = -TRIPLE_HOLD_DRAW_ANGLE;
      }
      break;
    }
    case "staffPulse": {
      const wave = Math.sin(progress * Math.PI);
      out.weaponDelta = -wave * STAFF_RAISE;
      out.weaponScale = 1 + wave * STAFF_PULSE_SCALE;
      break;
    }
    case "castHold": {
      const rise =
        progress < CASTHOLD_RISE_FRAC ? easeOutQuad(progress / CASTHOLD_RISE_FRAC) : 1;
      out.weaponDelta = -rise * CASTHOLD_RAISE;
      out.offArmDelta = -rise * CASTHOLD_RAISE;
      break;
    }
  }
  return out;
}

/** Redraw an existing hero view in place for the current frame's state. */
export function updateHeroView(view: HeroView, hero: Hero, ctx: HeroFrameContext): void {
  if (view.cls !== hero.cls) {
    view.cls = hero.cls;
    buildRig(view, hero.cls);
    view.anim.gearInitialized = false; // force a gear rebuild — anchors are class-specific
  }

  const anim = view.anim;
  const dt = Math.max(0, ctx.dt);

  // ---- M7 gear paper-doll: rebuild ONLY when the equipped templateId
  // actually changed (or on this view's first frame, incl. a save that loads
  // already geared) — never a per-frame path rebuild. See the module doc
  // comment's "GEAR PAPER-DOLL" section / `buildGearWeapon`/`buildGearArmor`.
  if (!anim.gearInitialized || anim.gearWeaponId !== hero.equipped.weapon) {
    anim.gearWeaponId = hero.equipped.weapon;
    buildGearWeapon(view, hero.cls, hero.equipped.weapon);
  }
  if (!anim.gearInitialized || anim.gearArmorId !== hero.equipped.armor) {
    anim.gearArmorId = hero.equipped.armor;
    buildGearArmor(view, hero.cls, hero.equipped.armor);
  }
  anim.gearInitialized = true;

  // ---- tier-2 (M5 evolution) identity accent: one-time build on the edge --
  // A hero can evolve long after its rig was first built, so this can't ride
  // `buildRig`'s cls-gated call above — it watches `hero.tier` directly and
  // fires once the first time it exceeds what's already been built (also
  // covers a save loaded already at tier 2, whose first frame here has
  // `tierBuilt` still at its default 1).
  if (anim.tierBuilt < hero.tier) {
    anim.tierBuilt = hero.tier;
    if (hero.tier === 2) {
      buildTierAccent(view, hero.cls);
      buildAuraRing(view, hero.cls);
    }
  }

  if (!anim.initialized) {
    anim.initialized = true;
    anim.lastX = hero.x;
    anim.lastCd = hero.cd;
    anim.wasDead = hero.dead;
    // M8 party P6: state-driven initial shadow value — a hero that spawns
    // ALREADY shadowed (e.g. a re-seed) shows no fade-in pop; the 0.4s ease
    // only plays when the flag flips while this view is already on screen
    // (see the shadow-progress block below).
    anim.shadowProgress = hero.shadowed ? 1 : 0;
    // "A new hero view just appeared" — the nameplate join-flash half of the
    // party-join juice (the ring-ping half is `fx/FxController.ts`'s own
    // first-sight mark-and-sweep, keyed off the same moment).
    anim.joinFlashT = 0;
  }

  // ---- death / revive transition detection -------------------------------
  if (hero.dead && !anim.wasDead) {
    anim.deathT = 0;
    anim.attack = null;
  } else if (!hero.dead && anim.wasDead) {
    anim.reviveT = 0;
    setGhostTint(view, false);
  }
  anim.wasDead = hero.dead;

  // ---- shadow-body progress: ease toward hero.shadowed ? 1 : 0 -----------
  const shadowTarget = hero.shadowed ? 1 : 0;
  const shadowStep = dt / SHADOW_FADE_DURATION;
  if (anim.shadowProgress < shadowTarget) {
    anim.shadowProgress = Math.min(shadowTarget, anim.shadowProgress + shadowStep);
  } else if (anim.shadowProgress > shadowTarget) {
    anim.shadowProgress = Math.max(shadowTarget, anim.shadowProgress - shadowStep);
  }

  // ---- locomotion: derive velocity from actual position delta ------------
  const velocity = dt > 0 ? (hero.x - anim.lastX) / dt : 0;
  anim.lastX = hero.x;
  const speedFrac = clamp01(Math.abs(velocity) / CONFIG.heroMove);

  // Rig flip — "face the target while fighting, movement direction while merely
  // walking" (owner-approved Option A). Priority:
  //  1. In COMBAT (`hero.aimX` set): face the engine's per-step combat aim, so a
  //     ranged hero KITING away still faces (and fires at) its foe instead of
  //     flipping to its retreat velocity ("spin when surrounded" + "shoots
  //     backwards" bugs). A small deadband holds facing when a foe is right on
  //     top of the hero (|aimX − x| ≈ 0) so it doesn't jitter.
  //  2. WALKING (aim null): the velocity rule, but debounced by a flip-interval
  //     hysteresis so an alternating walk direction can't strobe the rig.
  // When a target dies and nothing replaces it, `aimX` goes null and velocity is
  // ~0 (holding station), so NEITHER rule re-derives — the last facing is HELD
  // (the documented reason the view keeps no live target reference).
  anim.sinceFlip += dt;
  if (!hero.dead) {
    if (hero.aimX !== null) {
      const dx = hero.aimX - hero.x;
      if (Math.abs(dx) > AIM_FACING_DEADBAND) {
        const want: 1 | -1 = dx > 0 ? 1 : -1;
        if (want !== anim.facing) {
          anim.facing = want;
          anim.sinceFlip = 0;
        }
      }
    } else if (speedFrac >= FACING_SPEED_THRESHOLD) {
      const want: 1 | -1 = velocity > 0 ? 1 : -1;
      if (want !== anim.facing && anim.sinceFlip >= FACING_MIN_FLIP_INTERVAL) {
        anim.facing = want;
        anim.sinceFlip = 0;
      }
    }
  }
  view.bodyRoot.scale.x = anim.facing;

  anim.walkPhase += dt * (WALK_FREQ_BASE + speedFrac * WALK_FREQ_RANGE);
  anim.breathPhase += dt * BREATH_SPEED;

  const legSwing = LEG_SWING_MAX * speedFrac;
  const idleWobble = Math.sin(anim.breathPhase * 0.6) * IDLE_SWAY;
  view.legBack.rotation =
    IDLE_LEG_BACK + Math.sin(anim.walkPhase) * legSwing + idleWobble;
  view.legFront.rotation =
    IDLE_LEG_FRONT + Math.sin(anim.walkPhase + Math.PI) * legSwing - idleWobble;

  const marchBoost = ctx.marching ? MARCH_BOB_BOOST : 1;
  const leanBoost = ctx.marching ? MARCH_LEAN_BOOST : 1;
  const walkBob =
    Math.abs(Math.sin(anim.walkPhase)) * BOB_AMPLITUDE * speedFrac * marchBoost;
  const idleBob = Math.sin(anim.breathPhase) * 0.5;
  const leanTarget = hero.dead ? 0 : LEAN_WALK * speedFrac * leanBoost;
  anim.leanCurrent += (leanTarget - anim.leanCurrent) * clamp01(dt * LEAN_SMOOTH);

  const breathScale = 1 + Math.sin(anim.breathPhase) * BREATH_SCALE_AMPLITUDE;

  // ---- attack-anim triggers ------------------------------------------------
  if (!hero.dead) {
    let skillCastThisHero = false;
    for (const ev of ctx.events) {
      if (ev.type === "skillCast" && ev.slot === ctx.slot) {
        skillCastThisHero = true;
        if (hero.cls === "swordsman") startAttack(anim, "spin");
        else if (hero.cls === "archer") startAttack(anim, "triple");
        // Ninja: every skill (dash/twinfang/chaindash/eternal) resolves as a
        // strike, so all 4 play the same snappy dual-slash pose — the actual
        // dash reposition/chain hops are their own shadow-streak fx
        // (`heroDashed` -> `fx/shadowDash.ts`), not a rig animation.
        else if (hero.cls === "ninja") startAttack(anim, "dualSlash");
        else startAttack(anim, "castHold");
      }
    }
    if (!skillCastThisHero) {
      for (const ev of ctx.events) {
        if (
          ev.type === "projectileSpawn" &&
          ev.kind === "arrow" &&
          hero.cls === "archer"
        ) {
          startAttack(anim, "release");
        } else if (
          ev.type === "projectileSpawn" &&
          ev.kind === "orb" &&
          hero.cls === "mage"
        ) {
          startAttack(anim, "staffPulse");
        }
      }
    }
    // Swordsman/ninja basic melee has no dedicated event — a same-tick `cd`
    // RESET (jumping back up instead of ticking down) is the tell (ninja
    // shares this convention: shortest range, no projectile, per
    // docs/ninja-design.md §1).
    if (hero.cls === "swordsman" && hero.cd > anim.lastCd + 1e-4) {
      startAttack(anim, "swing");
    } else if (hero.cls === "ninja" && hero.cd > anim.lastCd + 1e-4) {
      startAttack(anim, "dualSlash");
    }
  }
  anim.lastCd = hero.cd;

  const attackFx = resolveAttack(anim, dt);

  // ---- compose upperBody transform -----------------------------------------
  view.upperBody.position.set(0, HIP_Y + walkBob + idleBob + attackFx.bobExtra);
  view.upperBody.rotation = anim.leanCurrent;
  view.upperBody.scale.set(breathScale, breathScale);

  const armSwing = ARM_SWING_MAX * speedFrac * 0.6;
  const restAngle = REST_ANGLE[hero.cls];
  const weaponIdleSway = Math.sin(anim.breathPhase * 0.7) * IDLE_SWAY;

  if (anim.attack) {
    view.weaponArm.rotation = restAngle + attackFx.weaponDelta;
    view.offArm.rotation = OFFARM_REST + attackFx.offArmDelta;
  } else {
    view.weaponArm.rotation =
      restAngle + weaponIdleSway + Math.sin(anim.walkPhase) * armSwing;
    view.offArm.rotation =
      OFFARM_REST + Math.sin(anim.walkPhase + Math.PI) * armSwing - idleWobble;
  }
  view.weaponArm.scale.set(attackFx.weaponScale, attackFx.weaponScale);

  // ---- mage cast-hold robe/hat flutter (item 12) ---------------------------
  // Subtle rotation sway on the torso (hood/hat + robe silhouette) while
  // `castHold` is active — reuses the existing breathing-phase clock, scaled
  // in by the hold's own progress so it eases on/off with the cast rather
  // than popping. Harmless no-op for the other two classes / at rest (torso's
  // pivot===position at rest, see `createHeroView`, so rotation=0 there is
  // exactly the unchanged rest pose `rig.test.ts` checks).
  if (hero.cls === "mage" && anim.attack?.kind === "castHold") {
    const holdFrac = clamp01(anim.attack.t / anim.attack.duration);
    view.torso.rotation =
      Math.sin(anim.breathPhase * 1.6) * CASTHOLD_SWAY_AMPLITUDE * holdFrac;
  } else {
    view.torso.rotation = 0;
  }

  // ---- death fall / revive bounce (bodyRoot only — hp/revive UI untouched) --
  if (hero.dead) {
    if (anim.deathT >= 0) {
      anim.deathT += dt;
      const p = clamp01(anim.deathT / DEATH_FALL_DURATION);
      const eased = easeOutQuad(p);
      view.bodyRoot.rotation = eased * DEATH_FALL_ANGLE;
      view.bodyRoot.alpha = 1 - eased * (1 - GHOST_ALPHA);
      if (p >= 1) {
        anim.deathT = -1;
        setGhostTint(view, true);
      }
    }
  } else if (anim.reviveT >= 0) {
    anim.reviveT += dt;
    const p = clamp01(anim.reviveT / REVIVE_BOUNCE_DURATION);
    const eased = easeOutBack(p);
    view.bodyRoot.rotation = DEATH_FALL_ANGLE * (1 - eased);
    view.bodyRoot.alpha = GHOST_ALPHA + (1 - GHOST_ALPHA) * clamp01(p * 1.4);
    if (p >= 1) {
      anim.reviveT = -1;
      view.bodyRoot.rotation = 0;
      view.bodyRoot.alpha = 1;
    }
  } else {
    view.bodyRoot.rotation = 0;
    view.bodyRoot.alpha = 1;
  }

  // ---- shadow-body dim (M8 party P6): multiplies whatever alpha the death/
  // revive block above just set — composes, never overwrites (a shadowed
  // hero mid-death-fall still fades correctly, just dimmer throughout). ------
  const shadowDim = 1 - anim.shadowProgress * (1 - SHADOW_ALPHA);
  view.bodyRoot.alpha *= shadowDim;

  // ---- shadow-body desaturation tint: CONTINUOUS while alive (unlike the
  // death ghost tint, which is edge-triggered ONCE — see `setGhostTint`'s doc
  // comment); a dead hero keeps its own ghost tint untouched. Flat-alpha/tint
  // only, no filters (render README rule). -------------------------------
  if (!hero.dead) {
    const shadowTint =
      anim.shadowProgress > 0
        ? lerpColor(0xffffff, PALETTE.shadowedTint, anim.shadowProgress)
        : 0xffffff;
    view.legBack.tint = shadowTint;
    view.legFront.tint = shadowTint;
    view.torso.tint = shadowTint;
    view.offArm.tint = shadowTint;
    view.weaponArm.tint = shadowTint;
    view.tierAccent.tint = shadowTint;
    view.gearWeapon.tint = shadowTint;
    view.gearOffWeapon.tint = shadowTint;
    view.gearArmor.tint = shadowTint;
  }

  // ---- nameplate (non-primary heroes only) + shadow "ออฟไลน์" tag ---------
  const showNameplate = ctx.slot !== 0 && !!ctx.displayName;
  view.nameplate.visible = showNameplate;
  if (showNameplate) view.nameplate.text = ctx.displayName as string;
  view.shadowTag.visible = hero.shadowed;

  // ---- HOF seasonal title tag (ANY slot, incl. solo/primary) --------------
  const titleText = ctx.socialBadge?.title ?? null;
  view.socialTitle.visible = !!titleText;
  if (titleText) view.socialTitle.text = titleText;

  if (anim.joinFlashT >= 0) {
    anim.joinFlashT += dt;
    if (anim.joinFlashT >= JOIN_FLASH_DURATION) {
      anim.joinFlashT = -1;
      view.nameplate.scale.set(1, 1);
      view.nameplate.alpha = NAMEPLATE_ALPHA;
    } else {
      const pulse = Math.sin(clamp01(anim.joinFlashT / JOIN_FLASH_DURATION) * Math.PI);
      view.nameplate.scale.set(
        1 + pulse * JOIN_FLASH_SCALE,
        1 + pulse * JOIN_FLASH_SCALE,
      );
      view.nameplate.alpha = NAMEPLATE_ALPHA + pulse * JOIN_FLASH_ALPHA;
    }
  } else {
    view.nameplate.alpha = NAMEPLATE_ALPHA;
  }

  // ---- root position (base x + any attack lunge) ---------------------------
  view.position.set(hero.x + (hero.dead ? 0 : attackFx.lungeX), 0);

  // ---- HP bar / revive countdown (unchanged placement/logic) --------------
  drawHpBar(view.hpBar, 0, GROUND_Y - 58, hero.hp, hero.maxHp);
  view.hpBar.visible = !hero.dead;

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

  // ---- tier-2 idle aura: subtle breathing pulse, hidden while dead ---------
  // Reuses the same `breathPhase` clock as the body's own idle sway/scale —
  // "subtle" per the render brief, so it's a small alpha/scale wobble, never
  // a spin or a bright strobe.
  const showAura = hero.tier === 2 && !hero.dead;
  view.auraRing.visible = showAura;
  if (showAura) {
    const wobble = Math.sin(anim.breathPhase * 0.8);
    view.auraRing.alpha = AURA_BASE_ALPHA + wobble * AURA_ALPHA_RANGE;
    const scale = 1 + wobble * AURA_SCALE_RANGE;
    view.auraRing.scale.set(scale, scale);
  }
}

// ---------------------------------------------------------------------------
// `fx/weaponTrail.ts` hooks — minimal readonly queries instead of the fx
// layer reaching into the rig's internal Graphics/animation state directly.
// ---------------------------------------------------------------------------

/** LOCAL point (within `weaponArm`'s own coordinate frame) at the blade
 * tip — MUST track `buildGearWeapon`'s swordsman branch's own tip formula
 * (`bladeLen`/`bladeRise`), so a tier-grown blade's trail/aura anchor grows
 * with it instead of lagging behind at the old tier-1 tip. */
function swordTipLocal(tier: number): { x: number; y: number } {
  const scale = GEAR_TIER_SCALE[tier] ?? 1;
  const hand = WEAPON_HAND.swordsman;
  const bladeLen = (12 + (tier - 1) * 2.4) * scale;
  const bladeRise = 20 * scale;
  return { x: hand.x + bladeLen, y: hand.y - bladeRise };
}

/**
 * World-space (i.e. `view.parent`-relative — the same logical coordinate
 * space every other `fx/` module already places things in) position of the
 * swordsman's weapon tip THIS frame, written into `out`. Returns `false`
 * (leaving `out` untouched) for any non-swordsman hero, or a view not yet
 * attached under a parent Container — callers should treat that as "no trail
 * sample this frame".
 */
export function getSwordTipPos(view: HeroView, out: { x: number; y: number }): boolean {
  if (view.cls !== "swordsman" || !view.parent) return false;
  view.parent.toLocal(swordTipLocal(view.gearWeaponTier), view.weaponArm, out);
  return true;
}

// ---------------------------------------------------------------------------
// M7 gear-wow hooks (`fx/gearAura.ts` / `fx/gearSparkle.ts`) — same minimal
// readonly-query pattern as `getSwordTipPos` above, generalized to every
// class (the weapon aura/armor sparkle aren't swordsman-only).
// ---------------------------------------------------------------------------

/** Per-class LOCAL "business end" of the weapon (mid-blade / bow center /
 * crystal head) — approximate on purpose (this anchors an ambient orbiting
 * flame aura, not a precision trail) but scales with tier so it stays
 * roughly on the weapon as it grows. */
function weaponAnchorLocal(cls: HeroClass, tier: number): { x: number; y: number } {
  const scale = GEAR_TIER_SCALE[tier] ?? 1;
  if (cls === "swordsman") {
    const hand = WEAPON_HAND.swordsman;
    const bladeLen = (12 + (tier - 1) * 2.4) * scale;
    const bladeRise = 20 * scale;
    return { x: hand.x + bladeLen * 0.55, y: hand.y - bladeRise * 0.55 };
  }
  if (cls === "archer") {
    const hand = WEAPON_HAND.archer;
    return { x: hand.x + 3, y: hand.y };
  }
  if (cls === "ninja") {
    // Mirrors `drawNinjaDaggerBlade`'s main-hand tip formula (`mirror: 1`) —
    // the off-hand dagger doesn't get its own aura anchor (one flame per
    // hero slot, same convention as every other class).
    const hand = WEAPON_HAND.ninja;
    const bladeLen = (7 + (tier - 1) * 1.4) * scale;
    const bladeRise = 9 * scale;
    return { x: hand.x + bladeLen * 0.55, y: hand.y - bladeRise * 0.55 };
  }
  const hand = WEAPON_HAND.mage;
  return { x: hand.x, y: HEAD_Y - 18 - (tier - 1) * 2 * scale - 2 };
}

/** World-space position of this hero's weapon anchor THIS frame (see
 * `weaponAnchorLocal`), for the tier-6/epic "Super Saiyan" aura
 * (`fx/gearAura.ts`) — driven continuously from `FxController`, never from
 * an event. `false` for a view not yet attached under a parent Container. */
export function getWeaponAnchorPos(
  view: HeroView,
  out: { x: number; y: number },
): boolean {
  if (!view.cls || !view.parent) return false;
  view.parent.toLocal(
    weaponAnchorLocal(view.cls, view.gearWeaponTier),
    view.weaponArm,
    out,
  );
  return true;
}

/** Fixed LOCAL chest point (within `upperBody`'s own coordinate frame,
 * same convention as `torso`/`gearArmor`) — anchors the tier-5+ armor
 * sparkle (`fx/gearSparkle.ts`); follows body lean/bob/breathe (and the
 * death-fall tilt) same as the armor overlay itself. */
const ARMOR_ANCHOR_LOCAL = { x: 0, y: SHOULDER_Y + 4 };

/** World-space position of this hero's chest/armor anchor THIS frame, for
 * the tier-5+ armor sparkle (`fx/gearSparkle.ts`). `false` for a view not
 * yet attached under a parent Container. */
export function getArmorAnchorPos(
  view: HeroView,
  out: { x: number; y: number },
): boolean {
  if (!view.parent) return false;
  view.parent.toLocal(ARMOR_ANCHOR_LOCAL, view.upperBody, out);
  return true;
}

/** HOF seasonal rewards (docs/hof-rewards-design.md §3 item 2, render wave):
 * fixed LOCAL mid-torso point (within `upperBody`'s own frame, same
 * convention as `ARMOR_ANCHOR_LOCAL` above) the champion gold aura
 * (`fx/championAura.ts`) centers its tall double-ring halo on — a touch lower
 * than the armor sparkle anchor so the halo's own geometry (see that module's
 * `RING_RY`) sits comfortably below the HP bar/nameplate lanes above the head. */
const CHAMPION_ANCHOR_LOCAL = { x: 0, y: HIP_Y + 2 };

/** World-space position of this hero's champion-aura anchor THIS frame — same
 * `false`-while-unattached contract as `getWeaponAnchorPos`/`getArmorAnchorPos`. */
export function getChampionAnchorPos(
  view: HeroView,
  out: { x: number; y: number },
): boolean {
  if (!view.parent) return false;
  view.parent.toLocal(CHAMPION_ANCHOR_LOCAL, view.upperBody, out);
  return true;
}

/** True while the swordsman's swing (basic melee) or spin (skill) attack
 * animation is actively playing — the window `fx/weaponTrail.ts` should be
 * laying down new ribbon points, as opposed to idle sway/locomotion. */
export function isSwordSwinging(view: HeroView): boolean {
  const kind = view.anim.attack?.kind;
  return view.cls === "swordsman" && (kind === "swing" || kind === "spin");
}

// ---------------------------------------------------------------------------
// `fx/FxController.ts` hooks (HERO SIGNATURE PASS 86d3k2q8f) — same minimal
// readonly-query pattern as `getSwordTipPos`/`isSwordSwinging` above.
// ---------------------------------------------------------------------------

/** Snapshot of a swordsman's currently-playing "swing" (basic attack) anim,
 * or `null` if it isn't a swordsman or no swing is currently playing. */
export interface SwingSnapshot {
  /** 0/1/2 — up-slash/down-slash/thrust (see `resolveAttack`'s "swing" case). */
  comboIndex: number;
  /** `HeroAnimState.attackSeq` at read time — compare across frames to
   * detect "a NEW swing started" without re-deriving the cd-reset tell. */
  seq: number;
}

/** Read-only peek at a swordsman's in-flight "swing" attack, for the
 * per-swing slash-crescent fx (item 2) — edge-detected by the CALLER
 * comparing `seq` across frames (see `FxController.detectSwordSwingStart()`). */
export function peekSwordSwing(view: HeroView): SwingSnapshot | null {
  if (view.cls !== "swordsman" || view.anim.attack?.kind !== "swing") return null;
  return { comboIndex: view.anim.comboIndex, seq: view.anim.attackSeq };
}

/** True while the mage's `castHold` (skill cast) anim is actively playing —
 * drives the orbiting cast-aura sparkles (item 12). */
export function isCastHolding(view: HeroView): boolean {
  return view.cls === "mage" && view.anim.attack?.kind === "castHold";
}

/** Toggle the ghost look via `tint` only (never re-walks a Graphics path) —
 * applied once on the dead/alive transition edge, not per frame. */
function setGhostTint(view: HeroView, dead: boolean): void {
  const tint = dead ? GHOST_TINT : 0xffffff;
  view.legBack.tint = tint;
  view.legFront.tint = tint;
  view.torso.tint = tint;
  view.offArm.tint = tint;
  view.weaponArm.tint = tint;
  view.tierAccent.tint = tint;
  // `tint` doesn't cascade to children the way `alpha` does — `gearWeapon`/
  // `gearArmor` are children of `weaponArm`/`upperBody` (M7 paper-doll) and
  // need the same ghost tint explicitly, or gear would stay full-color while
  // everything else desaturates on death. `gearOffWeapon` (ninja off-hand
  // dagger, child of `offArm`) needs the same treatment.
  view.gearWeapon.tint = tint;
  view.gearOffWeapon.tint = tint;
  view.gearArmor.tint = tint;
}
