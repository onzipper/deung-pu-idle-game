/**
 * Town NPC views (ป้าปุ๊ the merchant / ลุงดึ๋ง the refine smith) — the town
 * biome's decorative NPC silhouettes (`environment/groundProps.ts`'s
 * `npcSilhouette`, still ambient crowd flavor) stay as-is; these two rigs are
 * the REAL, distinct, named, tappable actors.
 *
 * Same build-once/GROUND_Y-relative/pivot convention as `heroView.ts` (see
 * that module's doc comment + `rig.test.ts`'s transform-math guard): every
 * pivoted container sets `pivot === position` at a fixed point so it can
 * rotate/scale about that point with zero net translation at rest, and every
 * Graphics path is drawn in ABSOLUTE (GROUND_Y-relative) coordinates —
 * pre-subtracting the pivot in path data is exactly footgun #1 (CLAUDE.md).
 *
 *   NpcView (Container, position.x = the anchor's fixed world-x, y = 0 — see
 *            `townNpcs.ts`; position never changes again after `create`)
 *   ├── stallProps / smithProps (Graphics, STATIC set dressing — stall+
 *   │   basket or anvil — never animated, drawn once, siblings of bodyRoot so
 *   │   they don't breathe/bob with the person)
 *   ├── bodyRoot (Container, pivot+position = feet)
 *   │   ├── lowerBody (Graphics: robe/legs wedge, static)
 *   │   └── upperBody (Container, pivot+position = hip — breathes via scale,
 *   │       same technique `heroView.ts` uses)
 *   │       ├── torso (Graphics: robe/tunic + head)
 *   │       └── hammerArm (Graphics, ลุงดึ๋ง ONLY — pivot = shoulder, swings
 *   │           through an idle "raise then strike" beat)
 *   ├── sparks (ลุงดึ๋ง ONLY: a tiny fixed pool of pooled Graphics dots, one
 *   │   flash per hammer strike — real-dt, capped, never allocated per-strike)
 *   ├── nameLabel (Text, floating name plate above the head)
 *   └── affordanceRing (Graphics: soft pulsing "แตะได้" ring at the feet —
 *       NOT a quest marker arrow, just a gentle glint)
 *
 * Every frame after the initial build only mutates transforms/alpha — no
 * Graphics path is ever re-walked (the hammer swing rotates a build-once arm,
 * the affordance ring pulses alpha/scale on a build-once circle).
 */

import { Container, Graphics, Text } from "pixi.js";
import { GROUND_Y } from "@/render/layout";
import { PALETTE, safeRadius } from "@/render/theme";
import { townNpcAnchor, type TownNpcId } from "@/render/townNpcs";

// ---------------------------------------------------------------------------
// Shared person-rig geometry (absolute, GROUND_Y-relative — see doc comment).
// ---------------------------------------------------------------------------
const FEET_Y = GROUND_Y - 4;
const HIP_Y = GROUND_Y - 26;
const HEAD_Y = GROUND_Y - 48;
const HEAD_R = 6.5;
const SHOULDER_Y = HEAD_Y + 9;

const BREATH_SPEED = Math.PI * 0.7; // slower/calmer than the hero's combat-ready breathing
const BREATH_SCALE_AMPLITUDE = 0.02;
const SWAY_SPEED = Math.PI * 0.3;
const SWAY_AMPLITUDE = 0.025;

// "แตะได้" affordance ring pulse.
const AFFORDANCE_RADIUS = 16;
const AFFORDANCE_PULSE_SPEED = 2.0;
const AFFORDANCE_MIN_ALPHA = 0.15;
const AFFORDANCE_MAX_ALPHA = 0.55;

// ลุงดึ๋ง's hammer idle beat: a slow raise, then a quick strike, holding
// briefly before the cycle repeats — "occasional tap", not a constant grind.
const HAMMER_PERIOD = 2.6; // seconds per full cycle
const HAMMER_RAISE_FRAC = 0.55; // fraction of the period spent slowly raising
const HAMMER_STRIKE_FRAC = 0.12; // fraction spent on the fast downswing
const HAMMER_REST_ANGLE = 0.15;
const HAMMER_RAISE_ANGLE = -1.05;
const HAMMER_STRIKE_ANGLE = 0.4;
const SPARK_COUNT = 3;
const SPARK_LIFE = 0.28;

