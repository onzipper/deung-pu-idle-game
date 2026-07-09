/**
 * Lab ⑨ "โลกมีมิติ" — screen-fixed weather layer (promotion candidate).
 *
 * One Container spanning the logical WORLD_WIDTH×WORLD_HEIGHT view; the CALLER
 * positions it (screen-fixed = added OUTSIDE the camera-panned strata) and the
 * caller's experiment root owns masking — this module never masks.
 *
 * Kinds:
 *   - "rain"  — lab-LOCAL streak pool (rain is NOT an `AmbientKind`; the
 *     src/render union stays untouched by design — see the lab-proud-tiger
 *     plan). All `RAIN_COUNT` Graphics are pre-built in one burst the first
 *     time rain is selected, then recycled in place forever: wrap, never
 *     die — zero steady-state allocation, mirroring `AmbientField`'s model.
 *   - "snow" / "ash" / "leaves" — thin wrappers over the real game's
 *     `AmbientField` (ash = the falling "snow" motion profile recolored gray;
 *     the constructor takes an arbitrary color, so no render change needed).
 *
 * Sub-pools are created lazily ONCE per kind and toggled by visibility after
 * that; `update` advances only the active pool. Flat colors, normal blend
 * only (project footgun 10 — no additive), every radius already routed
 * through `safeRadius` inside `AmbientField`.
 */

import { Container, Graphics } from "pixi.js";
import { AmbientField } from "@/render/environment/ambientParticles";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";

export type WeatherKind = "none" | "rain" | "snow" | "ash" | "leaves";

export const WEATHER_OPTIONS: readonly { id: WeatherKind; labelTh: string }[] = [
  { id: "none", labelTh: "ไม่มี" },
  { id: "rain", labelTh: "ฝน" },
  { id: "snow", labelTh: "หิมะ" },
  { id: "ash", labelTh: "เถ้าถ่าน" },
  { id: "leaves", labelTh: "ใบไม้" },
];

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

/** Rain streak pool size — fixed, all pre-built at first use, never grown. */
const RAIN_COUNT = 90;
/** Fall speed baseline, world-px/second (per-slot ×RAIN_SPEED_JITTER). */
const RAIN_FALL_SPEED = 420;
/** Leftward x drift, world-px/second (negative = drifts left, like the
 * ambient profiles' world-travel feel). Also sets the streak slant. */
const RAIN_DRIFT_X = -55;
/** Streak stroke width / length, world px (~2×12 slightly slanted line). */
const RAIN_STROKE_W = 2;
const RAIN_LEN = 12;
/** Flat cool blue-gray, normal blend (footgun 10 — never additive). */
const RAIN_COLOR = 0x9db8cc;
/** Per-slot alpha range — ceiling ≤ 0.7 so rain never overpowers actors. */
const RAIN_ALPHA_MIN = 0.35;
const RAIN_ALPHA_MAX = 0.7;
/** Per-slot speed multiplier range (both axes → slant stays consistent). */
const RAIN_SPEED_JITTER_MIN = 0.85;
const RAIN_SPEED_JITTER_MAX = 1.2;
/** Off-view wrap margin so streaks never pop at the layer edges. */
const RAIN_WRAP_MARGIN = 16;

/** AmbientField counts — capped ≤36 each (weather stays backdrop, not show). */
const SNOW_COUNT = 36;
const ASH_COUNT = 34;
const LEAF_COUNT = 30;

const SNOW_COLOR = 0xf2f7ff;
/** Ash = the "snow" fall profile recolored flat gray. */
const ASH_COLOR = 0x8f8f94;
const LEAF_COLOR = 0x9dbb61;

// ---------------------------------------------------------------------------

interface RainSlot {
  g: Graphics;
  x: number;
  y: number;
  /** Per-slot speed multiplier applied to fall AND drift. */
  speedMult: number;
}

interface RainPool {
  c: Container;
  slots: RainSlot[];
}

export interface WeatherLayer {
  view: Container;
  update(dt: number): void;
  setKind(k: WeatherKind): void;
  destroy(): void;
}

