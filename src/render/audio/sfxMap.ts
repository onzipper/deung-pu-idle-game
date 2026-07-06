/**
 * GameEvent -> synth recipe palette (the "sound design data" of the audio
 * module). `AudioController.ts` is the only caller — it switches on
 * `GameEvent["type"]` (mirroring `FxController.consumeEvents`'s switch) and
 * invokes the matching `play*` function here with the properly narrowed
 * event payload.
 *
 * All tunable numbers (frequencies, durations, gains) live in `SFX_PARAMS` so
 * a designer/QA pass can retune the whole palette's feel without touching
 * `AudioEngine`'s synth internals. Gains are kept conservative (rarely above
 * ~0.3 peak, pre-master) so layered sounds (e.g. bossDefeated's arpeggio +
 * coin shower) never clip together.
 *
 * Intentionally SILENT event types (no entry / no case in AudioController):
 *  - `projectileSpawn` — fires per-shot, far too high frequency for a discrete
 *    sound without machine-gunning even with throttling.
 *  - `stageCleared` — fires in the same instant as `bossDefeated` (see
 *    `engine/systems/boss.ts`), which already carries the "big moment" fanfare;
 *    a second overlapping sting here would just be noise.
 *  - `goldOffline` — not a real-time event a player is present to hear.
 *  - `zoneEntered` (M6 "World & Town") — fires on every zone-to-zone walk hop,
 *    same "too frequent for a discrete sound" reasoning as `waveSpawn`; the
 *    visual whoosh (`FxController.onZoneEntered`) carries this beat alone.
 *  - `zoneUnlocked`/`mapUnlocked` (M6) — visual-only sparkle in `FxController`
 *    is enough for these; kept unpaired with a sound rather than adding two
 *    more one-off stings to an already dense palette. EXCEPTION (M7.5): the
 *    sub-case of a `zoneUnlocked` that is specifically a map's BOSS ROOM
 *    unlocking DOES get a sound (`playBossDoorUnlocked`) — see
 *    `AudioController`'s `isBossZoneIdx` check — since that's the one-shot
 *    "the grand door outside just unlocked" beat the M7.5 gate feel spec asks
 *    for, distinct enough from routine zone progression to earn its own cue.
 *  - `zoneGateEnter`/`zoneGateExit` (M7.5) — the gate-transit polish stays
 *    visual-only too, same reasoning as `zoneEntered` (fires on every walk
 *    hop) — "reuse/extend the whoosh feel, don't duplicate audio" per spec.
 *  - `townArrived` (M7.5 idle-bot trips) — a background bookkeeping event
 *    (restock/sell), not a moment the player is watching for; silent.
 */

import type { GameEvent } from "@/engine";
import type { ItemRarity } from "@/engine/config/items";
import type { AudioEngine } from "@/render/audio/AudioEngine";

/** Per-event tunable synth parameters. Retune freely; no code changes needed
 * elsewhere unless a NEW parameter is introduced (update the `play*` fn too). */