interface NpcAnimState {
  breathPhase: number;
  swayPhase: number;
  affordancePhase: number;
  /** Elapsed seconds within the current `HAMMER_PERIOD` cycle (smith only). */
  hammerT: number;
  /** Whether the spark burst has already fired THIS cycle (smith only) —
   * guards against re-spawning more than once per strike; reset the instant
   * `hammerT` wraps back to a new cycle. */
  sparkedThisCycle: boolean;
}

interface SparkSlot {
  g: Graphics;
  active: boolean;
  age: number;
}

export interface NpcView extends Container {
  npcId: TownNpcId;
  bodyRoot: Container;
  upperBody: Container;
  nameLabel: Text;
  affordanceRing: Graphics;
  /** ลุงดึ๋ง only — `null` for ป้าปุ๊. */
  hammerArm: Graphics | null;
  sparks: SparkSlot[];
  /** World-space point (view-local, since `view.position.x` is the anchor's
   * fixed world-x and `y` is always 0) a UI-triggered speech bubble should
   * anchor above — see `GameRenderer.showNpcSpeech()`. */
  headAnchor: { x: number; y: number };
  anim: NpcAnimState;
}

export interface NpcUpdateCtx {
  /** Real seconds since the last frame (never sub-step count — same
   * real-time convention as every other continuous render-only animation). */
  dt: number;
  /** Only true while standing in the town zone — gates both visibility and
   * the (otherwise free-running) idle animation work. */
  visible: boolean;
}

function buildLowerBody(color: number, shade: number): Graphics {
  const g = new Graphics();
  g.poly(
    [-7, FEET_Y, -5, HIP_Y, 5, HIP_Y, 7, FEET_Y],
    true,
  ).fill({ color, alpha: 0.92 });
  g.poly([-7, FEET_Y, -5, HIP_Y, -1, HIP_Y, -2, FEET_Y], true).fill({
    color: shade,
    alpha: 0.5,
  });
  g.poly([-7, FEET_Y, -5, HIP_Y, 5, HIP_Y, 7, FEET_Y], true).stroke({
    width: 1,
    color: PALETTE.outline,
    alpha: 0.6,
  });
  return g;
}

/** Torso (robe/tunic wedge + head) drawn in ABSOLUTE coords, pivot handled by
 * the caller (`upperBody`'s pivot === position === (0, HIP_Y)). */
function buildTorso(bodyColor: number, shadeColor: number): Graphics {
  const g = new Graphics();
  g.poly([-6, HIP_Y, -8, SHOULDER_Y, 8, SHOULDER_Y, 6, HIP_Y], true).fill({
    color: bodyColor,
    alpha: 0.95,
  });
  g.poly([-6, HIP_Y, -8, SHOULDER_Y, -1, SHOULDER_Y, -2, HIP_Y], true).fill({
    color: shadeColor,
    alpha: 0.45,
  });
  g.poly([-6, HIP_Y, -8, SHOULDER_Y, 8, SHOULDER_Y, 6, HIP_Y], true).stroke({
    width: 1.2,
    color: PALETTE.outline,
    alpha: 0.7,
  });
  g.circle(0, HEAD_Y, safeRadius(HEAD_R)).fill({ color: PALETTE.npcSkin, alpha: 0.95 });
  g.circle(0, HEAD_Y, safeRadius(HEAD_R)).stroke({
    width: 1,
    color: PALETTE.outline,
    alpha: 0.6,
  });
  // Small round arm stubs, resting at the sides — plain flat-alpha, no
  // separate articulated arm (these two rigs stay simpler than the hero's).
  g.circle(-9, SHOULDER_Y + 8, safeRadius(2.6)).fill({ color: bodyColor, alpha: 0.9 });
  g.circle(9, SHOULDER_Y + 8, safeRadius(2.6)).fill({ color: bodyColor, alpha: 0.9 });
  return g;
}

