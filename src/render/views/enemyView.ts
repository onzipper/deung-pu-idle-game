/**
 * Enemy view: kind-specific silhouette (PROCEDURAL V2, task 86d3k2nj3 —
 * `normal` upright wedge w/ a plain double-eyed brow, `fast` a distinct low
 * sleek silhouette w/ an angry eye-slit, `tank` an armored block w/ plate
 * seams + heavy jaw, `ranged` a hooded kite w/ glowing eyes + a visible
 * weapon tip) + a small procedural rig giving each kind its own movement
 * "personality." Rigs stay deliberately simpler than
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
import { drawHpBar } from "@/render/views/hpBar";
import { enemySpeciesFor } from "@/render/views/enemySpecies";
import { PALETTE, safeRadius } from "@/render/theme";

// ---------------------------------------------------------------------------
// ดินแดนอสูร (ASURA endgame v1) ELITE treatment — an unmistakable "rare/
// dangerous" read on top of the zone's normal species rig: scaled up + a
// pulsing dark-red/violet aura ring. `elite` is fixed for an entity's whole
// life (set once at `promoteElite` time, before it ever enters `state.enemies`
// — see `systems/asura.ts`), same guarantee `kind`/`size` already rely on, so
// baking the scale into `buildRig`'s one-time `size` param (not a per-frame
// `view.scale` multiply, which is already spoken for by the facing flip/pose
// squash) is safe. The aura ring itself is built ONCE (elite-only) and only
// TRANSFORMED (alpha/scale pulse) per frame after that — continuous/persistent
// juice belongs in the view, not `fx/` (see render/README.md).
// ---------------------------------------------------------------------------
const ELITE_SIZE_SCALE = 1.35;
const ELITE_AURA_RADIUS = 24;
const ELITE_AURA_PULSE_SPEED = 3.2; // radians/sec
const ELITE_AURA_ALPHA_BASE = 0.3;
const ELITE_AURA_ALPHA_SWING = 0.22;
const ELITE_AURA_SCALE_SWING = 0.1;

/** The render-only effective size an elite draws at (scaled up) vs the
 * engine's own `enemy.size` (untouched — this never feeds back into
 * `GameState`). Every other kind reads its plain `enemy.size` unchanged. */
function effectiveSize(enemy: Enemy): number {
  return enemy.elite ? enemy.size * ELITE_SIZE_SCALE : enemy.size;
}

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
/** The hop/landing-settle itself — kept unchanged from before DEATH & SPAWN
 * DRAMA (86d3k2qjk item 2): the "materialize" beat now wrapping around it is
 * `fx/portal.ts`'s ground portal, opened by `FxController.updateEnemySpawns()`
 * off this same first-sight edge (a render-side mirror of `Pool`'s own
 * mark-and-sweep — see that method's doc comment). */
const SPAWN_DURATION = 0.35;
const SPAWN_HOP_HEIGHT = 14;
/** Fade-in window, real seconds — matches `fx/portal.ts`'s `PORTAL_OPEN_DURATION`
 * (kept as a plain literal, not an import: `enemyView.ts` has no other `fx/`
 * dependency, and the two only need to stay ROUGHLY in sync, not exactly). */
const SPAWN_FADE_DURATION = 0.15;
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
  /**
   * Rig-flip state (open hunting field, 86d3jv7m3 follow-up): every rig below
   * is drawn assuming its target sits at -x (the old always-hero-on-the-left
   * assumption). `1` = default/unflipped (front-facing -x); `-1` = mirrored
   * (front-facing +x). Derived from the entity's OWN recent movement delta
   * (the view has no reference to the hero's actual position) and HELD
   * through stationary beats — melee holding station to swing, ranged holding
   * to aim — rather than re-derived every frame off a near-zero velocity.
   */
  facing: 1 | -1;
  /** ASURA ELITE aura pulse clock (real seconds, randomized start phase so
   * several concurrent elites don't pulse in lockstep) — unused/inert for a
   * non-elite enemy. */
  eliteT: number;
}

