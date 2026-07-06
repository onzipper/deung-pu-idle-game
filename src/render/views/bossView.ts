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
 * M7.9 "Grand Expansion" (per-boss silhouette + palette identity, 6 boss
 * stages s5/10/15/20/25/30): the body/crown/eye colors and the crown/horn/
 * shoulder shapes below are resolved from `bossThemes.ts` (`bossThemeForMap`,
 * keyed by `ctx.mapId`) instead of one hardcoded look — everything else in
 * this module (the continuous per-frame redraw, the pivoted-rig transform,
 * telegraph/enrage tells) is UNCHANGED by that task; only WHICH shapes/colors
 * get drawn each frame varies. Telegraph/enrage stay universal accent colors
 * across every boss (`PALETTE.warn`/`enrageAura`) so "red = danger" reads
 * consistently regardless of which boss is on screen — only the boss's own
 * idle identity comes from the theme.
 *
 * `state.boss` is set to `null` the SAME engine step `bossDefeated` fires (see
 * `engine/systems/boss.ts`), so `GameRenderer` destroys this view before any
 * "collapse forward" animation could play on it — that beat is therefore
 * handled as a one-shot echo in `fx/bossEcho.ts` off the event, not here
 * (same reasoning as `fx/corpseEcho.ts` for regular enemies). A team wipe no
 * longer retreats the boss in place — M6 "World & Town" routes it through
 * `respawnToTown` (walk home, revive in town) instead, so there is no second
 * "boss leaves" beat to handle here.
 */

import { Container, Graphics } from "pixi.js";
import { CONFIG } from "@/engine/config";
import type { Boss } from "@/engine/entities";
import type { GameEvent } from "@/engine/state";
import { GROUND_Y } from "@/render/layout";
import { PALETTE, safeRadius } from "@/render/theme";
import { bossThemeForMap } from "@/render/views/bossThemes";

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
  /** The map (`CONFIG.world.maps[].id`, e.g. `"map4"`) this boss belongs to —
   * drives `bossThemeForMap()`'s per-boss silhouette/palette (M7.9). Render
   * has no engine `Boss.mapId` field to read (the entity itself is map-
   * agnostic — see `engine/entities/index.ts`), so the caller resolves it via
   * `zoneAt(state.location).mapId` (only valid while `state.boss` is set,
   * i.e. standing in that map's boss room) and passes it through here.
   * Optional/undefined falls back to the map1 "Cave Guardian" theme. */
  mapId?: string;
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
  const theme = bossThemeForMap(ctx.mapId);
  const color = boss.telegraph > 0 ? PALETTE.warn : theme.bodyColor;
  const pulse = boss.telegraph > 0 ? 3 * Math.sin(ctx.elapsedMs / 40) : 0;
  const r = safeRadius(CORE_R + pulse);

  view.enrageAura.clear();
  // Footgun (same class as `heroView.ts`'s `gearArmor`, CLAUDE.md #2's family):
  // an empty-but-VISIBLE Graphics contributes a bounds point at its own local
  // origin, not wherever its absent content would have been — inside a
  // pivoted container (`bodyRoot`, pivot=(0, GROUND_Y)) that phantom local
  // (0,0) point maps to global y≈0, silently exploding `bodyRoot.getBounds()`
  // whenever the boss is neither enraged nor telegraphing (surfaced by the
  // M7.9 rig tests, `__tests__/rig.test.ts`). Explicit `visible` toggle, not
  // just `clear()`, keeps bounds meaningful with zero rendering difference
  // (an invisible empty Graphics draws nothing either way).
  view.enrageAura.visible = boss.enraged;
  if (boss.enraged) {
    const auraPulse = 0.18 + 0.1 * Math.sin(ctx.elapsedMs / 220);
    view.enrageAura
      .circle(0, CY, safeRadius(r + 10))
      .stroke({ width: 5, color: PALETTE.enrageAura, alpha: auraPulse });
  }

  // PROCEDURAL V2 (task 86d3k2nj3) + M7.9 per-boss theme: crown/horns +
  // armor-plate seams + menacing eyes, layered onto the same continuously-
  // redrawn hexagon body (see the module doc comment for why this redraws
  // every frame rather than build-once — it already did, before either
  // task). Horns/eyes tint to the UNIVERSAL `PALETTE.enrageAura` while
  // enraged (so the menace tell reads consistently across every boss); at
  // rest they use this boss's own `theme.crownColor`/`eyeColor` identity.
  const menaceColor = boss.enraged ? PALETTE.enrageAura : theme.crownColor;

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
  // Per-boss crown/horns silhouette (M7.9 — see `bossThemes.ts`), plus this
  // theme's optional extra flourish (shoulder plates / molten cracks).
  theme.drawCrown(g, r, CY, menaceColor);
  theme.drawExtra?.(g, r, CY, menaceColor);
  g.circle(0, CY, 10).fill(PALETTE.arenaSky);
  // Menacing eyes — brighten/redden with the enrage/telegraph state, else
  // this boss's own idle eye color.
  const eyeColor = boss.telegraph > 0 || boss.enraged ? PALETTE.warn : theme.eyeColor;
  g.circle(-4, CY - 2, 2).fill(eyeColor);
  g.circle(4, CY - 2, 2).fill(eyeColor);

  const ring = view.telegraphRing;
  ring.clear();
  // Same empty-but-visible bounds footgun as `enrageAura` above.
  ring.visible = boss.telegraph > 0;
  if (boss.telegraph > 0) {
    const total = boss.enraged ? CONFIG.boss.telegraphEnraged : CONFIG.boss.telegraphNormal;
    const frac = total > 0 ? Math.max(0, Math.min(1, boss.telegraph / total)) : 0;
    const ringR = safeRadius(CORE_R + 10 + frac * 60);
    const alpha = 0.35 + (1 - frac) * 0.5;
    ring.circle(0, CY, ringR).stroke({ width: 3, color: PALETTE.warn, alpha });
  }
}
