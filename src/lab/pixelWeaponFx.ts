/**
 * `/lab` experiment ⑦ "weaponFx" support module — a self-contained pixel-art
 * particle system for weapon elemental effects (fire/electric/sparkle),
 * written clean enough to lift straight into `src/render/fx/` later. NO
 * engine/store/render imports — Pixi only, so it's provably a leaf module.
 *
 * Pixel-art rules baked in on purpose (see the task brief — these ARE the
 * experiment, not incidental style):
 *   - every particle is a SQUARE snapped to a virtual texel grid (`pixelSize`,
 *     via `setPixelSize` — the host passes the weapon sprite's on-screen
 *     texel size);
 *   - a STEPPED internal simulation clock (`setStepFps`, default 12) drives
 *     particle poses — the host still calls `update(dt)` every real frame
 *     (60fps), but particle position/color/life only change on a tick
 *     boundary. This is why 12fps reads "chunky and right" while 60fps reads
 *     "smooth but wrong" for this art style;
 *   - palettes are 3-5 flat shades, particles fade by SWAPPING palette/alpha
 *     STEPS over life, never a continuous alpha lerp;
 *   - normal blend mode only — never additive (project footgun 10: additive
 *     glow white-outs over bright daytime scenery).
 *
 * Pooling: a single fixed-size `Graphics` pool is built once in
 * `createPixelWeaponFx` and never grown/shrunk — spawning a particle claims a
 * free pooled `Graphics` (redrawing its tiny square/plus shape into place),
 * dying releases it back (`visible = false`). No `new Graphics()` after
 * construction, ever.
 */

import { Container, Graphics } from "pixi.js";
import type { RefineFxLayer, RefineFxRecipe } from "@/lab/refineFxRecipes";

export type WeaponFxElement = "none" | "fire" | "electric" | "sparkle";

