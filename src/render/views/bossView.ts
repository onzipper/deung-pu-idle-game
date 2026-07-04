/**
 * Boss view: big hexagon body — topped with a crown/horns, armor-plate
 * seams, and menacing eyes (PROCEDURAL V2, task 86d3k2nj3) — + a procedural
 * rig giving it a heavy, readable presence — slow stomping advance, an
 * unmistakable slam wind-up "tell" that peaks exactly when the telegraph
 * ends, a permanent enrage scale-up + tremor, and small attack/crush beats.
 *
 *   BossView (Container, position = boss.x + lunge, each frame)
 *   └── bodyRoot (Container, pivot+position = (0, GROUND_Y) — ground pivot for
 *       bob/lean/windup-raise/crush-squash/enrage-scale composition)
 *       ├── enrageAura (Graphics, redrawn every frame — continuous state)
 *       ├── telegraphRing (Graphics, redrawn every frame — continuous state)
 *       └── body (Graphics, redrawn every frame — continuous state; hexagon
 *           + crown/horns + plate seams + eyes, all one Graphics)
 *
 * `body`/`enrageAura`/`telegraphRing` already redrew from scratch every frame
 * BEFORE this rig existed (their color/radius pulse off `boss.telegraph`/
 * `boss.enraged`, continuous state, not a one-shot event) — that established
 * pattern is kept; only `bodyRoot`'s TRANSFORM is new.
 *
 * IMPORTANT (see `heroView.ts`'s doc comment + `__tests__/rig.test.ts` for the
 * full story): `bodyRoot.pivot === bodyRoot`'s baseline `position`
 * (`(0, GROUND_Y)`), so every child's Graphics path MUST use absolute
 * GROUND_Y-relative coordinates (exactly as the original flat code did) —
 * never pre-subtract the pivot, or the whole rig collapses toward world y≈0.
 *
 * `state.boss` is set to `null` the SAME engine step `bossDefeated`/
 * `bossRetreat` fire (see `engine/systems/boss.ts`), so `GameRenderer`
 * destroys this view before any "collapse forward"/"turn away and slide out"
 * animation could play on it — those two beats are therefore handled as a
 * one-shot echo in `fx/bossEcho.ts` off the event, not here (same reasoning
 * as `fx/corpseEcho.ts` for regular enemies).
 */

import { Container, Graphics } from "pixi.js";
import { CONFIG } from "@/engine/config";
import type { Boss } from "@/engine/entities";
import type { GameEvent } from "@/engine/state";
import { GROUND_Y } from "@/render/layout";
import { PALETTE, safeRadius } from "@/render/theme";

const CY = GROUND_Y - 30;
const CORE_R = 34;

// ---------------------------------------------------------------------------
// Locomotion / pose tuning.
// ---------------------------------------------------------------------------
const WALK_FREQ = Math.PI * 1.6; // slow — heavy stomping advance
const WALK_BOB_AMP = 4;
const WALK_LEAN = 0.035;

const WINDUP_RAISE = 10; // px risen at telegraph's END (the fairness tell peak)
const WINDUP_LEAN = 0.08;

const SLAM_CRUSH_DURATION = 0.32;
const CRUSH_DROP = 9;
const CRUSH_SQUASH = 0.16;

const ENRAGE_SHUDDER_DURATION = 0.32;
const ENRAGE_SHUDDER_FREQ = 46;
const ENRAGE_SHUDDER_AMP = 0.06;
const ENRAGE_SCALE_TARGET = 1.06;
const ENRAGE_SCALE_SMOOTH = 3;
const IDLE_TREMOR_AMP_BASE = 0.006;
const IDLE_TREMOR_AMP_ENRAGED = 0.018;
const IDLE_TREMOR_FREQ_BASE = 1.1;
const IDLE_TREMOR_FREQ_ENRAGED = 3.2;

const LUNGE_DURATION = 0.22;
const LUNGE_PX = 8;

type AttackKindAnim = "lunge" | "slamCrush" | "enrageShudder";

interface AttackAnim {
  kind: AttackKindAnim;
  t: number;
  duration: number;
}

interface BossAnimState {
  initialized: boolean;
  lastX: number;
  lastCd: number;
  walkPhase: number;
  idlePhase: number;
  enrageScaleCurrent: number;
  wasEnraged: boolean;
  attack: AttackAnim | null;
}

export interface BossFrameContext {
  /** Real elapsed ms since renderer start — feeds the existing continuous
   * telegraph/enrage-aura pulses (unchanged from before this rig existed). */
  elapsedMs: number;
  /** Real (wall-clock) seconds since the previous draw() — drives every
   * transient attack/crush/shudder timer. */
  dt: number;
  /** This frame's collected engine events. */
  events: readonly GameEvent[];
}