export const SFX_PARAMS = {
  hit: {
    enemyFreqBase: 620,
    enemyFreqPerDmg: 2.2,
    enemyFreqMax: 1000,
    heroFreqBase: 360,
    heroFreqPerDmg: 1.2,
    heroFreqMax: 560,
    decay: 0.06,
    gain: 0.16,
  },
  kill: {
    popDuration: 0.05,
    popFilterFreq: 1400,
    popGain: 0.22,
    coinDelay: 0.03,
    coinFreqFrom: 900,
    coinFreqTo: 1500,
    coinDuration: 0.09,
    coinGain: 0.18,
  },
  skillCast: {
    swordsman: { duration: 0.22, filterFrom: 2200, filterTo: 300, gain: 0.22 },
    archer: { tickFreq: 1200, tickGain: 0.16, tickGap: 0.045, tickCount: 3 },
    mage: { freqFrom: 90, freqTo: 55, duration: 0.4, gain: 0.22 },
  },
  heroDown: { freqFrom: 320, freqTo: 110, duration: 0.5, gain: 0.22 },
  /** Somber "walking home" tail, layered right after `heroDown`'s own sting
   * (M6 "World & Town": a full wipe now walks home to town via
   * `world.respawnToTown` instead of the old in-place boss retreat — this
   * repurposes what used to be `bossRetreat`'s quiet, non-punishing whiff). */
  heroWalkHome: { freqFrom: 260, freqTo: 130, duration: 0.4, gain: 0.1, delay: 0.15 },
  heroRevived: { freqFrom: 420, freqTo: 720, duration: 0.3, gain: 0.18 },
  bossSlamTelegraph: { freqFrom: 90, freqTo: 260, duration: 0.6, gain: 0.16 },
  bossSlamLand: {
    boomFreq: 55,
    boomFreqEnd: 32,
    boomDecay: 0.35,
    boomGain: 0.32,
    noiseFilterFreq: 500,
    noiseDuration: 0.3,
    noiseGain: 0.28,
  },
  bossEnraged: { freq: 140, freqEnd: 85, decay: 0.3, gain: 0.26, detune: 14 },
  /** Mob aggro growl (M6 "สนามล่ามอน" follow-up, open hunting field): a small,
   * SHORT snarl — deliberately higher/quicker/quieter than `bossEnraged`'s
   * growl (which is lower, longer, and much louder — a boss-fight moment)
   * and a different timbre than `hit`'s tick (sawtooth vs. triangle/square)
   * so the two never get confused on a busy field. Heavily throttled (see
   * `SFX_MIN_INTERVAL_MS`) — several mobs aggroing in the same instant
   * collapse into one bark, never a machine-gun. */
  mobAggroed: { freq: 210, freqEnd: 130, decay: 0.12, gain: 0.09, detune: 10 },
  bossDefeated: {
    arpeggio: [523.25, 659.25, 783.99, 1046.5], // C5 E5 G5 C6
    noteGap: 0.09,
    noteDecay: 0.16,
    noteGain: 0.2,
    coinCount: 6,
    coinGap: 0.07,
    coinFreqFrom: 900,
    coinFreqTo: 1500,
    coinDuration: 0.09,
    coinGain: 0.14,
  },
  /** Boss-room entrance (M6): a low, ominous drone — distinct from
   * `bossEnraged`'s growl and `bossSlamTelegraph`'s riser, since this fires
   * once on arrival, not mid-fight. */
  bossRoomEntered: { freq: 70, freqEnd: 45, decay: 0.5, gain: 0.2 },
  stageAdvanced: {
    notes: [440, 554.37, 659.25], // A4 C#5 E5
    noteGap: 0.07,
    noteDecay: 0.14,
    noteGain: 0.2,
  },
  levelUp: {
    notes: [659.25, 830.61], // E5 G#5 — short, bright, distinct from stageAdvanced's 3-note fanfare
    noteGap: 0.08,
    noteDecay: 0.18,
    noteGain: 0.16,
  },
  evolve: {
    // G4 B4 D5 G5 — a 4-note ascending arpeggio, distinct from levelUp's
    // 2-note chime, stageAdvanced's 3-note fanfare, AND bossDefeated's C-major
    // arpeggio (different scale degrees/register) — a mid-tier goal-ladder
    // moment needs its own unmistakable "big triumphant" identity.
    notes: [392.0, 493.88, 587.33, 783.99],
    noteGap: 0.1,
    noteDecay: 0.24,
    noteGain: 0.2,
    // A shimmering rising-filter noise tail layered under the arpeggio —
    // the "triumphant sparkle" that gives evolve more weight than levelUp's
    // plain chime without borrowing bossDefeated's coin-shower texture.
    shimmerFreqFrom: 1800,
    shimmerFreqTo: 3000,
    shimmerDuration: 0.5,
    shimmerGain: 0.12,
  },
  upgradeBought: {
    clickDuration: 0.02,
    clickFilterFreq: 2400,
    clickGain: 0.14,
    blipDelay: 0.02,
    blipFreqFrom: 500,
    blipFreqTo: 760,
    blipDuration: 0.08,
    blipGain: 0.16,
  },
  /** M7 gear-wow "drop beat": a soft synthesized chime, rarity-tiered — a
   * plain rising sweep for common/rare (rare pitches a touch higher/richer),
   * a short 3-note arpeggio for epic so the milestone drop is unmistakable.
   * Deliberately quiet (farm drops can fire often on a busy field). */
  itemDrop: {
    common: { freq: 720, freqEnd: 960, duration: 0.13, gain: 0.11 },
    rare: { freq: 740, freqEnd: 1160, duration: 0.15, gain: 0.13 },
    epic: {
      notes: [740, 987.77, 1244.51], // F#5 B5 D#6
      noteGap: 0.06,
      noteDecay: 0.18,
      noteGain: 0.16,
    },
  },
  /** M7.5 fast travel: a short rising arcane whir as the portal begins
   * forming (NOT a full-channel drone — `AudioEngine` has no early-stop API,
   * and every other cast-type cue in this palette is a short blip too), a
   * brighter arrival chime, and a quiet descending "dud" for a mid-channel
   * fizzle (only played when a channel was actually cancelled — see
   * `AudioController`). */
  fastTravelCastStart: { freqFrom: 260, freqTo: 620, duration: 0.4, gain: 0.14 },
  fastTravelArrive: {
    popFilterFreq: 1600,
    popDuration: 0.05,
    popGain: 0.16,
    chimeFreqFrom: 700,
    chimeFreqTo: 1300,
    chimeDuration: 0.12,
    chimeGain: 0.16,
  },
  fastTravelFizzle: { freqFrom: 420, freqTo: 180, duration: 0.18, gain: 0.12 },
  /** Boss-door unlock (M7.5): a low drone at the door itself — lighter/
   * shorter than `bossRoomEntered`'s own drone (which fires later, on actual
   * entry) so the two never get confused despite sharing a register. */
  bossDoorUnlocked: { freq: 85, freqEnd: 55, decay: 0.4, gain: 0.16 },
} as const;

