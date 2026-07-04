/**
 * Centralized ON/OFF knobs for the pricier render-fx additions (Task B: camera
 * punch, sword trail, shockwave/bloom/RGB-split Pixi filters — see
 * `render/README.md`'s Art direction section + `fx/impactFilters.ts`).
 *
 * Kept in one small, standalone module (rather than buried at the top of
 * `FxController.ts`) so balance/QA can flip a knob to A/B a GPU-costly effect
 * without hunting through `fx/`.
 */
export const RENDER_FX = {
  /**
   * `AdvancedBloomFilter` on the `projectiles` + `fx` layers (see
   * `GameRenderer.create()` / `fx/impactFilters.ts`'s `createBloomFilter()`).
   * Unlike the transient shockwave/RGB-split filters (attach-only-while-
   * active, zero idle cost by construction), bloom is a PERSISTENT filter —
   * always-on GPU work for as long as it's attached — so it's the one
   * genuinely worth a runtime kill-switch on lower-end GPUs.
   */
  bloom: true,
} as const;
