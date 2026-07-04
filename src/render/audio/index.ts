/**
 * Public entry point for the audio module. Import from `@/render/audio`
 * rather than reaching into individual files — mirrors the `@/engine`
 * single-entry-point convention.
 */

export { AudioController } from "@/render/audio/AudioController";
export { AudioEngine } from "@/render/audio/AudioEngine";
export { SFX_MIN_INTERVAL_MS, SFX_PARAMS } from "@/render/audio/sfxMap";
