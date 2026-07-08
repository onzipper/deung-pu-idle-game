"use client";

/**
 * Experiment ⑦ — อาวุธ+เอฟเฟค (weaponFx). Lets the owner judge whether CODE
 * pixel-particle weapon effects (`@/lab/pixelWeaponFx`) read well next to a
 * pixel-art weapon sprite (Swordtember-style reference), in three modes:
 * the weapon alone, held by the REAL in-game hero rig (`@/render/views/
 * heroView`, read-only import — never forked here), and mid-attack (the same
 * rig, with swings triggered by bumping the fake hero's `cd` the same way
 * `updateHeroView` itself detects a real swordsman swing).
 *
 * Weapon texture: prefers any uploaded frame-set group whose key starts with
 * "wpn" (drop `wpn_something_01.png` etc. into the lab asset picker); falls
 * back to a hand-authored ~30×11-texel placeholder sword baked once into a
 * `RenderTexture` (`buildPlaceholderTexture`) — a straight blade pointing +x
 * with the grip at the left, matching every "blade already +x" assumption
 * downstream (mounting on `weaponArm` needs zero extra rotation).
 *
 * Blade tip/direction feed for the HELD/ATTACK modes mirrors `heroView.ts`'s
 * own private `swordTipLocal()`/`getSwordTipPos()` technique verbatim (see
 * `updateBladeAnchorFromRig` below): a fixed LOCAL point in `weaponArm`'s own
 * coordinate frame, converted to `view.parent`-local space via `toLocal` —
 * NOT derived from the sprite's own bounds, so it inherits every swing's
 * rotation/lunge for free and stays correct regardless of sprite art scale.
 * The "alone" mode has no rig, so ITS tip anchor is derived from the sprite's
 * own bounds instead (`TIP_ANCHOR`/`GRIP_IN_SPRITE` fractions).
 */

