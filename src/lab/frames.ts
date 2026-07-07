/**
 * Frame-set loading for `/lab`: file picker + drag-drop -> permanent disk
 * storage (`public/lab-assets/`, via `/api/lab/assets`) + an IndexedDB fast
 * cache -> Pixi `Texture`s. See `page-lab-serialized-turing.md`'s "ที่เก็บไฟล์"
 * section for the full storage-flow spec this implements.
 *
 * Flow on drop/pick:
 *   1. cache the raw bytes into IndexedDB immediately (so a refresh mid-
 *      session never loses the frame, even before/without a successful
 *      upload — this is the "fast cache" role, not the source of truth),
 *   2. POST to `/api/lab/assets` (dev-only server behaviour; on prod, or on
 *      a network failure, this simply fails and the frame stays
 *      session-only/"not permanent yet" — the caller shows this in the UI
 *      and arms the `beforeunload` confirm),
 *   3. on success, mark the IndexedDB entry `permanent` and refresh the
 *      server's file list.
 *
 * On mount: GET the permanent list, then hydrate each entry's texture from
 * the IndexedDB cache if present (no network round trip), else fetch once
 * from its `/lab-assets/...` URL and cache it. Any IndexedDB entries that
 * are NOT (yet) on the server's permanent list are session-only leftovers
 * from an unfinished upload (or a prod session) — they're still offered in
 * the picker (this device remembers them), just flagged "ยังไม่ถาวร".
 */

import { Texture } from "pixi.js";

// ---------------------------------------------------------------------------
// IndexedDB fast cache
// ---------------------------------------------------------------------------

const DB_NAME = "lab-frames";
const DB_VERSION = 1;
const STORE = "frames";

interface CachedFrame {
  name: string;
  blob: Blob;
  permanent: boolean;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "name" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

async function idbGetAll(): Promise<CachedFrame[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as CachedFrame[]);
    req.onerror = () => reject(req.error ?? new Error("indexedDB getAll failed"));
  });
}

async function idbPut(entry: CachedFrame): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB put failed"));
  });
}

async function idbDelete(name: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB delete failed"));
  });
}

// ---------------------------------------------------------------------------
// Server (permanent) asset list
// ---------------------------------------------------------------------------

export interface LabAssetEntry {
  name: string;
  url: string;
}

/** GET the permanent file list — always available (dev + prod), see the
 * route's own doc comment. */
