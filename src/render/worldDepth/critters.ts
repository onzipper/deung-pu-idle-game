/**
 * Lab ⑨ "โลกมีมิติ" — sky birds + night fireflies (promotion candidate).
 *
 * Two separately-returned views because the caller slots them into DIFFERENT
 * strata of the camera-panned world (birds high behind the action, fireflies
 * just in front of the entity layer) — both live in WORLD coordinates and
 * span `coverageW` (the demo world is wider than one screen), NOT screen
 * space.
 *
 * Birds: a fixed pool of `BIRD_COUNT` chevron silhouettes (two short angled
 * wing strokes + a tiny body dot), built once and recycled forever — they
 * cross the sky band at differing speeds/phases and wrap horizontally; the
 * wing-flap is a sine on `scale.y` (wings swing up → flat → below the body),
 * so per-frame work is transform-only. Zero steady-state allocation.
 *
 * Fireflies: one warm yellow-green `AmbientField` mote field hugging the
 * ground band. The whole view's alpha is driven by the caller's day/night
 * `nightness` each update, and the field simulation is SKIPPED while it is
 * invisible (daytime) — fireflies exist only at night, for free by day.
 *
 * Flat colors, normal blend only (project footgun 10 — no additive); every
 * radius through `safeRadius` (here and inside `AmbientField`).
 */

import { Container, Graphics } from "pixi.js";
import { AmbientField } from "@/render/environment/ambientParticles";
import { GROUND_Y } from "@/render/layout";
import { safeRadius } from "@/render/theme";

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

/** Fixed bird pool size — built once, wraps forever. */
const BIRD_COUNT = 4;
/** Sky band the birds cross, world y (kept above every silhouette ridge). */
const BIRD_BAND_TOP = 40;
const BIRD_BAND_BOTTOM = 90;
/** Horizontal speed range, world-px/second — distant birds drift slowly. */
const BIRD_SPEED_MIN = 24;
const BIRD_SPEED_MAX = 46;
/** Chevron geometry: half wingspan / wing-tip lift above the body, world px. */
const BIRD_WING_SPAN = 5;
const BIRD_WING_LIFT = 3;
const BIRD_STROKE_W = 1.4;
const BIRD_BODY_R = 0.9;
/** Dark silhouette slate — birds read as distant shapes, not characters. */
const BIRD_COLOR = 0x2c3138;
const BIRD_ALPHA = 0.85;
/** Wing-flap: `scale.y` sweeps between these (1 = tips up, negative = tips
 * swung below the body) on a per-bird sine. */
const BIRD_FLAP_UP = 1;
const BIRD_FLAP_DOWN = -0.35;
/** Flap rate range, cycles/second. */
const BIRD_FLAP_HZ_MIN = 2.1;
const BIRD_FLAP_HZ_MAX = 3.2;
/** Gentle altitude bob so flight lines aren't laser-straight. */
const BIRD_BOB_AMP = 3;
const BIRD_BOB_HZ = 0.4;
/** Off-view wrap margin so birds never pop at the coverage edges. */
const BIRD_WRAP_MARGIN = 12;

/** Fireflies — warm yellow-green motes, ground band, night-only. */
const FIREFLY_COLOR = 0xd8f27a;
const FIREFLY_COUNT = 20;
const FIREFLY_BAND_TOP = GROUND_Y - 70;
const FIREFLY_BAND_BOTTOM = GROUND_Y + 6;
/** Below this `nightness` the field is treated as fully daytime-off. */
const NIGHTNESS_EPSILON = 0.02;

// ---------------------------------------------------------------------------

interface BirdSlot {
  g: Graphics;
  x: number;
  baseY: number;
  /** Horizontal direction, +1 right / −1 left (alternates per bird). */
  dir: 1 | -1;
  speed: number;
  phase: number;
  flapHz: number;
}

export interface Critters {
  birdsView: Container;
  firefliesView: Container;
  update(dt: number, nightness: number): void;
  destroy(): void;
}