export interface BossView extends Container {
  bodyRoot: Container;
  body: Graphics;
  telegraphRing: Graphics;
  /** Persistent enrage aura (M4 juice) — driven straight off `boss.enraged`,
   * not an event, since it's continuous state rather than a one-shot beat. */
  enrageAura: Graphics;
  anim: BossAnimState;
}

export function createBossView(): BossView {
  const view = new Container() as BossView;

  const bodyRoot = new Container();
  bodyRoot.pivot.set(0, GROUND_Y);
  bodyRoot.position.set(0, GROUND_Y);

  view.enrageAura = new Graphics();
  view.body = new Graphics();
  view.telegraphRing = new Graphics();
  bodyRoot.addChild(view.enrageAura, view.telegraphRing, view.body);
  view.addChild(bodyRoot);
  view.bodyRoot = bodyRoot;

  view.anim = {
    initialized: false,
    lastX: 0,
    lastCd: 0,
    walkPhase: 0,
    idlePhase: 0,
    enrageScaleCurrent: 1,
    wasEnraged: false,
    attack: null,
  };
  return view;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function startAttack(anim: BossAnimState, kind: AttackKindAnim, duration: number): void {
  anim.attack = { kind, t: 0, duration };
}

export function updateBossView(view: BossView, boss: Boss, ctx: BossFrameContext): void {
  const anim = view.anim;
  const dt = Math.max(0, ctx.dt);

  if (!anim.initialized) {
    anim.initialized = true;
    anim.lastX = boss.x;
    anim.lastCd = boss.cd;
    anim.wasEnraged = boss.enraged;
  }

  if (boss.enraged && !anim.wasEnraged) {
    startAttack(anim, "enrageShudder", ENRAGE_SHUDDER_DURATION);
  }
  anim.wasEnraged = boss.enraged;

  // ---- locomotion: heavy stomping advance (position-delta driven) --------
  const velocity = dt > 0 ? (boss.x - anim.lastX) / dt : 0;
  anim.lastX = boss.x;
  const speedFrac = clamp01(Math.abs(velocity) / Math.max(1, CONFIG.boss.moveSpeed));
  anim.walkPhase += dt * WALK_FREQ;
  anim.idlePhase += dt;

  const walkBob = Math.abs(Math.sin(anim.walkPhase)) * WALK_BOB_AMP * speedFrac;
  const walkLean = WALK_LEAN * speedFrac;

  // ---- slam wind-up "tell": rises to its peak EXACTLY as telegraph ends --
  let windupRaise = 0;
  let windupLean = 0;
  if (boss.telegraph > 0) {
    const total = boss.enraged ? CONFIG.boss.telegraphEnraged : CONFIG.boss.telegraphNormal;
    const progress = total > 0 ? clamp01(1 - boss.telegraph / total) : 0;
    windupRaise = progress * WINDUP_RAISE;
    windupLean = progress * WINDUP_LEAN;
  }

  // ---- enrage: permanent scale-up (smoothed in) + faster idle tremor -----
  const enrageScaleTarget = boss.enraged ? ENRAGE_SCALE_TARGET : 1;
  anim.enrageScaleCurrent +=
    (enrageScaleTarget - anim.enrageScaleCurrent) * clamp01(dt * ENRAGE_SCALE_SMOOTH);
  const tremorAmp = boss.enraged ? IDLE_TREMOR_AMP_ENRAGED : IDLE_TREMOR_AMP_BASE;
  const tremorFreq = boss.enraged ? IDLE_TREMOR_FREQ_ENRAGED : IDLE_TREMOR_FREQ_BASE;
  const tremor = Math.sin(anim.idlePhase * tremorFreq) * tremorAmp;

  // ---- basic-attack lunge: boss is a singleton, so (unlike enemies/heroes'
  // melee) its own `hit` events are unambiguous — filter to its own basic
  // attack (`source: "attack"`), not the slam (already covered by the crush
  // pose below) or anything else.
  if (!anim.attack) {
    for (const ev of ctx.events) {
      if (ev.type === "hit" && ev.target === "hero" && ev.source === "attack") {
        startAttack(anim, "lunge", LUNGE_DURATION);
        break;
      }
    }
  }
  for (const ev of ctx.events) {
    if (ev.type === "bossSlamLand") {
      startAttack(anim, "slamCrush", SLAM_CRUSH_DURATION);
    }
  }

  let attackOffX = 0;
  let attackDropY = 0;
  let attackRotation = 0;
  let attackScaleX = 1;
  let attackScaleY = 1;
  if (anim.attack) {
    anim.attack.t += dt;
    if (anim.attack.t >= anim.attack.duration) {
      anim.attack = null;
    } else {
      const progress = clamp01(anim.attack.t / anim.attack.duration);
      if (anim.attack.kind === "lunge") {
        attackOffX = -Math.sin(progress * Math.PI) * LUNGE_PX;
      } else if (anim.attack.kind === "slamCrush") {
        const settle = Math.sin(progress * Math.PI);
        attackDropY = settle * CRUSH_DROP;
        attackScaleY = 1 - settle * CRUSH_SQUASH;
        attackScaleX = 1 + settle * CRUSH_SQUASH * 0.6;
      } else {
        // enrageShudder: quick decaying shake, independent of the permanent
        // scale-up (which is handled continuously above).
        const decay = 1 - progress;
        attackRotation = Math.sin(anim.attack.t * ENRAGE_SHUDDER_FREQ) * ENRAGE_SHUDDER_AMP * decay;
      }
    }
  }

  // windupRaise SUBTRACTS (rises, Pixi is y-down) as the telegraph closes in.
  view.bodyRoot.position.set(attackOffX, GROUND_Y + walkBob - windupRaise + attackDropY);
  view.bodyRoot.rotation = walkLean + windupLean + tremor + attackRotation;
  view.bodyRoot.scale.set(
    anim.enrageScaleCurrent * attackScaleX,
    anim.enrageScaleCurrent * attackScaleY,
  );

  view.position.set(boss.x, 0);

  // ---- continuous, state-driven redraws (unchanged behaviour from before
  // this rig existed — see the module doc comment). Absolute coordinates,
  // per the pivot convention documented above. ------------------------------
  const color = boss.telegraph > 0 ? PALETTE.warn : PALETTE.boss;
  const pulse = boss.telegraph > 0 ? 3 * Math.sin(ctx.elapsedMs / 40) : 0;
  const r = safeRadius(CORE_R + pulse);

  view.enrageAura.clear();
  if (boss.enraged) {
    const auraPulse = 0.18 + 0.1 * Math.sin(ctx.elapsedMs / 220);
    view.enrageAura
      .circle(0, CY, safeRadius(r + 10))
      .stroke({ width: 5, color: PALETTE.enrageAura, alpha: auraPulse });
  }

  // PROCEDURAL V2 (task 86d3k2nj3): crown/horns + armor-plate seams +
  // menacing eyes, layered onto the same continuously-redrawn hexagon body
  // (see the module doc comment for why this redraws every frame rather
  // than build-once — it already did, before this task). Horns/eyes tint to
  // `PALETTE.enrageAura` while enraged so the menace reads at a glance, on
  // top of the existing body-color/aura enrage tells.
  const menaceColor = boss.enraged ? PALETTE.enrageAura : PALETTE.bossLight;

  const g = view.body;
  g.clear();
  g.regularPoly(0, CY, r, 6, Math.PI / 6).fill(color);
  // Armor-plate seams — flat-alpha lines across the hexagon face.
  g.moveTo(-r * 0.55, CY - r * 0.32)
    .lineTo(r * 0.55, CY - r * 0.32)
    .stroke({ width: 2, color: 0x000000, alpha: 0.22 });
  g.moveTo(-r * 0.4, CY + r * 0.28)
    .lineTo(r * 0.4, CY + r * 0.28)
    .stroke({ width: 2, color: 0x000000, alpha: 0.18 });
  // Horns + a small crown spike, rising off the top of the hexagon.
  g.poly(
    [-r * 0.32, CY - r * 0.85, -r * 0.52, CY - r * 1.55, -r * 0.1, CY - r * 0.95],
    true,
  ).fill(menaceColor);
  g.poly(
    [r * 0.32, CY - r * 0.85, r * 0.52, CY - r * 1.55, r * 0.1, CY - r * 0.95],
    true,
  ).fill(menaceColor);
  g.poly([-r * 0.1, CY - r * 0.95, r * 0.1, CY - r * 0.95, 0, CY - r * 1.3], true).fill(
    PALETTE.bossLight,
  );
  g.circle(0, CY, 10).fill(PALETTE.arenaSky);
  // Menacing eyes — brighten/redden with the enrage/telegraph state.
  const eyeColor = boss.telegraph > 0 || boss.enraged ? PALETTE.warn : PALETTE.bossLight;
  g.circle(-4, CY - 2, 2).fill(eyeColor);
  g.circle(4, CY - 2, 2).fill(eyeColor);

  const ring = view.telegraphRing;
  ring.clear();
  if (boss.telegraph > 0) {
    const total = boss.enraged ? CONFIG.boss.telegraphEnraged : CONFIG.boss.telegraphNormal;
    const frac = total > 0 ? Math.max(0, Math.min(1, boss.telegraph / total)) : 0;
    const ringR = safeRadius(CORE_R + 10 + frac * 60);
    const alpha = 0.35 + (1 - frac) * 0.5;
    ring.circle(0, CY, ringR).stroke({ width: 3, color: PALETTE.warn, alpha });
  }
}
