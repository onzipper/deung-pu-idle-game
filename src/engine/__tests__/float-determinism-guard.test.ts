import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/**
 * M8 party P1a REGRESSION GUARD. Cross-engine lockstep determinism requires that NO
 * implementation-defined transcendental (`Math.sin/cos/pow/hypot/...`) whose result
 * enters sim state survives in `src/engine`. Those must go through `core/dmath.ts`
 * (LUT sine, exact integer pow, IEEE sqrt-based hypot) so V8/JSC/SpiderMonkey agree
 * bit-for-bit. This source-scan fails the build if a banned call reappears anywhere in
 * the engine EXCEPT dmath.ts itself and the test/sim harness (`__tests__`).
 *
 * Chosen over an ESLint `no-restricted-syntax` rule: a source-scan is self-contained
 * (no flat-config surgery), file-scoped precisely, runs in the same CI test pass, and
 * gives a pointed failure message. Comments are stripped first so documentation may
 * still NAME the banned functions (e.g. dmath's own docblock) without tripping.
 */

const ENGINE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

// The implementation-defined transcendentals (IEEE-754 only mandates correct rounding
// for +,-,*,/ and sqrt — so Math.sqrt is deliberately NOT banned).
const BANNED =
  /\bMath\.(sin|cos|tan|atan2|hypot|pow|exp|log|log2|log10|cbrt|asin|acos|atan|sinh|cosh|tanh|expm1|log1p)\b/;

/** Strip block + line comments so docs may mention the banned names. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue; // tests + balance-sim harness may use libm
      collectTsFiles(full, out);
    } else if (entry.endsWith(".ts") && entry !== "dmath.ts") {
      out.push(full);
    }
  }
  return out;
}

describe("float-determinism guard — no impl-defined Math.* in engine sim code", () => {
  it("finds no banned transcendental outside dmath.ts / tests", () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(ENGINE_DIR)) {
      const code = stripComments(readFileSync(file, "utf8"));
      const lines = code.split("\n");
      lines.forEach((line, i) => {
        if (BANNED.test(line)) {
          offenders.push(`${file.split(sep).slice(-3).join("/")}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders, `Banned Math.* transcendentals must use core/dmath.ts:\n${offenders.join("\n")}`).toEqual(
      [],
    );
  });
});