export async function listPermanentAssets(): Promise<LabAssetEntry[]> {
  const res = await fetch("/api/lab/assets", { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json()) as { files?: LabAssetEntry[] };
  return data.files ?? [];
}

export interface UploadResult {
  ok: boolean;
  name?: string;
  url?: string;
  error?: string;
}

/** POST one file to `/api/lab/assets` — dev-only server-side; on prod (or a
 * network failure) this resolves `{ ok: false }` and the caller keeps the
 * frame session-only (IndexedDB-cached, not on disk). Never throws. */
export async function uploadAsset(file: File): Promise<UploadResult> {
  try {
    const form = new FormData();
    form.append("file", file, file.name);
    const res = await fetch("/api/lab/assets", { method: "POST", body: form });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { name: string; url: string };
    return { ok: true, name: data.name, url: data.url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}

/** DELETE a permanently-stored file — dev-only server-side. Never throws. */
export async function deletePermanentAsset(name: string): Promise<boolean> {
  try {
    const res = await fetch("/api/lab/assets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Merged asset library (server permanent list + IndexedDB session cache)
// ---------------------------------------------------------------------------

export interface LabLibraryEntry {
  name: string;
  /** true once confirmed present in `public/lab-assets/` on the server. */
  permanent: boolean;
}

/** Natural sort (so `frame2` sorts before `frame10`) — same convention the
 * plan calls for when ordering an animation's frames by filename. */
export function naturalSort(names: readonly string[]): string[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...names].sort(collator.compare);
}

/** Strip a name's trailing frame-index suffix (`_01`, `-2`, `03`, …) to
 * derive its animation-group key — `llama_walk_01` / `llama_walk_02` -> both
 * `llama_walk`. Names with no numeric suffix are their own (single-frame)
 * group. */
export function groupKeyOf(nameNoExt: string): string {
  const m = nameNoExt.match(/^(.*?)[-_]?(\d+)$/);
  return m && m[1] ? m[1] : nameNoExt;
}

function stripExt(name: string): string {
  return name.replace(/\.(png|webp)$/i, "");
}

/** Merge the server's permanent list with whatever this device's IndexedDB
 * cache already knows about, then group by `groupKeyOf`. Server-known files
 * are always `permanent: true`; anything IndexedDB-only is a leftover
 * session upload (prod, or a failed dev POST) — still offered, flagged not
 * permanent. */
export async function loadLibrary(): Promise<{
  entries: LabLibraryEntry[];
  groups: Record<string, string[]>;
}> {
  const [permanent, cached] = await Promise.all([
    listPermanentAssets().catch(() => [] as LabAssetEntry[]),
    idbGetAll().catch(() => [] as CachedFrame[]),
  ]);
  const permanentNames = new Set(permanent.map((a) => a.name));
  const byName = new Map<string, LabLibraryEntry>();
  for (const a of permanent) byName.set(a.name, { name: a.name, permanent: true });
  for (const c of cached) {
    if (!byName.has(c.name)) {
      byName.set(c.name, { name: c.name, permanent: permanentNames.has(c.name) });
    }
  }
  const entries = naturalSort([...byName.keys()]).map((n) => byName.get(n)!);
  const groups: Record<string, string[]> = {};
  for (const e of entries) {
    const key = groupKeyOf(stripExt(e.name));
    (groups[key] ??= []).push(e.name);
  }
  for (const key of Object.keys(groups)) groups[key] = naturalSort(groups[key]);
  return { entries, groups };
}

// ---------------------------------------------------------------------------
// File ingestion (drag-drop / picker) — caches + uploads, returns updated
// library info the caller (LabScreen) re-renders its picker from.
// ---------------------------------------------------------------------------

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/webp"]);

export interface IngestResult {
  name: string;
  permanent: boolean;
  error?: string;
}

/** Cache + (attempt to) permanently upload one dropped/picked file. Client-side
 * mirrors the server's own png/webp + 2MB checks so a rejected file gets an
 * immediate, specific message instead of waiting on a round trip. */
export async function ingestFile(file: File): Promise<IngestResult> {
  const name = file.name;
  if (!ALLOWED_TYPES.has(file.type)) {
    return { name, permanent: false, error: "รองรับเฉพาะไฟล์ .png / .webp" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { name, permanent: false, error: "ไฟล์ใหญ่เกิน 2MB" };
  }
  // 1. fast-cache immediately (survives a refresh even before/without upload).
  await idbPut({ name, blob: file, permanent: false, savedAt: Date.now() }).catch(() => {});
  // 2. attempt the permanent upload.
  const uploaded = await uploadAsset(file);
  if (uploaded.ok && uploaded.name) {
    await idbPut({ name: uploaded.name, blob: file, permanent: true, savedAt: Date.now() }).catch(
      () => {},
    );
    return { name: uploaded.name, permanent: true };
  }
  return { name, permanent: false, error: uploaded.error };
}

/** Remove a frame everywhere this session knows about it: the permanent disk
 * file (if any, dev-only) + the IndexedDB cache entry. */
export async function removeFrame(name: string): Promise<void> {
  await Promise.all([deletePermanentAsset(name).catch(() => false), idbDelete(name).catch(() => {})]);
}

// ---------------------------------------------------------------------------
// Texture loading
// ---------------------------------------------------------------------------

export interface LabFrame {
  name: string;
  texture: Texture;
}

export interface FrameSet {
  /** The group key these frames were loaded for (display only). */
  key: string;
  frames: LabFrame[];
}

async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image decode failed"));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Fetch (or read from the IndexedDB cache) + decode every name in `names`
 * into a Pixi `Texture`, in the given order — the caller (`loadFrameSet`)
 * passes an already natural-sorted group. `skipCache: true` on `Texture.from`
 * so re-uploading a same-named file (a redrawn frame) never serves a stale
 * cached texture. */
async function loadOneTexture(name: string, url: string): Promise<Texture> {
  const cached = await idbGetAll()
    .then((all) => all.find((c) => c.name === name)?.blob)
    .catch(() => undefined);
  let blob = cached;
  if (!blob) {
    const res = await fetch(url);
    blob = await res.blob();
    await idbPut({ name, blob, permanent: true, savedAt: Date.now() }).catch(() => {});
  }
  const img = await blobToImage(blob);
  return Texture.from(img, true);
}

/** Load every frame in `groupKey` as Pixi textures, natural-sorted by
 * filename. `library` is the merged entry list from `loadLibrary()`. */
export async function loadFrameSet(
  groupKey: string,
  groups: Record<string, string[]>,
): Promise<FrameSet> {
  const names = groups[groupKey] ?? [];
  const frames: LabFrame[] = [];
  for (const name of names) {
    try {
      const texture = await loadOneTexture(name, `/lab-assets/${name}`);
      frames.push({ name, texture });
    } catch {
      // A single bad/missing frame shouldn't sink the whole set — skip it.
    }
  }
  return { key: groupKey, frames };
}

/** Applies the nearest-neighbor (pixel-art-crisp) vs. linear (smoothed) scale
 * mode to every texture in a set — the global toggle in `LabScreen`. */
export function applyScaleMode(set: FrameSet, nearest: boolean): void {
  for (const f of set.frames) {
    f.texture.source.scaleMode = nearest ? "nearest" : "linear";
  }
}

/** Whether IndexedDB currently holds any frame not yet confirmed permanent —
 * the prod `beforeunload` confirm guard (see the plan's "ที่เก็บไฟล์" section).
 */
export async function hasUnsavedSessionFrames(): Promise<boolean> {
  const all = await idbGetAll().catch(() => [] as CachedFrame[]);
  return all.some((c) => !c.permanent);
}