export interface PixelWeaponFx {
  setElement(el: WeaponFxElement): void;
  /**
   * Experiment ⑧ "refineLadder" — a declarative, rarity/refine-driven layer
   * stack (`@/lab/refineFxRecipes`), running ADDITIVE and INDEPENDENT of
   * `setElement`'s legacy fire/electric/sparkle path (separate module state,
   * separate accumulators, separate pool-slot `Kind`s) so ⑦'s behavior stays
   * byte-identical. `null` clears it. Value-compared internally (NOT
   * reference-compared) so a host calling this every frame with an
   * equivalent-shaped recipe is a safe no-op — never resets a running
   * accumulator/timer on a redundant call (the setStepFps footgun class). */
  setRecipe(recipe: RefineFxRecipe | null): void;
  /** Feed every frame: blade TIP position in this fx's parent-local space,
   * plus an optional normalized blade direction (tip minus grip) so fire
   * spawns ALONG the blade line instead of only at the tip. Direction
   * defaults to +x (blade pointing right) when omitted. */
  setAnchor(tipX: number, tipY: number, dirX?: number, dirY?: number): void;
  setPixelSize(px: number): void;
  setStepFps(fps: number): void;
  setDensity(mult: number): void;
  /** Density burst for a handful of sim ticks — call on every swing so
   * attacks read juicier than idle hold. */
  notifySwing(): void;
  /** World-space ground line for the recipe `ambient` feature's ground-spark
   * pops (experiment ⑧'s "special-feel" wave). Not gated/compared — just
   * assigned (see `setGroundY` below); default is `null` (ground sparks off)
   * so hosts that never call this (experiment ⑦) are unaffected. */
  setGroundY(y: number): void;
  update(dt: number): void;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Palettes — flat shades only, normal blend (footgun 10).
// ---------------------------------------------------------------------------

const FIRE_PALETTE = [0xffffff, 0xffd166, 0xf3722c, 0xd62828, 0x6a1f1b] as const;
const ELECTRIC_CORE = 0xffffff;
const ELECTRIC_YELLOW = 0xffe66d;
const ELECTRIC_BLUE = 0x4cc9f0;
const SPARKLE_CYAN = 0x8be9fd;
const SPARKLE_WHITE = 0xffffff;

/** Stepped alpha levels (never a continuous lerp) — index 0 = fully opaque. */
const ALPHA_STEPS = [1, 0.75, 0.5, 0.25] as const;

// ---------------------------------------------------------------------------
// Experiment ⑧ "refineLadder" support — recipe-driven layer kinds. Fully
// additive: separate module state below, separate `Kind` members above,
// never touches a single line of the legacy fire/electric/sparkle path.
// ---------------------------------------------------------------------------

const EMPTY_PALETTE: readonly number[] = [];

/** Multi-step palette fade by life PROGRESS (0 = birth, 1 = death) — same
 * "swap palette steps, never a continuous lerp" rule as `tickFire`'s inline
 * `FIRE_PALETTE` lookup, generalized to an arbitrary recipe palette. */
function paletteStepColor(palette: readonly number[], progress: number): number {
  if (palette.length === 0) return 0xffffff;
  const idx = Math.min(palette.length - 1, Math.floor(progress * palette.length));
  return palette[idx]!;
}

/** Approximate blade-line coverage in world px — this module only receives
 * the TIP + direction (not the real blade length from the host rig), so fire/
 * electric/sparkle spawn positions walk backward from the tip along this
 * fixed approximate span. Fine for a "does this read as fire ON the blade"
 * judgment call; a real render/fx port would thread the actual blade length
 * through instead. */
const SPAWN_SPREAD = 24;

/** Recipe crackle/beat spawn spread — recipe LAYERS carry their own `spread`
 * (see `RefineFxLayer`), but crackle/beat aren't tied to one layer, so they
 * share this fixed span (same default the legacy element path itself uses). */
const RECIPE_EVENT_SPREAD = SPAWN_SPREAD;

const POOL_SIZE = 340;

type Kind =
  | "fire"
  | "fireStray"
  | "electricSeg"
  | "electricFlash"
  | "sparkle"
  // ---- experiment ⑧ "refineLadder" recipe-driven kinds (additive, see
  // `setRecipe` below) — fully separate from the legacy element kinds above.
  | "recipeMotes"
  | "recipeFlame"
  | "recipeSparkle"
  | "recipeCrackle"
  // ---- "special-feel" wave (molten/afterimage/charge-burst-beat/ambient) —
  // replaces the old static recipeBeatColumn/recipeBeatFlare pair.
  | "recipeMolten"
  | "recipeDrip"
  | "recipeTrail"
  | "recipeCharge"
  | "recipeFlashBar"
  | "recipeBurst"
  | "recipeAmbient"
  | "recipeGroundSpark";

function isRecipeKind(kind: Kind): boolean {
  return kind.startsWith("recipe");
}

interface Slot {
  g: Graphics;
  active: boolean;
  kind: Kind;
  x: number;
  y: number;
  /** Velocity for every particle-ish kind — EXCEPT `recipeMolten`, which
   * repurposes this pair as `(tFrac, perpOffset)` instead of a velocity (see
   * `tickRecipeMolten`): `vx` = 0..1 fraction back along the blade from the
   * tip, `vy` = world-px perpendicular offset off the blade centerline. A
   * molten slot's position is RE-PROJECTED from the current tip+dir every
   * tick using these two numbers, never integrated — reusing the existing
   * fields instead of growing `Slot` for one kind. */
  vx: number;
  vy: number;
  sizeTexels: number;
  life: number; // seconds remaining
  maxLife: number;
  /** Generic per-particle random seed — positional wobble phase for most
   * kinds, but repurposed as the color-SHIMMER phase for `recipeMolten`
   * (`tickRecipeMolten` walks its palette by `sin(tickCount + wobbleSeed)`
   * instead of by life progress, since molten pixels don't age out). */
  wobbleSeed: number;
  color: number;
  // sparkle blink cycle
  phase: "in" | "hold" | "out";
  phaseTicksLeft: number;
  // recipe-kind multi-step color fade (motes/flame/beat-column) — see
  // `paletteStepColor`. Unused (empty) by every legacy element kind.
  palette: readonly number[];
}

function makeSlot(layer: Container): Slot {
  const g = new Graphics();
  g.visible = false;
  layer.addChild(g);
  return {
    g,
    active: false,
    kind: "fire",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    sizeTexels: 1,
    life: 0,
    maxLife: 1,
    wobbleSeed: Math.random() * 1000,
    color: 0xffffff,
    phase: "in",
    phaseTicksLeft: 0,
    palette: EMPTY_PALETTE,
  };
}

/** Clamp helper mirroring the project's `safeRadius()` habit (footgun 3) —
 * every size fed into a `Graphics` draw call goes through this. */
function clampPositive(v: number, min = 0): number {
  return Math.max(min, v);
}

export function createPixelWeaponFx(parent: Container): PixelWeaponFx {
  const layer = new Container();
  parent.addChild(layer);

  const pool: Slot[] = [];
  for (let i = 0; i < POOL_SIZE; i++) pool.push(makeSlot(layer));

  let element: WeaponFxElement = "none";
  let pixelSize = 4;
  let stepFps = 12;
  let density = 1;

  let tipX = 0;
  let tipY = 0;
  let dirX = 1;
  let dirY = 0;

  let simAccum = 0;
  let tickCount = 0;
  let burstTicksLeft = 0;

  let electricBolt: Slot[] = [];
  let boltTickCounter = 0;
  const BOLT_REROLL_EVERY_TICKS = 2;

  let fireSpawnAccum = 0;
  let sparkleSpawnAccum = 0;

  // ---- experiment ⑧ "refineLadder" recipe state — additive, separate from
  // every legacy `element` accumulator above. `setRecipe` is VALUE-compared
  // (see below), so this only resets on a genuine recipe change.
  let recipe: RefineFxRecipe | null = null;
  let recipeLayerRuntimes: { cfg: RefineFxLayer; spawnAccum: number }[] = [];
  let lastRecipeSig: string | null = null;
  let crackleTimer = 0;

  // ---- "special-feel" wave state — additive, mirrors the crackle/beat
  // state above (all reset together in `setRecipe`, never on a redundant
  // same-signature call).
  let groundY: number | null = null;
  // molten: the currently-"clinging" slots (for drip-pick/top-up bookkeeping
  // only — the actual per-tick ride-the-blade reprojection runs generically
  // in the pool dispatch loop below, keyed off `kind === "recipeMolten"`).
  let moltenSlots: Slot[] = [];
  let dripAccum = 0;
  // swing afterimage: fixed-size ring buffer of recent tip positions, pushed
  // once per sim tick, zero allocation per tick (pre-filled below).
  const TIP_RING_SIZE = 10;
  const tipRing: { x: number; y: number }[] = Array.from({ length: TIP_RING_SIZE }, () => ({ x: 0, y: 0 }));
  let tipRingHead = 0;
  // charge→burst beat: within-cycle phase timer + one-shot flags per cycle.
  let beatCycleTimer = 0;
  let beatFlashDone = false;
  let beatBurstDone = false;
  let chargeSpawnAccum = 0;
  // ambient: separate accumulators for the two ambient sub-emitters.
  let emberAccum = 0;
  let groundSparkAccum = 0;

  function findFreeSlot(): Slot | null {
    for (const s of pool) if (!s.active) return s;
    return null;
  }

  function snap(v: number): number {
    return Math.round(v / pixelSize) * pixelSize;
  }

  function releaseSlot(s: Slot): void {
    s.active = false;
    s.g.visible = false;
    // recipeFlashBar's oversized tip-flare (`phase: "in"`) scales its
    // Graphics up mid-life — a slot released from any path (recipe swap,
    // element swap) must hand the next spawner a 1×
    // node or the reused particle draws oversized.
    s.g.scale.set(1);
  }

  function drawSquare(g: Graphics, texels: number, color: number, alpha: number): void {
    const side = clampPositive(texels, 0.01) * pixelSize;
    g.clear();
    g.rect(-side / 2, -side / 2, side, side).fill({ color, alpha });
  }

  /** 5-texel plus shape (one sparkle "twinkle"), drawn as a single pooled
   * Graphics — center cell + 4 orthogonal arm cells. */
  function drawPlus(g: Graphics, color: number, alpha: number): void {
    const s = clampPositive(pixelSize, 0.01);
    g.clear();
    const cells: ReadonlyArray<[number, number]> = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [cx, cy] of cells) {
      g.rect(cx * s - s / 2, cy * s - s / 2, s, s).fill({ color, alpha });
    }
  }