/** Minimum ms between two sounds sharing a throttle key — the "same-type
 * hail" guard (a 3x-speed wave of hits must not machine-gun). Keyed by
 * `AudioController`'s throttle-key string prefix, not directly by
 * `GameEvent["type"]` (e.g. `hit` is further split per target). */
export const SFX_MIN_INTERVAL_MS = {
  hit: 30,
  kill: 40,
  skillCast: 80,
  heroDown: 150,
  heroRevived: 150,
  bossSlamTelegraph: 400,
  bossSlamLand: 300,
  bossEnraged: 400,
  mobAggroed: 700,
  bossDefeated: 800,
  bossRoomEntered: 800,
  stageAdvanced: 500,
  levelUp: 200,
  evolve: 400,
  upgradeBought: 40,
  itemDrop: 180,
  fastTravelCastStart: 500,
  fastTravelArrive: 300,
  fastTravelFizzle: 300,
  bossDoorUnlocked: 1000,
  // M7.9 boss-variety mechanics (maps 4-6) — reuse the CLOSEST existing synth
  // recipes below (no new `SFX_PARAMS` entries): charge telegraph/hit mirror
  // the slam's own riser/boom (same "wind-up then heavy landing" shape),
  // summon reuses the mob-aggro bark (a short "something arrived" cue), and
  // the hazard warn/strike pair reuses the same riser/boom split too. Own
  // throttle-key namespace so a boss's base slam kit (always present) never
  // shares/starves budget with its ONE extra mechanic.
  bossChargeTelegraph: 400,
  bossChargeHit: 300,
  bossSummon: 700,
  bossHazardWarn: 600,
  bossHazardStrike: 250,
} as const;

type Ev<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;

/** Hit: short tick; pitch rises a little with damage amount so a huge hit
 * reads as punchier than a tickle, clamped so it never screeches. Hero-taken
 * hits use a lower/duller tone (square) vs. enemy/boss hits (triangle, a
 * touch brighter) so the two read as distinct at a glance^H^Hlisten. */
