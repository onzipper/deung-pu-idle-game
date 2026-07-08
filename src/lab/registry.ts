/**
 * `/lab` registry — the single extension point for new art experiments (see
 * `page-lab-serialized-turing.md`). Adding a new experiment = one new file in
 * `experiments/` + one line in `LAB_EXPERIMENTS` below.
 *
 * `LabScene.controls` is a deliberately loosely-typed bag: each experiment
 * pairs its own `createScene` + `Controls` in the SAME file, so the concrete
 * shape (which functions/getters it holds) is a private contract between
 * those two — not something worth a generic type parameter on `LabScene`
 * itself for a dev-only sandbox page.
 */

import type { FC } from "react";
import type { Container } from "pixi.js";
import type { LabStage } from "@/lab/stage";
import type { FrameSet } from "@/lab/frames";

export interface LabScene {
  /** Root Pixi node — already appended into `stage.world` by `createScene`. */
  view: Container;
  /** Called every real-time rAF tick (`dt` in seconds) by `LabScreen`. */
  update(dt: number): void;
  /** Removes `view` from its parent + disposes every Pixi resource it owns. */
  destroy(): void;
  /** Live knobs the paired `Controls` component reads/writes — see the
   * module doc comment above. */
  controls: Record<string, unknown>;
}

export interface LabExperiment {
  id: string;
  title: string;
  desc: string;
  Controls: FC<{ scene: LabScene }>;
  createScene(stage: LabStage, frames: FrameSet): LabScene;
}

import { animPlayerExperiment } from "@/lab/experiments/animPlayer";
import { inBiomeExperiment } from "@/lab/experiments/inBiome";
import { sideBySideExperiment } from "@/lab/experiments/sideBySide";
import { juiceExperiment } from "@/lab/experiments/juice";
import { playgroundExperiment } from "@/lab/experiments/playground";
import { townPreviewExperiment } from "@/lab/experiments/townPreview";
import { weaponFxExperiment } from "@/lab/experiments/weaponFx";
import { refineLadderExperiment } from "@/lab/experiments/refineLadder";

export const LAB_EXPERIMENTS: readonly LabExperiment[] = [
  animPlayerExperiment,
  inBiomeExperiment,
  sideBySideExperiment,
  juiceExperiment,
  playgroundExperiment,
  townPreviewExperiment,
  weaponFxExperiment,
  refineLadderExperiment,
];
