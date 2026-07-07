/**
 * WORLD BOSS "เสี่ยจ๋อง" view (hourly world boss, render wave).
 *
 * A DELIBERATELY distinct silhouette from every stage boss (owner spec:
 * "รูปทรงไม่เหมือนกับบอส/มอนที่มีตอนนี้ ดูแล้วรู้ว่า world boss") — a broad round
 * "flashy tycoon" figure (~2.5x a stage boss's `CORE_R`): gold chain + medallion,
 * dark sunglasses, a warm shirt-highlighted belly, a PERSISTENT gold aura ring at
 * the feet (not enrage-gated, unlike `bossView.ts`'s — this is a status/identity
 * cue, always on while he's up), and a handful of orbiting "coin glint" idle
 * sparkles (wealth, not combat, so this reads even at rest).
 *
 * Rig discipline mirrors `bossView.ts` exactly (same footgun classes apply):
 *   - `bodyRoot` is pivoted at `(0, GROUND_Y)` — every child Graphics path uses
 *     ABSOLUTE GROUND_Y-relative coordinates (CLAUDE.md footgun #1).
 *   - Every curved shape here is a FULL command (`circle()`/`ellipse()`/
 *     `roundRect()`/`regularPoly()`), never a partial `.arc()` after the pen has
 *     moved elsewhere (footgun #2) — no point-sampling needed since nothing here
 *     draws a partial ring/crescent.
 *   - Every radius/size is `safeRadius()`-clamped (footgun #3).
 *   - Flat/solid fills only, no gradients, no additive blend (footgun #10).
 *
 * `updateWorldBossView()` reuses the SAME event vocabulary `bossView.ts` reacts
 * to (`hit`/`bossSlamLand`/`enraged` transition) for its lunge/crush/shudder
 * poses — the world boss and a stage boss never coexist (mutually exclusive
 * phases: `state.boss` only lives in a boss room, `state.worldBoss.entity` only
 * in an open farm zone), so there is no cross-talk risk reusing the same event
 * types the same way `bossView.ts` already filters them (by event shape, not by
 * entity id).
 */

import { Container, Graphics } from "pixi.js";
import { CONFIG } from "@/engine/config";
import type { Boss } from "@/engine/entities";
import type { GameEvent } from "@/engine/state";
import { GROUND_Y } from "@/render/layout";
import { PALETTE, safeRadius } from "@/render/theme";

/** ~2.5x a stage boss's `CORE_R` (34) — the owner's explicit scale ask. */
export const WORLD_BOSS_CORE_R = 84;
/** Body center, GROUND_Y-relative — a touch higher than a stage boss's `CY`
 * (GROUND_Y-30) since this body is much taller. Exported so `FxController`/
 * `GameRenderer` can anchor shared-event beats (rings/damage numbers) at the
 * right height instead of the stage boss's fixed `BOSS_CY`. */
export const WORLD_BOSS_CY = GROUND_Y - 74;

const WALK_FREQ = Math.PI * 1.3; // a touch slower/heavier than the stage boss
const WALK_BOB_AMP = 5;
const WALK_LEAN = 0.03;

const WINDUP_RAISE = 14;
const WINDUP_LEAN = 0.07;

const SLAM_CRUSH_DURATION = 0.34;
const CRUSH_DROP = 11;
const CRUSH_SQUASH = 0.15;

const ENRAGE_SHUDDER_DURATION = 0.32;
const ENRAGE_SHUDDER_FREQ = 42;
const ENRAGE_SHUDDER_AMP = 0.05;
const ENRAGE_SCALE_TARGET = 1.05;
const ENRAGE_SCALE_SMOOTH = 3;
const IDLE_TREMOR_AMP_BASE = 0.005;
const IDLE_TREMOR_AMP_ENRAGED = 0.015;
const IDLE_TREMOR_FREQ_BASE = 1.0;
const IDLE_TREMOR_FREQ_ENRAGED = 2.8;

const LUNGE_DURATION = 0.22;
const LUNGE_PX = 9;

/** Idle "coin glint" sparkles — a fixed handful of small dots orbiting the
 * upper body, twinkling in/out (never a constant glow — same "twinkle, not a
 * glow" convention as `fx/gearSparkle.ts`). Purely decorative/continuous, no
 * event needed; built once, transform+redraw only. */
