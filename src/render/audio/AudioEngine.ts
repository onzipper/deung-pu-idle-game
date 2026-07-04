/**
 * Lazy, asset-free WebAudio synth toolkit — the low-level layer of the audio
 * module. No engine/Pixi/React imports (audio is presentation, same rule as
 * `render/fx`, but this file is intentionally standalone/importable on its
 * own — `sfxMap.ts` + `AudioController.ts` are the only things that know
 * about `GameEvent`).
 *
 * Design constraints (mirrors the fx-layer rules in `render/README.md`):
 *  - Never throws. Every public method feature-detects/guards and degrades to
 *    a silent no-op if WebAudio is unavailable (SSR, older browsers, a
 *    locked-down sandbox) — same spirit as the POC crashes this project
 *    avoids by construction, just for audio instead of canvas.
 *  - `AudioContext` is created lazily, only from `resume()`, which itself
 *    must be called from inside a real user-gesture handler (browsers block
 *    autoplay until one fires — see `AudioController`'s pointerdown wiring).
 *  - A hard concurrent-voice cap + a per-throttle-key minimum interval stop a
 *    3x-speed hail of same-type events (e.g. many `hit`s in one frame) from
 *    turning into a machine-gun; see `allow()`.
 *  - All synth primitives are generic (tone/noise/sweep) — the actual game-y
 *    recipes (which freq, which envelope, which combo) live in `sfxMap.ts` so
 *    a designer can retune the palette without touching this file.
 */

/** Oscillator waveform shapes WebAudio supports natively. */
export type ToneShape = OscillatorType;

export interface ToneOptions {
  /** Waveform. Default "sine". */
  shape?: ToneShape;
  /** Attack time (seconds) to reach peak gain. Default 0.005 (near-instant). */
  attack?: number;
  /** Decay/release time (seconds) from peak back to ~silent. Default 0.15. */
  decay?: number;
  /** Peak linear gain BEFORE the master volume, kept conservative so layered
   * sounds never clip. Default 0.25. */
  gain?: number;
  /** Optional pitch detune in cents (flavour variance). Default 0. */
  detune?: number;
  /** If set, frequency linearly slides from `freq` to this by the end of the
   * `attack + decay` window (cheap "blip with a little pitch swoop"). */
  freqEnd?: number;
  /** Delay (seconds, from now) before the sound starts — for scheduling
   * sequences (arpeggios, ticks) on the audio clock instead of setTimeout. */
  delay?: number;
}

export interface NoiseOptions {
  /** Total duration, seconds. Default 0.2. */
  duration?: number;
  /** Attack time, seconds. Default 0.002. */
  attack?: number;
  /** Peak linear gain before master. Default 0.2. */
  gain?: number;
  /** Filter shape carving the raw white noise into a game-y texture
   * (thump/hiss/swish). Default "lowpass". */
  filterType?: BiquadFilterType;
  /** Filter cutoff, Hz. Default 1200. */
  filterFreq?: number;
  /** Filter resonance. Default 0.7. */
  filterQ?: number;
  /** If set, the filter cutoff linearly slides from `filterFreq` to this over
   * `duration` (rising tension / falling whoosh). */
  filterFreqEnd?: number;
  delay?: number;
}

export interface SweepOptions {
  /** Waveform. Default "sine". */
  shape?: ToneShape;
  /** Total duration, seconds. Default 0.3. */
  duration?: number;
  /** Attack time, seconds. Default 0.01. */
  attack?: number;
  /** Peak linear gain before master. Default 0.25. */
  gain?: number;
  delay?: number;
}

/** Hard cap on concurrently-playing one-shots (voice pool). Keeps a chaotic
 * screen (many kills/hits/skills at 3x speed) from turning into noise mush
 * and caps CPU spent on oscillator/filter graphs. */
const MAX_CONCURRENT_VOICES = 8;

/** Clamp to a sane [0, 1] gain range. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Resolve a cross-browser `AudioContext` constructor without throwing if
 * neither exists (older Safari's prefixed one, or none at all in a sandboxed
 * / SSR environment). */
function resolveAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Shared 2s white-noise buffer, built lazily on first noise burst and
   * reused (looped/truncated) for every subsequent one — avoids re-generating
   * a random buffer per sound. */
  private noiseBuffer: AudioBuffer | null = null;

  private volume = 0.5;
  private muted = false;

  private activeVoices = 0;
  /** wall-clock-ish `ctx.currentTime` (seconds) of the last sound played per
   * throttle key, so a hail of same-type events can be rate-limited. */
  private readonly lastPlayedAt = new Map<string, number>();

  /** True once a real `AudioContext` exists (does not imply "running" — it
   * may still be "suspended" pending a user gesture). */
  get isReady(): boolean {
    return this.ctx !== null;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get currentVolume(): number {
    return this.volume;
  }

  /**
   * Create (once) and/or resume the `AudioContext`. MUST be called from
   * inside a real user-gesture event handler at least once — browsers block
   * audio output until then. Safe to call repeatedly/every pointerdown; it is
   * a cheap no-op once already running. Never throws.
   */
  resume(): void {
    if (!this.ctx) {
      const Ctor = resolveAudioContextCtor();
      if (!Ctor) return; // WebAudio unavailable — degrade silently forever.
      try {
        const ctx = new Ctor();
        const master = ctx.createGain();
        master.gain.value = this.muted ? 0 : this.volume;
        master.connect(ctx.destination);
        this.ctx = ctx;
        this.master = master;
      } catch {
        this.ctx = null;
        this.master = null;
        return;
      }
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume().catch(() => {
        /* transient — next resume() (next pointerdown) retries */
      });
    }
  }

  /** Master volume, 0..1, applied before any per-sound gain. */
  setVolume(v: number): void {
    this.volume = clamp01(v);
    if (this.master && !this.muted) this.master.gain.value = this.volume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  /**
   * Throttle gate: true if a sound tagged `key` is allowed to play right now,
   * given (a) the global concurrent-voice cap and (b) a minimum interval
   * since the last sound sharing that key. Recording "last played" happens as
   * a side effect of an allowed check, so callers should only call this once
   * per candidate sound, immediately before playing it.
   */
  allow(key: string, minIntervalMs: number): boolean {
    if (!this.ctx || !this.master) return false;
    if (this.activeVoices >= MAX_CONCURRENT_VOICES) return false;
    const now = this.ctx.currentTime * 1000;
    const last = this.lastPlayedAt.get(key) ?? -Infinity;
    if (now - last < minIntervalMs) return false;
    this.lastPlayedAt.set(key, now);
    return true;
  }

  /** A short envelope-shaped oscillator "blip" — the workhorse primitive
   * (ticks, dings, low rumbles, growls all reduce to this + parameters). */
  tone(freq: number, opts: ToneOptions = {}): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const shape = opts.shape ?? "sine";
    const attack = Math.max(0, opts.attack ?? 0.005);
    const decay = Math.max(0.01, opts.decay ?? 0.15);
    const gain = clamp01(opts.gain ?? 0.25);
    const delay = Math.max(0, opts.delay ?? 0);
    const start = ctx.currentTime + delay;
    const end = start + attack + decay;

    const osc = ctx.createOscillator();
    osc.type = shape;
    osc.frequency.setValueAtTime(Math.max(1, freq), start);
    if (opts.detune) osc.detune.setValueAtTime(opts.detune, start);
    if (opts.freqEnd) {
      osc.frequency.linearRampToValueAtTime(Math.max(1, opts.freqEnd), end);
    }

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(env);
    env.connect(master);
    osc.start(start);
    osc.stop(end + 0.02);
    this.trackVoice(osc, end + 0.02 - ctx.currentTime);
  }

  /** A filtered white-noise burst — thumps, hisses, whooshes, coin-shower
   * texture, boss-slam impact. */
  noise(opts: NoiseOptions = {}): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const duration = Math.max(0.01, opts.duration ?? 0.2);
    const attack = Math.max(0, opts.attack ?? 0.002);
    const gain = clamp01(opts.gain ?? 0.2);
    const delay = Math.max(0, opts.delay ?? 0);
    const start = ctx.currentTime + delay;
    const end = start + duration;

    const buffer = this.getNoiseBuffer(ctx);
    if (!buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true; // shared buffer is 2s; loop covers any requested duration

    const filter = ctx.createBiquadFilter();
    filter.type = opts.filterType ?? "lowpass";
    filter.Q.value = opts.filterQ ?? 0.7;
    filter.frequency.setValueAtTime(Math.max(20, opts.filterFreq ?? 1200), start);
    if (opts.filterFreqEnd) {
      filter.frequency.linearRampToValueAtTime(Math.max(20, opts.filterFreqEnd), end);
    }

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    src.connect(filter);
    filter.connect(env);
    env.connect(master);
    src.start(start);
    src.stop(end + 0.02);
    this.trackVoice(src, end + 0.02 - ctx.currentTime);
  }

  /** A pitch-swept oscillator over its whole duration — sad/happy sweeps
   * (hero down/revived), tension risers, victory/fanfare notes-with-glide. */
  sweep(freqFrom: number, freqTo: number, opts: SweepOptions = {}): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const shape = opts.shape ?? "sine";
    const duration = Math.max(0.02, opts.duration ?? 0.3);
    const attack = Math.max(0, opts.attack ?? 0.01);
    const gain = clamp01(opts.gain ?? 0.25);
    const delay = Math.max(0, opts.delay ?? 0);
    const start = ctx.currentTime + delay;
    const end = start + duration;

    const osc = ctx.createOscillator();
    osc.type = shape;
    osc.frequency.setValueAtTime(Math.max(1, freqFrom), start);
    osc.frequency.linearRampToValueAtTime(Math.max(1, freqTo), end);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(env);
    env.connect(master);
    osc.start(start);
    osc.stop(end + 0.02);
    this.trackVoice(osc, end + 0.02 - ctx.currentTime);
  }

  /** Full teardown — closes the context so nothing keeps running after
   * unmount. Never throws. */
  destroy(): void {
    this.lastPlayedAt.clear();
    this.activeVoices = 0;
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    if (ctx && ctx.state !== "closed") {
      void ctx.close().catch(() => {
        /* already closing/closed — fine */
      });
    }
  }

  // ---------------------------------------------------------------------

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer | null {
    if (this.noiseBuffer) return this.noiseBuffer;
    try {
      const seconds = 2;
      const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
      return buffer;
    } catch {
      return null;
    }
  }

  private trackVoice(node: AudioScheduledSourceNode, durationSec: number): void {
    this.activeVoices++;
    let settled = false;
    const release = () => {
      if (settled) return;
      settled = true;
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    node.addEventListener("ended", release, { once: true });
    // Safety net: some older engines are flaky about firing `ended` for very
    // short buffer sources. Guarantees the voice slot is freed regardless.
    setTimeout(release, Math.max(0, durationSec) * 1000 + 100);
  }
}