function buildBird(): Graphics {
  const g = new Graphics();
  g.moveTo(-BIRD_WING_SPAN, -BIRD_WING_LIFT)
    .lineTo(0, 0)
    .lineTo(BIRD_WING_SPAN, -BIRD_WING_LIFT)
    .stroke({ width: BIRD_STROKE_W, color: BIRD_COLOR, alpha: BIRD_ALPHA });
  g.circle(0, 0, safeRadius(BIRD_BODY_R)).fill({ color: BIRD_COLOR, alpha: BIRD_ALPHA });
  return g;
}

export function createCritters(coverageW: number): Critters {
  const width = Math.max(1, coverageW);
  const birdsView = new Container();
  let destroyed = false;
  let t = 0;

  // Spread starting x / altitude / speed evenly across the pool (plus jitter)
  // so the four birds are guaranteed distinct — never a synchronized flock.
  const bobSafeTop = BIRD_BAND_TOP + BIRD_BOB_AMP + 2;
  const bobSafeBottom = BIRD_BAND_BOTTOM - BIRD_BOB_AMP - 2;
  const birds: BirdSlot[] = Array.from({ length: BIRD_COUNT }, (_, i) => {
    const g = buildBird();
    const frac = BIRD_COUNT <= 1 ? 0.5 : i / (BIRD_COUNT - 1);
    const x = ((i + 0.5) / BIRD_COUNT) * width + (Math.random() - 0.5) * 60;
    const baseY =
      bobSafeTop + frac * Math.max(0, bobSafeBottom - bobSafeTop) + (Math.random() - 0.5) * 6;
    const speed =
      BIRD_SPEED_MIN + frac * (BIRD_SPEED_MAX - BIRD_SPEED_MIN) + Math.random() * 4;
    g.position.set(x, baseY);
    birdsView.addChild(g);
    return {
      g,
      x,
      baseY,
      dir: i % 2 === 0 ? -1 : 1,
      speed,
      phase: Math.random() * Math.PI * 2,
      flapHz: BIRD_FLAP_HZ_MIN + Math.random() * (BIRD_FLAP_HZ_MAX - BIRD_FLAP_HZ_MIN),
    };
  });

  const fireflies = new AmbientField(
    "mote",
    FIREFLY_COLOR,
    FIREFLY_COUNT,
    width,
    FIREFLY_BAND_TOP,
    FIREFLY_BAND_BOTTOM,
  );
  const firefliesView = fireflies.view;
  firefliesView.alpha = 0;

  function update(dt: number, nightness: number): void {
    if (destroyed) return;
    t += dt;

    const spanX = width + BIRD_WRAP_MARGIN * 2;
    for (const bird of birds) {
      bird.x += bird.dir * bird.speed * dt;
      if (bird.x < -BIRD_WRAP_MARGIN) bird.x += spanX;
      if (bird.x > width + BIRD_WRAP_MARGIN) bird.x -= spanX;
      const y = bird.baseY + Math.sin(t * BIRD_BOB_HZ * Math.PI * 2 + bird.phase) * BIRD_BOB_AMP;
      bird.g.position.set(bird.x, y);
      const flap = 0.5 + 0.5 * Math.sin(t * bird.flapHz * Math.PI * 2 + bird.phase);
      bird.g.scale.y = BIRD_FLAP_DOWN + (BIRD_FLAP_UP - BIRD_FLAP_DOWN) * flap;
    }

    const night = Math.min(1, Math.max(0, nightness));
    firefliesView.alpha = night;
    firefliesView.visible = night > NIGHTNESS_EPSILON;
    // Daytime = fireflies don't exist: skip the whole field simulation.
    if (night > NIGHTNESS_EPSILON) fireflies.update(dt);
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    birdsView.destroy({ children: true });
    fireflies.destroy();
  }

  return { birdsView, firefliesView, update, destroy };
}
