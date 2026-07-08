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

const POOL_SIZE = 280;

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
  | "recipeBeatColumn"
  | "recipeBeatFlare";

function isRecipeKind(kind: Kind): boolean {
  return kind.startsWith("recipe");
}

interface Slot {
  g: Graphics;
  active: boolean;
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  sizeTexels: number;
  life: number; // seconds remaining
  maxLife: number;
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
  let beatTimer = 0;

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
    // recipeBeatFlare scales its Graphics up mid-life — a slot released from
    // any path (recipe swap, element swap) must hand the next spawner a 1×
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

  // ---- recipe: beat (+10 normal / +5 legendary) — rising column + tip flare
  function spawnBeatPulse(cfg: NonNullable<RefineFxRecipe["beat"]>): void {
    const flare = findFreeSlot();
    if (flare) {
      flare.active = true;
      flare.kind = "recipeBeatFlare";
      flare.x = tipX;
      flare.y = tipY;
      flare.color = cfg.columnPalette[0] ?? 0xffffff;
      flare.maxLife = 3 / clampPositive(stepFps, 1);
      flare.life = flare.maxLife;
      flare.g.visible = true;
    }
    const columnCount = 5;
    for (let i = 0; i < columnCount; i++) {
      const s = findFreeSlot();
      if (!s) break;
      const perpX = -dirY;
      const perpY = dirX;
      const jitter = (Math.random() - 0.5) * 4;
      s.active = true;
      s.kind = "recipeBeatColumn";
      s.color = cfg.columnPalette[i % cfg.columnPalette.length]!;
      s.x = tipX + perpX * jitter;
      s.y = tipY + perpY * jitter - i * pixelSize * 1.5; // stagger the column upward
      s.vx = (Math.random() - 0.5) * 6;
      s.vy = -(40 + Math.random() * 20);
      s.sizeTexels = 1 + (i % 2);
      s.maxLife = 0.55 + Math.random() * 0.25;
      s.life = s.maxLife;
      s.g.visible = true;
    }
  }

  function tickRecipeBeatColumn(s: Slot, tickDt: number): void {
    s.life -= tickDt;
    if (s.life <= 0) {
      releaseSlot(s);
      return;
    }
    s.x += s.vx * tickDt;
    s.y += s.vy * tickDt;
    const progress = 1 - s.life / s.maxLife;
    const alphaIdx =
      progress > 0.6 ? Math.min(ALPHA_STEPS.length - 1, Math.floor((progress - 0.6) * 4 * ALPHA_STEPS.length)) : 0;
    drawSquare(s.g, s.sizeTexels, s.color, ALPHA_STEPS[alphaIdx]);
    s.g.position.set(snap(s.x), snap(s.y));
  }

  /** Bigger plus-shape flash (the "tip-flare pulse" half of the beat) —
   * `drawPlus` itself has no size param (fixed at `pixelSize`), so the
   * "bigger" read comes from scaling the pooled Graphics node directly,
   * shrinking back to 1× over its short life. */
  function tickRecipeBeatFlare(s: Slot, tickDt: number): void {
    s.life -= tickDt;
    if (s.life <= 0) {
      releaseSlot(s);
      s.g.scale.set(1);
      return;
    }
    const progress = 1 - s.life / s.maxLife;
    const alphaIdx = Math.min(ALPHA_STEPS.length - 1, Math.floor(progress * ALPHA_STEPS.length));
    drawPlus(s.g, s.color, ALPHA_STEPS[alphaIdx]);
    s.g.scale.set(clampPositive(1.6 - progress * 0.6, 0.6));
    s.g.position.set(snap(s.x), snap(s.y));
  }

  // ---- sim tick -----------------------------------------------------------
  function simTick(tickDt: number): void {
    tickCount++;
    if (burstTicksLeft > 0) burstTicksLeft--;
    const burstMult = burstTicksLeft > 0 ? 1.8 : 1;

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
      if (recipe.beat) {
        beatTimer += tickDt;
        if (beatTimer >= recipe.beat.flarePeriod) {
          beatTimer -= recipe.beat.flarePeriod;
          spawnBeatPulse(recipe.beat);
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
      else if (s.kind === "recipeBeatColumn") tickRecipeBeatColumn(s, tickDt);
      else if (s.kind === "recipeBeatFlare") tickRecipeBeatFlare(s, tickDt);
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
      // spawnAccum/crackleTimer/beatTimer on a redundant call. `resolveRefine
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
      beatTimer = 0;
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
