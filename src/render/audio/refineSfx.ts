/**
 * M7.6 ตีบวก (Refine) SFX — a small, self-contained synth palette for the
 * town refine station (`ui/components/RefinePanel.tsx`). Unlike the rest of
 * `render/audio` (`sfxMap.ts`/`AudioController.ts`), these sounds are triggered
 * by a UI-initiated HTTP action, not a `GameEvent` the engine emitted — there is
 * no per-frame consumer, so this stays a tiny standalone module built on the
 * SAME low-level `AudioEngine` synth primitives (tone/noise/sweep), same
 * conservative-gain-so-layered-sounds-never-clip convention.
 *
 * `RefinePanel.tsx` owns exactly one `AudioEngine` instance for its lifetime
 * (created via `createRefineAudio()`), calls `.resume()` from inside the
 * refine button's own click handler (a real user gesture) and applies the
 * shared `soundMuted` preference — mirrors `AudioController`'s own
 * resume/mute wiring, just scoped to this one panel instead of the whole game.
 */

import { AudioEngine } from "@/render/audio/AudioEngine";

export function createRefineAudio(): AudioEngine {
  return new AudioEngine();
}

/** One "hammer strike" tick during the anticipation build-up — a short,
 * percussive knock (filtered noise thump + a low tone click) that rises
 * slightly in pitch/gain each successive strike so the sequence reads as
 * building tension toward the reveal. `strikeIndex` is 0-based; `delaySec`
 * schedules it on the audio clock (so a whole charge sequence can be fired in
 * one call rather than relying on drifting `setTimeout`s). */
export function playRefineChargeTick(
  engine: AudioEngine,
  strikeIndex: number,
  delaySec = 0,
): void {
  const rise = Math.min(strikeIndex, 4);
  engine.noise({
    duration: 0.05,
    gain: 0.16 + rise * 0.02,
    filterType: "lowpass",
    filterFreq: 900 + rise * 120,
    delay: delaySec,
  });
  engine.tone(180 + rise * 18, {
    shape: "square",
    decay: 0.05,
    gain: 0.1 + rise * 0.015,
    delay: delaySec,
  });
}

/** Success chime — a short bright ascending arpeggio (distinct from
 * `sfxMap.ts`'s `levelUp`/`stageAdvanced` fanfares: fewer notes, quicker, so it
 * reads as "this ONE item" rather than a whole-run milestone). */
export function playRefineSuccess(engine: AudioEngine): void {
  const notes = [523.25, 659.25, 880]; // C5 E5 A5
  notes.forEach((freq, i) => {
    engine.tone(freq, { shape: "triangle", decay: 0.16, gain: 0.22, delay: i * 0.07 });
  });
}

/** Degrade — a dull, muted "thud" (low filtered noise + a short descending
 * tone), quieter and shorter than `break`'s sting so the two never get
 * confused: this is a setback, not a catastrophe. */
export function playRefineDegrade(engine: AudioEngine): void {
  engine.noise({ duration: 0.16, gain: 0.2, filterType: "lowpass", filterFreq: 260 });
  engine.tone(180, { shape: "sine", freqEnd: 110, decay: 0.22, gain: 0.16, delay: 0.03 });
}

/** Break (item destroyed) — a sharper noise "crack" burst followed by a
 * somber low descending sweep, the heaviest of the three outcomes. */
export function playRefineBreak(engine: AudioEngine): void {
  engine.noise({ duration: 0.22, gain: 0.3, filterType: "bandpass", filterFreq: 1400, filterQ: 1.2 });
  engine.noise({ duration: 0.12, gain: 0.24, filterType: "highpass", filterFreq: 2200, delay: 0.02 });
  engine.sweep(220, 70, { shape: "sine", duration: 0.5, gain: 0.22, delay: 0.08 });
}
