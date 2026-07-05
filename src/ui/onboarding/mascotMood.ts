/**
 * Shared mascot mood/pose vocabulary for onboarding-step + contextual-tip
 * dialogue (M4.8 card B). Kept as a standalone, dependency-free type (no
 * React import) so `steps.ts`/`tips.ts` — which are deliberately DOM/React-free
 * for headless testability, per their own doc comments — can attach an
 * optional `mood` to a step/tip without pulling in the presentational
 * `Mascot` component. Two-to-three poses max, per the task brief: cheap CSS
 * transforms/expression swaps, not a real animation rig.
 */
export type MascotMood = "neutral" | "excited" | "warning";