export interface EnemyFrameContext {
  /** Real (wall-clock) seconds since the previous draw() — drives every
   * attack/recoil/spawn timer, exactly like `fx/` and `heroView.ts`. */
  dt: number;
  /** This frame's collected engine events. */
  events: readonly GameEvent[];
  /** The map (`CONFIG.world.maps[].id`, e.g. `"map4"`) this enemy spawned
   * into — drives `enemySpecies.ts`'s per-map silhouette (M7.9 "new mob
   * species"). Only read at first-sight `buildRig()` time (an enemy never
   * changes map mid-life — see `enemySpecies.ts`'s doc comment), same
   * plumbing convention as `bossView.ts`'s `ctx.mapId`. Optional/undefined
   * falls back to the map1/2/3 original silhouettes. */
  mapId?: string;
}

export interface EnemyView extends Container {
  body: Graphics;
  legs: Graphics;
  limbArm: Graphics;
  hpBar: Graphics;
  /** ASURA ELITE pulsing aura ring (built once, elite-only — see the module
   * doc comment above). Stays an empty, invisible `Graphics` for every
   * ordinary enemy (zero extra draw calls beyond an idle child). */
  eliteRing: Graphics;
  kind: EnemyKind | null;
  anim: EnemyAnimState;
}

export function createEnemyView(): EnemyView {
  const view = new Container() as EnemyView;
  view.body = new Graphics();
  view.legs = new Graphics();
  view.limbArm = new Graphics();
  view.hpBar = new Graphics();
  view.eliteRing = new Graphics();
  view.eliteRing.visible = false;
  view.kind = null;

  view.body.pivot.set(0, GROUND_Y);
  view.body.position.set(0, GROUND_Y);

  view.addChild(view.body, view.legs, view.limbArm, view.eliteRing, view.hpBar);
  view.anim = {
    initialized: false,
    lastX: 0,
    walkPhase: Math.random() * Math.PI * 2,
    lastCd: 0,
    armAngle: 0,
    spawnT: 0,
    attack: null,
    facing: 1,
    eliteT: Math.random() * Math.PI * 2,
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
 * an entity's lifetime — same guarantee `enemyView.ts` always relied on).
 * Personality details below are all extra draw calls into the SAME 3
 * Graphics objects (`body`/`legs`/`limbArm`) — the per-enemy display-object
 * budget (`body`, `legs`, `limbArm`, `hpBar`) is unchanged from before this
 * task, which matters with many enemies live at once. Colors stay
 * kind-coded (`color` = the kind's single base hex); shading/eyes/plates use
 * plain black/white alpha overlays on that same hue, never a new palette
 * entry per kind — the flat-alpha-layering rule, not gradients.
 *
 * M7.9 "new mob species": WHICH silhouette/color this kind draws now comes
 * from `enemySpecies.ts` (keyed by `mapId × kind`) instead of a hardcoded
 * switch here — map1/2/3 resolve to the exact original builders (byte-
 * identical, see that module's doc comment), map4/5/6 get their own species.
 * Everything else below (legs/limbArm, the rest of the rig contract) is
 * unchanged by this task.
 *
 * `size` is already the ELITE-scaled effective size (see `effectiveSize()`)
 * when `elite` is true — the silhouette itself just draws bigger, no separate
 * code path. `elite` additionally populates `view.eliteRing` once (two flat-
 * alpha circles — a dark-red/violet aura ring, `updateEnemyView` only pulses
 * its alpha/scale per frame after this). */
function buildRig(
  view: EnemyView,
  kind: EnemyKind,
  size: number,
  mapId: string | undefined,
  elite: boolean,
): void {
  const s = Math.max(0.1, size);
  const { color, build } = enemySpeciesFor(mapId, kind);

  const g = view.body;
  g.clear();
  build(g, s, color);

  view.eliteRing.clear();
  if (elite) {
    const cy = GROUND_Y - 16 * s;
    const r = safeRadius(ELITE_AURA_RADIUS * s);
    view.eliteRing.circle(0, cy, r).fill({ color: PALETTE.eliteAuraDark, alpha: 0.28 });
    view.eliteRing.circle(0, cy, r).stroke({ width: 2, color: PALETTE.eliteAura, alpha: 0.85 });
    view.eliteRing.visible = true;
  } else {
    view.eliteRing.visible = false;
  }

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
  if (kind === "ranged") {
    // Small crossbow-limb chevron at the weapon tip — "visible weapon".
    const tipX = front.x - armLen;
    const tipY = front.y;
    view.limbArm
      .moveTo(tipX, tipY - 3 * s)
      .lineTo(tipX + 3 * s, tipY)
      .lineTo(tipX, tipY + 3 * s)
      .stroke({ width: 1.4, color, cap: "round" });
  }
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
  const size = effectiveSize(enemy);
  if (view.kind !== enemy.kind) {
    view.kind = enemy.kind;
    buildRig(view, enemy.kind, size, ctx.mapId, !!enemy.elite);
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

  // Rig flip: only re-derive while actually moving with intent (see the
  // `EnemyAnimState.facing` doc comment) — holds its last value while
  // stationary (e.g. mid-swing, or ranged holding its AIM pose).
  if (!stationary) {
    anim.facing = velocity < 0 ? 1 : -1;
  }
  const facing = anim.facing;

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
  // The hop/landing-settle below is unchanged; the fade-in is new (DEATH &
  // SPAWN DRAMA v2) so the body "steps out of" `fx/portal.ts`'s ground
  // portal rather than just popping fully-formed into view.
  let spawnHop = 0;
  if (anim.spawnT >= 0 && anim.spawnT < SPAWN_DURATION) {
    anim.spawnT += dt;
    const p = clamp01(anim.spawnT / SPAWN_DURATION);
    spawnHop = -SPAWN_HOP_HEIGHT * (1 - easeOutBack(p));
    view.alpha = clamp01(anim.spawnT / SPAWN_FADE_DURATION);
    if (p >= 1) anim.spawnT = -1;
  }

  // ---- compose transforms ---------------------------------------------------
  // `dirOffX` mirrors the melee-lunge/ranged-recoil kick (baked assuming -x)
  // to whichever side `facing` currently points. `body`/`legs` flip about
  // their own local x=0 (already the entity's anchor — see `buildRig`'s
  // absolute-coordinate doc comment), so a plain `scale.x` sign flip mirrors
  // the silhouette with no path/pivot changes. `limbArm`'s pivot is BAKED at
  // build time to the unflipped `frontPoint` — mirroring its own `position`
  // by the same `facing` (in addition to its `scale.x`) keeps the shoulder
  // anchor + swing direction consistent instead of drifting off the body.
  const dirOffX = attackOffX * facing;
  view.body.position.set(dirOffX, GROUND_Y + pose.offY + spawnHop);
  view.body.scale.set(pose.scaleX * facing, pose.scaleY);

  view.legs.position.set(dirOffX * 0.6 + shuffleX * facing, pose.offY * 0.5 + spawnHop);
  view.legs.scale.x = facing;

  const front = frontPoint(enemy.kind, Math.max(0.1, size));
  view.limbArm.scale.x = facing;
  view.limbArm.rotation = anim.armAngle + attackArmDelta;
  view.limbArm.position.set(front.x * facing + dirOffX, front.y + pose.offY + spawnHop);

  view.position.set(enemy.x, 0);

  // ---- ASURA ELITE aura pulse (continuous, elite-only) ---------------------
  // Ring geometry is built ONCE in `buildRig`; every frame here only pulses
  // alpha/scale (a "build once, transform per frame" continuous visual, same
  // convention as `bossView.ts`'s enrage tint) — no `.clear()`/redraw cost.
  if (enemy.elite) {
    anim.eliteT += dt * ELITE_AURA_PULSE_SPEED;
    const pulse = Math.sin(anim.eliteT);
    view.eliteRing.alpha = clamp01(ELITE_AURA_ALPHA_BASE + ELITE_AURA_ALPHA_SWING * pulse);
    const auraScale = 1 + ELITE_AURA_SCALE_SWING * pulse;
    view.eliteRing.position.set(dirOffX, spawnHop);
    view.eliteRing.scale.set(auraScale);
  }

  drawHpBar(
    view.hpBar,
    0,
    GROUND_Y - 42 - 8 * size,
    enemy.hp,
    enemy.maxHp,
    30 * size,
  );
}
