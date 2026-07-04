/**
 * Enemy view: kind-specific silhouette + a small procedural rig giving each
 * kind its own movement "personality." Rigs stay deliberately simpler than
 * `heroView.ts` (many enemies can be on screen at once): body + legs + one
 * accent limb + HP bar, built ONCE per id (first sight — same pooling
 * contract as before), transform-only per frame after that.
 *
 *   EnemyView (pooled Container, position = enemy.x + lunge, each frame)
 *   ├── body (Graphics, kind silhouette; pivot = ground contact, for squash/bob)
 *   ├── legs (Graphics, small tread marks; position-only shuffle/bob)
 *   ├── limbArm (Graphics, pivot = "front" point — jab accent for melee kinds,
 *   │            the visible weapon/aim-and-recoil limb for `ranged`)
 *   └── hpBar (Graphics, sibling — stays level, unaffected by body squash)
 *
 * Locomotion (bob/shuffle/squash) derives from actual per-frame position
 * delta, normalized by the entity's OWN `speed` (each kind has a very
 * different top speed) — so cadence is proportional to real movement and
 * naturally scales with the 1x/2x/3x multiplier. Attack tells (windup+lunge
 * for melee, aim+recoil for ranged) are REAL-TIME, event/cooldown-triggered,
 * like `fx/`. One shared phase clock (`walkPhase`) feeds every part's motion
 * — no per-part trig storms even with many enemies live at once.
 *
 * Melee kinds have no dedicated "I just attacked" event (`hit` only carries
 * the VICTIM's info, and multiple enemies could be attacking the same
 * instant), so — like the hero swordsman — a same-tick `cd` RESET is the
 * per-entity-safe tell. Death is handled render-side by `fx/corpseEcho.ts`
 * off the `kill` event, NOT here: the engine removes a dead enemy from state
 * the same step it dies, so this view is destroyed before any death anim
 * could play.
 */

import { Container, Graphics } from "pixi.js";
import type { Enemy, EnemyKind } from "@/engine/entities";
import type { GameEvent } from "@/engine/state";
import { GROUND_Y } from "@/render/layout";
import { ENEMY_COLORS, safeRadius } from "@/render/theme";
import { drawHpBar } from "@/render/views/hpBar";

// ---------------------------------------------------------------------------
// Per-kind tunables — the single table personality differences read from.
// ---------------------------------------------------------------------------
interface EnemyKindParams {
  /** Walk-phase speed multiplier (fast = high, tank = low). */
  freqMult: number;
  /** Body bob amplitude (px) at full speed. */
  bobAmp: number;
  /** Footfall squash strength (fraction of scale) at full speed. */
  squashAmp: number;
  /** Legs shuffle amplitude (px) at full speed. */
  shuffleAmp: number;
  /** Attack (melee) / recoil (ranged) anim duration, REAL seconds. */
  attackDuration: number;
  /** Pre-lunge pull-back distance (px) — 0 for ranged (no lunge). */
  windupPull: number;
  /** Lunge distance toward the hero side (px) — small "kick" for ranged. */
  lungeAmp: number;
  /** Weapon/limb swing amplitude for the attack tell (radians). */
  armSwingAmp: number;
}

const ENEMY_MOTION: Record<EnemyKind, EnemyKindParams> = {
  // Steady trudge — workmanlike, moderate everything.
  normal: {
    freqMult: 1.0,
    bobAmp: 1.6,
    squashAmp: 0.05,
    shuffleAmp: 1.4,
    attackDuration: 0.26,
    windupPull: 2,
    lungeAmp: 6,
    armSwingAmp: 0.35,
  },
  // Darting spring — crouch-pounce cycle handled specially (see `fastPose`).
  fast: {
    freqMult: 2.6,
    bobAmp: 1.1,
    squashAmp: 0.2,
    shuffleAmp: 1.0,
    attackDuration: 0.18,
    windupPull: 3,
    lungeAmp: 10,
    armSwingAmp: 0.5,
  },
  // Heavy stomp — slow, big, weighty down-beat.
  tank: {
    freqMult: 0.5,
    bobAmp: 3.6,
    squashAmp: 0.13,
    shuffleAmp: 0.8,
    attackDuration: 0.34,
    windupPull: 4,
    lungeAmp: 5,
    armSwingAmp: 0.3,
  },
  // Skitters while closing, then holds an AIM pose at range.
  ranged: {
    freqMult: 1.5,
    bobAmp: 1.0,
    squashAmp: 0.04,
    shuffleAmp: 1.2,
    attackDuration: 0.16,
    windupPull: 0,
    lungeAmp: 2,
    armSwingAmp: 0.4,
  },
};

