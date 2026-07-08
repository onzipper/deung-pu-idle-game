/**
 * HOF seasonal rewards (docs/hof-rewards-design.md §3 item 2) — the rank-1
 * "champion" gold aura, shown on any hero whose per-season HOF award marks it
 * a current #1 in a rewarded board (level/power/gold — see `setHeroSocialBadges()`
 * on `GameRenderer`). Continuous/persistent (not event-driven), one slot per
 * hero, same convention as `gearAura.ts`'s tier-6/epic weapon flame and
 * `warCryAura.ts`'s buff aura — driven every frame from `FxController.update()`
 * reading live `GameState` + the badge map, never from `GameState` itself
 * (render/ui-only, no engine involvement, no SAVE bump).
 *
 * MUST read as visually DISTINCT from every other gold-family aura already in
 * the game (owner spec):
 *  - the tier-2 evolution idle aura (`heroView.ts`'s `buildAuraRing` — a flat
 *    ground-hugging ellipse, WIDE not tall)
 *  - the +8/+9/+10 refine-prestige ladder (`gearAura.ts`'s boosted flame ring
 *    + `refinePrestige.ts`'s ember trickle — anchored on the WEAPON/ARMOR, not
 *    the whole body)
 *  - the world-boss "เสี่ยจ๋อง" gold aura ring (`worldBossView.ts` — also a
 *    flat ground ellipse, and a boss-only look)
 * This one is a TALL (rx < ry) vertical double-ring halo centered on the
 * body's mid-torso, with a handful of motes slowly orbiting just outside it —
 * a "full-body nimbus", not a ground glow or a weapon flame. Anchored well
 * below the HP bar/nameplate lanes (`heroView.ts`'s `NAMEPLATE_Y`/HP bar sit
 * at GROUND_Y-58 and above; this halo's top edge stays below GROUND_Y-50 even
 * at its widest pulse) so it never competes with them for legibility.
 *
 * Footgun 10 (CLAUDE.md): everything here is a plain stroke/fill on the
 * DEFAULT (normal) blend mode — never `blendMode: "add"` (additive white-out
 * over bright daytime scenes). All radii through `safeRadius()`.
 *
 * Perf: every shape (the two ring ellipses, each mote) is built ONCE at
 * construction (fixed color — unlike `gearAura.ts`'s per-hero-color flames,
 * this is always the same "championGold" family) — every frame only mutates
 * position/scale/alpha (transform-only), same build-once-per-rig convention
 * as the rest of `fx/`. Fixed cap `MAX_SLOTS * MOTES_PER_SLOT` (3 × 5 = 15
 * Graphics + 3 × 2 ring Graphics = 21 total), zero per-frame allocation.
 */

import { Container, Graphics } from "pixi.js";
import { PALETTE, safeRadius } from "@/render/theme";

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------
const MAX_SLOTS = 3; // one aura per hero slot (party cap)
const MOTES_PER_SLOT = 5;

/** Ring half-extents — deliberately TALLER than wide (rx < ry), the opposite
 * proportion of every ground-anchored aura ellipse elsewhere in the game (see
 * module doc). */
const RING_RX = 14;
const RING_RY = 20;
const RING_INNER_RATIO = 0.62; // the "double ring" inner stroke
const RING_WIDTH_OUTER = 1.6;
const RING_WIDTH_INNER = 1;
const RING_ALPHA_OUTER = 0.75;
const RING_ALPHA_INNER = 0.5;
/** Slow breathing pulse — a scale multiplier applied to the WHOLE ring root,
 * kept small so stroke width visually wobbles only a hair (same accepted
 * convention as `gearAura.ts`'s per-flame `scale.set()`). */
const PULSE_SPEED = 1.3; // rad/s
const PULSE_RANGE = 0.05;

/** Motes orbit just outside the ring, slow and lazy — "prestige", not "busy". */
const MOTE_ORBIT_RX = RING_RX + 6;
const MOTE_ORBIT_RY = RING_RY + 7;
const MOTE_ORBIT_SPEED = 0.55; // rad/s — slower than gearAura's flame orbit (1.6)
const MOTE_RADIUS = 1.5;
const MOTE_FLICKER_SPEED = 2.2;
const MOTE_ALPHA_BASE = 0.55;
const MOTE_ALPHA_RANGE = 0.35;

/** Per-second lerp rate the whole slot fades in/out by — a quick bloom-in/out,
 * never a hard pop (same convention as `gearAura.ts`'s `FADE_RATE`). */
const FADE_RATE = 5;

interface Mote {
  view: Graphics;
  angleOffset: number;
  flickerPhase: number;
}

