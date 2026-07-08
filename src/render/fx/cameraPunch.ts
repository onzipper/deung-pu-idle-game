/**
 * Camera punch: a brief, directed "zoom-in-then-ease-out" on the whole
 * `world` container, composed ON TOP of the letterbox `baseTransform` +
 * `ScreenShake` — never a replacement of either (see
 * `GameRenderer.applyWorldTransform()`, which multiplies this class's
 * `scale` onto `baseTransform.scale` and adds this class's `offset` onto
 * `baseTransform` + shake's own offset).
 *
 * Distinct from `ScreenShake` (random rotating jitter): this is a single
 * eased curve — scale rises fast to a peak by `IN_FRAC` of the duration, then
 * eases back down to 1 over the remainder — so it reads as "the camera
 * flinched toward the hit", not noise. An optional tiny position nudge
 * toward the triggering event's world x sells the same "toward the impact"
 * read for off-center hits (boss slam, skill cast); events with no natural
 * single point of impact (boss defeated) can omit it for a symmetric punch.
 *
 * Retrigger policy: STRONGEST WINS — mirrors `ScreenShake.trigger()`'s
 * `Math.max`. A `skillCast` punch arriving while a `bossSlamLand` punch is
 * still mid-flight must never cut the bigger one short.
 */

import { WORLD_WIDTH } from "@/render/layout";

export type CameraPunchKind =
  | "skillCast"
  | "swordSpin"
  | "bossSlamLand"
  | "bossDefeated"
  | "zoneWhoosh"
  | "bossRoomEntered"
  | "swordQuake"
  | "archerBarrage"
  | "mageCataclysm"
  | "swordSkyfall"
  | "archerStorm"
  | "mageApocalypse"
  | "ninjaMassacre"
  | "ninjaEternal";

/** Peak scale multiplier (1.0 = no zoom) per trigger kind — see the task
 * spec's exact values. `swordSpin` (HERO SIGNATURE PASS item 6) is a
 * slightly stronger variant of the generic `skillCast` punch, specifically
 * for the swordsman's crescent-nova spin — "strongest wins" (see
 * `trigger()`) means it naturally takes over from a plain `skillCast` punch
 * that happened to fire the same instant. `zoneWhoosh` (M6 "World & Town",
 * a zone-to-zone walk arriving) is deliberately the softest of all — barely
 * a nudge, it just sells "you just arrived somewhere". `bossRoomEntered` is
 * a dedicated, weightier entrance beat — bigger than a skill cast, smaller
 * than the boss's own slam. The three tier-2 ULTIMATE kinds (M7.7 "Skill
 * Spectacle" — sword_quake/archer_barrage/mage_cataclysm) are deliberately
 * the BIGGEST punches in the palette, bigger even than `bossDefeated` — the
 * owner's "เบิ้มๆ สาดๆ ดุๆ" screen-shaking-apocalyptic mandate for a
 * field-wide ultimate landing. M7.9 "Grand Expansion"'s tier-3 skill-4s
 * (swordSkyfall/archerStorm/mageApocalypse) are each tuned to clearly
 * OUT-PUNCH their own class's tier-2 ultimate above (owner spec: "each MUST
 * clearly out-spectacle its tier-2 ultimate") — the new biggest punches in
 * the palette. `ninjaMassacre` (SAVE v18 render wave, tier-2 chain-dash
 * ultimate) sits in the same tier-2-ultimate band as swordQuake/
 * archerBarrage/mageCataclysm; `ninjaEternal` (tier-3 skill-4) sits in the
 * swordSkyfall/archerStorm/mageApocalypse band, same "each class's own
 * ladder" convention. */
const PEAK_SCALE: Record<CameraPunchKind, number> = {
  skillCast: 1.02,
  swordSpin: 1.035,
  bossSlamLand: 1.045,
  bossDefeated: 1.06,
  zoneWhoosh: 1.015,
  bossRoomEntered: 1.05,
  swordQuake: 1.08,
  archerBarrage: 1.07,
  mageCataclysm: 1.09,
  swordSkyfall: 1.11,
  archerStorm: 1.1,
  mageApocalypse: 1.12,
  ninjaMassacre: 1.075,
  ninjaEternal: 1.115,
};