  // ---- fire -----------------------------------------------------------
  function spawnFire(stray: boolean): void {
    const s = findFreeSlot();
    if (!s) return;
    // born along the blade line, tip back toward grip ~60% of the blade
    const t = Math.random() * 0.6;
    const perpX = -dirY;
    const perpY = dirX;
    const jitter = (Math.random() - 0.5) * 6;
    s.x = tipX - dirX * t * SPAWN_SPREAD + perpX * jitter;
    s.y = tipY - dirY * t * SPAWN_SPREAD + perpY * jitter;
    s.active = true;
    s.kind = stray ? "fireStray" : "fire";
    s.sizeTexels = stray ? 1 : 1 + Math.floor(Math.random() * 3); // 1-3 texels
    s.maxLife = stray ? 0.9 + Math.random() * 0.35 : 0.5 + Math.random() * 0.3;
    s.life = s.maxLife;
    const upSpeed = stray ? 55 + Math.random() * 30 : 30 + Math.random() * 20;
    s.vx = (Math.random() - 0.5) * (stray ? 40 : 18);
    s.vy = -upSpeed;
    s.wobbleSeed = Math.random() * 1000;
    s.g.visible = true;
  }

  function tickFire(s: Slot, tickDt: number): void {
    s.life -= tickDt;
    if (s.life <= 0) {
      releaseSlot(s);
      return;
    }
    const wobbleAmp = s.kind === "fireStray" ? 10 : 5;
    const wobble = Math.sin((tickCount + s.wobbleSeed) * 0.9) * wobbleAmp;
    s.x += (s.vx + wobble) * tickDt;
    s.y += s.vy * tickDt;

    const progress = 1 - s.life / s.maxLife; // 0 = birth, 1 = death
    const stepIdx = Math.min(FIRE_PALETTE.length - 1, Math.floor(progress * FIRE_PALETTE.length));
    const color = FIRE_PALETTE[stepIdx];
    const shrink = clampPositive(s.sizeTexels * (1 - progress * 0.6), 0.6);
    const alphaIdx = progress > 0.8 ? Math.min(ALPHA_STEPS.length - 1, Math.floor((progress - 0.8) * 5 * ALPHA_STEPS.length)) : 0;
    drawSquare(s.g, shrink, color, ALPHA_STEPS[alphaIdx]);
    s.g.position.set(snap(s.x), snap(s.y));
  }

  // ---- electric ---------------------------------------------------------
  function rerollElectricBolt(): void {
    for (const s of electricBolt) releaseSlot(s);
    electricBolt = [];
    boltTickCounter = 0;
    if (element !== "electric") return;

    const segCount = 6 + Math.floor(Math.random() * 4); // 6-9
    const perpX = -dirY;
    const perpY = dirX;
    let prevPerp = 0;
    for (let i = 0; i < segCount; i++) {
      const s = findFreeSlot();
      if (!s) break;
      const t = segCount > 1 ? i / (segCount - 1) : 0;
      const zig = prevPerp + (Math.random() - 0.5) * 8;
      prevPerp = zig * 0.4; // decay so the chain doesn't wander off-blade
      s.x = tipX - dirX * t * SPAWN_SPREAD + perpX * zig;
      s.y = tipY - dirY * t * SPAWN_SPREAD + perpY * zig;
      s.active = true;
      s.kind = "electricSeg";
      const roll = Math.random();
      s.color = roll < 0.5 ? ELECTRIC_CORE : roll < 0.8 ? ELECTRIC_YELLOW : ELECTRIC_BLUE;
      s.g.visible = true;
      drawSquare(s.g, 1, s.color, 1);
      s.g.position.set(snap(s.x), snap(s.y));
      electricBolt.push(s);
    }

    // brief 1-tick flash pixels at the tip every few re-rolls
    if (Math.random() < 0.35) {
      const flashCount = 1 + Math.floor(Math.random() * 3);
      const tickInterval = 1 / clampPositive(stepFps, 1);
      for (let i = 0; i < flashCount; i++) {
        const s = findFreeSlot();
        if (!s) break;
        s.active = true;
        s.kind = "electricFlash";
        s.x = tipX + (Math.random() - 0.5) * 6;
        s.y = tipY + (Math.random() - 0.5) * 6;
        s.life = tickInterval;
        s.maxLife = tickInterval;
        s.color = ELECTRIC_CORE;
        drawSquare(s.g, 1, s.color, 1);
        s.g.position.set(snap(s.x), snap(s.y));
        s.g.visible = true;
      }
    }
  }

  function tickElectricFlash(s: Slot, tickDt: number): void {
    s.life -= tickDt;
    if (s.life <= 0) releaseSlot(s);
  }

  // ---- sparkle ------------------------------------------------------------
  function spawnSparkle(): void {
    const s = findFreeSlot();
    if (!s) return;
    const t = Math.random();
    const perpX = -dirY;
    const perpY = dirX;
    const jitter = (Math.random() - 0.5) * 10;
    s.x = tipX - dirX * t * SPAWN_SPREAD + perpX * jitter;
    s.y = tipY - dirY * t * SPAWN_SPREAD + perpY * jitter;
    s.active = true;
    s.kind = "sparkle";
    s.color = Math.random() < 0.6 ? SPARKLE_CYAN : SPARKLE_WHITE;
    s.phase = "in";
    s.phaseTicksLeft = 3 + Math.floor(Math.random() * 2); // 3-4 ticks per phase
    s.g.visible = true;
    drawPlus(s.g, s.color, ALPHA_STEPS[2]);
    s.g.position.set(snap(s.x), snap(s.y));
  }

  function tickSparkle(s: Slot): void {
    s.phaseTicksLeft -= 1;
    if (s.phaseTicksLeft > 0) return;
    if (s.phase === "in") {
      s.phase = "hold";
      s.phaseTicksLeft = 3 + Math.floor(Math.random() * 2);
      drawPlus(s.g, s.color, ALPHA_STEPS[0]);
    } else if (s.phase === "hold") {
      s.phase = "out";
      s.phaseTicksLeft = 3 + Math.floor(Math.random() * 2);
      drawPlus(s.g, s.color, ALPHA_STEPS[2]);
    } else {
      releaseSlot(s);
    }
  }