interface Slot {
  ringRoot: Container;
  motes: Mote[];
  active: boolean;
  x: number;
  y: number;
  fade: number; // 0..1, eased toward `active ? 1 : 0`
  phase: number;
}

/** Static double-ring shape, built once (fixed championGold family colors —
 * unlike `gearAura.ts`'s flames, this never needs a per-hero recolor). */
function buildRingShape(g: Graphics): void {
  g.clear();
  g.ellipse(0, 0, safeRadius(RING_RX), safeRadius(RING_RY)).stroke({
    width: RING_WIDTH_OUTER,
    color: PALETTE.championGold,
    alpha: RING_ALPHA_OUTER,
  });
  g.ellipse(
    0,
    0,
    safeRadius(RING_RX * RING_INNER_RATIO),
    safeRadius(RING_RY * RING_INNER_RATIO),
  ).stroke({
    width: RING_WIDTH_INNER,
    color: PALETTE.championGoldCore,
    alpha: RING_ALPHA_INNER,
  });
}

function buildMoteShape(g: Graphics): void {
  g.clear();
  g.circle(0, 0, safeRadius(MOTE_RADIUS)).fill(PALETTE.championGoldCore);
  g.circle(0, 0, safeRadius(MOTE_RADIUS)).stroke({
    width: 0.6,
    color: PALETTE.championGoldDeep,
    alpha: 0.6,
  });
}

export class ChampionAuraController {
  private readonly slots: Slot[] = [];

  constructor(private readonly container: Container) {
    for (let s = 0; s < MAX_SLOTS; s++) {
      const ringRoot = new Container();
      const outerAndInner = new Graphics();
      buildRingShape(outerAndInner);
      ringRoot.addChild(outerAndInner);
      ringRoot.visible = false;
      container.addChild(ringRoot);

      const motes: Mote[] = [];
      for (let i = 0; i < MOTES_PER_SLOT; i++) {
        const view = new Graphics();
        buildMoteShape(view);
        view.visible = false;
        container.addChild(view);
        motes.push({
          view,
          angleOffset: (Math.PI * 2 * i) / MOTES_PER_SLOT,
          flickerPhase: Math.random() * Math.PI * 2,
        });
      }

      this.slots.push({
        ringRoot,
        motes,
        active: false,
        x: 0,
        y: 0,
        fade: 0,
        phase: Math.random() * Math.PI * 2, // de-sync concurrent champions
      });
    }
  }

  /** Called once per hero slot per frame by `FxController` — `active=false`
   * simply lets the slot's fade ease back to invisible (never a hard pop),
   * same convention as `gearAura.ts`'s `setSlot()`. `x`/`y` is the body's
   * mid-torso anchor (`getChampionAnchorPos()` in `heroView.ts`). */
  setSlot(slot: number, active: boolean, x: number, y: number): void {
    if (slot < 0 || slot >= MAX_SLOTS) return;
    const s = this.slots[slot];
    s.active = active;
    s.x = x;
    s.y = y;
  }

  update(dt: number): void {
    for (const s of this.slots) {
      const target = s.active ? 1 : 0;
      s.fade += (target - s.fade) * Math.min(1, dt * FADE_RATE);
      if (s.fade < 0.02 && !s.active) {
        s.ringRoot.visible = false;
        for (const m of s.motes) m.view.visible = false;
        continue;
      }

      s.phase += dt * MOTE_ORBIT_SPEED;
      const pulse = 1 + Math.sin(s.phase * (PULSE_SPEED / MOTE_ORBIT_SPEED)) * PULSE_RANGE;

      s.ringRoot.visible = true;
      s.ringRoot.position.set(s.x, s.y);
      s.ringRoot.scale.set(pulse);
      s.ringRoot.alpha = s.fade;

      s.motes.forEach((m) => {
        m.flickerPhase += dt * MOTE_FLICKER_SPEED;
        const angle = s.phase + m.angleOffset;
        const mx = s.x + Math.cos(angle) * MOTE_ORBIT_RX;
        const my = s.y + Math.sin(angle) * MOTE_ORBIT_RY;
        const flick = Math.sin(m.flickerPhase);
        m.view.visible = true;
        m.view.position.set(mx, my);
        m.view.alpha = Math.max(
          0,
          Math.min(1, (MOTE_ALPHA_BASE + flick * MOTE_ALPHA_RANGE * 0.5) * s.fade),
        );
      });
    }
  }

  destroy(): void {
    for (const s of this.slots) {
      this.container.removeChild(s.ringRoot);
      s.ringRoot.destroy({ children: true });
      for (const m of s.motes) {
        this.container.removeChild(m.view);
        m.view.destroy();
      }
    }
    this.slots.length = 0;
  }
}