export function playHit(engine: AudioEngine, ev: Ev<"hit">): void {
  const p = SFX_PARAMS.hit;
  const isHero = ev.target === "hero";
  const base = isHero ? p.heroFreqBase : p.enemyFreqBase;
  const perDmg = isHero ? p.heroFreqPerDmg : p.enemyFreqPerDmg;
  const max = isHero ? p.heroFreqMax : p.enemyFreqMax;
  const freq = Math.min(max, base + ev.amount * perDmg);
  engine.tone(freq, {
    shape: isHero ? "square" : "triangle",
    attack: 0.002,
    decay: p.decay,
    gain: p.gain,
  });
}

/** Kill: a short noise "pop" immediately followed by a rising coin blip. */
export function playKill(engine: AudioEngine): void {
  const p = SFX_PARAMS.kill;
  engine.noise({
    duration: p.popDuration,
    filterType: "bandpass",
    filterFreq: p.popFilterFreq,
    filterQ: 1.2,
    gain: p.popGain,
  });
  engine.sweep(p.coinFreqFrom, p.coinFreqTo, {
    shape: "triangle",
    duration: p.coinDuration,
    gain: p.coinGain,
    delay: p.coinDelay,
  });
}

/** Per-class skill cast flavour: swordsman whoosh sweep, archer triple-tick,
 * mage low rumble. */
export function playSkillCast(engine: AudioEngine, ev: Ev<"skillCast">): void {
  const p = SFX_PARAMS.skillCast;
  if (ev.heroClass === "swordsman") {
    const s = p.swordsman;
    engine.noise({
      duration: s.duration,
      filterType: "lowpass",
      filterFreq: s.filterFrom,
      filterFreqEnd: s.filterTo,
      filterQ: 0.9,
      gain: s.gain,
    });
  } else if (ev.heroClass === "archer") {
    const a = p.archer;
    for (let i = 0; i < a.tickCount; i++) {
      engine.tone(a.tickFreq, {
        shape: "square",
        attack: 0.001,
        decay: 0.04,
        gain: a.tickGain,
        delay: i * a.tickGap,
      });
    }
  } else {
    const m = p.mage;
    engine.sweep(m.freqFrom, m.freqTo, {
      shape: "sawtooth",
      duration: m.duration,
      gain: m.gain,
    });
  }
}

/** Hero down: sad downward sweep. */
export function playHeroDown(engine: AudioEngine): void {
  const p = SFX_PARAMS.heroDown;
  engine.sweep(p.freqFrom, p.freqTo, { shape: "sine", duration: p.duration, gain: p.gain });
}

/** Somber "walking home" tail (M6 "World & Town") — a quieter, slightly
 * lower second downward sweep starting a beat after `playHeroDown`'s own
 * sting, so a wipe reads as "down, then a long quiet walk home" rather than
 * one more hit-taken cue. See `SFX_PARAMS.heroWalkHome`'s doc comment for the
 * `bossRetreat` history this repurposes. */
export function playHeroWalkHome(engine: AudioEngine): void {
  const p = SFX_PARAMS.heroWalkHome;
  engine.sweep(p.freqFrom, p.freqTo, {
    shape: "sine",
    duration: p.duration,
    gain: p.gain,
    delay: p.delay,
  });
}

/** Hero revived: soft rising chime. */
export function playHeroRevived(engine: AudioEngine): void {
  const p = SFX_PARAMS.heroRevived;
  engine.sweep(p.freqFrom, p.freqTo, {
    shape: "sine",
    duration: p.duration,
    gain: p.gain,
  });
}

/** Boss slam telegraph: a tension riser during the wind-up. */
export function playBossSlamTelegraph(engine: AudioEngine): void {
  const p = SFX_PARAMS.bossSlamTelegraph;
  engine.sweep(p.freqFrom, p.freqTo, {
    shape: "sawtooth",
    duration: p.duration,
    gain: p.gain,
  });
}

/** Boss slam land: deep boom (sub-bass tone) + a filtered noise thump. */
export function playBossSlamLand(engine: AudioEngine): void {
  const p = SFX_PARAMS.bossSlamLand;
  engine.tone(p.boomFreq, {
    shape: "sine",
    attack: 0.004,
    decay: p.boomDecay,
    gain: p.boomGain,
    freqEnd: p.boomFreqEnd,
  });
  engine.noise({
    duration: p.noiseDuration,
    filterType: "lowpass",
    filterFreq: p.noiseFilterFreq,
    gain: p.noiseGain,
  });
}