function buildRainPool(): RainPool {
  const c = new Container();
  // Slant follows the velocity vector so motion and streak angle agree.
  const slantX = (RAIN_DRIFT_X / RAIN_FALL_SPEED) * RAIN_LEN;
  const slots: RainSlot[] = Array.from({ length: RAIN_COUNT }, () => {
    const g = new Graphics();
    g.moveTo(0, 0)
      .lineTo(slantX, RAIN_LEN)
      .stroke({ width: RAIN_STROKE_W, color: RAIN_COLOR, alpha: 1 });
    g.alpha = RAIN_ALPHA_MIN + Math.random() * (RAIN_ALPHA_MAX - RAIN_ALPHA_MIN);
    const x = Math.random() * WORLD_WIDTH;
    const y = Math.random() * WORLD_HEIGHT;
    g.position.set(x, y);
    c.addChild(g);
    return {
      g,
      x,
      y,
      speedMult:
        RAIN_SPEED_JITTER_MIN + Math.random() * (RAIN_SPEED_JITTER_MAX - RAIN_SPEED_JITTER_MIN),
    };
  });
  return { c, slots };
}

/** Advance every streak by `dt` real seconds — mutate + wrap, zero alloc. */
function updateRain(pool: RainPool, dt: number): void {
  const spanY = WORLD_HEIGHT + RAIN_WRAP_MARGIN * 2;
  const spanX = WORLD_WIDTH + RAIN_WRAP_MARGIN * 2;
  for (const slot of pool.slots) {
    slot.y += RAIN_FALL_SPEED * slot.speedMult * dt;
    slot.x += RAIN_DRIFT_X * slot.speedMult * dt;
    if (slot.y > WORLD_HEIGHT + RAIN_WRAP_MARGIN) slot.y -= spanY;
    if (slot.x < -RAIN_WRAP_MARGIN) slot.x += spanX;
    if (slot.x > WORLD_WIDTH + RAIN_WRAP_MARGIN) slot.x -= spanX;
    slot.g.position.set(slot.x, slot.y);
  }
}

export function createWeatherLayer(initial: WeatherKind): WeatherLayer {
  const view = new Container();
  let kind: WeatherKind = "none";
  let destroyed = false;

  // Lazily-created-once sub-pools, toggled by visibility afterwards.
  let rain: RainPool | null = null;
  const fields = new Map<WeatherKind, AmbientField>();

  function ensurePool(k: WeatherKind): void {
    if (k === "none") return;
    if (k === "rain") {
      if (!rain) {
        rain = buildRainPool();
        view.addChild(rain.c);
      }
      return;
    }
    if (!fields.has(k)) {
      const field =
        k === "snow"
          ? new AmbientField("snow", SNOW_COLOR, SNOW_COUNT, WORLD_WIDTH, 0, WORLD_HEIGHT)
          : k === "ash"
            ? new AmbientField("snow", ASH_COLOR, ASH_COUNT, WORLD_WIDTH, 0, WORLD_HEIGHT)
            : new AmbientField("leaf", LEAF_COLOR, LEAF_COUNT, WORLD_WIDTH, 0, WORLD_HEIGHT);
      fields.set(k, field);
      view.addChild(field.view);
    }
  }

  function applyVisibility(): void {
    if (rain) rain.c.visible = kind === "rain";
    for (const [k, field] of fields) field.view.visible = k === kind;
  }

  function setKind(k: WeatherKind): void {
    if (destroyed || k === kind) return;
    kind = k;
    ensurePool(k);
    applyVisibility();
  }

  function update(dt: number): void {
    if (destroyed || kind === "none") return;
    if (kind === "rain") {
      if (rain) updateRain(rain, dt);
      return;
    }
    fields.get(kind)?.update(dt);
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    // AmbientField owns its view's teardown; destroying it first also detaches
    // it from `view`, so the final tree destroy never double-frees.
    for (const field of fields.values()) field.destroy();
    fields.clear();
    rain = null;
    view.destroy({ children: true });
  }

  setKind(initial);
  return { view, update, setKind, destroy };
}