  // ---- recipe: motes (common — เศษประกายเหล็ก, drifting 1-texel dust) -----
  function spawnRecipeMotes(cfg: RefineFxLayer): void {
    const s = findFreeSlot();
    if (!s) return;
    const t = Math.random();
    const perpX = -dirY;
    const perpY = dirX;
    const jitter = (Math.random() - 0.5) * 8;
    s.x = tipX - dirX * t * cfg.spread + perpX * jitter;
    s.y = tipY - dirY * t * cfg.spread + perpY * jitter;
    s.active = true;
    s.kind = "recipeMotes";
    s.palette = cfg.palette;
    s.sizeTexels = cfg.sizeTexels;
    s.maxLife = 1.2 + Math.random() * 0.6;
    s.life = s.maxLife;
    s.vx = (Math.random() - 0.5) * 10;
    s.vy = -(6 + Math.random() * 8); // slow drift, not a fire-style upward burst
    s.wobbleSeed = Math.random() * 1000;
    s.g.visible = true;
  }

  function tickRecipeMotes(s: Slot, tickDt: number): void {
    s.life -= tickDt;
    if (s.life <= 0) {
      releaseSlot(s);
      return;
    }
    const wobble = Math.sin((tickCount + s.wobbleSeed) * 0.6) * 4;
    s.x += (s.vx + wobble) * tickDt;
    s.y += s.vy * tickDt;
    const progress = 1 - s.life / s.maxLife;
    const color = paletteStepColor(s.palette, progress);
    const alphaIdx =
      progress > 0.7 ? Math.min(ALPHA_STEPS.length - 1, Math.floor((progress - 0.7) * 4 * ALPHA_STEPS.length)) : 0;
    drawSquare(s.g, s.sizeTexels, color, ALPHA_STEPS[alphaIdx]);
    s.g.position.set(snap(s.x), snap(s.y));
  }

  // ---- recipe: flame (epic — เปลวไฟอำพัน; legendary gold layer reuses this) -
  function spawnRecipeFlame(cfg: RefineFxLayer): void {
    const s = findFreeSlot();
    if (!s) return;
    const t = Math.random() * 0.6;
    const perpX = -dirY;
    const perpY = dirX;
    const jitter = (Math.random() - 0.5) * 6;
    s.x = tipX - dirX * t * cfg.spread + perpX * jitter;
    s.y = tipY - dirY * t * cfg.spread + perpY * jitter;
    s.active = true;
    s.kind = "recipeFlame";
    s.palette = cfg.palette;
    s.sizeTexels = cfg.sizeTexels + Math.floor(Math.random() * 2);
    s.maxLife = 0.45 + Math.random() * 0.3;
    s.life = s.maxLife;
    const upSpeed = 28 + Math.random() * 20;
    s.vx = (Math.random() - 0.5) * 16;
    s.vy = -upSpeed;
    s.wobbleSeed = Math.random() * 1000;
    s.g.visible = true;
  }

  function tickRecipeFlame(s: Slot, tickDt: number): void {
    s.life -= tickDt;
    if (s.life <= 0) {
      releaseSlot(s);
      return;
    }
    const wobble = Math.sin((tickCount + s.wobbleSeed) * 0.9) * 5;
    s.x += (s.vx + wobble) * tickDt;
    s.y += s.vy * tickDt;
    const progress = 1 - s.life / s.maxLife;
    const color = paletteStepColor(s.palette, progress);
    const shrink = clampPositive(s.sizeTexels * (1 - progress * 0.6), 0.6);
    const alphaIdx =
      progress > 0.8 ? Math.min(ALPHA_STEPS.length - 1, Math.floor((progress - 0.8) * 5 * ALPHA_STEPS.length)) : 0;
    drawSquare(s.g, shrink, color, ALPHA_STEPS[alphaIdx]);
    s.g.position.set(snap(s.x), snap(s.y));
  }

  // ---- recipe: sparkle (rare — ประกายฟ้า; legendary violet layer reuses) --
  // Blink-phase logic itself is kind-agnostic (`tickSparkle` above just reads
  // `s.color`/`s.phase`), so this only needs its own SPAWN using the recipe's
  // palette instead of the fixed SPARKLE_CYAN/WHITE pair.
  function spawnRecipeSparkle(cfg: RefineFxLayer): void {
    const s = findFreeSlot();
    if (!s) return;
    const t = Math.random();
    const perpX = -dirY;
    const perpY = dirX;
    const jitter = (Math.random() - 0.5) * 10;
    s.x = tipX - dirX * t * cfg.spread + perpX * jitter;
    s.y = tipY - dirY * t * cfg.spread + perpY * jitter;
    s.active = true;
    s.kind = "recipeSparkle";
    const altA = cfg.palette[0] ?? 0xffffff;
    const altB = cfg.palette[Math.min(1, cfg.palette.length - 1)] ?? altA;
    s.color = Math.random() < 0.5 ? altA : altB;
    s.phase = "in";
    s.phaseTicksLeft = 3 + Math.floor(Math.random() * 2);
    s.g.visible = true;
    drawPlus(s.g, s.color, ALPHA_STEPS[2]);
    s.g.position.set(snap(s.x), snap(s.y));
  }

  function spawnRecipeParticle(lr: { cfg: RefineFxLayer; spawnAccum: number }): void {
    if (lr.cfg.kind === "motes") spawnRecipeMotes(lr.cfg);
    else if (lr.cfg.kind === "flame") spawnRecipeFlame(lr.cfg);
    else spawnRecipeSparkle(lr.cfg);
  }

  // ---- recipe: crackle (+9 normal / +4 legendary) — 1-tick zigzag bolt ----
  function spawnCrackleBurst(cfg: NonNullable<RefineFxRecipe["crackle"]>): void {
    const segCount = 4 + Math.floor(Math.random() * 3); // 4-6
    const perpX = -dirY;
    const perpY = dirX;
    let prevPerp = 0;
    const tickInterval = 1 / clampPositive(stepFps, 1);
    for (let i = 0; i < segCount; i++) {
      const s = findFreeSlot();
      if (!s) break;
      const t = segCount > 1 ? i / (segCount - 1) : 0;
      const zig = prevPerp + (Math.random() - 0.5) * 10;
      prevPerp = zig * 0.4;
      s.x = tipX - dirX * t * RECIPE_EVENT_SPREAD + perpX * zig;
      s.y = tipY - dirY * t * RECIPE_EVENT_SPREAD + perpY * zig;
      s.active = true;
      s.kind = "recipeCrackle";
      s.color = Math.random() < 0.5 ? cfg.palette[0]! : (cfg.palette[1] ?? cfg.palette[0]!);
      s.life = tickInterval;
      s.maxLife = tickInterval;
      s.g.visible = true;
      drawSquare(s.g, 1, s.color, 1);
      s.g.position.set(snap(s.x), snap(s.y));
    }
  }