/** Boss enraged: a gritty growl — two slightly detuned sawtooth blips dipping
 * in pitch (cheap distortion-free texture, no WaveShaper needed). */
export function playBossEnraged(engine: AudioEngine): void {
  const p = SFX_PARAMS.bossEnraged;
  engine.tone(p.freq, {
    shape: "sawtooth",
    attack: 0.002,
    decay: p.decay,
    gain: p.gain,
    freqEnd: p.freqEnd,
    detune: p.detune,
  });
  engine.tone(p.freq * 1.01, {
    shape: "sawtooth",
    attack: 0.002,
    decay: p.decay,
    gain: p.gain * 0.7,
    freqEnd: p.freqEnd * 1.01,
    detune: -p.detune,
    delay: 0.012,
  });
}

/** Mob aggro growl: one short, quiet, detuned sawtooth snarl — see
 * `SFX_PARAMS.mobAggroed`'s doc comment for how this stays distinct from
 * `playBossEnraged`/`playHit`. */
export function playMobAggroed(engine: AudioEngine): void {
  const p = SFX_PARAMS.mobAggroed;
  engine.tone(p.freq, {
    shape: "sawtooth",
    attack: 0.002,
    decay: p.decay,
    gain: p.gain,
    freqEnd: p.freqEnd,
    detune: p.detune,
  });
}

/** Boss defeated: victory arpeggio followed by a coin-shower of ticks. */
export function playBossDefeated(engine: AudioEngine): void {
  const p = SFX_PARAMS.bossDefeated;
  p.arpeggio.forEach((freq, i) => {
    engine.tone(freq, {
      shape: "triangle",
      attack: 0.004,
      decay: p.noteDecay,
      gain: p.noteGain,
      delay: i * p.noteGap,
    });
  });
  const showerStart = p.arpeggio.length * p.noteGap + 0.05;
  for (let i = 0; i < p.coinCount; i++) {
    engine.sweep(p.coinFreqFrom, p.coinFreqTo, {
      shape: "triangle",
      duration: p.coinDuration,
      gain: p.coinGain,
      delay: showerStart + i * p.coinGap,
    });
  }
}

/** Boss-room entrance: a low, ominous drone — one-shot on arrival, distinct
 * from every mid-fight boss cue (`bossEnraged`'s growl, `bossSlamTelegraph`'s
 * riser). */
export function playBossRoomEntered(engine: AudioEngine): void {
  const p = SFX_PARAMS.bossRoomEntered;
  engine.tone(p.freq, {
    shape: "sine",
    attack: 0.01,
    decay: p.decay,
    gain: p.gain,
    freqEnd: p.freqEnd,
  });
}

/** Stage advanced: a short 3-note ascending fanfare. */
export function playStageAdvanced(engine: AudioEngine): void {
  const p = SFX_PARAMS.stageAdvanced;
  p.notes.forEach((freq, i) => {
    engine.tone(freq, {
      shape: "square",
      attack: 0.003,
      decay: p.noteDecay,
      gain: p.noteGain,
      delay: i * p.noteGap,
    });
  });
}

/** Hero level-up (M5): a short, bright 2-note chime — distinct from
 * `stageAdvanced`'s longer 3-note fanfare so the two "progress" beats never
 * get confused, and throttled per `SFX_MIN_INTERVAL_MS.levelUp` since several
 * heroes can level in the same instant off one big kill's XP grant. */
export function playLevelUp(engine: AudioEngine): void {
  const p = SFX_PARAMS.levelUp;
  p.notes.forEach((freq, i) => {
    engine.tone(freq, {
      shape: "triangle",
      attack: 0.003,
      decay: p.noteDecay,
      gain: p.noteGain,
      delay: i * p.noteGap,
    });
  });
}

/** Hero class-advancement / evolution (M5): a triumphant 4-note ascending
 * arpeggio + a shimmering rising-filter noise tail — deliberately grander and
 * distinct from both `playLevelUp` (short 2-note chime) and `playBossDefeated`
 * (different scale/register, no coin-shower texture) since this is a rarer,
 * bigger goal-ladder moment (at most once per hero for the whole M5 run). */