const GLINT_COUNT = 5;
const GLINT_ORBIT_R = WORLD_BOSS_CORE_R * 0.78;
const GLINT_RADIUS = 2.2;

type AttackKindAnim = "lunge" | "slamCrush" | "enrageShudder";

interface AttackAnim {
  kind: AttackKindAnim;
  t: number;
  duration: number;
}

interface GlintState {
  phase: number;
  speed: number;
  yFactor: number;
}

interface WorldBossAnimState {
  initialized: boolean;
  lastX: number;
  walkPhase: number;
  idlePhase: number;
  enrageScaleCurrent: number;
  wasEnraged: boolean;
  attack: AttackAnim | null;
  glints: GlintState[];
}

export interface WorldBossFrameContext {
  /** Real elapsed ms since renderer start — feeds the continuous aura pulse. */
  elapsedMs: number;
  /** Real (wall-clock) seconds since the previous draw(). */
  dt: number;
  /** This frame's collected engine events. */
  events: readonly GameEvent[];
}

export interface WorldBossView extends Container {
  bodyRoot: Container;
  body: Graphics;
  auraRing: Graphics;
  telegraphRing: Graphics;
  glintDots: Graphics[];
  anim: WorldBossAnimState;
}

export function createWorldBossView(): WorldBossView {
  const view = new Container() as WorldBossView;

  const bodyRoot = new Container();
  bodyRoot.pivot.set(0, GROUND_Y);
  bodyRoot.position.set(0, GROUND_Y);

  view.auraRing = new Graphics();
  view.telegraphRing = new Graphics();
  view.body = new Graphics();
  view.glintDots = Array.from({ length: GLINT_COUNT }, () => new Graphics());
  bodyRoot.addChild(view.auraRing, view.telegraphRing, view.body, ...view.glintDots);
  view.addChild(bodyRoot);
  view.bodyRoot = bodyRoot;

  view.anim = {
    initialized: false,
    lastX: 0,
    walkPhase: 0,
    idlePhase: 0,
    enrageScaleCurrent: 1,
    wasEnraged: false,
    attack: null,
    glints: Array.from({ length: GLINT_COUNT }, (_, i) => ({
      phase: (i / GLINT_COUNT) * Math.PI * 2,
      speed: 0.5 + (i % 3) * 0.12,
      yFactor: 0.4 + (i % 2) * 0.3,
    })),
  };
  return view;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function startAttack(anim: WorldBossAnimState, kind: AttackKindAnim, duration: number): void {
  anim.attack = { kind, t: 0, duration };
}

export function updateWorldBossView(
  view: WorldBossView,
  boss: Boss,
  ctx: WorldBossFrameContext,
): void {
  const anim = view.anim;
  const dt = Math.max(0, ctx.dt);

  if (!anim.initialized) {
    anim.initialized = true;
    anim.lastX = boss.x;
    anim.wasEnraged = boss.enraged;
  }

  if (boss.enraged && !anim.wasEnraged) {
    startAttack(anim, "enrageShudder", ENRAGE_SHUDDER_DURATION);
  }
  anim.wasEnraged = boss.enraged;

  // ---- locomotion (mirrors bossView.ts's heavy stomping advance) ----------
  const velocity = dt > 0 ? (boss.x - anim.lastX) / dt : 0;
  anim.lastX = boss.x;
  const speedFrac = clamp01(Math.abs(velocity) / Math.max(1, CONFIG.worldBoss.boss.moveSpeed));
  anim.walkPhase += dt * WALK_FREQ;
  anim.idlePhase += dt;

  const walkBob = Math.abs(Math.sin(anim.walkPhase)) * WALK_BOB_AMP * speedFrac;
  const walkLean = WALK_LEAN * speedFrac;

  // ---- slam wind-up tell ----------------------------------------------------
  let windupRaise = 0;
  let windupLean = 0;
  if (boss.telegraph > 0) {
    const total = boss.enraged
      ? CONFIG.worldBoss.boss.telegraphEnraged
      : CONFIG.worldBoss.boss.telegraphNormal;
    const progress = total > 0 ? clamp01(1 - boss.telegraph / total) : 0;
    windupRaise = progress * WINDUP_RAISE;
    windupLean = progress * WINDUP_LEAN;
  }

  // ---- enrage: permanent scale-up + faster idle tremor ---------------------
  const enrageScaleTarget = boss.enraged ? ENRAGE_SCALE_TARGET : 1;
  anim.enrageScaleCurrent +=
    (enrageScaleTarget - anim.enrageScaleCurrent) * clamp01(dt * ENRAGE_SCALE_SMOOTH);
  const tremorAmp = boss.enraged ? IDLE_TREMOR_AMP_ENRAGED : IDLE_TREMOR_AMP_BASE;
  const tremorFreq = boss.enraged ? IDLE_TREMOR_FREQ_ENRAGED : IDLE_TREMOR_FREQ_BASE;
  const tremor = Math.sin(anim.idlePhase * tremorFreq) * tremorAmp;

  // ---- basic-attack lunge / slam crush --------------------------------------
  if (!anim.attack) {
    for (const ev of ctx.events) {
      if (ev.type === "hit" && ev.target === "hero" && ev.source === "attack") {
        startAttack(anim, "lunge", LUNGE_DURATION);
        break;
      }
    }
  }
  for (const ev of ctx.events) {
    if (ev.type === "bossSlamLand") startAttack(anim, "slamCrush", SLAM_CRUSH_DURATION);
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
        const decay = 1 - progress;
        attackRotation = Math.sin(anim.attack.t * ENRAGE_SHUDDER_FREQ) * ENRAGE_SHUDDER_AMP * decay;
      }
    }
  }

  view.bodyRoot.position.set(attackOffX, GROUND_Y + walkBob - windupRaise + attackDropY);
  view.bodyRoot.rotation = walkLean + windupLean + tremor + attackRotation;
  view.bodyRoot.scale.set(
    anim.enrageScaleCurrent * attackScaleX,
    anim.enrageScaleCurrent * attackScaleY,
  );

  view.position.set(boss.x, 0);

  const R = safeRadius(WORLD_BOSS_CORE_R);
  const CY = WORLD_BOSS_CY;

  // ---- persistent gold aura ring at the feet — a STATUS cue, always on
  // (unlike bossView's enrage-only aura), pulsing gently; turns hotter/redder
  // while enraged so "danger" still reads on top of the wealth motif. --------
  const auraColor = boss.enraged ? PALETTE.enrageAura : PALETTE.worldBossGold;
  const aeraSpeed = boss.enraged ? 140 : 260;
  const auraPulse = 0.35 + 0.15 * Math.sin(ctx.elapsedMs / aeraSpeed);
  view.auraRing.clear();
  view.auraRing
    .ellipse(0, GROUND_Y - 2, R * 0.92, R * 0.3)
    .stroke({ width: 4, color: auraColor, alpha: auraPulse });
  view.auraRing
    .ellipse(0, GROUND_Y - 2, R * 0.6, R * 0.19)
    .stroke({ width: 2, color: PALETTE.worldBossGold, alpha: auraPulse * 0.6 });

  // ---- telegraph ring (universal "danger" tell, same language as bossView) -
  const ring = view.telegraphRing;
  ring.clear();
  ring.visible = boss.telegraph > 0;
  if (boss.telegraph > 0) {
    const total = boss.enraged
      ? CONFIG.worldBoss.boss.telegraphEnraged
      : CONFIG.worldBoss.boss.telegraphNormal;
    const frac = total > 0 ? clamp01(boss.telegraph / total) : 0;
    const ringR = safeRadius(R + 14 + frac * 70);
    const alpha = 0.35 + (1 - frac) * 0.5;
    ring.circle(0, CY, ringR).stroke({ width: 3, color: PALETTE.warn, alpha });
  }

  // ---- the tycoon body itself -----------------------------------------------
  const g = view.body;
  g.clear();

  // Suit body — broad round belly.
  const bodyColor = boss.telegraph > 0 ? PALETTE.warn : PALETTE.worldBossSuit;
  g.circle(0, CY, R).fill(bodyColor);
  // Shirt/belly highlight — flat alpha, no gradient.
  g.ellipse(0, CY + R * 0.22, R * 0.55, R * 0.42).fill({
    color: PALETTE.worldBossShirt,
    alpha: 0.9,
  });
  // Suit-shade seam down the middle (breaks up the flat circle silhouette).
  g.moveTo(0, CY - R * 0.7)
    .lineTo(0, CY + R * 0.75)
    .stroke({ width: 3, color: PALETTE.worldBossSuitShade, alpha: 0.4 });

  // Stubby arms (mirrored) — a rounded rect each side, gold ring "hand" accent.
  const armY = CY - R * 0.05;
  const armColor = PALETTE.worldBossSuit;
  g.roundRect(R * 0.68, armY - R * 0.14, R * 0.38, R * 0.32, R * 0.14).fill(armColor);
  g.roundRect(-R * 0.68 - R * 0.38, armY - R * 0.14, R * 0.38, R * 0.32, R * 0.14).fill(armColor);
  g.circle(R * 0.68 + R * 0.38 + 2, armY + R * 0.02, safeRadius(R * 0.06)).fill(
    PALETTE.worldBossGold,
  );
  g.circle(-R * 0.68 - R * 0.38 - 2, armY + R * 0.02, safeRadius(R * 0.06)).fill(
    PALETTE.worldBossGold,
  );

  // Head — sits above the belly.
  const headCy = CY - R * 0.98;
  const headR = safeRadius(R * 0.42);
  g.circle(0, headCy, headR).fill(PALETTE.npcSkin);

  // Dark sunglasses — two rounded rects + a bridge line.
  const lensW = headR * 0.62;
  const lensH = headR * 0.4;
  const lensY = headCy - headR * 0.08;
  const menaceColor = boss.enraged ? PALETTE.enrageAura : PALETTE.worldBossLens;
  g.roundRect(-lensW - headR * 0.1, lensY - lensH / 2, lensW, lensH, lensH * 0.3).fill(
    menaceColor,
  );
  g.roundRect(headR * 0.1, lensY - lensH / 2, lensW, lensH, lensH * 0.3).fill(menaceColor);
  g.moveTo(-headR * 0.1, lensY).lineTo(headR * 0.1, lensY).stroke({
    width: 2,
    color: menaceColor,
  });
  // A telegraph/enrage rim glint on the lenses (universal "eyes go hot" tell).
  if (boss.telegraph > 0 || boss.enraged) {
    g.circle(-headR * 0.1 - lensW * 0.5, lensY, safeRadius(1.6)).fill(PALETTE.warn);
    g.circle(headR * 0.1 + lensW * 0.5, lensY, safeRadius(1.6)).fill(PALETTE.warn);
  }

  // Gold chain — a shallow "V" strand across the chest + a few round links +
  // one bigger medallion pendant at the low point.
  const chainTopY = CY - R * 0.62;
  const chainLowY = CY - R * 0.18;
  const chainSpan = R * 0.5;
  g.moveTo(-chainSpan, chainTopY)
    .lineTo(0, chainLowY)
    .lineTo(chainSpan, chainTopY)
    .stroke({ width: 2.5, color: PALETTE.worldBossGold, alpha: 0.95 });
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const lx = -chainSpan + t * chainSpan;
    const ly = chainTopY + t * (chainLowY - chainTopY);
    g.circle(lx, ly, safeRadius(2)).fill(PALETTE.worldBossGold);
    const rx = chainSpan - t * chainSpan;
    g.circle(rx, ly, safeRadius(2)).fill(PALETTE.worldBossGold);
  }
  g.circle(0, chainLowY, safeRadius(R * 0.1)).fill(PALETTE.worldBossGold);
  g.circle(0, chainLowY, safeRadius(R * 0.05)).fill(PALETTE.worldBossGoldDark);

  // ---- idle "coin glint" sparkle — orbiting, twinkling, always on (wealth
  // motif reads even at rest, not just mid-fight). ----------------------------
  for (let i = 0; i < view.glintDots.length; i++) {
    const gl = anim.glints[i];
    gl.phase += dt * gl.speed;
    const orbitR = GLINT_ORBIT_R * (0.7 + 0.3 * gl.yFactor);
    const gx = Math.cos(gl.phase) * orbitR;
    const gy = CY - R * 0.5 + Math.sin(gl.phase) * orbitR * gl.yFactor;
    const twinkle = 0.35 + 0.45 * Math.max(0, Math.sin(gl.phase * 2.3 + i));
    const dot = view.glintDots[i];
    dot.clear();
    dot.circle(gx, gy, safeRadius(GLINT_RADIUS)).fill({
      color: PALETTE.worldBossGold,
      alpha: twinkle,
    });
  }
}