  // ---- recipe: molten (+8 normal / +3 legendary) — pixels CLING to the
  // blade, re-projected from the CURRENT tip+dir every tick (make-or-break
  // behavior — see the `Slot.vx`/`vy`/`wobbleSeed` repurpose docs above).
  function spawnMoltenSlot(cfg: NonNullable<RefineFxRecipe["molten"]>): Slot | null {
    const s = findFreeSlot();
    if (!s) return null;
    s.active = true;
    s.kind = "recipeMolten";
    s.palette = cfg.palette;
    s.sizeTexels = 1 + Math.floor(Math.random() * 2); // 1-2 texels, small clinging pixels
    s.vx = Math.random(); // tFrac — repurposed, NOT velocity (see Slot doc)
    s.vy = (Math.random() - 0.5) * 6; // perpOffset — repurposed, NOT velocity
    s.wobbleSeed = Math.random() * 1000; // shimmer phase seed — repurposed
    s.g.visible = true;
    return s;
  }

  function refillMoltenSlots(cfg: NonNullable<RefineFxRecipe["molten"]>): void {
    const need = cfg.countTexels - moltenSlots.length;
    for (let i = 0; i < need; i++) {
      const s = spawnMoltenSlot(cfg);
      if (!s) break;
      moltenSlots.push(s);
    }
  }

  const MOLTEN_SPREAD = RECIPE_EVENT_SPREAD;
  const MOLTEN_SHIMMER_SPEED = 0.35;

  /** Re-projects position from the CURRENT tip+dir every call (this IS the
   * "ride the blade through a swing" behavior) instead of integrating a
   * velocity — molten slots never age out on their own, only via a drip
   * conversion (see the drip bookkeeping in `simTick`). Color walks the
   * palette by a slow shimmer (phase = `wobbleSeed`), not by life progress —
   * molten pixels don't have a life progress. */
  function tickRecipeMolten(s: Slot): void {
    const perpX = -dirY;
    const perpY = dirX;
    s.x = tipX - dirX * s.vx * MOLTEN_SPREAD + perpX * s.vy;
    s.y = tipY - dirY * s.vx * MOLTEN_SPREAD + perpY * s.vy;
    const shimmer = (Math.sin((tickCount + s.wobbleSeed) * MOLTEN_SHIMMER_SPEED) + 1) / 2;
    drawSquare(s.g, s.sizeTexels, paletteStepColor(s.palette, shimmer), ALPHA_STEPS[0]);
    s.g.position.set(snap(s.x), snap(s.y));
  }

  const DRIP_GRAVITY = 220;

  /** A molten slot plucked mid-flight (see the drip bookkeeping in
   * `simTick`) falls with gravity and fades out by palette-step before/at
   * `groundY` (or its own life running out, whichever comes first). */
  function tickRecipeDrip(s: Slot, tickDt: number): void {
    s.life -= tickDt;
    s.vy += DRIP_GRAVITY * tickDt;
    s.x += s.vx * tickDt;
    s.y += s.vy * tickDt;
    const hitGround = groundY !== null && s.y >= groundY;
    if (s.life <= 0 || hitGround) {
      releaseSlot(s);
      return;
    }
    const progress = 1 - s.life / s.maxLife;
    const color = paletteStepColor(s.palette, progress);
    const shrink = clampPositive(s.sizeTexels * (1 - progress * 0.5), 0.5);
    const alphaIdx =
      progress > 0.7 ? Math.min(ALPHA_STEPS.length - 1, Math.floor((progress - 0.7) * 4 * ALPHA_STEPS.length)) : 0;
    drawSquare(s.g, shrink, color, ALPHA_STEPS[alphaIdx]);
    s.g.position.set(snap(s.x), snap(s.y));
  }

  // ---- recipe: swing afterimage (+9 normal / +4 legendary) — stationary
  // ghost squares sampled from the tip ring-buffer; also reused (below) for
  // ambient ground-spark pops, which are the same "stationary, stepped-alpha
  // fade, short life" shape with a different spawn site.
  function pushTipRing(): void {
    const slot = tipRing[tipRingHead]!;
    slot.x = tipX;
    slot.y = tipY;
    tipRingHead = (tipRingHead + 1) % TIP_RING_SIZE;
  }

  const TRAIL_LAG_TICKS = 3;

  function spawnRecipeTrail(cfg: NonNullable<RefineFxRecipe["swingTrail"]>): void {
    const s = findFreeSlot();
    if (!s) return;
    const lagIdx = (tipRingHead - TRAIL_LAG_TICKS - 1 + TIP_RING_SIZE * 2) % TIP_RING_SIZE;
    const p = tipRing[lagIdx]!;
    s.active = true;
    s.kind = "recipeTrail";
    s.palette = cfg.palette;
    s.sizeTexels = 1.4;
    s.x = p.x;
    s.y = p.y;
    const tickInterval = 1 / clampPositive(stepFps, 1);
    s.maxLife = tickInterval * (1 + Math.floor(Math.random() * 2)); // 1-2 ticks
    s.life = s.maxLife;
    s.g.visible = true;
  }

  function spawnRecipeGroundSpark(cfg: NonNullable<RefineFxRecipe["ambient"]>): void {
    if (groundY === null) return;
    const s = findFreeSlot();
    if (!s) return;
    s.active = true;
    s.kind = "recipeGroundSpark";
    s.palette = cfg.palette;
    s.sizeTexels = 1;
    s.x = tipX + (Math.random() - 0.5) * 50;
    s.y = groundY;
    const tickInterval = 1 / clampPositive(stepFps, 1);
    s.maxLife = tickInterval * (2 + Math.floor(Math.random() * 2)); // 2-3 ticks
    s.life = s.maxLife;
    s.g.visible = true;
  }

