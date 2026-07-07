"use client";

/**
 * `/lab` client island — experiment picker + asset loader bar + the mounted
 * Pixi stage. See `page-lab-serialized-turing.md` for the full spec this
 * implements. Everything here is plain `useState` (no Zustand — this is a
 * throwaway dev sandbox, not game state) and every string is hardcoded Thai
 * (lab is intentionally outside the i18n catalog).
 *
 * Isolation rule: nothing in `src/lab/**` or this page imports game code
 * beyond `@/engine` (read-only) and `@/render/**` (read-only, existing
 * modules only) — and nothing in the real game imports FROM `src/lab/**`.
 * Deleting `src/app/lab/` + `src/lab/` should leave the rest of the app
 * untouched.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createLabStage, type LabStage } from "@/lab/stage";
import {
  ALL_FRAMES_GROUP_KEY,
  applyScaleMode,
  groupKeyOf,
  hasUnsavedSessionFrames,
  ingestFile,
  loadFrameSet,
  loadLibrary,
  prepareFriendlyUpload,
  removeFrame,
  shouldAutoSelectAllFramesGroup,
  type FrameSet,
} from "@/lab/frames";
import { LAB_EXPERIMENTS, type LabScene } from "@/lab/registry";

const EMPTY_FRAME_SET: FrameSet = { key: "", frames: [] };

export function LabScreen() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<LabScene | null>(null);

  const [stage, setStage] = useState<LabStage | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  const [experimentId, setExperimentId] = useState(LAB_EXPERIMENTS[0].id);
  // Paired together (not two separate `scene`/`experimentId` reads) so the
  // rendered `<Controls>` NEVER sees a scene built for a different
  // experiment — `experimentId` flips synchronously on a tab click, one
  // render before the rebuild effect below actually swaps `scene`; reading
  // `mounted.id` (not the target `experimentId`) for which `Controls` to
  // render closes that one-frame mismatch window.
  const [mounted, setMounted] = useState<{ id: string; scene: LabScene } | null>(null);

  const [groups, setGroups] = useState<Record<string, string[]>>({});
  const [groupKey, setGroupKey] = useState("");
  const [frameSet, setFrameSet] = useState<FrameSet>(EMPTY_FRAME_SET);
  const [nearestNeighbor, setNearestNeighbor] = useState(true);

  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [unsavedSession, setUnsavedSession] = useState(false);

  // ---- Pixi Application lifecycle (mirrors GameRenderer's create()/destroy()
  // idempotent idiom — see stage.ts's doc comment; StrictMode-safe). ----
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    let cancelled = false;
    let localStage: LabStage | null = null;
    createLabStage(el)
      .then((s) => {
        if (cancelled) {
          s.destroy();
          return;
        }
        localStage = s;
        setStage(s);
      })
      .catch((err: unknown) => {
        setStageError(err instanceof Error ? err.message : "เริ่ม Pixi ไม่สำเร็จ");
      });
    return () => {
      cancelled = true;
      localStage?.destroy();
      setStage(null);
    };
  }, []);

  // ---- rAF loop: drives the CURRENT scene's update(dt) only — never React
  // state per frame (see CLAUDE.md's rule; `sceneRef` sidesteps a stale
  // closure without re-subscribing this effect on every scene swap). ----
  useEffect(() => {
    if (!stage) return;
    let rafId = 0;
    let last = performance.now();
    function tick(now: number): void {
      rafId = requestAnimationFrame(tick);
      const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
      last = now;
      sceneRef.current?.update(dt);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [stage]);

  // ---- (Re)build the mounted scene whenever the stage, the picked
  // experiment, or the loaded frame set changes. ----
  useEffect(() => {
    if (!stage) return;
    const experiment = LAB_EXPERIMENTS.find((e) => e.id === experimentId) ?? LAB_EXPERIMENTS[0];
    const built = experiment.createScene(stage, frameSet);
    sceneRef.current = built;
    // Syncing an external system's (Pixi's) freshly-built object into React
    // state so the paired `Controls` component below re-renders with the
    // right instance — legitimate "sync external system" use, not a
    // reactive resync loop (this effect's own deps are the only trigger).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external-system sync, see above
    setMounted({ id: experiment.id, scene: built });
    return () => {
      built.destroy();
      if (sceneRef.current === built) sceneRef.current = null;
    };
  }, [stage, experimentId, frameSet]);

  // ---- Asset library (permanent + IndexedDB-cached) ----
  const refreshLibrary = useCallback(async (preferGroup?: string) => {
    const { groups: g } = await loadLibrary();
    setGroups(g);
    const keys = Object.keys(g);
    setGroupKey((prev) => {
      if (preferGroup && g[preferGroup]) return preferGroup;
      if (prev && g[prev]) return prev;
      // Owner bug report ("/lab never animates"): per-file grouping can
      // degrade to nothing but singleton groups (arbitrary/Thai/symbol-heavy
      // upload names with no shared numbered prefix) — default straight to
      // the "combine everything" virtual group instead of an arbitrary still
      // image in that case (see `shouldAutoSelectAllFramesGroup`'s doc
      // comment in `@/lab/frames`).
      if (shouldAutoSelectAllFramesGroup(g)) return ALL_FRAMES_GROUP_KEY;
      return keys[0] ?? "";
    });
    setUnsavedSession(await hasUnsavedSessionFrames());
  }, []);

  useEffect(() => {
    // One-shot mount fetch (same idiom as `CharactersScreen.tsx`) — no
    // reactive dependency to resync on.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount fetch, see above
    void refreshLibrary();
  }, [refreshLibrary]);

  // Load textures whenever the selected group (or the library behind it)
  // changes.
  useEffect(() => {
    let cancelled = false;
    if (!groupKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the scene to an empty frame set when no group is selected
      setFrameSet(EMPTY_FRAME_SET);
      return;
    }
    void loadFrameSet(groupKey, groups).then((set) => {
      if (cancelled) return;
      applyScaleMode(set, nearestNeighbor);
      setFrameSet(set);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `groups` changes alongside groupKey; nearestNeighbor is applied live below instead
  }, [groupKey, groups]);

  // Nearest-neighbor toggle applies live to whatever's already loaded — no
  // reload needed.
  useEffect(() => {
    applyScaleMode(frameSet, nearestNeighbor);
  }, [frameSet, nearestNeighbor]);

  // ---- prod-only "unsaved images" beforeunload confirm (owner-approved
  // guard — see the plan's "ที่เก็บไฟล์" section). Dev never arms it: every
  // dev upload lands on disk immediately. ----
  useEffect(() => {
    if (process.env.NODE_ENV === "development") return;
    function handler(e: BeforeUnloadEvent): void {
      if (!unsavedSession) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [unsavedSession]);

  const ingestFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setBusy(true);
      // Fresh snapshot ONCE per batch (not per-file) — `prepareFriendlyUpload`
      // needs the current `frame_NN` high-water mark so a rename never
      // collides with an earlier ingestion session's own renamed files.
      const { entries: knownEntries } = await loadLibrary();
      const knownNames = knownEntries.map((e) => e.name);
      let lastGroup: string | undefined;
      let okCount = 0;
      let renamedCount = 0;
      const errors: string[] = [];
      for (const file of list) {
        const prepared = prepareFriendlyUpload(file, knownNames);
        if (prepared.renamed) {
          renamedCount++;
          knownNames.push(prepared.file.name); // reserve it for the rest of this loop
        }
        const result = await ingestFile(prepared.file);
        if (result.error) {
          errors.push(`${prepared.originalName}: ${result.error}`);
        } else {
          okCount++;
          lastGroup = groupKeyOf(result.name.replace(/\.(png|webp)$/i, ""));
        }
      }
      setBusy(false);
      const renameNote =
        renamedCount > 0
          ? ` — เปลี่ยนชื่อไฟล์ที่ไม่มีตัวอักษร (เช่น ภาษาไทย/สัญลักษณ์ที่ถูกตัดออกหมด) ${renamedCount} ไฟล์เป็น frame_01, frame_02, ... ให้อัตโนมัติ (ครั้งหน้าแนะนำตั้งชื่อเช่น llama_walk_01.png เพื่อจัดกลุ่มอนิเมชันได้เอง)`
          : "";
      setStatusMsg(
        (errors.length > 0
          ? `เพิ่ม ${okCount} ไฟล์ / ผิดพลาด ${errors.length}: ${errors.join(", ")}`
          : `เพิ่ม ${okCount} ไฟล์เรียบร้อย`) + renameNote,
      );
      await refreshLibrary(lastGroup);
    },
    [refreshLibrary],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) void ingestFiles(e.dataTransfer.files);
    },
    [ingestFiles],
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) void ingestFiles(e.target.files);
      e.target.value = "";
    },
    [ingestFiles],
  );

  const onDeleteFrame = useCallback(
    async (name: string) => {
      await removeFrame(name);
      await refreshLibrary();
    },
    [refreshLibrary],
  );

  const experiment = LAB_EXPERIMENTS.find((e) => e.id === experimentId) ?? LAB_EXPERIMENTS[0];
  const groupNames = Object.keys(groups).sort();
  const currentFrames = groups[groupKey] ?? [];

  // Best-effort fps readout from whatever the mounted experiment's own
  // player exposes (duck-typed — not every experiment's `controls` bag has
  // one, e.g. ⑥ town preview has no single `FramePlayer`) — a diagnostic
  // convenience only, never load-bearing.
  const mountedFps = useMemo(() => {
    const ctrl = mounted?.scene.controls as { player?: { getFps?: () => number } } | undefined;
    const fps = ctrl?.player?.getFps?.();
    return typeof fps === "number" ? fps : null;
  }, [mounted]);

  return (
    <div className="flex min-h-screen w-full flex-col gap-3 bg-slate-950 p-3 text-slate-100 md:flex-row md:p-4">
      <div className="flex flex-1 flex-col gap-3">
        <header className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-semibold text-slate-300">/lab — art experiment sandbox</h1>
          <nav className="flex flex-wrap gap-1">
            {LAB_EXPERIMENTS.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setExperimentId(e.id)}
                className={`rounded px-2 py-1 text-xs ${
                  e.id === experimentId
                    ? "bg-emerald-700 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {e.title}
              </button>
            ))}
          </nav>
        </header>
        <p className="text-xs text-slate-400">{experiment.desc}</p>

        <div
          ref={mountRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="relative aspect-[3/1] w-full min-h-[220px] overflow-hidden rounded border border-slate-700 bg-black"
        >
          {stageError && (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-red-300">
              {stageError}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
          <label className="cursor-pointer rounded bg-slate-800 px-2 py-1 hover:bg-slate-700">
            เลือกไฟล์ .png/.webp
            <input
              type="file"
              accept="image/png,image/webp"
              multiple
              className="hidden"
              onChange={onPick}
            />
          </label>
          <span className="text-slate-500">หรือลากไฟล์วางในกรอบด้านบน — อัปโหลดถาวรอัตโนมัติตอน dev</span>
          {busy && <span className="text-amber-300">กำลังอัปโหลด...</span>}
        </div>
        {statusMsg && <p className="text-xs text-slate-400">{statusMsg}</p>}
      </div>

      <aside className="flex w-full flex-col gap-4 rounded border border-slate-800 bg-slate-900 p-3 md:w-80">
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold text-slate-400">ชุดเฟรม</h2>
          <select
            className="rounded bg-slate-800 px-2 py-1 text-xs"
            value={groupKey}
            onChange={(e) => setGroupKey(e.target.value)}
          >
            {groupNames.length === 0 && <option value="">(ยังไม่มีไฟล์)</option>}
            {groupNames.map((g) => (
              <option key={g} value={g}>
                {g} ({groups[g].length} เฟรม)
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={nearestNeighbor}
              onChange={(e) => setNearestNeighbor(e.target.checked)}
            />
            <span>คมชัดแบบพิกเซล (nearest-neighbor)</span>
          </label>
          {groupKey && (
            <p className="text-[11px] text-slate-400">
              ชุดนี้มี {currentFrames.length} เฟรม
              {mountedFps !== null ? ` @ fps ${mountedFps}` : ""}
            </p>
          )}
          {groupKey && currentFrames.length === 1 && (
            <p className="text-[11px] text-amber-300">
              มีเฟรมเดียวจึงไม่ขยับ — เลือกชุด &quot;{ALL_FRAMES_GROUP_KEY}&quot; หรือครั้งหน้าตั้งชื่อไฟล์ลงท้ายเลข
              เช่น llama_walk_01.png
            </p>
          )}
          {currentFrames.length > 0 && (
            <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto text-xs">
              {currentFrames.map((name) => (
                <li key={name} className="flex items-center justify-between gap-2 rounded bg-slate-800 px-2 py-1">
                  <span className="truncate">{name}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded bg-red-900 px-1.5 text-[10px] hover:bg-red-800"
                    onClick={() => void onDeleteFrame(name)}
                  >
                    ลบ
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2 border-t border-slate-800 pt-3">
          <h2 className="text-xs font-semibold text-slate-400">ควบคุมการทดลอง</h2>
          {mounted &&
            (() => {
              // Render the Controls paired with the ACTUALLY mounted
              // scene's experiment, not the (possibly just-clicked, not
              // yet rebuilt) `experimentId` — see `mounted`'s doc comment.
              const mountedExperiment =
                LAB_EXPERIMENTS.find((e) => e.id === mounted.id) ?? LAB_EXPERIMENTS[0];
              return <mountedExperiment.Controls scene={mounted.scene} />;
            })()}
        </section>
      </aside>
    </div>
  );
}