const LEG_BASE_Y = GROUND_Y - 2;
const SPAWN_DURATION = 0.35;
const SPAWN_HOP_HEIGHT = 14;
/** Below this normalized speed, treat the entity as "stationary" (AIM pose
 * for ranged; idle shuffle otherwise). */
const AIM_SPEED_THRESHOLD = 0.08;
const ARM_SMOOTH = 10; // per-second lerp rate toward the resting/AIM target

type AttackKindAnim = "lunge" | "recoil";

interface AttackAnim {
  kind: AttackKindAnim;
  t: number;
  duration: number;
}

interface EnemyAnimState {
  initialized: boolean;
  lastX: number;
  walkPhase: number;
  lastCd: number;
  armAngle: number;
  spawnT: number;
  attack: AttackAnim | null;
}

export interface EnemyFrameContext {
  /** Real (wall-clock) seconds since the previous draw() — drives every
   * attack/recoil/spawn timer, exactly like `fx/` and `heroView.ts`. */
  dt: number;
  /** This frame's collected engine events. */
  events: readonly GameEvent[];
}

export interface EnemyView extends Container {
  body: Graphics;
  legs: Graphics;
  limbArm: Graphics;
  hpBar: Graphics;
  kind: EnemyKind | null;
  anim: EnemyAnimState;
}

export function createEnemyView(): EnemyView {
  const view = new Container() as EnemyView;
  view.body = new Graphics();
  view.legs = new Graphics();
  view.limbArm = new Graphics();
  view.hpBar = new Graphics();
  view.kind = null;

  view.body.pivot.set(0, GROUND_Y);
  view.body.position.set(0, GROUND_Y);

  view.addChild(view.body, view.legs, view.limbArm, view.hpBar);
  view.anim = {
    initialized: false,
    lastX: 0,
    walkPhase: Math.random() * Math.PI * 2,
    lastCd: 0,
    armAngle: 0,
    spawnT: 0,
    attack: null,
  };
  return view;
}

/** The "front" (heroes-facing) attach point for `limbArm`, per kind/size —
 * approximate, not pixel-exact (stylized silhouettes, subtle accent limb). */
function frontPoint(kind: EnemyKind, size: number): { x: number; y: number } {
  const s = Math.max(0.1, size);
  if (kind === "tank") return { x: -12 * s, y: GROUND_Y - 16 * s };
  if (kind === "ranged") return { x: -10 * s, y: GROUND_Y - 16 };
  return { x: -15 * s, y: GROUND_Y - 16 };
}

/** (Re)draw the body + legs + limb only once per id (kind/size are fixed for
 * an entity's lifetime — same guarantee `enemyView.ts` always relied on). */
