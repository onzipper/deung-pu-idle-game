// Guards docs/CODEMAP.md against rot — the docs-sync rule, enforced mechanically.
// 1. Every `src/...` path the map references must exist on disk (no stale lines).
// 2. Every non-test source file under src/ must have its own line in the map
//    (except src/lab/** — owner's WIP zone, mapped as a single grouped entry).
// Paths in CODEMAP must be backtick-wrapped; only backticked tokens are checked.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const CODEMAP_PATH = join(ROOT, "docs", "CODEMAP.md");

const SOURCE_EXT = /\.tsx?$/;
const isTestFile = (rel: string) =>
  rel.includes("__tests__/") || /\.test\.tsx?$/.test(rel);

function readCodemapRefs(): Set<string> {
  const text = readFileSync(CODEMAP_PATH, "utf8");
  const refs = new Set<string>();
  for (const match of text.matchAll(/`(src\/[^`]+)`/g)) {
    refs.add(match[1]);
  }
  return refs;
}

function walkSourceFiles(relDir: string, out: string[]): string[] {
  for (const entry of readdirSync(join(ROOT, relDir))) {
    const rel = `${relDir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) {
      walkSourceFiles(rel, out);
    } else if (SOURCE_EXT.test(entry)) {
      out.push(rel);
    }
  }
  return out;
}

describe("docs/CODEMAP.md stays in sync with src/", () => {
  const refs = readCodemapRefs();

  it("references at least one path (map exists and is parseable)", () => {
    expect(refs.size).toBeGreaterThan(0);
  });

  it("has no stale paths — every referenced src/ path exists on disk", () => {
    const stale: string[] = [];
    for (const ref of refs) {
      const abs = join(ROOT, ref.replace(/\/$/, ""));
      try {
        const st = statSync(abs);
        if (ref.endsWith("/") && !st.isDirectory()) stale.push(ref);
      } catch {
        stale.push(ref);
      }
    }
    expect(
      stale,
      `Stale CODEMAP paths (file moved/deleted without updating docs/CODEMAP.md):\n${stale.join("\n")}`,
    ).toEqual([]);
  });

  it("has no unmapped files — every non-test source file has a line", () => {
    const files = walkSourceFiles("src", []).filter(
      (rel) => !isTestFile(rel) && !rel.startsWith("src/lab/"),
    );
    const unmapped = files.filter((rel) => !refs.has(rel));
    expect(
      unmapped,
      `Source files missing from docs/CODEMAP.md (add a one-line entry per file):\n${unmapped.join("\n")}`,
    ).toEqual([]);
  });
});
