/**
 * dmath — cross-engine DETERMINISTIC transcendentals (M8 party P1a).
 *
 * IEEE-754 mandates correct rounding ONLY for +, -, *, / and sqrt. The libm
 * transcendentals (`Math.sin/cos/pow/exp/log/hypot/...`) are IMPLEMENTATION-DEFINED,
 * so identical inputs can diverge by an ULP across V8 (Chrome/Node), JavaScriptCore
 * (iOS Safari) and SpiderMonkey (Firefox). For a lockstep party sim that desync
 * compounds into a full state divergence. Therefore: any transcendental whose RESULT
 * ENTERS SIM STATE must be computed here, using ONLY correctly-rounded primitives, so
 * every engine produces bit-identical results.
 *
 * What lives here:
 *  - `dsin` / `dcos`: quarter-wave LUT + linear interpolation. The TABLE itself is
 *    built at module load from a Taylor polynomial evaluated with only +,-,* (NEVER
 *    from Math.sin — that would re-introduce the very non-determinism we remove).
 *  - `dhypot(x,y)` = sqrt(x*x + y*y). Math.sqrt IS IEEE-correct → allowed as-is.
 *  - `dpow(base, exp)`: the engine only ever raises to NON-NEGATIVE INTEGER exponents
 *    (config growth curves `base^(n-1)`, shop `base^(stage-1)`), so this is exact
 *    integer exponentiation-by-squaring — a fixed sequence of IEEE multiplies, hence
 *    cross-engine identical. Fractional exponents throw (none exist; a future one must
 *    be added deliberately, not slip in).
 *
 * Precision: `dsin/dcos` are within ~1e-6 abs of the true value (Taylor terms give
 * <1e-8 at the sample points; 4096-entry linear interpolation adds <1e-7 of curvature
 * error). That is far tighter than the wander wobble needs; the point is DETERMINISM,
 * not accuracy. `dpow` on integer exponents is as accurate as repeated multiply.
 */

// ---- knobs / constants (only place magic numbers live) ----

/** Quarter-wave table resolution. 4096 samples over [0, π/2]. */
const TABLE_SIZE = 4096;

/** π and its multiples as decimal LITERALS (identical on every engine). */
const PI = 3.141592653589793;
const HALF_PI = PI / 2; // exact IEEE division of literals → deterministic
const TWO_PI = PI * 2;

/** Radians per table step, and its reciprocal (multiply is faster/deterministic). */
const STEP = HALF_PI / TABLE_SIZE;
const INV_STEP = TABLE_SIZE / HALF_PI;

// ---------------------------------------------------------------------------
// Table construction — polynomial sin on [0, π/2] using ONLY +,-,*
// ---------------------------------------------------------------------------

/**
 * Taylor sine, Horner form, evaluated with only +,-,* (each an IEEE-correct op, so
 * the result is bit-identical on every engine). Accurate to <1e-8 on [0, π/2].
 * Coefficients are reciprocal factorials computed from EXACT integer factorials
 * (all ≤ 13! = 6227020800, representable exactly in a double) via IEEE division.
 */
const C1 = -1 / 6; // -1/3!
const C2 = 1 / 120; //  1/5!
const C3 = -1 / 5040; // -1/7!
const C4 = 1 / 362880; //  1/9!
const C5 = -1 / 39916800; // -1/11!
const C6 = 1 / 6227020800; //  1/13!

function polySin(x: number): number {
  const x2 = x * x;
  let s = C6;
  s = C5 + x2 * s;
  s = C4 + x2 * s;
  s = C3 + x2 * s;
  s = C2 + x2 * s;
  s = C1 + x2 * s;
  s = 1 + x2 * s;
  return x * s;
}

/** Quarter-wave sine table over [0, π/2] with TABLE_SIZE+1 samples (inclusive). */
export function buildSinTable(): Float64Array {
  const t = new Float64Array(TABLE_SIZE + 1);
  for (let i = 0; i <= TABLE_SIZE; i++) t[i] = polySin(i * STEP);
  return t;
}

const SIN_TABLE = buildSinTable();

// ---------------------------------------------------------------------------
// dsin / dcos
// ---------------------------------------------------------------------------

/** Lookup + linear interpolation of the quarter-wave table for a in [0, π/2]. */
function quarter(a: number): number {
  const pos = a * INV_STEP;
  let i = Math.floor(pos);
  if (i >= TABLE_SIZE) return SIN_TABLE[TABLE_SIZE];
  if (i < 0) i = 0;
  const frac = pos - i;
  const lo = SIN_TABLE[i];
  return lo + (SIN_TABLE[i + 1] - lo) * frac;
}

/**
 * Deterministic sine. Range-reduces `x` into [0, 2π) with floor (IEEE-exact), then
 * folds by quadrant symmetry into the [0, π/2] quarter-wave table. Cross-engine
 * identical for identical inputs.
 */
export function dsin(x: number): number {
  // reduce into [0, TWO_PI)
  let r = x - Math.floor(x / TWO_PI) * TWO_PI;
  if (r < 0) r = 0; // guard fp underflow at the seam
  if (r >= TWO_PI) r = 0;
  if (r <= HALF_PI) return quarter(r); // Q0
  if (r <= PI) return quarter(PI - r); // Q1
  if (r <= PI + HALF_PI) return -quarter(r - PI); // Q2
  return -quarter(TWO_PI - r); // Q3
}

/** Deterministic cosine, expressed via `dsin` (cos x = sin(x + π/2)). */
export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

// ---------------------------------------------------------------------------
// dhypot
// ---------------------------------------------------------------------------

/** Deterministic 2D magnitude. sqrt is IEEE-correct → this is exact and portable. */
export function dhypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

// ---------------------------------------------------------------------------
// dpow — exact integer exponentiation
// ---------------------------------------------------------------------------

/** base^n for a non-negative integer n, exponentiation-by-squaring (IEEE multiplies). */
function ipow(base: number, n: number): number {
  let result = 1;
  let b = base;
  let e = n;
  while (e > 0) {
    if (e & 1) result *= b;
    e >>>= 1;
    if (e > 0) b *= b;
  }
  return result;
}

/**
 * Deterministic power. The engine only raises to INTEGER exponents (growth curves
 * `base^(n-1)`, shop `base^(stage-1)`), so this is exact integer exponentiation — a
 * fixed sequence of IEEE multiplies, identical on every engine. A fractional exponent
 * would be implementation-defined, so it throws: none exist today, and any future one
 * must be added deliberately (precomputed into an integer-domain table, per the P1a plan).
 */
export function dpow(base: number, exp: number): number {
  if (!Number.isInteger(exp)) {
    throw new Error(`dpow: non-integer exponent ${exp} is not deterministic — see dmath.ts`);
  }
  if (exp < 0) return 1 / ipow(base, -exp);
  return ipow(base, exp);
}