/** ป้าปุ๊'s market stall (posts + awning + counter + basket) — static set
 * dressing behind/around the figure, added as a sibling of `bodyRoot` so it
 * never breathes/bobs. Built in ABSOLUTE (GROUND_Y-relative) coords. */
function buildStallProps(): Graphics {
  const g = new Graphics();
  const postTop = GROUND_Y - 60;
  const counterY = GROUND_Y - 20;
  // Posts.
  g.rect(-22, postTop, 3, HIP_Y - postTop + 6).fill({ color: PALETTE.npcStallWood, alpha: 0.9 });
  g.rect(19, postTop, 3, HIP_Y - postTop + 6).fill({ color: PALETTE.npcStallWood, alpha: 0.9 });
  // Awning (trapezoid canopy).
  g.poly(
    [-26, postTop, 26, postTop, 20, postTop - 14, -20, postTop - 14],
    true,
  ).fill({ color: PALETTE.npcApron, alpha: 0.92 });
  g.poly(
    [-26, postTop, 26, postTop, 20, postTop - 14, -20, postTop - 14],
    true,
  ).stroke({ width: 1, color: PALETTE.outline, alpha: 0.6 });
  // Awning stripe accent.
  g.rect(-20, postTop - 10, 40, 3).fill({ color: PALETTE.npcApronShade, alpha: 0.6 });
  // Counter.
  g.roundRect(-24, counterY, 48, 10, 2).fill({ color: PALETTE.npcStallWood, alpha: 0.95 });
  g.roundRect(-24, counterY, 48, 10, 2).stroke({ width: 1, color: PALETTE.outline, alpha: 0.6 });
  // Basket on the counter.
  g.poly(
    [10, counterY, 12, counterY - 7, 20, counterY - 7, 21, counterY],
    true,
  ).fill({ color: PALETTE.npcBasket, alpha: 0.9 });
  g.moveTo(12, counterY - 7)
    .lineTo(16, counterY - 11)
    .lineTo(20, counterY - 7)
    .stroke({ width: 1.4, color: PALETTE.npcStallWood, alpha: 0.9 });
  return g;
}

/** ลุงดึ๋ง's anvil (static, sibling of `bodyRoot`). Built in ABSOLUTE
 * (GROUND_Y-relative) coords, positioned to the figure's off-hand side. */
function buildAnvilProps(): Graphics {
  const g = new Graphics();
  const topY = GROUND_Y - 20;
  g.rect(14, topY + 8, 6, FEET_Y - (topY + 8)).fill({ color: PALETTE.npcAnvil, alpha: 0.95 }); // stand
  g.poly(
    [8, topY + 8, 26, topY + 8, 30, topY, 4, topY],
    true,
  ).fill({ color: PALETTE.npcAnvil, alpha: 0.95 }); // body
  g.poly([8, topY + 8, 26, topY + 8, 30, topY, 4, topY], true).stroke({
    width: 1,
    color: PALETTE.outline,
    alpha: 0.7,
  });
  g.rect(4, topY - 2, 26, 3).fill({ color: PALETTE.npcAnvilHighlight, alpha: 0.85 }); // top face
  // Horn (the anvil's pointed working end).
  g.poly([30, topY, 38, topY - 3, 30, topY + 5], true).fill({
    color: PALETTE.npcAnvil,
    alpha: 0.95,
  });
  return g;
}