function buildRig(view: EnemyView, kind: EnemyKind, size: number): void {
  const s = Math.max(0.1, size);
  const color = ENEMY_COLORS[kind];

  const g = view.body;
  g.clear();
  if (kind === "tank") {
    g.roundRect(-12 * s, GROUND_Y - 30 * s, safeRadius(24 * s), safeRadius(28 * s), 4).fill(
      color,
    );
  } else if (kind === "ranged") {
    const cy = GROUND_Y - 16;
    g.poly([0, cy - 10 * s, 10 * s, cy, 0, cy + 10 * s, -10 * s, cy], true).fill(color);
  } else {
    g.poly(
      [-15 * s, GROUND_Y - 16, 13 * s, GROUND_Y - 16 - 14 * s, 13 * s, GROUND_Y - 2],
      true,
    ).fill(color);
  }
  g.circle(-3, GROUND_Y - 17, 2.5).fill({ color: 0x000000, alpha: 0.5 });

  view.legs.clear();
  view.legs
    .moveTo(-5 * s, LEG_BASE_Y)
    .lineTo(-2 * s, LEG_BASE_Y - 6 * s)
    .stroke({ width: 1.6, color, alpha: 0.55, cap: "round" });
  view.legs
    .moveTo(5 * s, LEG_BASE_Y)
    .lineTo(2 * s, LEG_BASE_Y - 6 * s)
    .stroke({ width: 1.6, color, alpha: 0.55, cap: "round" });

  // limbArm's pivot === its baseline position (see `updateEnemyView`, which
  // only ever offsets position AWAY from this point) — Pixi's transform is
  // `parent = position + R·(local − pivot)`, so with pivot == baseline
  // position the path must be drawn in ABSOLUTE coordinates (starting AT
  // `front`, not at local (0,0)); pre-subtracting `front` here would cancel
  // it a second time and collapse the limb toward world y≈0 (see
  // `heroView.ts`'s doc comment on the exact same bug class, and
  // `__tests__/rig.test.ts` for the regression guard).
  const front = frontPoint(kind, s);
  view.limbArm.pivot.set(front.x, front.y);
  view.limbArm.position.set(front.x, front.y);
  view.limbArm.clear();
  const armLen = kind === "ranged" ? 13 * s : 8 * s;
  view.limbArm
    .moveTo(front.x, front.y)
    .lineTo(front.x - armLen, front.y)
    .stroke({ width: kind === "ranged" ? 2.2 : 1.8, color, cap: "round" });
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const d = x - 1;
  return 1 + c3 * d * d * d + c1 * d * d;
}

/** Smooth compress -> spring-release -> settle cycle for `fast` — distinct
 * from the shared sine bob the other grounded kinds use. */
function fastPose(phase: number, speedFrac: number, amp: number): { offY: number; scaleX: number; scaleY: number } {
  const frac = (((phase / (Math.PI * 2)) % 1) + 1) % 1;
  if (frac < 0.35) {
    const k = frac / 0.35;
    return { offY: 0, scaleX: 1 + 0.14 * k * speedFrac, scaleY: 1 - 0.24 * k * speedFrac };
  }
  if (frac < 0.55) {
    const k = (frac - 0.35) / 0.2;
    return {
      offY: -k * amp * speedFrac,
      scaleX: 1 + 0.14 * (1 - k) * speedFrac,
      scaleY: 1 - 0.24 * (1 - k) * speedFrac + 0.16 * k * speedFrac,
    };
  }
  const k = (frac - 0.55) / 0.45;
  return {
    offY: -(1 - k) * amp * speedFrac * 0.3,
    scaleX: 1,
    scaleY: 1 + 0.16 * (1 - k) * speedFrac,
  };
}

/** Shared "dip + footfall squash" bob for normal/tank/ranged (same visual
 * language as `heroView.ts`'s walk bob — a cohesive whole-game convention). */
function groundedPose(
  phase: number,
  speedFrac: number,
  p: EnemyKindParams,
): { offY: number; scaleX: number; scaleY: number } {
  const bounce = Math.abs(Math.sin(phase));
  const footfall = bounce * bounce * bounce * bounce * bounce * bounce; // sharp peak
  return {
    offY: bounce * p.bobAmp * speedFrac,
    scaleX: 1 + footfall * p.squashAmp * 0.6 * speedFrac,
    scaleY: 1 - footfall * p.squashAmp * speedFrac,
  };
}

function startAttack(anim: EnemyAnimState, kind: AttackKindAnim, duration: number): void {
  anim.attack = { kind, t: 0, duration };
}

/** Windup(pull back) -> lunge(toward heroes, -x) -> snap back, one curve. */
function meleeLungeCurve(progress: number, windupPull: number, lungeAmp: number): number {
  if (progress < 0.3) return windupPull * (progress / 0.3);
  const k = (progress - 0.3) / 0.7;
  return windupPull * (1 - k) - lungeAmp * Math.sin(k * Math.PI);
}

/** Quick single backward recoil kick (ranged, firing its bolt). */
function recoilCurve(progress: number): number {
  return Math.sin(progress * Math.PI);
}

