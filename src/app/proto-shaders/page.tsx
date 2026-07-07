"use client";

/**
 * PROTO ONLY — Pixi filter/shader showcase for the owner to judge in-browser
 * whether filters (`pixi-filters` + a `DisplacementFilter`) should join the
 * game's sanctioned visual language. Self-contained: its own Pixi mount
 * (`ProtoShaderStage`, `src/render/fx/proto/`), plain React state for the
 * controls (NO Zustand game store), and it never imports `GameClient.tsx` or
 * anything under `src/ui/`. Deleting `src/app/proto-shaders/` +
 * `src/render/fx/proto/` removes this experiment entirely.
 */

import { useEffect, useRef, useState } from "react";
import {
  ProtoShaderStage,
  type ProtoSceneId,
  type ProtoToggles,
} from "@/render/fx/proto/ProtoShaderStage";

const SCENES: { id: ProtoSceneId; label: string; effectLabel: string; effectDesc: string }[] = [
  {
    id: "map5",
    label: "ทะเลทรายซากอารยธรรม (map5)",
    effectLabel: "ไอร้อนกลางทะเลทราย",
    effectDesc: "Displacement filter shimmer เหนือเส้นขอบฟ้า",
  },
  {
    id: "map4",
    label: "ทุนดราน้ำแข็ง (map4)",
    effectLabel: "แสงออโรร่า",
    effectDesc: "ริบบิ้นคลื่นไซน์ซ้อนชั้น สีฟ้า-เขียวเย็นตา",
  },
  {
    id: "map6",
    label: "นครนรก (map6)",
    effectLabel: "โทนอุ่น + เรืองแสงถ่านไฟ",
    effectDesc: "Adjustment filter โทนอุ่น + Bloom (ระวังไม่ให้ขาวจ้า)",
  },
];

export default function ProtoShadersPage() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<ProtoShaderStage | null>(null);

  const [sceneId, setSceneId] = useState<ProtoSceneId>("map5");
  const [toggles, setToggles] = useState<ProtoToggles>({
    primary: true,
    colorGrade: false,
    lowPower: false,
  });
  const [primaryStrength, setPrimaryStrength] = useState(0.6);
  const [gradeStrength, setGradeStrength] = useState(0.6);
  const [fps, setFps] = useState(60);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stage = new ProtoShaderStage();
    stageRef.current = stage;
    const el = mountRef.current;
    if (!el) return;
    stage
      .create(el)
      .then(() => {
        if (cancelled) return;
        setReady(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    const fpsTimer = window.setInterval(() => {
      setFps(Math.round(stageRef.current?.getFps() ?? 0));
    }, 300);

    return () => {
      cancelled = true;
      window.clearInterval(fpsTimer);
      stage.destroy();
      stageRef.current = null;
    };
    // Mount once; scene/toggle/strength changes are pushed imperatively below.
  }, []);

  useEffect(() => {
    if (ready) stageRef.current?.setScene(sceneId);
  }, [sceneId, ready]);

  useEffect(() => {
    if (!ready) return;
    stageRef.current?.setToggle("primary", toggles.primary);
  }, [toggles.primary, ready]);

  useEffect(() => {
    if (!ready) return;
    stageRef.current?.setToggle("colorGrade", toggles.colorGrade);
  }, [toggles.colorGrade, ready]);

  useEffect(() => {
    if (!ready) return;
    stageRef.current?.setToggle("lowPower", toggles.lowPower);
  }, [toggles.lowPower, ready]);

  useEffect(() => {
    if (ready) stageRef.current?.setStrength("primary", primaryStrength);
  }, [primaryStrength, ready]);

  useEffect(() => {
    if (ready) stageRef.current?.setStrength("colorGrade", gradeStrength);
  }, [gradeStrength, ready]);

  const activeScene = SCENES.find((s) => s.id === sceneId) ?? SCENES[0];

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-neutral-950 p-4 text-neutral-100 md:flex-row">
      <div className="flex flex-1 flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Pixi Filter Showcase (proto)</h1>
          <div className="rounded bg-black/40 px-2 py-1 font-mono text-sm">
            FPS: <span className={fps < 45 ? "text-red-400" : "text-emerald-400"}>{fps}</span>
          </div>
        </div>
        <div
          ref={mountRef}
          className="aspect-3/1 w-full overflow-hidden rounded-lg border border-neutral-700 bg-black"
        />
        {error && <p className="text-sm text-red-400">เมาท์ Pixi ไม่สำเร็จ: {error}</p>}
        {!ready && !error && <p className="text-sm text-neutral-400">กำลังโหลด Pixi…</p>}
        <p className="text-xs text-neutral-500">
          หมายเหตุมือถือ: filter คือค่าใช้จ่ายแบบ full-screen pass — เปิด &quot;low-power&quot;
          เพื่อลด resolution ของ filter ลงครึ่งหนึ่งบนอุปกรณ์ที่แรงไม่พอ
        </p>
      </div>

      <aside className="flex w-full flex-col gap-4 md:w-80">
        <section className="rounded-lg border border-neutral-700 p-3">
          <h2 className="mb-2 text-sm font-semibold text-neutral-300">ฉาก (Scene)</h2>
          <div className="flex flex-col gap-1">
            {SCENES.map((s) => (
              <button
                key={s.id}
                onClick={() => setSceneId(s.id)}
                className={`rounded px-2 py-1.5 text-left text-sm ${
                  s.id === sceneId
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-neutral-800/60 text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-neutral-700 p-3">
          <h2 className="mb-2 text-sm font-semibold text-neutral-300">เอฟเฟกต์เฉพาะฉาก</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={toggles.primary}
              onChange={(e) => setToggles((t) => ({ ...t, primary: e.target.checked }))}
            />
            {activeScene.effectLabel}
          </label>
          <p className="mt-1 text-xs text-neutral-500">{activeScene.effectDesc}</p>
          <label className="mt-2 flex flex-col gap-1 text-xs text-neutral-400">
            ความแรง (strength): {primaryStrength.toFixed(2)}
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={primaryStrength}
              onChange={(e) => setPrimaryStrength(Number(e.target.value))}
            />
          </label>
        </section>

        <section className="rounded-lg border border-neutral-700 p-3">
          <h2 className="mb-2 text-sm font-semibold text-neutral-300">
            Global color-grade (ทุกฉาก)
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={toggles.colorGrade}
              onChange={(e) => setToggles((t) => ({ ...t, colorGrade: e.target.checked }))}
            />
            เปิด color grade ต่อไบโอม
          </label>
          <p className="mt-1 text-xs text-neutral-500">
            AdjustmentFilter เดียว (contrast/saturation/gamma preset ต่อฉาก) — ดูว่าแค่เกรดสี
            อย่างเดียวช่วยได้แค่ไหนโดยไม่มีเอฟเฟกต์อื่น
          </p>
          <label className="mt-2 flex flex-col gap-1 text-xs text-neutral-400">
            ความแรงเกรดสี: {gradeStrength.toFixed(2)}
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={gradeStrength}
              onChange={(e) => setGradeStrength(Number(e.target.value))}
            />
          </label>
        </section>

        <section className="rounded-lg border border-neutral-700 p-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={toggles.lowPower}
              onChange={(e) => setToggles((t) => ({ ...t, lowPower: e.target.checked }))}
            />
            Low-power mode (ลด resolution ของ filter ครึ่งหนึ่ง)
          </label>
        </section>
      </aside>
    </main>
  );
}