  /** Stationary square, stepped-alpha fade over life — shared by
   * `recipeTrail` (swing afterimage) and `recipeGroundSpark` (ambient pop). */
  function tickRecipeStationaryFade(s: Slot, tickDt: number): void {
    s.life -= tickDt;
    if (s.life <= 0) {
      releaseSlot(s);
      return;
    }
    const progress = 1 - s.life / s.maxLife;
    const color = paletteStepColor(s.palette, progress);
    const alphaIdx = Math.min(ALPHA_STEPS.length - 1, Math.floor(progress * ALPHA_STEPS.length));
    drawSquare(s.g, s.sizeTexels, color, ALPHA_STEPS[alphaIdx]);
    s.g.position.set(snap(s.x), snap(s.y));
  }

  // ---- recipe: charge→burst beat (+10 normal / +5 legendary) — REWORK of
  // the old static ember-column + tip-flare pulse into a 3-phase
  // anticipation→payoff cycle: INHALE (ring homes to the CURRENT tip every
  // tick) → FLASH (oversized plus + bright blade-line squares) → BURST
  // (radial pixels + a swing-style density kick).
  const CHARGE_INHALE_DURATION = 0.9;
  const CHARGE_SPAWN_RATE = 10; // particles/sec during the inhale window
  const CHARGE_RING_RADIUS = 50;
  const CHARGE_SPEED = 90;

  function spawnRecipeCharge(cfg: NonNullable<RefineFxRecipe["beat"]>): void {
    const s = findFreeSlot();
    if (!s) return;
    const a = Math.random() * Math.PI * 2;
    const r = CHARGE_RING_RADIUS + Math.random() * 20;
    s.active = true;
    s.kind = "recipeCharge";
    s.palette = cfg.palette;
    s.sizeTexels = 1;
    s.x = tipX + Math.cos(a) * r;
    s.y = tipY + Math.sin(a) * r * 0.6;
    s.maxLife = CHARGE_INHALE_DURATION + 0.2; // safety cap if it never reaches the tip
    s.life = s.maxLife;
    s.g.visible = true;
  }

  /** Re-aims toward the CURRENT tip every tick (not a fixed target captured
   * at spawn) at a constant speed — so charge particles track a swinging
   * blade during the inhale window instead of drifting to a stale point. */
  function tickRecipeCharge(s: Slot, tickDt: number): void {
    s.life -= tickDt;
    const dx = tipX - s.x;
    const dy = tipY - s.y;
    const dist = Math.hypot(dx, dy);
    if (s.life <= 0 || dist < 4) {
      releaseSlot(s);
      return;
    }
    s.x += (dx / dist) * CHARGE_SPEED * tickDt;
    s.y += (dy / dist) * CHARGE_SPEED * tickDt;
    const progress = 1 - s.life / s.maxLife;
    drawSquare(s.g, s.sizeTexels, paletteStepColor(s.palette, progress), ALPHA_STEPS[0]);
    s.g.position.set(snap(s.x), snap(s.y));
  }

  function spawnFlashBar(cfg: NonNullable<RefineFxRecipe["beat"]>): void {
    const tickInterval = 1 / clampPositive(stepFps, 1);
    // oversized white-plus tip flare — `phase: "in"` marks the scale-
    // animated core (vs. `"hold"` for the plain blade-line squares below).
    const core = findFreeSlot();
    if (core) {
      core.active = true;
      core.kind = "recipeFlashBar";
      core.phase = "in";
      core.x = tipX;
      core.y = tipY;
      core.color = 0xffffff;
      core.maxLife = tickInterval * 2;
      core.life = core.maxLife;
      core.g.visible = true;
    }
    const barCount = 3 + Math.floor(Math.random() * 2); // 3-4
    const perpX = -dirY;
    const perpY = dirX;
    for (let i = 0; i < barCount; i++) {
      const s = findFreeSlot();
      if (!s) break;
      const t = barCount > 1 ? i / (barCount - 1) : 0;
      const jitter = (Math.random() - 0.5) * 4;
      s.active = true;
      s.kind = "recipeFlashBar";
      s.phase = "hold";
      s.x = tipX - dirX * t * RECIPE_EVENT_SPREAD + perpX * jitter;
      s.y = tipY - dirY * t * RECIPE_EVENT_SPREAD + perpY * jitter;
      s.color = cfg.palette[i % cfg.palette.length] ?? 0xffffff;
      s.sizeTexels = 1 + (i % 2);
      s.maxLife = tickInterval * 2;
      s.life = s.maxLife;
      s.g.visible = true;
    }
  }

  /** `phase === "in"` is the oversized plus-shape flare (scale-animated,
   * same "scale the pooled node, shrink back to 1×" technique the old
   * `recipeBeatFlare` used); `phase === "hold"` is a plain bright blade-line
   * square. `releaseSlot` resets scale on release either way. */
  function tickRecipeFlashBar(s: Slot, tickDt: number): void {
    s.life -= tickDt;
    if (s.life <= 0) {
      releaseSlot(s);
      return;
    }
    const progress = 1 - s.life / s.maxLife;
    const alphaIdx = Math.min(ALPHA_STEPS.length - 1, Math.floor(progress * ALPHA_STEPS.length));
    if (s.phase === "in") {
      drawPlus(s.g, s.color, ALPHA_STEPS[alphaIdx]);
      s.g.scale.set(clampPositive(1.8 - progress * 0.8, 0.6));
    } else {
      drawSquare(s.g, s.sizeTexels, s.color, ALPHA_STEPS[alphaIdx]);
    }
    s.g.position.set(snap(s.x), snap(s.y));
  }

  const BURST_COUNT_MIN = 10;
  const BURST_DENSITY_KICK_TICKS = 3;

