/**
 * Hit-flash: a brief "flash to white" pulse on the target's own view container
 * when it takes a `hit`. Implemented with `ColorMatrixFilter` instead of a
 * hand-built gradient/overlay (the POC-bug rule): the filter's matrix is set
 * once to a flat "map every color to white" transform, and the filter's own
 * `alpha` (its original-vs-transformed mix uniform) is driven from 1 -> 0 as
 * the flash decays — so no per-frame matrix math is needed, just one number.
 *
 * Pooled: filters are only attached to a view while it is actively flashing,
 * and returned to a free-list once the flash ends (never left attached —
 * idle entities pay zero extra render cost).
 */

import { ColorMatrixFilter } from "pixi.js";
import type { Container } from "pixi.js";

// 5x4 matrix (see ColorMatrixFilter docs): maps every input color straight to
// opaque white, alpha untouched. Combined with `filter.alpha` (the filter's
// own original-vs-transformed mix uniform) as the 1 -> 0 flash decay.
const WHITE_MATRIX: ColorMatrixFilter["matrix"] = [
  0, 0, 0, 0, 1,
  0, 0, 0, 0, 1,
  0, 0, 0, 0, 1,
  0, 0, 0, 1, 0,
];

/** Seconds a flash takes to fully decay back to normal. */
const FLASH_DURATION = 0.12;

interface FlashEntry {
  view: Container;
  filter: ColorMatrixFilter;
  t: number;
}

export class HitFlashController {
  private readonly active = new Map<Container, FlashEntry>();
  private readonly freeFilters: ColorMatrixFilter[] = [];

  /** Start (or restart) a flash on `view`. Safe to call every hit, even rapid ones. */
  trigger(view: Container): void {
    let entry = this.active.get(view);
    if (!entry) {
      const filter = this.freeFilters.pop() ?? makeWhiteFlashFilter();
      entry = { view, filter, t: 0 };
      this.active.set(view, entry);
      view.filters = [filter];
    }
    entry.t = FLASH_DURATION;
    entry.filter.alpha = 1;
  }

  /** Advance every active flash by `dt` real seconds. */
  update(dt: number): void {
    for (const [view, entry] of this.active) {
      entry.t -= dt;
      if (entry.t <= 0) {
        view.filters = null;
        this.freeFilters.push(entry.filter);
        this.active.delete(view);
        continue;
      }
      entry.filter.alpha = Math.max(0, entry.t / FLASH_DURATION);
    }
  }

  /** Full teardown (renderer destroy). */
  destroy(): void {
    for (const [view] of this.active) view.filters = null;
    this.active.clear();
    this.freeFilters.length = 0;
  }
}

function makeWhiteFlashFilter(): ColorMatrixFilter {
  const filter = new ColorMatrixFilter();
  filter.matrix = WHITE_MATRIX;
  filter.alpha = 0;
  return filter;
}