export function updateEnemyView(view: EnemyView, enemy: Enemy, ctx: EnemyFrameContext): void {
  if (view.kind !== enemy.kind) {
    view.kind = enemy.kind;
    buildRig(view, enemy.kind, enemy.size);
  }

  const anim = view.anim;
  const dt = Math.max(0, ctx.dt);
  const params = ENEMY_MOTION[enemy.kind];

  if (!anim.initialized) {
    anim.initialized = true;
    anim.lastX = enemy.x;
    anim.lastCd = enemy.cd;
    anim.spawnT = 0; // first sight -> play the spawn-in beat
    anim.armAngle = enemy.kind === "ranged" ? 0.5 : 0;
  }

  // ---- locomotion: derive velocity from actual position delta ------------
  const velocity = dt > 0 ? (enemy.x - anim.lastX) / dt : 0;
  anim.lastX = enemy.x;
  const speedFrac = clamp01(Math.abs(velocity) / Math.max(1, enemy.speed));
  const stationary = speedFrac < AIM_SPEED_THRESHOLD;

  anim.walkPhase += dt * (1.2 + speedFrac * 3.5) * params.freqMult;

  const pose =
    enemy.kind === "fast"
      ? fastPose(anim.walkPhase, speedFrac, params.bobAmp)
      : groundedPose(anim.walkPhase, speedFrac, params);

  const shuffleX = Math.sin(anim.walkPhase) * params.shuffleAmp * speedFrac;

  // ---- attack-anim triggers ------------------------------------------------
  // Melee kinds: no dedicated "I attacked" event — a same-tick `cd` RESET
  // (jumping back up) is the per-entity-safe tell (many enemies can share the
  // same instant, unlike the boss's singleton `hit` events).
  // Ranged fires its bolt in the exact same engine tick its `cd` resets (see
  // `engine/systems/combat.ts`), so the same per-entity cd-reset check covers
  // its recoil trigger too — no need to also position-match `ctx.events`.
  if (enemy.cd > anim.lastCd + 1e-4) {
    startAttack(anim, enemy.kind === "ranged" ? "recoil" : "lunge", params.attackDuration);
  }
  anim.lastCd = enemy.cd;

  let attackOffX = 0;
  let attackArmDelta = 0;
  if (anim.attack) {
    anim.attack.t += dt;
    if (anim.attack.t >= anim.attack.duration) {
      anim.attack = null;
    } else {
      const progress = clamp01(anim.attack.t / anim.attack.duration);
      if (anim.attack.kind === "lunge") {
        attackOffX = meleeLungeCurve(progress, params.windupPull, params.lungeAmp);
        attackArmDelta = -Math.sin(progress * Math.PI) * params.armSwingAmp * 2.5;
      } else {
        attackOffX = recoilCurve(progress) * 3;
        attackArmDelta = recoilCurve(progress) * params.armSwingAmp;
      }
    }
  }

  // ---- ranged AIM pose (continuous, smoothed toward a target angle) -------
  const armTarget =
    enemy.kind === "ranged" ? (stationary ? -0.15 : 0.5) : Math.sin(anim.walkPhase) * params.armSwingAmp * 0.5;
  anim.armAngle += (armTarget - anim.armAngle) * clamp01(dt * ARM_SMOOTH);

  // ---- spawn-in entrance beat (first sight only) --------------------------
  let spawnHop = 0;
  if (anim.spawnT >= 0 && anim.spawnT < SPAWN_DURATION) {
    anim.spawnT += dt;
    const p = clamp01(anim.spawnT / SPAWN_DURATION);
    spawnHop = -SPAWN_HOP_HEIGHT * (1 - easeOutBack(p));
    if (p >= 1) anim.spawnT = -1;
  }

  // ---- compose transforms ---------------------------------------------------
  view.body.position.set(attackOffX, GROUND_Y + pose.offY + spawnHop);
  view.body.scale.set(pose.scaleX, pose.scaleY);

  view.legs.position.set(attackOffX * 0.6 + shuffleX, pose.offY * 0.5 + spawnHop);

  const front = frontPoint(enemy.kind, Math.max(0.1, enemy.size));
  view.limbArm.rotation = anim.armAngle + attackArmDelta;
  view.limbArm.position.set(front.x + attackOffX, front.y + pose.offY + spawnHop);

  view.position.set(enemy.x, 0);

  drawHpBar(
    view.hpBar,
    0,
    GROUND_Y - 42 - 8 * enemy.size,
    enemy.hp,
    enemy.maxHp,
    30 * enemy.size,
  );
}