  /** Radial burst — "treat as an internal `notifySwing`-style density spike"
   * (the plan's words): reuses `burstTicksLeft`, the SAME knob a real swing
   * uses, so the burst beat also gives every other active recipe feature
   * (swing afterimage window, layer burst multiplier) a brief kick. */
  function spawnBurst(cfg: NonNullable<RefineFxRecipe["beat"]>): void {
    const count = BURST_COUNT_MIN + Math.floor(Math.random() * 3); // 10-12
    for (let i = 0; i < count; i++) {
      const s = findFreeSlot();
      if (!s) break;
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.3;
      const speed = 60 + Math.random() * 40;
      s.active = true;
      s.kind = "recipeBurst";
      s.palette = cfg.palette;
      s.x = tipX;
      s.y = tipY;
      s.vx = Math.cos(a) * speed;
      s.vy = Math.sin(a) * speed * 0.6;
      s.sizeTexels = 1 + Math.floor(Math.random() * 2);
      s.maxLife = 0.35 + Math.random() * 0.2;
      s.life = s.maxLife;
      s.wobbleSeed = Math.random() * 1000;
      s.g.visible = true;
    }
    burstTicksLeft = Math.max(burstTicksLeft, BURST_DENSITY_KICK_TICKS);
  }

  // ---- recipe: world ambient (+10 normal / +5 legendary) — slow wide-radius
  // embers around the whole character, reusing `tickRecipeMotes`'s drift/
  // fade (kind-agnostic — it only reads generic Slot fields).
  function spawnRecipeAmbient(cfg: NonNullable<RefineFxRecipe["ambient"]>): void {
    const s = findFreeSlot();
    if (!s) return;
    s.x = tipX + (Math.random() - 0.5) * 60; // ±30px around the anchor
    s.y = tipY + (Math.random() - 0.5) * 60;
    s.active = true;
    s.kind = "recipeAmbient";
    s.palette = cfg.palette;
    s.sizeTexels = 1;
    s.maxLife = 1.8 + Math.random() * 1.2; // slow, wide-radius rise
    s.life = s.maxLife;
    s.vx = (Math.random() - 0.5) * 6;
    s.vy = -(4 + Math.random() * 5);
    s.wobbleSeed = Math.random() * 1000;
    s.g.visible = true;
  }

  // ---- sim tick -----------------------------------------------------------
  function simTick(tickDt: number): void {
    tickCount++;
    if (burstTicksLeft > 0) burstTicksLeft--;
    const burstMult = burstTicksLeft > 0 ? 1.8 : 1;
    // Pushed unconditionally, once per tick, zero allocation (fixed-size
    // pre-filled ring) — even when nothing currently reads it, so the swing-
    // afterimage buffer is never stale the instant a recipe turns it on.
    pushTipRing();

    if (element === "fire") {
      // rate-based (particles/second), NOT particles/tick, so concurrent
      // particle count stays roughly constant regardless of `stepFps` —
      // otherwise a high stepFps would spawn (and need pool room for) far
      // more concurrent particles than a low one for the same visual density.
      const rate = 20 * density * burstMult;
      fireSpawnAccum += rate * tickDt;
      while (fireSpawnAccum >= 1) {
        spawnFire(false);
        fireSpawnAccum -= 1;
      }
      if (Math.random() < 0.6 * density * tickDt) spawnFire(true); // stray ember
    } else if (element === "electric") {
      boltTickCounter++;
      if (boltTickCounter >= BOLT_REROLL_EVERY_TICKS || electricBolt.length === 0) {
        rerollElectricBolt();
      }
    } else if (element === "sparkle") {
      const rate = 3 * density * burstMult;
      sparkleSpawnAccum += rate * tickDt;
      while (sparkleSpawnAccum >= 1) {
        spawnSparkle();
        sparkleSpawnAccum -= 1;
      }
    }

    // ---- experiment ⑧ recipe path — additive, runs independently of the
    // legacy `element` branches above (both CAN be active at once; no
    // experiment exercises that combination, but nothing here assumes not).
    if (recipe) {
      for (const lr of recipeLayerRuntimes) {
        const rate = lr.cfg.rate * density * burstMult;
        lr.spawnAccum += rate * tickDt;
        while (lr.spawnAccum >= 1) {
          spawnRecipeParticle(lr);
          lr.spawnAccum -= 1;
        }
      }
      if (recipe.crackle) {
        crackleTimer += tickDt;
        if (crackleTimer >= recipe.crackle.interval) {
          crackleTimer -= recipe.crackle.interval;
          spawnCrackleBurst(recipe.crackle);
        }
      }

      // ---- molten: top-up the clinging population + roll drips. The
      // per-tick ride-the-blade reprojection itself runs generically in the
      // pool dispatch loop below (keyed off `kind === "recipeMolten"`).
      if (recipe.molten) {
        refillMoltenSlots(recipe.molten);
        if (recipe.molten.dripRate > 0) {
          dripAccum += recipe.molten.dripRate * tickDt;
          while (dripAccum >= 1 && moltenSlots.length > 0) {
            dripAccum -= 1;
            const idx = Math.floor(Math.random() * moltenSlots.length);
            const dripSlot = moltenSlots[idx]!;
            moltenSlots.splice(idx, 1);
            // Convert the plucked slot IN PLACE into a falling drip — reuses
            // its pooled Graphics, no extra `findFreeSlot` needed.
            dripSlot.kind = "recipeDrip";
            dripSlot.vx = (Math.random() - 0.5) * 14;
            dripSlot.vy = 6 + Math.random() * 8;
            dripSlot.maxLife = 0.6 + Math.random() * 0.5;
            dripSlot.life = dripSlot.maxLife;
            refillMoltenSlots(recipe.molten); // top back up to countTexels
          }
        }
      } else if (moltenSlots.length > 0) {
        // Defensive only — `molten` going non-null→null always rides a
        // recipe signature change, which `setRecipe` already releases+clears
        // for. Kept so this branch can never silently leak active slots if
        // that invariant is ever broken.
        for (const s of moltenSlots) releaseSlot(s);
        moltenSlots = [];
      }

      // ---- swing afterimage: only while a swing burst is active — "no
      // buffer reads while idle" (the plan's words).
      if (recipe.swingTrail && burstTicksLeft > 0) {
        spawnRecipeTrail(recipe.swingTrail);
      }

      // ---- charge→burst beat: INHALE (0..period-worth of ring-homing
      // particles) → FLASH (2 ticks) → BURST, then quiet until the cycle
      // wraps. Phase computed from a within-cycle timer (not tick counts)
      // so it stays correct across `setStepFps` changes.
      if (recipe.beat) {
        beatCycleTimer += tickDt;
        const flashEnd = CHARGE_INHALE_DURATION + tickDt * 2;
        if (beatCycleTimer < CHARGE_INHALE_DURATION) {
          chargeSpawnAccum += CHARGE_SPAWN_RATE * tickDt;
          while (chargeSpawnAccum >= 1) {
            spawnRecipeCharge(recipe.beat);
            chargeSpawnAccum -= 1;
          }
        } else if (beatCycleTimer < flashEnd) {
          if (!beatFlashDone) {
            spawnFlashBar(recipe.beat);
            beatFlashDone = true;
          }
        } else if (!beatBurstDone) {
          spawnBurst(recipe.beat);
          beatBurstDone = true;
        }
        if (beatCycleTimer >= recipe.beat.period) {
          beatCycleTimer -= recipe.beat.period;
          beatFlashDone = false;
          beatBurstDone = false;
          chargeSpawnAccum = 0;
        }
      }

      // ---- world ambient: slow embers around the whole character + ground
      // sparks (only once a host calls `setGroundY`).
      if (recipe.ambient) {
        emberAccum += recipe.ambient.emberRate * density * tickDt;
        while (emberAccum >= 1) {
          spawnRecipeAmbient(recipe.ambient);
          emberAccum -= 1;
        }
        if (groundY !== null) {
          groundSparkAccum += recipe.ambient.groundSparkRate * density * tickDt;
          while (groundSparkAccum >= 1) {
            spawnRecipeGroundSpark(recipe.ambient);
            groundSparkAccum -= 1;
          }
        }
      }
    }

    for (const s of pool) {
      if (!s.active) continue;
      if (s.kind === "fire" || s.kind === "fireStray") tickFire(s, tickDt);
      else if (s.kind === "electricFlash") tickElectricFlash(s, tickDt);
      else if (s.kind === "sparkle") tickSparkle(s);
      // electricSeg: static between re-rolls — no per-tick pose update.
      else if (s.kind === "recipeMotes") tickRecipeMotes(s, tickDt);
      else if (s.kind === "recipeFlame") tickRecipeFlame(s, tickDt);
      else if (s.kind === "recipeSparkle") tickSparkle(s); // phase logic is kind-agnostic
      else if (s.kind === "recipeCrackle") tickElectricFlash(s, tickDt); // life-countdown-only, also kind-agnostic
      else if (s.kind === "recipeMolten") tickRecipeMolten(s);
      else if (s.kind === "recipeDrip") tickRecipeDrip(s, tickDt);
      else if (s.kind === "recipeTrail" || s.kind === "recipeGroundSpark") tickRecipeStationaryFade(s, tickDt);
      else if (s.kind === "recipeCharge") tickRecipeCharge(s, tickDt);
      else if (s.kind === "recipeFlashBar") tickRecipeFlashBar(s, tickDt);
      else if (s.kind === "recipeBurst") tickRecipeFlame(s, tickDt); // radial fade/move is kind-agnostic
      else if (s.kind === "recipeAmbient") tickRecipeMotes(s, tickDt); // drift/fade is kind-agnostic
    }
  }