/** Build ONCE, first sight (mirrors `createHeroView`/`createEnemyView`). */
export function createNpcView(npcId: TownNpcId): NpcView {
  const view = new Container() as NpcView;
  view.npcId = npcId;
  const isSmith = npcId === "npc:lungdueng";

  const anchor = townNpcAnchor(npcId);
  view.position.set(anchor.x, 0);

  const bodyColor = isSmith ? PALETTE.npcSmithTunic : PALETTE.npcApron;
  const shadeColor = isSmith ? PALETTE.npcSmithTunicShade : PALETTE.npcApronShade;

  // Static set dressing goes in FIRST (behind the figure).
  const props = isSmith ? buildAnvilProps() : buildStallProps();
  view.addChild(props);

  const bodyRoot = new Container();
  bodyRoot.pivot.set(0, FEET_Y);
  bodyRoot.position.set(0, FEET_Y);

  const lowerBody = buildLowerBody(bodyColor, shadeColor);

  const upperBody = new Container();
  upperBody.pivot.set(0, HIP_Y);
  upperBody.position.set(0, HIP_Y);
  const torso = buildTorso(bodyColor, shadeColor);
  upperBody.addChild(torso);

  let hammerArm: Graphics | null = null;
  if (isSmith) {
    hammerArm = new Graphics();
    hammerArm.pivot.set(9, SHOULDER_Y + 4);
    hammerArm.position.set(9, SHOULDER_Y + 4);
    // Forearm + hammer head, drawn in ABSOLUTE coords from the shoulder
    // pivot point outward (same convention `heroView.ts`'s `weaponArm` uses).
    hammerArm
      .moveTo(9, SHOULDER_Y + 4)
      .lineTo(9, SHOULDER_Y + 16)
      .stroke({ width: 3, color: PALETTE.npcSkin, cap: "round" });
    hammerArm.rect(4, SHOULDER_Y + 15, 10, 4).fill({ color: PALETTE.npcStallWood, alpha: 0.9 }); // handle
    hammerArm
      .roundRect(0, SHOULDER_Y + 10, 18, 8, 2)
      .fill({ color: PALETTE.npcAnvil, alpha: 0.95 }); // hammer head
    hammerArm.roundRect(0, SHOULDER_Y + 10, 18, 8, 2).stroke({
      width: 1,
      color: PALETTE.outline,
      alpha: 0.6,
    });
    upperBody.addChild(hammerArm);
  }

  bodyRoot.addChild(lowerBody, upperBody);
  view.addChild(bodyRoot);

  // Sparks: a fixed, tiny pool of pooled dots (smith only) — never allocated
  // per-strike, just reused round-robin (`SPARK_COUNT` is generous for "one
  // burst at a time").
  const sparks: SparkSlot[] = [];
  if (isSmith) {
    for (let i = 0; i < SPARK_COUNT; i++) {
      const g = new Graphics();
      g.circle(0, 0, safeRadius(1.8)).fill({ color: PALETTE.npcEmberSpark, alpha: 0.95 });
      g.visible = false;
      view.addChild(g);
      sparks.push({ g, active: false, age: 0 });
    }
  }

  const affordanceRing = new Graphics();
  affordanceRing
    .circle(0, FEET_Y + 1, safeRadius(AFFORDANCE_RADIUS))
    .stroke({ width: 1.6, color: PALETTE.npcAffordance, alpha: 1 });
  view.addChild(affordanceRing);

  const nameLabel = new Text({
    text: anchor.name,
    style: {
      fontSize: 12,
      fontWeight: "700",
      fill: PALETTE.ivory,
      fontFamily: "sans-serif",
    },
  });
  nameLabel.anchor.set(0.5);
  nameLabel.position.set(0, HEAD_Y - HEAD_R - 12);
  view.addChild(nameLabel);

  view.bodyRoot = bodyRoot;
  view.upperBody = upperBody;
  view.nameLabel = nameLabel;
  view.affordanceRing = affordanceRing;
  view.hammerArm = hammerArm;
  view.sparks = sparks;
  view.headAnchor = { x: anchor.x, y: HEAD_Y };
  view.anim = {
    breathPhase: Math.random() * Math.PI * 2,
    swayPhase: Math.random() * Math.PI * 2,
    affordancePhase: Math.random() * Math.PI * 2,
    hammerT: Math.random() * HAMMER_PERIOD, // de-sync from any other smith-like view
    sparkedThisCycle: false,
  };

  return view;
}

/** Every frame: transforms/alpha only, never a path rebuild (see doc
 * comment). Safe to call even while `ctx.visible` is false (cheap early-out)
 * so the caller doesn't need extra branching. */
