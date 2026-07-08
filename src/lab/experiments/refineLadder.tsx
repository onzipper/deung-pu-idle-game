"use client";

/**
 * Experiment ⑧ — ตีบวก&ความหายาก (refineLadder). Owner liked ⑦'s on-weapon
 * pixel fx and asked for a second version showing how the REAL code-drawn
 * gear (`@/render/views/heroView`, read-only import — never forked) reads
 * across the +0..+10 refine ladder, with fx identity driven by RARITY only
 * (`@/lab/refineFxRecipes` — the pure design-doc-in-code resolver;
 * `@/lab/pixelWeaponFx`'s new `setRecipe` turns it into pooled particles,
 * additive/independent of ⑦'s `setElement` path — see that module's header).
 *
 * Two view modes:
 *   - "single": one rig, real weapon at the selected class/tier (or the
 *     class's ตำนาน legendary), refine slider +0..+10 (+0..+5 legendary).
 *   - "ladder" (แถวเทียบ): 5 rigs spread across the stage showing the SAME
 *     weapon at fixed refine checkpoints [0,5,7,9,10] (legendary [0,2,3,4,5])
 *     side by side — a glance-compare of the whole ladder.
 *
 * `getWeaponAnchorPos`/`view.weaponArm` give the per-class "business end"
 * anchor (blade/bow/staff/dagger) directly — no manual GRIP/BLADE_LEN rig
 * geometry needed here, unlike ⑦'s sword-only placeholder-sprite mirror.
 * Class changes destroy+recreate the `HeroView` (cheap, button-tap-rate) per
 * the pre-explored guardrail, rather than relying on `updateHeroView`'s own
 * cls-edge rebuild — keeps this experiment's rig lifecycle simple/obviously
 * correct rather than leaning on an internal implementation detail.
 */

