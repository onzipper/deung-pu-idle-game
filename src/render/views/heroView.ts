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
 *   │       ├── offArm (Graphics: plain arm, counter-swings / raises for casts)
 *   │       └── weaponArm (Graphics: arm + class weapon, drives every attack anim)
 *   ├── hpBar (Graphics — NOT under bodyRoot: stays upright even mid-fall)
 *   ├── reviveRing (Graphics — ditto: countdown must stay readable)
 *   └── reviveLabel (Text)
 *
 * Every frame after the initial build only mutates transforms (position /
 * rotation / scale / alpha) or `tint` — never re-walks a Graphics path. Timing
 * split: locomotion (walk cadence/bob/lean) derives from actual per-frame
 * position delta, so it naturally speeds up with the 1x/2x/3x multiplier
 * (more sub-steps -> bigger delta over the same real `dt`); transient
 * attack/death/revive beats run on REAL seconds (`ctx.dt`), exactly like
 * `fx/`, so they stay equally snappy at any sim speed.
 */

import { Container, Graphics, Text } from "pixi.js";
import { CONFIG } from "@/engine/config";
import type { Hero, HeroClass } from "@/engine/entities";
import type { GameEvent } from "@/engine/state";
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

// ---------------------------------------------------------------------------
// Per-class resting weapon-arm / off-arm angles (radians).
// ---------------------------------------------------------------------------
const REST_ANGLE: Record<HeroClass, number> = {
  swordsman: -0.15,
  archer: -0.35, // held slightly drawn at rest — "always under tension"
  mage: -0.05,
};
const OFFARM_REST = 0.35;

// ---------------------------------------------------------------------------
// Attack animation durations (REAL seconds) + amplitudes.
// ---------------------------------------------------------------------------
const SWING_DURATION = 0.22;
const SWING_AMPLITUDE = 1.35;
const LUNGE_PX = 5;

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

