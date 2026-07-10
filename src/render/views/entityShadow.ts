/**
 * Contact shadows (R4.5 Wave 1, issue #69) — a small flat-alpha ground ellipse
 * that plants every actor (hero/enemy/boss/ghost/NPC) on the floor. This is the
 * cheapest, highest-value depth cue in `docs/map-direction.md`'s priority order:
 * it grounds an actor even on flat ground, and it makes the (now capped, whisper-
 * subtle) depth scale read as "further away" rather than "randomly smaller".
 *
 * BINDING art-direction constraints (see `src/render/README.md`):
 *   - NO gradient, NO Pixi filter, NO additive blend. A soft edge is faked with
 *     TWO stacked flat-alpha ellipses (a wide faint skirt + a tighter darker
 *     core) — the same layered-alpha vocabulary the sky/glow effects use.
 *   - near-black, LOW alpha so it reads on BOTH the bright town/noon palette and
 *     the dark night/cave one without ever turning into a hard cutout.
 *
 * Placement contract (avoids the Pixi pivot double-subtraction trap, known-traps
 * #3): the shadow is a CHILD of the actor ROOT, whose pivot is `GROUND_Y`. The
 * ellipse is drawn at the Graphics' OWN local origin (0,0) and the Graphics is
 * POSITIONED at `(0, SHADOW_FOOT_Y)`. So:
 *   - the root's `pivot.y = GROUND_Y` + per-frame `view.y = footY` maps the
 *     shadow's origin straight onto the placed foot line — the SAME transform the
 *     actor rides, never a re-added offset;
 *   - scaling the shadow Graphics itself (enemy footprint = `enemy.size`) scales
 *     the ellipse AROUND its own origin, so the contact point stays planted;
 *   - the root's uniform depth scale then shrinks/grows the whole thing, so the
 *     shadow tracks the actor's apparent size for free.
 *
 * Perf: build-once. `createEntityShadow` draws the ellipses a single time; steady
 * state is transform-only (`scale`/`position` on the root, plus one optional
 * `scale.set` per enemy for its footprint). Zero per-frame allocation.
 */

import { Container, Graphics } from "pixi.js";
import { GROUND_Y } from "@/render/layout";
import { PALETTE, safeRadius } from "@/render/theme";

/** Near-black — `PALETTE.shadow` (0x000000). */
const SHADOW_COLOR = PALETTE.shadow;
/** Wide faint skirt alpha (the soft outer edge). */
const SHADOW_OUTER_ALPHA = 0.16;
/** Tighter core alpha, stacked over the skirt (composited ≈ 0.30 in the overlap
 * — the low end of the dark-fantasy "reads on bright AND dark" window). */
const SHADOW_INNER_ALPHA = 0.22;
/** Inner-core half-width as a fraction of the footprint half-width. */
const SHADOW_INNER_FRAC = 0.62;
/** Ellipse flatten (vertical radius ÷ horizontal radius) — a ground disc read
 * from the fixed low 2.5D camera, never a circle. */
const SHADOW_FLATTEN = 0.3;
/** Local y the ellipse center sits at inside the (GROUND_Y-pivoted) root: right
 * at the contact line, a hair above GROUND_Y so it nestles under the feet. */
const SHADOW_FOOT_Y = GROUND_Y - 1;

/** Per-actor-class footprint half-widths (world units, at depth scale 1 / size 1). */
export const HERO_SHADOW_RX = 13;
export const ENEMY_SHADOW_RX = 14;
export const BOSS_SHADOW_RX = 30;
export const WORLD_BOSS_SHADOW_RX = 46;
export const NPC_SHADOW_RX = 12;

/** A view container that has had a contact shadow attached. */
export interface HasContactShadow {
  contactShadow: Graphics;
}

/** Draw the two stacked flat-alpha ellipses at the Graphics' own origin (0,0). */
function drawShadow(g: Graphics, rx: number): void {
  const rOuter = safeRadius(rx);
  const rInner = safeRadius(rx * SHADOW_INNER_FRAC);
  g.clear();
  g.ellipse(0, 0, rOuter, safeRadius(rOuter * SHADOW_FLATTEN)).fill({
    color: SHADOW_COLOR,
    alpha: SHADOW_OUTER_ALPHA,
  });
  g.ellipse(0, 0, rInner, safeRadius(rInner * SHADOW_FLATTEN)).fill({
    color: SHADOW_COLOR,
    alpha: SHADOW_INNER_ALPHA,
  });
}

/**
 * Build a contact-shadow Graphics with footprint half-width `rx`. Positioned at
 * the foot line inside a GROUND_Y-pivoted root; the caller adds it as the
 * backmost child of the actor root (see `attachContactShadow`).
 */
export function createEntityShadow(rx: number): Graphics {
  const g = new Graphics();
  drawShadow(g, rx);
  g.position.set(0, SHADOW_FOOT_Y);
  return g;
}

/**
 * Attach a contact shadow as the BACKMOST child of an actor root `view` (so it
 * draws behind the body, never over it) and record it on `view.contactShadow`.
 * The root must be foot-pivoted (`pivot.y = GROUND_Y`) — every pooled actor root
 * in `GameRenderer` already is. Returns the same view, typed with the shadow.
 */
export function attachContactShadow<V extends Container>(
  view: V,
  rx: number,
): V & HasContactShadow {
  const shadow = createEntityShadow(rx);
  view.addChildAt(shadow, 0);
  const withShadow = view as V & HasContactShadow;
  withShadow.contactShadow = shadow;
  return withShadow;
}
