/**
 * PROTO ONLY (`/proto-shaders`) — effect #4: a cheap generic per-biome
 * color-grade PRESET (temperature/contrast lift), shown as its own toggle so
 * the owner can judge "how much does a grade alone buy" versus the scene's
 * dedicated effect (haze/aurora/ember-bloom). One `AdjustmentFilter` instance,
 * reused across scene switches (its uniforms are just re-set per preset).
 */

import { AdjustmentFilter } from "pixi-filters";
import type { ProtoSceneId } from "@/render/fx/proto/ProtoShaderStage";

interface GradePreset {
  gamma: number;
  contrast: number;
  saturation: number;
  red: number;
  green: number;
  blue: number;
}

/** Warm/cool presets per scene — a small temperature + contrast lift, NOT a
 * full re-tint (per the binding "no wash over the whole sprite/scene" art
 * direction — this is deliberately the cheapest possible "expensive-looking"
 * knob, tuned conservatively). */
const PRESETS: Record<ProtoSceneId, GradePreset> = {
  map4: { gamma: 1.02, contrast: 1.08, saturation: 0.92, red: 0.97, green: 1.0, blue: 1.08 },
  map5: { gamma: 0.98, contrast: 1.1, saturation: 1.05, red: 1.08, green: 1.02, blue: 0.92 },
  map6: { gamma: 0.95, contrast: 1.14, saturation: 1.08, red: 1.12, green: 0.98, blue: 0.88 },
};

export class ColorGradeEffect {
  readonly filter = new AdjustmentFilter();
  private strength = 0.6;
  private scene: ProtoSceneId = "map4";

  setScene(scene: ProtoSceneId): void {
    this.scene = scene;
    this.applyPreset();
  }

  setStrength(strength01: number): void {
    this.strength = Math.max(0, Math.min(1, strength01));
    this.applyPreset();
  }

  setLowPower(lowPower: boolean): void {
    this.filter.resolution = lowPower ? 0.5 : 1;
  }

  private applyPreset(): void {
    const p = PRESETS[this.scene];
    const s = this.strength;
    // Lerp each uniform from neutral (1/1/1) toward the preset by `strength`.
    this.filter.gamma = 1 + (p.gamma - 1) * s;
    this.filter.contrast = 1 + (p.contrast - 1) * s;
    this.filter.saturation = 1 + (p.saturation - 1) * s;
    this.filter.red = 1 + (p.red - 1) * s;
    this.filter.green = 1 + (p.green - 1) * s;
    this.filter.blue = 1 + (p.blue - 1) * s;
  }

  destroy(): void {
    this.filter.destroy();
  }
}