import { useState } from "react";
import { Container, Graphics, Point, Sprite, Text, Texture } from "pixi.js";
import type { LabStage } from "@/lab/stage";
import { buildCheckerboard } from "@/lab/stage";
import { applyScaleMode, loadFrameSet, loadLibrary, type FrameSet } from "@/lab/frames";
import type { LabExperiment, LabScene } from "@/lab/registry";
import { GROUND_Y, WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";
import {
  createHeroView,
  updateHeroView,
  type HeroRenderModel,
  type HeroView,
} from "@/render/views/heroView";
import { createPixelWeaponFx, type PixelWeaponFx, type WeaponFxElement } from "@/lab/pixelWeaponFx";

type Mode = "alone" | "held" | "attack";

// ---------------------------------------------------------------------------
// Rig geometry knobs — GRIP mirrors heroView's own private
// `WEAPON_HAND.swordsman` (`{ x: 12, y: HEAD_Y - 2 }` where `HEAD_Y =
// GROUND_Y - 48`, both private to that module) so a sprite mounted here at
// this local point sits exactly in the swordsman's hand. BLADE_LEN/BLADE_RISE
// mirror `swordTipLocal()`'s own tip formula at tier 1.
// ---------------------------------------------------------------------------
const RIG_X = WORLD_WIDTH / 2;
const GRIP = { x: 12, y: GROUND_Y - 48 - 2 };
const BLADE_LEN = 38;
const BLADE_RISE = 8;

/** World px per texture px for the held/attack rig modes — the placeholder
 * matrix's blade span (guard→tip, ~22 texels) at this scale ≈ 44 world px,
 * close to the ~38 target. */
const SPRITE_SCALE = 2;
/** "อาวุธเดี่ยว" (alone) mode — bigger, for close inspection. */
const ALONE_SPRITE_SCALE = 6;
/** Where the grip sits within the sprite's own texture (normalized 0..1,
 * i.e. a Pixi `anchor` value) — matches the placeholder matrix's blade row
 * (see `buildPlaceholderSwordMatrix`); left edge, upper-third row. */
const GRIP_IN_SPRITE = { xFrac: 0, yFrac: 0.3 };
/** Where the blade TIP sits within the sprite's own texture — same row as
 * the grip (a straight horizontal blade), right edge. */
const TIP_ANCHOR = { xFrac: 1, yFrac: 0.3 };
/** Blade is already authored pointing +x — no extra sprite rotation needed. */
const SPRITE_ROT = 0;

// ---------------------------------------------------------------------------
// Placeholder pixel-art sword (used only when no "wpn*" frame group is
// uploaded) — a 30×11 texel matrix, char → flat color, built via small
// range-fill loops instead of hand-typed ASCII rows (less error-prone, same
// end result: a literal `string[]` matrix). Straight blade pointing +x, grip
// at the left, per the owner's Swordtember-style reference:
//   - blade: mid-gray body, bright top edge, white glint, dark under-edge
//   - grip/guard: dark navy checkered
//   - pommel: near-black
//   - near-black outline wraps every shape
// ---------------------------------------------------------------------------
const MATRIX_W = 30;
const MATRIX_H = 11;

const PLACEHOLDER_COLORS: Record<string, number> = {
  o: 0x17171c, // outline
  b: 0x9aa0a6, // blade mid-gray
  t: 0xe8eaed, // blade bright top edge
  g: 0xffffff, // white glint
  u: 0x5f6368, // blade dark under-edge
  x: 0x2c3350, // grip/guard navy
  y: 0x1c2138, // grip/guard navy (checker alt)
  p: 0x0a0a0d, // pommel near-black
};

function buildPlaceholderSwordMatrix(): string[] {
  const grid: string[][] = Array.from({ length: MATRIX_H }, () => Array<string>(MATRIX_W).fill("."));
  const fillRange = (r: number, c0: number, c1: number, ch: string): void => {
    if (r < 0 || r >= MATRIX_H) return;
    for (let c = Math.max(0, c0); c <= Math.min(MATRIX_W - 1, c1); c++) grid[r]![c] = ch;
  };
  const checkerRange = (r: number, c0: number, c1: number): void => {
    if (r < 0 || r >= MATRIX_H) return;
    for (let c = Math.max(0, c0); c <= Math.min(MATRIX_W - 1, c1); c++) {
      grid[r]![c] = (r + c) % 2 === 0 ? "x" : "y";
    }
  };

  // guard: cols 7-8, rows 1-6 (checker) + outline rows 0 & 7
  fillRange(0, 7, 8, "o");
  for (let r = 1; r <= 6; r++) checkerRange(r, 7, 8);
  fillRange(7, 7, 8, "o");

  // pommel: cols 0-1, rows 2-4 + outline rows 1 & 5
  fillRange(1, 0, 1, "o");
  fillRange(2, 0, 1, "p");
  fillRange(3, 0, 1, "p");
  fillRange(4, 0, 1, "p");
  fillRange(5, 0, 1, "o");

  // grip: cols 2-6, rows 2-4 (checker) + outline rows 1 & 5
  fillRange(1, 2, 6, "o");
  checkerRange(2, 2, 6);
  checkerRange(3, 2, 6);
  checkerRange(4, 2, 6);
  fillRange(5, 2, 6, "o");

  // blade main: cols 9-22, rows 1-5 (top edge/body/body/body/under-edge) + outline rows 0 & 6
  fillRange(0, 9, 22, "o");
  fillRange(1, 9, 22, "t");
  fillRange(2, 9, 22, "b");
  fillRange(3, 9, 22, "b");
  fillRange(4, 9, 22, "b");
  fillRange(5, 9, 22, "u");
  fillRange(6, 9, 22, "o");
  grid[2]![12] = "g"; // glint

  // blade taper: cols 23-25, rows 2-4 + outline rows 1 & 5
  fillRange(1, 23, 25, "o");
  fillRange(2, 23, 25, "t");
  fillRange(3, 23, 25, "b");
  fillRange(4, 23, 25, "u");
  fillRange(5, 23, 25, "o");

  // blade tip: cols 26-28, row 3 (glint) + outline rows 2 & 4
  fillRange(2, 26, 28, "o");
  fillRange(3, 26, 28, "g");
  fillRange(4, 26, 28, "o");

  // point pixel
  grid[3]![29] = "o";

  return grid.map((row) => row.join(""));
}

/** Draw `matrix` (1 texel = 1 texture px) into a fresh `Graphics`, bake it
 * into a `RenderTexture` via the lab stage's own renderer, then discard the
 * `Graphics` — footgun 3 respected (flat fills only, no hand-built
 * gradients); nearest-neighbor scale mode for crisp pixel-art. */
function buildPlaceholderTexture(stage: LabStage): Texture {
  const g = new Graphics();
  for (let r = 0; r < MATRIX_H; r++) {
    const row = buildPlaceholderSwordMatrix()[r]!;
    for (let c = 0; c < MATRIX_W; c++) {
      const ch = row[c];
      if (!ch || ch === ".") continue;
      const color = PLACEHOLDER_COLORS[ch];
      if (color === undefined) continue;
      g.rect(c, r, 1, 1).fill(color);
    }
  }
  const texture = stage.app.renderer.generateTexture(g);
  g.destroy();
  texture.source.scaleMode = "nearest";
  return texture;
}

/** Prefer an uploaded "wpn*"-keyed frame group's first frame; otherwise the
 * baked placeholder sword. Never throws — any library-load hiccup falls
 * through to the placeholder so the experiment always renders something. */
async function resolveWeaponTexture(stage: LabStage): Promise<Texture> {
  try {
    const { groups } = await loadLibrary();
    const wpnKey = Object.keys(groups).find((k) => k.toLowerCase().startsWith("wpn"));
    if (wpnKey) {
      const set: FrameSet = await loadFrameSet(wpnKey, groups);
      if (set.frames.length > 0) {
        applyScaleMode(set, true);
        return set.frames[0]!.texture;
      }
    }
  } catch {
    // fall through — a broken library load shouldn't sink this experiment
  }
  return buildPlaceholderTexture(stage);
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

interface ControlsBag {
  getMode(): Mode;
  setMode(m: Mode): void;
  getElement(): WeaponFxElement;
  setElement(el: WeaponFxElement): void;
  getStepped(): boolean;
  setStepped(v: boolean): void;
  getDensity(): number;
  setDensity(v: number): void;
  getCadence(): number;
  setCadence(v: number): void;
}

function createScene(stage: LabStage, _frames: FrameSet): LabScene {
  void _frames; // this experiment resolves its OWN weapon texture — see file doc comment

  const view = new Container();
  view.addChild(buildCheckerboard(WORLD_WIDTH, WORLD_HEIGHT));
  stage.world.addChild(view);

  const loadingText = new Text({
    text: "กำลังโหลด...",
    style: { fill: 0xffe28a, fontSize: 14 },
  });
  loadingText.anchor.set(0.5);
  loadingText.position.set(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
  view.addChild(loadingText);

  const fxLayer = new Container();
  view.addChild(fxLayer);
  const fx: PixelWeaponFx = createPixelWeaponFx(fxLayer);

  const aloneContainer = new Container();
  aloneContainer.visible = false;
  view.addChild(aloneContainer);

  const hero: HeroView = createHeroView();
  hero.visible = false;
  view.addChild(hero);

  const fakeHero: HeroRenderModel = {
    cls: "swordsman",
    x: RIG_X,
    aimX: null,
    equipped: { weapon: null, armor: null },
    tier: 1,
    shadowed: false,
    cd: 0,
    dead: false,
    hp: 100,
    maxHp: 100,
    reviveTimer: 0,
  };

  let ready = false;
  let disposed = false;
  let aloneSprite: Sprite | null = null;
  let mode: Mode = "held";
  let stepped = true;
  let density = 1;
  let cadence = 0.7;
  let cadenceAccum = 0;
  let aloneBobT = Math.random() * 10;

  // Cached Points — no per-frame allocations (mirrors `getSwordTipPos`'s own
  // `toLocal(..., out)` convention in heroView.ts).
  const tmpTip = new Point();
  const tmpGrip = new Point();
  const outTip = new Point();
  const outGrip = new Point();

  function applyModeVisibility(): void {
    if (!ready) return;
    aloneContainer.visible = mode === "alone";
    hero.visible = mode === "held" || mode === "attack";
  }

  async function mount(): Promise<void> {
    const texture = await resolveWeaponTexture(stage);
    // The scene may have been destroyed while the texture loaded (tab switch,
    // React StrictMode double-mount) — touching the destroyed containers
    // below would throw.
    if (disposed) return;

    const aSprite = new Sprite(texture);
    aSprite.anchor.set(GRIP_IN_SPRITE.xFrac, GRIP_IN_SPRITE.yFrac);
    aSprite.scale.set(ALONE_SPRITE_SCALE);
    aloneContainer.addChild(aSprite);
    aloneSprite = aSprite;

    const rSprite = new Sprite(texture);
    rSprite.anchor.set(GRIP_IN_SPRITE.xFrac, GRIP_IN_SPRITE.yFrac);
    rSprite.scale.set(SPRITE_SCALE);
    rSprite.rotation = SPRITE_ROT;
    rSprite.position.set(GRIP.x, GRIP.y);
    hero.weaponArm.addChild(rSprite);
    // The code-drawn weapon head would otherwise draw a second (bare) blade
    // right on top of this sprite — hide both gear graphics, safety included
    // per the brief even though swordsman never populates gearOffWeapon.
    hero.gearWeapon.visible = false;
    hero.gearOffWeapon.visible = false;

    ready = true;
    loadingText.visible = false;
    applyModeVisibility();
  }

  void mount();

  /** Blade tip + (tip−grip) direction for the HELD/ATTACK modes — a fixed
   * LOCAL point in `weaponArm`'s own frame, converted into `view.parent`
   * (== this scene's `view`) local space, exactly like heroView's own
   * private `swordTipLocal()`/`getSwordTipPos()`. */
  function updateBladeAnchorFromRig(): void {
    if (!hero.parent) return;
    tmpTip.set(GRIP.x + BLADE_LEN, GRIP.y - BLADE_RISE);
    tmpGrip.set(GRIP.x, GRIP.y);
    hero.parent.toLocal(tmpTip, hero.weaponArm, outTip);
    hero.parent.toLocal(tmpGrip, hero.weaponArm, outGrip);
    fx.setAnchor(outTip.x, outTip.y, outTip.x - outGrip.x, outTip.y - outGrip.y);
  }

  let currentElement: WeaponFxElement = "fire";
  fx.setElement(currentElement);

  const controls: ControlsBag = {
    getMode: () => mode,
    setMode(m) {
      mode = m;
      cadenceAccum = 0;
      fakeHero.cd = 0;
      applyModeVisibility();
    },
    getElement: () => currentElement,
    setElement(el) {
      currentElement = el;
      fx.setElement(el);
    },
    getStepped: () => stepped,
    setStepped(v) {
      stepped = v;
    },
    getDensity: () => density,
    setDensity(v) {
      density = v;
    },
    getCadence: () => cadence,
    setCadence(v) {
      cadence = v;
    },
  };

  return {
    view,
    update(dt) {
      if (!ready || disposed) return;

      fx.setStepFps(stepped ? 12 : 60);
      fx.setDensity(density);

      if (mode === "alone") {
        fx.setPixelSize(ALONE_SPRITE_SCALE);
        aloneBobT += dt;
        const bob = Math.sin(aloneBobT * 1.6) * 6;
        const baseX = WORLD_WIDTH / 2;
        const baseY = WORLD_HEIGHT / 2 + bob;
        // bob the CONTAINER by whole pixelSize steps so it stays on-grid
        aloneContainer.position.set(
          Math.round(baseX / ALONE_SPRITE_SCALE) * ALONE_SPRITE_SCALE,
          Math.round(baseY / ALONE_SPRITE_SCALE) * ALONE_SPRITE_SCALE,
        );
        if (aloneSprite) {
          const tipX = aloneContainer.position.x + aloneSprite.width * (TIP_ANCHOR.xFrac - GRIP_IN_SPRITE.xFrac);
          const tipY = aloneContainer.position.y + aloneSprite.height * (TIP_ANCHOR.yFrac - GRIP_IN_SPRITE.yFrac);
          fx.setAnchor(tipX, tipY, 1, 0);
        }
      } else {
        fx.setPixelSize(SPRITE_SCALE);
        fakeHero.x = RIG_X;
        if (mode === "attack") {
          cadenceAccum += dt;
          if (cadenceAccum >= cadence) {
            cadenceAccum -= cadence;
            fakeHero.cd += 1;
            fx.notifySwing();
          }
          fakeHero.cd = Math.max(0, fakeHero.cd - dt);
        } else {
          fakeHero.cd = 0; // idle stance, fx only
        }
        updateHeroView(hero, fakeHero, { dt, slot: 0, events: [], marching: false });
        updateBladeAnchorFromRig();
      }

      fx.update(dt);
    },
    destroy() {
      disposed = true;
      fx.destroy();
      view.parent?.removeChild(view);
      view.destroy({ children: true });
    },
    controls: controls as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

const MODE_OPTIONS: { id: Mode; label: string }[] = [
  { id: "alone", label: "อาวุธเดี่ยว" },
  { id: "held", label: "ตัวละครถือ" },
  { id: "attack", label: "โจมตี" },
];

const ELEMENT_OPTIONS: { id: WeaponFxElement; label: string }[] = [
  { id: "none", label: "ไม่มี" },
  { id: "fire", label: "🔥 ไฟ" },
  { id: "electric", label: "⚡ ไฟฟ้า" },
  { id: "sparkle", label: "✨ ประกาย" },
];

const btnBase =
  "min-h-10 rounded px-3 py-2 text-xs transition-colors";
const btnOff = "bg-slate-700 hover:bg-slate-600 text-slate-200";
const btnOn = "bg-amber-700 hover:bg-amber-600 text-white";

function WeaponFxControls({ scene }: { scene: LabScene }) {
  const c = scene.controls as unknown as ControlsBag;
  const [mode, setModeState] = useState(c.getMode());
  const [element, setElementState] = useState(c.getElement());
  const [stepped, setSteppedState] = useState(c.getStepped());
  const [density, setDensityState] = useState(c.getDensity());
  const [cadence, setCadenceState] = useState(c.getCadence());

  return (
    <div className="flex flex-col gap-4 text-xs text-slate-200">
      <div>
        <p className="mb-1 text-slate-400">โหมด</p>
        <div className="flex flex-wrap gap-2">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`${btnBase} ${mode === opt.id ? btnOn : btnOff}`}
              onClick={() => {
                c.setMode(opt.id);
                setModeState(opt.id);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-slate-400">ธาตุเอฟเฟค</p>
        <div className="flex flex-wrap gap-2">
          {ELEMENT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`${btnBase} ${element === opt.id ? btnOn : btnOff}`}
              onClick={() => {
                c.setElement(opt.id);
                setElementState(opt.id);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className={`${btnBase} ${stepped ? btnOn : btnOff}`}
        onClick={() => {
          const v = !stepped;
          c.setStepped(v);
          setSteppedState(v);
        }}
      >
        {stepped ? "สเต็ป 12fps (ถูกต้องสำหรับพิกเซล)" : "เนียน 60fps (เทียบให้เห็นว่าผิด)"}
      </button>

      <label className="flex items-center justify-between gap-2">
        <span>ความหนาแน่น</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={density}
          className="min-h-10 flex-1"
          onChange={(e) => {
            const v = Number(e.target.value);
            c.setDensity(v);
            setDensityState(v);
          }}
        />
        <span className="w-8 text-right tabular-nums">{density.toFixed(1)}</span>
      </label>

      {mode === "attack" && (
        <label className="flex items-center justify-between gap-2">
          <span>จังหวะฟัน (วิ)</span>
          <input
            type="range"
            min={0.4}
            max={1.2}
            step={0.05}
            value={cadence}
            className="min-h-10 flex-1"
            onChange={(e) => {
              const v = Number(e.target.value);
              c.setCadence(v);
              setCadenceState(v);
            }}
          />
          <span className="w-10 text-right tabular-nums">{cadence.toFixed(2)}</span>
        </label>
      )}

      <p className="text-slate-500">
        ทดสอบว่าเอฟเฟคอนุภาคพิกเซล (โค้ดล้วน) เข้ากับอาวุธพิกเซลอาร์ตได้ดีพอหรือไม่ — วางไฟล์ชื่อขึ้นต้นด้วย
        &quot;wpn&quot; ในคลัง lab เพื่อใช้อาวุธจริงแทนดาบตัวอย่าง
      </p>
    </div>
  );
}

export const weaponFxExperiment: LabExperiment = {
  id: "weaponFx",
  title: "⑦ อาวุธ+เอฟเฟค",
  desc: "เอฟเฟคอนุภาคพิกเซล (ไฟ/ไฟฟ้า/ประกาย) บนอาวุธพิกเซลอาร์ต — อาวุธเดี่ยว / ตัวละครถือ / โจมตี",
  Controls: WeaponFxControls,
  createScene,
};
