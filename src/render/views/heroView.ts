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

const SPIN_DURATION = 0.4; // matches FxController's swordsman-spin ring

const RELEASE_DURATION = 0.16;
const RELEASE_KICK = 0.55;
const TRIPLE_GAP = 0.11;
const TRIPLE_DURATION = TRIPLE_GAP * 2 + RELEASE_DURATION;

const STAFF_PULSE_DURATION = 0.28;
const STAFF_RAISE = 0.4;
const STAFF_PULSE_SCALE = 0.1;

const CASTHOLD_DURATION = 0.55;
const CASTHOLD_RISE_FRAC = 0.4;
const CASTHOLD_RAISE = 1.0;

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
  const offArm = new Graphics();
  const weaponArm = new Graphics();
  offArm.pivot.set(0, SHOULDER_Y);
  offArm.position.set(0, SHOULDER_Y);
  weaponArm.pivot.set(0, SHOULDER_Y);
  weaponArm.position.set(0, SHOULDER_Y);

  upperBody.addChild(torso, offArm, weaponArm);
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

  view.addChild(bodyRoot, hpBar, reviveRing, reviveLabel);

  view.bodyRoot = bodyRoot;
  view.legBack = legBack;
  view.legFront = legFront;
  view.upperBody = upperBody;
  view.torso = torso;
  view.offArm = offArm;
  view.weaponArm = weaponArm;
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
  // `.rotation` around the hip pivot set in createHeroView.
  for (const leg of [view.legBack, view.legFront]) {
    leg.moveTo(0, HIP_Y)
      .lineTo(0, FEET_Y)
      .stroke({ width: 2.4, color: colors.body, cap: "round" });
  }

  // Torso: spine + head (+ a mage hood/collar, POC-faithful) — absolute
  // coordinates (upperBody.pivot = (0, HIP_Y) handles the hip-pivot rotation).
  const t = view.torso;
  t.moveTo(0, HEAD_Y + 6)
    .lineTo(0, HIP_Y)
    .stroke({ width: 2.4, color: colors.body, cap: "round" });
  t.circle(0, HEAD_Y, HEAD_R).fill(colors.body);
  if (cls === "mage") {
    t.poly([-6, HEAD_Y - 4, 6, HEAD_Y - 4, 0, HEAD_Y - 15], true).fill(colors.body);
  }

  // Off arm: a plain relaxed arm — absolute coordinates (shoulder pivot).
  view.offArm
    .moveTo(0, SHOULDER_Y)
    .lineTo(-9, SHOULDER_Y + 6)
    .stroke({ width: 2.2, color: colors.body, cap: "round" });

  // Weapon arm: class-specific arm + weapon — ported 1:1 (absolute
  // coordinates) from the old flat drawWeapon().
  const g = view.weaponArm;
  if (cls === "swordsman") {
    const bx = 12;
    const by = HEAD_Y - 2;
    g.moveTo(0, SHOULDER_Y)
      .lineTo(bx, by)
      .stroke({ width: 2.4, color: colors.body, cap: "round" });
    g.moveTo(bx, by)
      .lineTo(bx + 10, by - 16)
      .stroke({ width: 3, color: colors.light, cap: "round" });
  } else if (cls === "archer") {
    const bx = 11;
    g.moveTo(0, SHOULDER_Y)
      .lineTo(bx, HEAD_Y + 4)
      .stroke({ width: 2.4, color: colors.body, cap: "round" });
    g.arc(bx + 3, HEAD_Y + 4, 11, -1.1, 1.1).stroke({ width: 1.6, color: colors.light });
  } else {
    const sx = 11;
    g.moveTo(0, SHOULDER_Y)
      .lineTo(sx, HEAD_Y + 4)
      .stroke({ width: 2.4, color: colors.body, cap: "round" });
    g.moveTo(sx, HEAD_Y - 14)
      .lineTo(sx, GROUND_Y - 16)
      .stroke({ width: 2.4, color: colors.body, cap: "round" });
    g.circle(sx, HEAD_Y - 16, safeRadius(5)).fill({
      color: colors.light,
      alpha: 0.9,
    });
  }
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
      const swing = Math.sin(progress * Math.PI);
      out.weaponDelta = swing * SWING_AMPLITUDE;
      out.lungeX = swing * LUNGE_PX;
      break;
    }
    case "spin": {
      out.weaponDelta = progress * Math.PI * 2;
      out.bobExtra = Math.sin(progress * Math.PI) * -2;
      break;
    }
    case "release": {
      out.weaponDelta = -Math.sin(progress * Math.PI) * RELEASE_KICK;
      break;
    }
    case "triple": {
      const pulseIdx = Math.min(2, Math.floor(atk.t / (RELEASE_DURATION + TRIPLE_GAP)));
      const localT = atk.t - pulseIdx * (RELEASE_DURATION + TRIPLE_GAP);
      if (localT <= RELEASE_DURATION) {
        const p = clamp01(localT / RELEASE_DURATION);
        out.weaponDelta = -Math.sin(p * Math.PI) * RELEASE_KICK;
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
}

// ---------------------------------------------------------------------------
// `fx/weaponTrail.ts` hooks — minimal readonly queries instead of the fx
// layer reaching into the rig's internal Graphics/animation state directly.
// ---------------------------------------------------------------------------

/** Fixed LOCAL point (within `weaponArm`'s own coordinate frame) at the
 * blade tip — must track the segment drawn in `buildRig`'s swordsman branch
 * (`bx=12, by=HEAD_Y-2`; tip at `bx+10, by-16`). */
const SWORD_TIP_LOCAL = { x: 22, y: HEAD_Y - 18 };

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

/** Toggle the ghost look via `tint` only (never re-walks a Graphics path) —
 * applied once on the dead/alive transition edge, not per frame. */
function setGhostTint(view: HeroView, dead: boolean): void {
  const tint = dead ? GHOST_TINT : 0xffffff;
  view.legBack.tint = tint;
  view.legFront.tint = tint;
  view.torso.tint = tint;
  view.offArm.tint = tint;
  view.weaponArm.tint = tint;
}
