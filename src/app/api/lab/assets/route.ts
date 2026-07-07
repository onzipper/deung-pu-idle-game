/**
 * `/lab` asset storage endpoint (art-experiment sandbox, NOT part of the game
 * save/economy layer — see `src/lab/README` contract in the lab plan).
 *
 * GET    -> list every `.png`/`.webp` file in `public/lab-assets/`. Always
 *           available (dev + prod): on prod this just enumerates whatever was
 *           committed to the repo (the workflow is draw -> upload in dev ->
 *           commit -> deploy -> view anywhere).
 * POST   -> accept ONE `multipart/form-data` file (field `file`), sanitize its
 *           name, and write it into `public/lab-assets/`. DEV-ONLY.
 * DELETE -> remove one file by (sanitized) name. DEV-ONLY.
 *
 * Security bounds (owner-approved, unlisted/noindex page, hidden-on-prod
 * route — see the plan doc): png/webp only, <=2MB, filenames forced to
 * `[a-z0-9_-]+.(png|webp)` (derived from the upload, never trusted verbatim)
 * so path traversal is structurally impossible — there is no way to encode a
 * `/` or `..` into the sanitized name. Write/delete are gated on
 * `NODE_ENV === "development"` by default; a future prod-upload key would be
 * an explicit env-gated addition here (TODO below), not a loosening of this
 * check.
 */

import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const LAB_ASSETS_DIR = path.join(process.cwd(), "public", "lab-assets");
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
};

// TODO(future): if prod uploads are ever wanted, gate this on an explicit
// server-only env secret (e.g. `LAB_WRITE_KEY`) checked against a request
// header — NOT a loosening of the dev-only default below.
function writesAllowed(): boolean {
  return process.env.NODE_ENV === "development";
}

/** Derive a filesystem-safe stem from an arbitrary uploaded filename: strip
 * any extension, lowercase, collapse every non `[a-z0-9_-]` run to `_`, trim
 * leading/trailing `_`. Never returns anything containing `/`, `\`, or `..`
 * (the disallowed-char collapse eats them), so the result is safe to `path
 * .join` directly — no separate traversal check needed, but callers should
 * still `path.basename` defensively (belt-and-suspenders).
 */
function sanitizeStem(rawName: string): string {
  const noExt = rawName.replace(/\.[^./\\]+$/, "");
  const cleaned = noExt
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || `frame_${Date.now()}`;
}

function isSafeStoredName(name: string): boolean {
  return /^[a-z0-9_-]+\.(png|webp)$/.test(name);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(LAB_ASSETS_DIR, { recursive: true });
}

export async function GET() {
  try {
    await ensureDir();
    const entries = await fs.readdir(LAB_ASSETS_DIR);
    const files = entries
      .filter((n) => /\.(png|webp)$/i.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((name) => ({ name, url: `/lab-assets/${name}` }));
    return NextResponse.json({ files });
  } catch (err) {
    console.error("[api/lab/assets] GET failed:", err);
    return NextResponse.json({ files: [] });
  }
}

export async function POST(request: Request) {
  if (!writesAllowed()) {
    return NextResponse.json(
      { error: "อัปโหลดได้เฉพาะตอน dev เท่านั้น" },
      { status: 403 },
    );
  }
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "ไม่พบไฟล์ (field 'file')" }, { status: 400 });
    }
    const ext = ALLOWED_MIME_EXT[file.type];
    if (!ext) {
      return NextResponse.json({ error: "รองรับเฉพาะไฟล์ .png / .webp" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 2MB" }, { status: 400 });
    }
    const stem = sanitizeStem(file.name);
    const storedName = `${stem}.${ext}`;
    if (!isSafeStoredName(storedName)) {
      // Unreachable given `sanitizeStem`'s char whitelist — defensive.
      return NextResponse.json({ error: "ชื่อไฟล์ไม่ถูกต้อง" }, { status: 400 });
    }
    await ensureDir();
    const destPath = path.join(LAB_ASSETS_DIR, path.basename(storedName));
    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(destPath, bytes);
    return NextResponse.json({ name: storedName, url: `/lab-assets/${storedName}` });
  } catch (err) {
    console.error("[api/lab/assets] POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!writesAllowed()) {
    return NextResponse.json(
      { error: "ลบไฟล์ได้เฉพาะตอน dev เท่านั้น" },
      { status: 403 },
    );
  }
  try {
    const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name : "";
    if (!isSafeStoredName(name)) {
      return NextResponse.json({ error: "ชื่อไฟล์ไม่ถูกต้อง" }, { status: 400 });
    }
    const targetPath = path.join(LAB_ASSETS_DIR, path.basename(name));
    await fs.unlink(targetPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/lab/assets] DELETE failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