export function updateNpcView(view: NpcView, ctx: NpcUpdateCtx): void {
  view.visible = ctx.visible;
  if (!ctx.visible) return;

  const dt = Math.max(0, ctx.dt);
  const anim = view.anim;
  anim.breathPhase += dt * BREATH_SPEED;
  anim.swayPhase += dt * SWAY_SPEED;
  anim.affordancePhase += dt * AFFORDANCE_PULSE_SPEED;

  const breathScale = 1 + Math.sin(anim.breathPhase) * BREATH_SCALE_AMPLITUDE;
  view.upperBody.scale.set(breathScale, breathScale);
  view.upperBody.rotation = Math.sin(anim.swayPhase) * SWAY_AMPLITUDE;

  const pulse = 0.5 + 0.5 * Math.sin(anim.affordancePhase);
  view.affordanceRing.alpha = AFFORDANCE_MIN_ALPHA + (AFFORDANCE_MAX_ALPHA - AFFORDANCE_MIN_ALPHA) * pulse;
  const ringScale = 0.92 + 0.12 * pulse;
  view.affordanceRing.scale.set(ringScale, ringScale);

  if (view.hammerArm) {
    anim.hammerT += dt;
    if (anim.hammerT >= HAMMER_PERIOD) {
      anim.hammerT -= HAMMER_PERIOD;
      anim.sparkedThisCycle = false; // fresh cycle, arm the spark gate again
    }
    const raiseEnd = HAMMER_PERIOD * HAMMER_RAISE_FRAC;
    const strikeEnd = raiseEnd + HAMMER_PERIOD * HAMMER_STRIKE_FRAC;

    let angle: number;
    if (anim.hammerT < raiseEnd) {
      // Slow raise: rest -> fully raised.
      const t = anim.hammerT / raiseEnd;
      angle = HAMMER_REST_ANGLE + (HAMMER_RAISE_ANGLE - HAMMER_REST_ANGLE) * easeOutQuad(t);
    } else if (anim.hammerT < strikeEnd) {
      // Fast strike: raised -> struck. Fire the spark burst once, right as
      // impact lands (t >= 0.85), guarded so a run of small-dt frames can't
      // re-trigger it before the cycle wraps.
      const t = (anim.hammerT - raiseEnd) / (strikeEnd - raiseEnd);
      angle = HAMMER_RAISE_ANGLE + (HAMMER_STRIKE_ANGLE - HAMMER_RAISE_ANGLE) * easeInQuad(t);
      if (!anim.sparkedThisCycle && t >= 0.85) {
        spawnSparkBurst(view);
        anim.sparkedThisCycle = true;
      }
    } else {
      // Hold briefly at struck pose, then ease back to rest before the next
      // cycle. Safety net: a big single dt (e.g. a stalled tab, or a test
      // stepping straight past the strike window) still fires exactly one
      // spark burst here instead of silently skipping it.
      const t = Math.min(1, (anim.hammerT - strikeEnd) / (HAMMER_PERIOD - strikeEnd));
      angle = HAMMER_STRIKE_ANGLE + (HAMMER_REST_ANGLE - HAMMER_STRIKE_ANGLE) * easeOutQuad(t);
      if (!anim.sparkedThisCycle) {
        spawnSparkBurst(view);
        anim.sparkedThisCycle = true;
      }
    }
    view.hammerArm.rotation = angle;
  }

  for (const spark of view.sparks) {
    if (!spark.active) continue;
    spark.age += dt;
    if (spark.age >= SPARK_LIFE) {
      spark.active = false;
      spark.g.visible = false;
      continue;
    }
    const frac = spark.age / SPARK_LIFE;
    spark.g.alpha = 1 - frac;
    spark.g.scale.set(1 + frac * 0.8, 1 + frac * 0.8);
  }
}

function spawnSparkBurst(view: NpcView): void {
  const anvilTopX = 16;
  const anvilTopY = GROUND_Y - 22;
  for (let i = 0; i < view.sparks.length; i++) {
    const spark = view.sparks[i];
    spark.active = true;
    spark.age = 0;
    spark.g.visible = true;
    spark.g.alpha = 1;
    spark.g.scale.set(1, 1);
    const spread = (i - (view.sparks.length - 1) / 2) * 4;
    spark.g.position.set(anvilTopX + spread, anvilTopY - Math.abs(spread) * 0.5);
  }
}

function easeOutQuad(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - (1 - c) * (1 - c);
}
function easeInQuad(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c;
}