  return {
    setElement(el: WeaponFxElement): void {
      if (element === "electric" && el !== "electric") {
        for (const s of electricBolt) releaseSlot(s);
        electricBolt = [];
      }
      element = el;
    },
    setRecipe(next: RefineFxRecipe | null): void {
      // VALUE-compared (not reference), so a host that recomputes a fresh
      // recipe object every frame (rather than only on an actual refine/
      // rarity change) is still a safe no-op — never resets a running
      // spawnAccum/crackleTimer/beatCycleTimer on a redundant call. `resolveRefine
      // FxRecipe` returns small plain-object trees, so JSON.stringify is a
      // cheap-enough dev-tool signature (called at most once per slider tick,
      // never in a hot per-particle loop).
      const sig = next ? JSON.stringify(next) : null;
      if (sig === lastRecipeSig) return;
      lastRecipeSig = sig;

      // A changed recipe invalidates every IN-FLIGHT recipe-kind particle
      // (stale palette/behavior) — release them so the new recipe starts
      // clean, exactly like `setElement`'s own electric-bolt teardown above.
      for (const s of pool) {
        if (s.active && isRecipeKind(s.kind)) releaseSlot(s);
      }

      recipe = next;
      recipeLayerRuntimes = (next?.layers ?? []).map((cfg) => ({ cfg, spawnAccum: 0 }));
      crackleTimer = 0;

      // "special-feel" wave state — every accumulator/one-shot flag resets
      // together with the recipe swap above (the blanket release loop just
      // above already deactivated any in-flight molten/drip/trail/charge/
      // flashBar/burst/ambient/groundSpark slots; `moltenSlots` only needs
      // its stale references dropped).
      moltenSlots = [];
      dripAccum = 0;
      beatCycleTimer = 0;
      beatFlashDone = false;
      beatBurstDone = false;
      chargeSpawnAccum = 0;
      emberAccum = 0;
      groundSparkAccum = 0;
      if (next?.molten) refillMoltenSlots(next.molten);
    },
    setGroundY(y: number): void {
      groundY = y;
    },
    setAnchor(tx: number, ty: number, dx = 1, dy = 0): void {
      tipX = tx;
      tipY = ty;
      const len = Math.hypot(dx, dy);
      if (len > 1e-6) {
        dirX = dx / len;
        dirY = dy / len;
      }
    },
    setPixelSize(px: number): void {
      pixelSize = clampPositive(px, 0.5);
    },
    setStepFps(fps: number): void {
      const next = clampPositive(fps, 1);
      if (next === stepFps) return; // hosts may call this every frame — a
      // reset-on-every-call would zero the accumulator before it ever
      // reaches one tick interval and the sim would never advance.
      stepFps = next;
      simAccum = 0; // avoid a spawn backlog burst on a big fps drop
    },
    setDensity(mult: number): void {
      density = clampPositive(mult, 0);
    },
    notifySwing(): void {
      burstTicksLeft = 4 + Math.floor(Math.random() * 3); // 4-6 ticks
    },
    update(dt: number): void {
      simAccum += clampPositive(dt, 0);
      const tickInterval = 1 / clampPositive(stepFps, 1);
      let guard = 0;
      while (simAccum >= tickInterval && guard < 8) {
        simTick(tickInterval);
        simAccum -= tickInterval;
        guard++;
      }
    },
    destroy(): void {
      layer.parent?.removeChild(layer);
      layer.destroy({ children: true });
    },
  };
}
