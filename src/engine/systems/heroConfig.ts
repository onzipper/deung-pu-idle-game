/**
 * Per-hero automation config write path (M8 party P1b).
 *
 * `HeroConfig` (auto-cast / auto-allocate / auto-hunt / auto-potions + thresholds)
 * is SIM-AFFECTING and must be identical on every cohort client. There is exactly
 * ONE way it is written — `applyHeroConfig` — used by both:
 *   - the SOLO store-mirror (`syncPrimaryHeroConfig`), which copies the store-fed
 *     GLOBAL `GameState` fields onto `heroes[0].config` when the zone holds a single
 *     hero (the solo fast path), and
 *   - the replicated `setHeroConfig` intent (cohort), which writes an arbitrary hero.
 *
 * Keeping a single writer is the design's "one code path, no divergence" guarantee
 * (docs/party-design-m8.md §2). Pure — no RNG, no wall-clock.
 */

import type { GameState } from "@/engine/state";
import type { Hero, HeroConfig } from "@/engine/entities";

/** Merge a partial config onto a hero (the sole `HeroConfig` writer). No-op if absent. */
export function applyHeroConfig(hero: Hero | undefined, patch: Partial<HeroConfig>): void {
  if (!hero) return;
  const c = hero.config;
  if (patch.autoCast !== undefined) c.autoCast = patch.autoCast;
  if (patch.autoAllocate !== undefined) c.autoAllocate = patch.autoAllocate;
  if (patch.autoHunt !== undefined) c.autoHunt = patch.autoHunt;
  if (patch.autoHpPotion !== undefined) c.autoHpPotion = patch.autoHpPotion;
  if (patch.autoManaPotion !== undefined) c.autoManaPotion = patch.autoManaPotion;
  if (patch.autoHpThreshold !== undefined) c.autoHpThreshold = patch.autoHpThreshold;
  if (patch.autoManaThreshold !== undefined) c.autoManaThreshold = patch.autoManaThreshold;
}

/**
 * SOLO fast path: mirror the store-fed GLOBAL toggles/thresholds onto `heroes[0]`'s
 * config. Runs ONLY when the zone holds a single hero — a cohort (≥2 heroes) is driven
 * purely by replicated `setHeroConfig` intents, so no "local player" global ever leaks
 * into the shared sim. With one hero this reproduces the pre-P1b behaviour exactly
 * (the systems read `hero.config.X` = the same value they used to read off `state.X`),
 * so a 1-hero run stays byte-identical. Note `state.autoHunt` is BOTH persisted and
 * mirrored here; `autoReturn`/`autoAdvance` stay global (navigation, not per-hero).
 */
export function syncPrimaryHeroConfig(state: GameState): void {
  if (state.heroes.length !== 1) return;
  applyHeroConfig(state.heroes[0], {
    autoCast: state.autoCast,
    autoAllocate: state.autoAllocate,
    autoHunt: state.autoHunt,
    autoHpPotion: state.autoHpPotion,
    autoManaPotion: state.autoManaPotion,
    autoHpThreshold: state.autoHpThreshold,
    autoManaThreshold: state.autoManaThreshold,
  });
}