/** Peak position nudge (world px, toward the event's side of the arena),
 * scaled with the same "how big a deal is this" ladder as `PEAK_SCALE`. */
const PEAK_NUDGE_PX: Record<CameraPunchKind, number> = {
  skillCast: 1.5,
  swordSpin: 2.2,
  bossSlamLand: 3,
  bossDefeated: 4,
  zoneWhoosh: 1,
  bossRoomEntered: 3.5,
  swordQuake: 4.5,
  archerBarrage: 4,
  mageCataclysm: 5,
  swordSkyfall: 5.5,
  archerStorm: 5,
  mageApocalypse: 6,
  ninjaMassacre: 4.2,
  ninjaEternal: 5.5,
};

/** Total real-seconds duration of one punch (zoom-in + ease-out), per spec. */
const DURATION = 0.18;
/** Fraction of `DURATION` spent zooming IN before easing back out. */
const IN_FRAC = 0.35;

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
function easeInQuad(t: number): number {
  return t * t;
}

/** 0 -> 1 -> 0 envelope: a quick rise to the peak by `IN_FRAC`, then an
 * easing decay back to 0 over the remainder. `u` is elapsed/duration in [0,1]. */
function envelope(u: number): number {
  if (u <= IN_FRAC) return easeOutQuad(u / IN_FRAC);
  return 1 - easeInQuad((u - IN_FRAC) / (1 - IN_FRAC));
}

export class CameraPunch {
  /** Elapsed real seconds since the current punch started; `>= duration`
   * means fully settled/idle (the common case, every frame nothing fired). */
  private t = DURATION;
  private duration = DURATION;
  /** `PEAK_SCALE[kind] - 1` for the in-flight punch. */
  private peakDelta = 0;
  private nudgeMag = 0;
  /** -1 / 0 / 1 — 0 renders no nudge at all (symmetric punches). */
  private nudgeDir = 0;

  private envelopeNow(): number {
    if (this.t >= this.duration) return 0;
    return envelope(this.t / this.duration);
  }

  /**
   * Kick a punch. `worldX`, if given, biases the tiny nudge toward that side
   * of the arena; omit it for a purely symmetric zoom (e.g. `bossDefeated`,
   * which has no single point of impact).
   */
  trigger(kind: CameraPunchKind, worldX?: number): void {
    const peakDelta = PEAK_SCALE[kind] - 1;
    // Strongest wins: compare the NEW punch's peak against the CURRENTLY
    // in-flight one's instantaneous (already-decaying) strength, not its
    // original peak — so a weaker punch arriving well after the strong one's
    // own peak has passed is still free to take over.
    const currentStrength = this.peakDelta * this.envelopeNow();
    if (peakDelta < currentStrength) return;

    this.peakDelta = peakDelta;
    this.nudgeMag = PEAK_NUDGE_PX[kind];
    this.nudgeDir = worldX == null ? 0 : worldX >= WORLD_WIDTH / 2 ? 1 : -1;
    this.duration = DURATION;
    this.t = 0;
  }

  /** Advance by `dt` REAL seconds (never sub-step count, like the rest of `fx/`). */
  update(dt: number): void {
    if (this.t >= this.duration) return;
    this.t = Math.min(this.duration, this.t + Math.max(0, dt));
  }

  /** Multiplicative scale factor — compose onto `baseTransform.scale`. */
  get scale(): number {
    return 1 + this.peakDelta * this.envelopeNow();
  }

  /** Additive world-space position nudge — compose onto the letterbox
   * offset + screenshake offset. */
  get offset(): { x: number; y: number } {
    const e = this.envelopeNow();
    return { x: this.nudgeDir * this.nudgeMag * e, y: 0 };
  }
}