export function playEvolve(engine: AudioEngine): void {
  const p = SFX_PARAMS.evolve;
  p.notes.forEach((freq, i) => {
    engine.tone(freq, {
      shape: "triangle",
      attack: 0.004,
      decay: p.noteDecay,
      gain: p.noteGain,
      delay: i * p.noteGap,
    });
  });
  engine.noise({
    duration: p.shimmerDuration,
    filterType: "bandpass",
    filterFreq: p.shimmerFreqFrom,
    filterFreqEnd: p.shimmerFreqTo,
    filterQ: 1.4,
    gain: p.shimmerGain,
    delay: p.notes.length * p.noteGap * 0.5,
  });
}

/** M7 gear-wow "drop beat": a soft chime, rarity-tiered (see
 * `SFX_PARAMS.itemDrop`'s doc comment). */
export function playItemDrop(engine: AudioEngine, rarity: ItemRarity): void {
  const p = SFX_PARAMS.itemDrop;
  if (rarity === "epic") {
    p.epic.notes.forEach((freq, i) => {
      engine.tone(freq, {
        shape: "triangle",
        attack: 0.003,
        decay: p.epic.noteDecay,
        gain: p.epic.noteGain,
        delay: i * p.epic.noteGap,
      });
    });
    return;
  }
  const cfg = rarity === "rare" ? p.rare : p.common;
  engine.sweep(cfg.freq, cfg.freqEnd, { shape: "sine", duration: cfg.duration, gain: cfg.gain });
}

/** Fast travel begins channeling: a short rising arcane whir. */
export function playFastTravelCastStart(engine: AudioEngine): void {
  const p = SFX_PARAMS.fastTravelCastStart;
  engine.sweep(p.freqFrom, p.freqTo, { shape: "sawtooth", duration: p.duration, gain: p.gain });
}

/** Fast travel arrives: a soft pop immediately followed by a bright chime —
 * mirrors `playKill`'s "pop then blip" shape but pitched/timed differently so
 * the two never get confused. */
export function playFastTravelArrive(engine: AudioEngine): void {
  const p = SFX_PARAMS.fastTravelArrive;
  engine.noise({
    duration: p.popDuration,
    filterType: "bandpass",
    filterFreq: p.popFilterFreq,
    filterQ: 1.1,
    gain: p.popGain,
  });
  engine.sweep(p.chimeFreqFrom, p.chimeFreqTo, {
    shape: "triangle",
    duration: p.chimeDuration,
    gain: p.chimeGain,
    delay: 0.03,
  });
}

/** Fast travel fizzles mid-channel (damaged/dead/etc. — only played when a
 * channel was actually in progress, see `AudioController`): a quiet
 * descending "dud". */
export function playFastTravelFizzle(engine: AudioEngine): void {
  const p = SFX_PARAMS.fastTravelFizzle;
  engine.sweep(p.freqFrom, p.freqTo, { shape: "square", duration: p.duration, gain: p.gain });
}

/** Boss-door unlock: a low drone at the door itself — see `SFX_PARAMS
 * .bossDoorUnlocked`'s doc comment for how this stays distinct from
 * `playBossRoomEntered`. */
export function playBossDoorUnlocked(engine: AudioEngine): void {
  const p = SFX_PARAMS.bossDoorUnlocked;
  engine.tone(p.freq, {
    shape: "sine",
    attack: 0.015,
    decay: p.decay,
    gain: p.gain,
    freqEnd: p.freqEnd,
  });
}

/** Upgrade bought: a tiny click followed by a rising confirmation blip. Kept
 * deliberately unobtrusive — this can fire often (auto-upgrade). */
export function playUpgradeBought(engine: AudioEngine): void {
  const p = SFX_PARAMS.upgradeBought;
  engine.noise({
    duration: p.clickDuration,
    filterType: "highpass",
    filterFreq: p.clickFilterFreq,
    gain: p.clickGain,
  });
  engine.sweep(p.blipFreqFrom, p.blipFreqTo, {
    shape: "sine",
    duration: p.blipDuration,
    gain: p.blipGain,
    delay: p.blipDelay,
  });
}
