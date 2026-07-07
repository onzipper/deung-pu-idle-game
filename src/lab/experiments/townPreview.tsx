"use client";

/**
 * Experiment ⑥ — พรีวิวลามะเมือง (town preview). Mounts the REAL
 * `createTownLlamaActor` from `@/render/environment/townLlama` (render is
 * read-only from `src/lab/**` per that module's own isolation rule — nothing
 * here forks or re-implements its behavior) with a custom `AssetLoader`
 * injected so it resolves textures from THIS lab session's already-loaded
 * frame library instead of a real `/lab-assets/llama_sit_01.png`-style fetch.
 *
 * `townLlama.ts`'s `loadLlamaFrames()` always requests its own hardcoded
 * filenames (`llama_sit_01.png` / `llama_stand_01..04.png`) through whatever
 * `AssetLoader` it's given — the injected loader here ignores the literal
 * filename and instead reads the trailing frame ordinal (`_01`, `_02`, ...)
 * out of the requested `src`, maps "sit"/"stand" to whichever library group
 * `@/lab/frameGroupHeuristics` picked for that role, and returns that
 * ordinal's texture. Any file townLlama asks for that has no counterpart
 * (group missing, or fewer frames than the fixed 2-sit/4-stand contract
 * wants) makes the loader reject for THAT file — `loadLlamaFrames()`'s own
 * `Promise.all` then takes down just that half, exactly like a real missing
 * PNG would, so the actor's own graceful-degradation behavior is exercised
 * for real, not re-implemented here.
 *
 * A tap on the previewed llama triggers the exact same happy-hop + heart-pip
 * reaction (`townLlama.ts` part 3) as the live game — this experiment adds
 * NO extra interaction wiring of its own; interactivity all lives on the
 * actor's own `view`. The one difference from in-game: there is no
 * `GameClient` DOM ground-tap listener here, so unlike in the real town a tap
 * on the lab llama does NOT also walk anything anywhere — see the hint text.
 */