type AttackKindAnim = "swing" | "spin" | "release" | "triple" | "staffPulse" | "castHold";

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
  tierBuilt: 1 | 2;
  /**
   * Rig-flip state (open hunting field, 86d3jv7m3 follow-up): the whole rig
   * is drawn facing +x (bow/blade/staff all built on the +x side — see
   * `buildRig`). `1` = default/unflipped (facing +x); `-1` = mirrored (facing
   * -x). Derived from the hero's OWN recent movement delta (this view has no
   * reference to its current target's position) and HELD through stationary
   * beats (holding position to swing/shoot/cast) rather than re-derived every
   * frame off a near-zero velocity.
   */
  facing: 1 | -1;
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

  upperBody.addChild(torso, offArm, weaponArm, tierAccent);
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

  view.addChild(bodyRoot, auraRing, hpBar, reviveRing, reviveLabel);

  view.bodyRoot = bodyRoot;
  view.legBack = legBack;
  view.legFront = legFront;
  view.upperBody = upperBody;
  view.torso = torso;
  view.offArm = offArm;
  view.weaponArm = weaponArm;
  view.tierAccent = tierAccent;
  view.auraRing = auraRing;
  view.hpBar = hpBar;
  view.reviveRing = reviveRing;
  view.reviveLabel = reviveLabel;
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
    t.poly([-6, SHOULDER_Y, -10, HIP_Y - 2, -2, HIP_Y + 2, 2, SHOULDER_Y + 2], true).fill({
      color: colors.shade,
      alpha: 0.9,
    });
    t.moveTo(-8, SHOULDER_Y - 2)
      .lineTo(-4, SHOULDER_Y - 15)
      .stroke({ width: 4, color: colors.shade, cap: "round" });
    t.moveTo(-4, SHOULDER_Y - 15)
      .lineTo(-2.5, SHOULDER_Y - 20)
      .stroke({ width: 1.2, color: colors.light, cap: "round" });
    t.moveTo(-4, SHOULDER_Y - 14)
      .lineTo(-5.5, SHOULDER_Y - 19)
      .stroke({ width: 1.2, color: colors.light, cap: "round" });
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
    t.poly(arcFanPoints(0, HEAD_Y, HEAD_R + 1, Math.PI, Math.PI * 2), true).fill(colors.light);
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
    t.circle(HEAD_R * 0.3, HEAD_Y + 1, HEAD_R * 0.6).fill({ color: colors.shade, alpha: 0.6 });
    t.circle(HEAD_R * 0.55, HEAD_Y - 1, 1).fill(PALETTE.outline);
    t.circle(HEAD_R * 0.55, HEAD_Y + 2, 1).fill(PALETTE.outline);
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

  // Weapon arm: class-specific arm + weapon — absolute coordinates
  // (shoulder pivot), same convention as everything above.
  const g = view.weaponArm;
  if (cls === "swordsman") {
    const bx = 12;
    const by = HEAD_Y - 2;
    g.moveTo(0, SHOULDER_Y)
      .lineTo(bx, by)
      .stroke({ width: 2.6, color: colors.body, cap: "round" });
    // Big sword: a tapered blade poly (reads as a blade, not a stick) with a
    // distinct crossguard perpendicular to it. Tip position is mirrored in
    // `SWORD_TIP_LOCAL` below (the weapon-trail hook) — keep them in sync.
    const tipX = bx + 12;
    const tipY = by - 20;
    const dx = tipX - bx;
    const dy = tipY - by;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const px = -ny;
    const py = nx;
    const halfW = 2.2;
    g.poly(
      [bx + px * halfW, by + py * halfW, tipX, tipY, bx - px * halfW, by - py * halfW],
      true,
    ).fill(PALETTE.steel);
    g.moveTo(bx - px * 5, by - py * 5)
      .lineTo(bx + px * 5, by + py * 5)
      .stroke({ width: 2.2, color: colors.light, cap: "round" });
  } else if (cls === "archer") {
    const bx = 11;
    const cx = bx + 3;
    const cy = HEAD_Y + 4;
    const r = 13;
    g.moveTo(0, SHOULDER_Y)
      .lineTo(bx, cy)
      .stroke({ width: 2.4, color: colors.body, cap: "round" });
    g.arc(cx, cy, r, -1.1, 1.1).stroke({ width: 1.8, color: colors.light });
    const p1x = cx + r * Math.cos(-1.1);
    const p1y = cy + r * Math.sin(-1.1);
    const p2x = cx + r * Math.cos(1.1);
    const p2y = cy + r * Math.sin(1.1);
    // Bowstring (chord), pulled back slightly toward -x — "always under
    // tension" per the rest-angle tuning above — plus a nocked arrow aimed
    // forward (+x, the facing direction).
    const stringX = cx - r * 0.15;
    g.moveTo(p1x, p1y)
      .lineTo(stringX, cy)
      .lineTo(p2x, p2y)
      .stroke({ width: 1, color: PALETTE.steel, alpha: 0.8 });
    g.moveTo(stringX, cy)
      .lineTo(stringX + 15, cy)
      .stroke({ width: 1.4, color: colors.light, cap: "round" });
    g.poly([stringX + 15, cy - 2, stringX + 19, cy, stringX + 15, cy + 2], true).fill(
      PALETTE.steel,
    );
  } else {
    const sx = 11;
    g.moveTo(0, SHOULDER_Y)
      .lineTo(sx, HEAD_Y + 4)
      .stroke({ width: 2.4, color: colors.body, cap: "round" });
    g.moveTo(sx, HEAD_Y - 18)
      .lineTo(sx, GROUND_Y - 16)
      .stroke({ width: 2.4, color: colors.body, cap: "round" });
    // Crystal head: layered flat-alpha "glow" rings (no gradients) around a
    // bright core — the cast "pulse" scales `weaponArm` as a whole, so the
    // glow breathes with it for free.
    g.circle(sx, HEAD_Y - 20, safeRadius(7)).fill({ color: colors.light, alpha: 0.16 });
    g.circle(sx, HEAD_Y - 20, safeRadius(5)).fill({ color: colors.light, alpha: 0.32 });
    g.circle(sx, HEAD_Y - 20, safeRadius(3)).fill({ color: colors.light, alpha: 0.95 });
    g.circle(sx, HEAD_Y - 20, safeRadius(3)).stroke({
      width: 1,
      color: PALETTE.outline,
      alpha: 0.5,
    });
  }
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
    g.circle(-4.5, SHOULDER_Y, 3.2).stroke({ width: 1, color: TIER_ACCENT_GOLD, alpha: 0.85 });
    g.circle(4.5, SHOULDER_Y, 3.2).stroke({ width: 1, color: TIER_ACCENT_GOLD, alpha: 0.85 });
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
    g.circle(-2, SHOULDER_Y - 1, safeRadius(4)).fill({ color: TIER_ACCENT_GOLD, alpha: 0.18 });
    g.circle(-2, SHOULDER_Y - 1, safeRadius(2.4)).fill({ color: TIER_ACCENT_GOLD, alpha: 0.55 });
    g.circle(-2, SHOULDER_Y - 1, safeRadius(1.2)).fill({ color: 0xffffff, alpha: 0.9 });
    g.moveTo(-6, SHOULDER_Y - 2)
      .lineTo(-10, HIP_Y - 2)
      .stroke({ width: 1, color: TIER_ACCENT_GOLD, alpha: 0.7 });
  } else {
    // Brighter jewel accent: a glowing gem brooch at the collar (mirrors the
    // archer's, keeping the "evolution gem" motif consistent) plus a gold
    // band trim over the hat.
    g.circle(0, SHOULDER_Y - 2, safeRadius(4)).fill({ color: TIER_ACCENT_GOLD, alpha: 0.18 });
    g.circle(0, SHOULDER_Y - 2, safeRadius(2.4)).fill({ color: TIER_ACCENT_GOLD, alpha: 0.55 });
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
function arcFanPoints(cx: number, cy: number, r: number, start: number, end: number): number[] {
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
              : CASTHOLD_DURATION;
  anim.attack = { kind, t: 0, duration };
  anim.attackSeq++;
  if (kind === "swing") anim.comboIndex = (anim.comboIndex + 1) % 3;
  else if (kind === "release") anim.shotPoseIndex = (anim.shotPoseIndex + 1) % 2;
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
  const out: AttackFx = { weaponDelta: 0, offArmDelta: 0, bobExtra: 0, lungeX: 0, weaponScale: 1 };
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
      const rise = progress < CASTHOLD_RISE_FRAC ? easeOutQuad(progress / CASTHOLD_RISE_FRAC) : 1;
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
  }

  const anim = view.anim;
  const dt = Math.max(0, ctx.dt);

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

  // ---- locomotion: derive velocity from actual position delta ------------
  const velocity = dt > 0 ? (hero.x - anim.lastX) / dt : 0;
  anim.lastX = hero.x;
  const speedFrac = clamp01(Math.abs(velocity) / CONFIG.heroMove);

  // Rig flip: only re-derive while actually moving with intent — holds its
  // last value while stationary (in range, holding station to attack/cast),
  // frozen while dead (see `EnemyAnimState.facing`'s sibling doc comment for
  // why this can't just key off a live target reference instead).
  if (!hero.dead && speedFrac >= FACING_SPEED_THRESHOLD) {
    anim.facing = velocity > 0 ? 1 : -1;
  }
  view.bodyRoot.scale.x = anim.facing;

  anim.walkPhase += dt * (WALK_FREQ_BASE + speedFrac * WALK_FREQ_RANGE);
  anim.breathPhase += dt * BREATH_SPEED;

  const legSwing = LEG_SWING_MAX * speedFrac;
  const idleWobble = Math.sin(anim.breathPhase * 0.6) * IDLE_SWAY;
  view.legBack.rotation = IDLE_LEG_BACK + Math.sin(anim.walkPhase) * legSwing + idleWobble;
  view.legFront.rotation =
    IDLE_LEG_FRONT + Math.sin(anim.walkPhase + Math.PI) * legSwing - idleWobble;

  const marchBoost = ctx.marching ? MARCH_BOB_BOOST : 1;
  const leanBoost = ctx.marching ? MARCH_LEAN_BOOST : 1;
  const walkBob = Math.abs(Math.sin(anim.walkPhase)) * BOB_AMPLITUDE * speedFrac * marchBoost;
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
        else startAttack(anim, "castHold");
      }
    }
    if (!skillCastThisHero) {
      for (const ev of ctx.events) {
        if (ev.type === "projectileSpawn" && ev.kind === "arrow" && hero.cls === "archer") {
          startAttack(anim, "release");
        } else if (ev.type === "projectileSpawn" && ev.kind === "orb" && hero.cls === "mage") {
          startAttack(anim, "staffPulse");
        }
      }
    }
    // Swordsman basic melee has no dedicated event — a same-tick `cd` RESET
    // (jumping back up instead of ticking down) is the tell.
    if (hero.cls === "swordsman" && hero.cd > anim.lastCd + 1e-4) {
      startAttack(anim, "swing");
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
    view.weaponArm.rotation = restAngle + weaponIdleSway + Math.sin(anim.walkPhase) * armSwing;
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
    view.torso.rotation = Math.sin(anim.breathPhase * 1.6) * CASTHOLD_SWAY_AMPLITUDE * holdFrac;
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

/** Fixed LOCAL point (within `weaponArm`'s own coordinate frame) at the
 * blade tip — must track the segment drawn in `buildRig`'s swordsman branch
 * (`bx=12, by=HEAD_Y-2`; tip at `bx+12, by-20`). */
const SWORD_TIP_LOCAL = { x: 24, y: HEAD_Y - 22 };

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
  view.parent.toLocal(SWORD_TIP_LOCAL, view.weaponArm, out);
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
}