import { useState } from "react";
import { Container, Point, Text } from "pixi.js";
import type { LabStage } from "@/lab/stage";
import { buildCheckerboard } from "@/lab/stage";
import type { FrameSet } from "@/lab/frames";
import type { LabExperiment, LabScene } from "@/lab/registry";
import { GROUND_Y, WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";
import { createHeroView, getWeaponAnchorPos, updateHeroView, type HeroRenderModel, type HeroView } from "@/render/views/heroView";
import { createPixelWeaponFx, type PixelWeaponFx } from "@/lab/pixelWeaponFx";
import { resolveRefineFxRecipe } from "@/lab/refineFxRecipes";
import { ITEM_TEMPLATES, LEGENDARY_FOR_CLASS, LEGENDARY_TEMPLATES, type ItemRarity } from "@/engine/config/items";
import type { HeroClass } from "@/engine/entities";

type ViewMode = "single" | "ladder";

// ---------------------------------------------------------------------------
// Class + weapon catalog (built once at module scope — pure lookups, no Pixi).
// ---------------------------------------------------------------------------

const CLASS_OPTIONS: { id: HeroClass; label: string }[] = [
  { id: "swordsman", label: "ดาบ" },
  { id: "archer", label: "ธนู" },
  { id: "mage", label: "เวทมนตร์" },
  { id: "ninja", label: "นินจา" },
];

interface WeaponEntry {
  templateId: string;
  tier: number;
  rarity: ItemRarity;
}

const WEAPONS_BY_CLASS: Record<HeroClass, WeaponEntry[]> = (() => {
  const map = { swordsman: [], archer: [], mage: [], ninja: [] } as Record<HeroClass, WeaponEntry[]>;
  for (const t of Object.values(ITEM_TEMPLATES)) {
    if (t.slot !== "weapon" || t.kind === "legendary" || t.kind === "fortifier") continue;
    if (!t.classReq) continue;
    map[t.classReq].push({ templateId: t.id, tier: t.tier, rarity: t.rarity });
  }
  for (const cls of CLASS_OPTIONS) map[cls.id].sort((a, b) => a.tier - b.tier);
  return map;
})();

const LEVELS_NORMAL = [0, 5, 7, 9, 10] as const;
const LEVELS_LEGEND = [0, 2, 3, 4, 5] as const;

const RARITY_LABEL: Record<ItemRarity, string> = { common: "ธรรมดา", rare: "หายาก", epic: "เอปิก" };
const RARITY_CHIP_COLOR: Record<ItemRarity, number> = { common: 0xd7deee, rare: 0x4fc3f7, epic: 0xffb347 };
const LEGENDARY_LABEL = "ตำนาน";
const LEGENDARY_CHIP_COLOR = 0xf7d048;

const ATTACK_CADENCE = 0.7;
const CADENCE_PHASE_STEP = 0.12;
const FX_PIXEL_SIZE = 3;

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

interface RigInstance {
  hero: HeroView;
  fx: PixelWeaponFx;
  fxLayer: Container;
  label: Text;
  fakeHero: HeroRenderModel;
  x: number;
  cadenceAccum: number;
}

interface ControlsBag {
  getMode(): ViewMode;
  setMode(v: ViewMode): void;
  getCls(): HeroClass;
  setCls(c: HeroClass): void;
  getTier(): number;
  setTier(t: number): void;
  getLegendary(): boolean;
  setLegendary(v: boolean): void;
  getRefine(): number;
  setRefine(v: number): void;
  getAttack(): boolean;
  setAttack(v: boolean): void;
  getStepped(): boolean;
  setStepped(v: boolean): void;
  getRarity(): ItemRarity;
}

function createScene(stage: LabStage, _frames: FrameSet): LabScene {
  void _frames; // this experiment resolves weapons from the REAL gear catalog, no uploaded texture

  const view = new Container();
  view.addChild(buildCheckerboard(WORLD_WIDTH, WORLD_HEIGHT));
  stage.world.addChild(view);

  const rigsLayer = new Container();
  view.addChild(rigsLayer);

  let disposed = false;
  let mode: ViewMode = "single";
  let cls: HeroClass = "swordsman";
  let tier = 1; // 1..10, ignored while legendary
  let legendary = false;
  let refine = 0; // +0..+10 normal, clamped to +0..+5 while legendary
  let attack = false;
  let stepped = true;
  let rigs: RigInstance[] = [];

  function currentWeapon(): WeaponEntry {
    if (legendary) {
      const id = LEGENDARY_FOR_CLASS[cls];
      const t = LEGENDARY_TEMPLATES[id]!;
      return { templateId: t.id, tier: t.tier, rarity: t.rarity };
    }
    return WEAPONS_BY_CLASS[cls][tier - 1] ?? WEAPONS_BY_CLASS[cls][0]!;
  }

  function maxRefine(): number {
    return legendary ? LEVELS_LEGEND[LEVELS_LEGEND.length - 1] : 10;
  }

  function destroyRig(r: RigInstance): void {
    r.fx.destroy();
    r.fxLayer.parent?.removeChild(r.fxLayer);
    r.fxLayer.destroy({ children: true });
    r.hero.parent?.removeChild(r.hero);
    r.hero.destroy({ children: true });
    r.label.parent?.removeChild(r.label);
    r.label.destroy();
  }

  function buildRig(x: number, phaseIdx: number): RigInstance {
    const hero: HeroView = createHeroView();
    rigsLayer.addChild(hero);

    const fxLayer = new Container();
    rigsLayer.addChild(fxLayer);
    const fx = createPixelWeaponFx(fxLayer);
    fx.setPixelSize(FX_PIXEL_SIZE);

    const label = new Text({ text: "", style: { fill: 0xffe28a, fontSize: 12 } });
    label.anchor.set(0.5, 0);
    rigsLayer.addChild(label);

    const fakeHero: HeroRenderModel = {
      cls,
      x,
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

    return { hero, fx, fxLayer, label, fakeHero, x, cadenceAccum: phaseIdx * CADENCE_PHASE_STEP };
  }

  function rebuildRigs(): void {
    for (const r of rigs) destroyRig(r);
    rigs = [];
    if (mode === "single") {
      rigs.push(buildRig(WORLD_WIDTH / 2, 0));
    } else {
      const margin = WORLD_WIDTH * 0.1;
      const step = (WORLD_WIDTH - margin * 2) / (5 - 1);
      for (let i = 0; i < 5; i++) rigs.push(buildRig(margin + i * step, i));
    }
  }

  rebuildRigs();

  const tmpZero = new Point(0, 0);
  const outAnchor = new Point();
  const outPivot = new Point();

  /** Business-end anchor + normalized blade direction for THIS rig, straight
   * from the real rig geometry (`getWeaponAnchorPos` + the weaponArm pivot),
   * exactly as the plan specifies — no per-class constants needed here. */
  function updateFxAnchor(r: RigInstance): void {
    const ok = getWeaponAnchorPos(r.hero, outAnchor);
    if (!ok || !r.hero.parent) return;
    r.hero.parent.toLocal(tmpZero, r.hero.weaponArm, outPivot);
    let dx = outAnchor.x - outPivot.x;
    let dy = outAnchor.y - outPivot.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      dx = 1;
      dy = 0;
    } else {
      dx /= len;
      dy /= len;
    }
    r.fx.setAnchor(outAnchor.x, outAnchor.y, dx, dy);
  }

  const controls: ControlsBag = {
    getMode: () => mode,
    setMode(v) {
      if (v === mode) return;
      mode = v;
      rebuildRigs();
    },
    getCls: () => cls,
    setCls(c) {
      if (c === cls) return;
      cls = c;
      rebuildRigs(); // per-class rig rebuild — the pre-explored "safest" call
    },
    getTier: () => tier,
    setTier(t) {
      tier = Math.max(1, Math.min(10, Math.round(t)));
    },
    getLegendary: () => legendary,
    setLegendary(v) {
      legendary = v;
      if (v && refine > LEVELS_LEGEND[LEVELS_LEGEND.length - 1]) {
        refine = LEVELS_LEGEND[LEVELS_LEGEND.length - 1];
      }
    },
    getRefine: () => refine,
    setRefine(v) {
      refine = Math.max(0, Math.min(maxRefine(), Math.round(v)));
    },
    getAttack: () => attack,
    setAttack(v) {
      attack = v;
    },
    getStepped: () => stepped,
    setStepped(v) {
      stepped = v;
    },
    getRarity: () => currentWeapon().rarity,
  };

  return {
    view,
    update(dt) {
      if (disposed) return;

      const weapon = currentWeapon();
      const levels = legendary ? LEVELS_LEGEND : LEVELS_NORMAL;

      for (let i = 0; i < rigs.length; i++) {
        const r = rigs[i]!;
        r.fakeHero.x = r.x;
        r.fakeHero.equipped.weapon = weapon.templateId;

        const refineForRig = mode === "single" ? refine : levels[i]!;

        if (attack) {
          r.cadenceAccum += dt;
          if (r.cadenceAccum >= ATTACK_CADENCE) {
            r.cadenceAccum -= ATTACK_CADENCE;
            r.fakeHero.cd += 1;
            r.fx.notifySwing();
          }
          r.fakeHero.cd = Math.max(0, r.fakeHero.cd - dt);
        } else {
          r.fakeHero.cd = 0;
        }

        updateHeroView(r.hero, r.fakeHero, { dt, slot: 0, events: [], marching: false });
        updateFxAnchor(r);

        r.fx.setStepFps(stepped ? 12 : 60);
        r.fx.setRecipe(resolveRefineFxRecipe(weapon.rarity, refineForRig, legendary));
        r.fx.update(dt);

        r.label.text = `+${refineForRig}`;
        r.label.position.set(r.x, GROUND_Y + 8);
      }
    },
    destroy() {
      disposed = true;
      for (const r of rigs) destroyRig(r);
      rigs = [];
      view.parent?.removeChild(view);
      view.destroy({ children: true });
    },
    controls: controls as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

const MODE_OPTIONS: { id: ViewMode; label: string }[] = [
  { id: "single", label: "ตัวเดียว" },
  { id: "ladder", label: "แถวเทียบ" },
];

const btnBase = "min-h-10 rounded px-3 py-2 text-xs transition-colors";
const btnOff = "bg-slate-700 hover:bg-slate-600 text-slate-200";
const btnOn = "bg-amber-700 hover:bg-amber-600 text-white";

function RefineLadderControls({ scene }: { scene: LabScene }) {
  const c = scene.controls as unknown as ControlsBag;
  const [mode, setModeState] = useState(c.getMode());
  const [cls, setClsState] = useState(c.getCls());
  const [tier, setTierState] = useState(c.getTier());
  const [legendary, setLegendaryState] = useState(c.getLegendary());
  const [refine, setRefineState] = useState(c.getRefine());
  const [attack, setAttackState] = useState(c.getAttack());
  const [stepped, setSteppedState] = useState(c.getStepped());

  const rarity = c.getRarity();
  const chipColor = legendary ? LEGENDARY_CHIP_COLOR : RARITY_CHIP_COLOR[rarity];
  const chipLabel = legendary ? LEGENDARY_LABEL : RARITY_LABEL[rarity];
  const chipHex = `#${chipColor.toString(16).padStart(6, "0")}`;
  const maxRefine = legendary ? 5 : 10;

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
        <p className="mb-1 text-slate-400">คลาส</p>
        <div className="flex flex-wrap gap-2">
          {CLASS_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`${btnBase} ${cls === opt.id ? btnOn : btnOff}`}
              onClick={() => {
                c.setCls(opt.id);
                setClsState(opt.id);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-slate-400">ระดับอาวุธ</p>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((t) => (
            <button
              key={t}
              type="button"
              className={`${btnBase} ${!legendary && tier === t ? btnOn : btnOff}`}
              onClick={() => {
                c.setLegendary(false);
                setLegendaryState(false);
                c.setTier(t);
                setTierState(t);
                setRefineState(c.getRefine());
              }}
            >
              t{t}
            </button>
          ))}
          <button
            type="button"
            className={`${btnBase} ${legendary ? btnOn : btnOff}`}
            onClick={() => {
              c.setLegendary(true);
              setLegendaryState(true);
              setRefineState(c.getRefine());
            }}
          >
            ตำนาน
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-slate-400">ความหายาก</span>
        <span
          className="rounded px-2 py-1 font-semibold"
          style={{ backgroundColor: chipHex, color: "#17171c" }}
        >
          {chipLabel}
        </span>
      </div>

      {mode === "single" && (
        <label className="flex items-center justify-between gap-2">
          <span>ตีบวก</span>
          <input
            type="range"
            min={0}
            max={maxRefine}
            step={1}
            value={Math.min(refine, maxRefine)}
            className="min-h-10 flex-1"
            onChange={(e) => {
              const v = Number(e.target.value);
              c.setRefine(v);
              setRefineState(c.getRefine());
            }}
          />
          <span className="w-8 text-right tabular-nums">+{Math.min(refine, maxRefine)}</span>
        </label>
      )}

      <button
        type="button"
        className={`${btnBase} ${attack ? btnOn : btnOff}`}
        onClick={() => {
          const v = !attack;
          c.setAttack(v);
          setAttackState(v);
        }}
      >
        {attack ? "กำลังโจมตี" : "โจมตี"}
      </button>

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

      <p className="text-slate-500">
        อาวุธเป็นของจริงในเกม (โค้ดวาดล้วน) — เอฟเฟคพิกเซลขึ้นกับ &quot;ความหายาก&quot; ของไอเทมเท่านั้น ไม่ใช่คลาส
        ลองไล่สไลเดอร์ +0→+10 เพื่อดูจังหวะ IGNITE ที่ +7, หนาแน่นขึ้นที่ +8, แฉลบไฟฟ้าขาวที่ +9 และจังหวะเต้นที่ +10
      </p>
    </div>
  );
}

export const refineLadderExperiment: LabExperiment = {
  id: "refineLadder",
  title: "⑧ ตีบวก&ความหายาก",
  desc: "อาวุธจริงของเกม (โค้ดวาด) + เอฟเฟคพิกเซลตามความหายาก/ระดับตีบวก — เทียบทั้งแถว +0..+10",
  Controls: RefineLadderControls,
  createScene,
};