import { useEffect, useState } from "react";
import { Container, Graphics, Text } from "pixi.js";
import type { LabStage } from "@/lab/stage";
import { applyScaleMode, loadFrameSet, loadLibrary, type FrameSet } from "@/lab/frames";
import { pickSitGroupKey, pickStandGroupKey } from "@/lab/frameGroupHeuristics";
import type { LabExperiment, LabScene } from "@/lab/registry";
import { GROUND_Y, WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";
import {
  createTownLlamaActor,
  type AssetLoader,
  type TownLlamaActor,
} from "@/render/environment/townLlama";

/** `townLlama.ts`'s own fixed file-count contract (not exported — mirrored
 * here only for the ordinal-out-of-range check below; the loader itself
 * doesn't need the literal filenames, just which role + which ordinal). */
const SIT_FRAME_COUNT = 2;
const STAND_FRAME_COUNT = 4;

interface ControlsBag {
  getHint(): string;
  reload(): void;
}

/** Builds an `AssetLoader` that resolves every requested file against the
 * given (already-loaded) sit/stand `FrameSet`s by ordinal position — `null`
 * for a role means "no matching library group", so every request for that
 * role rejects (townLlama treats the whole set as absent, same as a real
 * 404). */
function makeLibraryLoader(sitSet: FrameSet | null, standSet: FrameSet | null): AssetLoader {
  return (urls) => {
    const src = urls.src;
    const m = /(\d+)\.png$/.exec(src);
    const ordinal = m ? Number(m[1]) - 1 : 0;
    const isSit = src.includes("sit");
    const set = isSit ? sitSet : standSet;
    const texture = set?.frames[ordinal]?.texture;
    if (!texture) {
      return Promise.reject(new Error(`no lab frame for ${src} (ordinal ${ordinal})`));
    }
    return Promise.resolve(texture);
  };
}

function hintFor(
  sitKey: string | null,
  standKey: string | null,
  sitSet: FrameSet | null,
  standSet: FrameSet | null,
): string {
  if (!sitKey && !standKey) {
    return 'ยังไม่พบกลุ่มเฟรมชื่อมีคำว่า "sit" หรือ "stand" — ตั้งชื่อไฟล์เช่น llama_sit_01.png / llama_stand_01.png แล้วอัปโหลดที่แผงด้านขวา';
  }
  const sitCount = sitSet?.frames.length ?? 0;
  const standCount = standSet?.frames.length ?? 0;
  const parts: string[] = [];
  parts.push(
    sitKey
      ? `นั่ง: "${sitKey}" (${sitCount}/${SIT_FRAME_COUNT} เฟรมที่ต้องการ)`
      : 'ไม่พบกลุ่ม "sit"',
  );
  parts.push(
    standKey
      ? `ยืน/เดิน: "${standKey}" (${standCount}/${STAND_FRAME_COUNT} เฟรมที่ต้องการ)`
      : 'ไม่พบกลุ่ม "stand"',
  );
  const shortWarn: string[] = [];
  if (sitKey && sitCount < SIT_FRAME_COUNT) shortWarn.push("sit");
  if (standKey && standCount < STAND_FRAME_COUNT) shortWarn.push("stand");
  const warn =
    shortWarn.length > 0
      ? ` (เฟรมไม่ครบ ${shortWarn.join("/")} — เกมจริงจะถือว่าเซ็ตนั้นพังทั้งชุด)`
      : "";
  return `พรีวิวจริงจากเกม — ${parts.join(" / ")}${warn}`;
}

function createScene(stage: LabStage, _frames: FrameSet): LabScene {
  void _frames; // this experiment loads its OWN sit/stand groups — see doc comment above

  const view = new Container();
  // Simple town-ish backdrop (flat two-tone, no gradients — footgun 3) so the
  // llama's GROUND_Y-relative feet-anchor placement reads correctly, per the
  // task spec, without pulling in the real `BiomeScene` town biome.
  view.addChild(new Graphics().rect(0, 0, WORLD_WIDTH, GROUND_Y).fill(0x24314a));
  view.addChild(new Graphics().rect(0, GROUND_Y, WORLD_WIDTH, WORLD_HEIGHT - GROUND_Y).fill(0x4a3b2a));
  view.addChild(new Graphics().rect(0, GROUND_Y, WORLD_WIDTH, 2).fill(0x6b5a3f));

  const hintText = new Text({
    text: "กำลังโหลดชุดเฟรมจากคลัง...",
    style: { fill: 0xffe28a, fontSize: 12, wordWrap: true, wordWrapWidth: WORLD_WIDTH - 24 },
  });
  hintText.anchor.set(0.5, 0);
  hintText.position.set(WORLD_WIDTH / 2, 8);
  view.addChild(hintText);

  const llamaLayer = new Container();
  view.addChild(llamaLayer);

  stage.world.addChild(view);

  let currentActor: TownLlamaActor | null = null;
  let hint = "";

  async function mount(): Promise<void> {
    currentActor?.destroy();
    llamaLayer.removeChildren();
    currentActor = null;

    const { groups } = await loadLibrary();
    const sitKey = pickSitGroupKey(groups);
    const standKey = pickStandGroupKey(groups);
    const sitSet = sitKey ? await loadFrameSet(sitKey, groups) : null;
    const standSet = standKey ? await loadFrameSet(standKey, groups) : null;
    if (sitSet) applyScaleMode(sitSet, true);
    if (standSet) applyScaleMode(standSet, true);

    hint = hintFor(sitKey, standKey, sitSet, standSet);
    hintText.text = `${hint}\nแตะที่ลามะเพื่อดูปฏิกิริยาจริง (หมายเหตุ: ในหน้านี้ไม่มีตัวละครฮีโร่ให้เดินมาด้วย ต่างจากในเกมจริง)`;

    if (!sitSet && !standSet) return; // graceful no-op, same as townLlama's own contract

    const actor = createTownLlamaActor(makeLibraryLoader(sitSet, standSet));
    currentActor = actor;
    llamaLayer.addChild(actor.view);
  }

  void mount();

  const controls: ControlsBag = {
    getHint: () => hint,
    reload: () => void mount(),
  };

  return {
    view,
    update(dt) {
      // Always "in town" — this preview has no zone concept of its own; the
      // whole point is previewing the actor's real behavior unconditionally.
      currentActor?.update(dt, true);
    },
    destroy() {
      currentActor?.destroy();
      view.parent?.removeChild(view);
      view.destroy({ children: true });
    },
    controls: controls as unknown as Record<string, unknown>,
  };
}

function TownPreviewControls({ scene }: { scene: LabScene }) {
  const c = scene.controls as unknown as ControlsBag;
  const [hint, setHint] = useState(c.getHint());

  // `hint` lives in a plain closure variable inside `createScene` (resolved
  // asynchronously, including on the very first automatic mount — not just
  // after a manual reload), so this panel polls it rather than relying on a
  // single one-shot timer — a small dev-sandbox convenience, not a pattern
  // for real game UI (which reads a throttled Zustand snapshot instead).
  useEffect(() => {
    const id = setInterval(() => setHint(c.getHint()), 300);
    return () => clearInterval(id);
  }, [c]);

  return (
    <div className="flex flex-col gap-3 text-xs text-slate-200">
      <button
        type="button"
        className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600"
        onClick={() => c.reload()}
      >
        โหลดคลังใหม่
      </button>
      <p className="text-slate-400">{hint || "กำลังโหลด..."}</p>
      <p className="text-slate-500">
        พฤติกรรม (นั่ง/ยืน-สับเปลี่ยน, เดินสุ่มในแพทช์, แตะแล้วกระโดดดีใจ+หัวใจลอย) เหมือนในเกมจริงทุกประการ —
        มาจากโมดูลเดียวกัน (`createTownLlamaActor`) ไม่ได้จำลองแยก
      </p>
    </div>
  );
}

export const townPreviewExperiment: LabExperiment = {
  id: "townPreview",
  title: "⑥ พรีวิวลามะเมือง",
  desc: "เมานต์ createTownLlamaActor ตัวจริงจากเกม โดยดึงเฟรม sit/stand จากคลังของ lab — พรีวิวพฤติกรรมและปฏิกิริยาเมื่อแตะได้ครบ ไม่ต้องเปิดเกม",
  Controls: TownPreviewControls,
  createScene,
};
