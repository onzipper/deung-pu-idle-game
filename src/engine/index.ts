/**
 * Public engine API.
 *
 * `render/`, `ui/`, and `server/` import ONLY from here — never reach into
 * engine internals. This keeps the pure-simulation boundary intact.
 */

export * from "@/engine/core/loop";
export * from "@/engine/core/rng";
export * from "@/engine/core/math";
export * from "@/engine/core/step";
export * from "@/engine/config";
export * from "@/engine/entities";
export * from "@/engine/state";
export * from "@/engine/state/version";

// Derived-stat helpers and positional queries the render/ui layers need
// (e.g. team power for the boss hint, target lists for drawing).
export * from "@/engine/systems/stats";
export * from "@/engine/systems/targeting";

// Class-advancement (evolution) helpers: `canEvolveHero` / `evolutionCost` let the
// UI derive a per-hero `canEvolve` flag for its snapshot; `evolveHero` is applied
// only through `step()` via the `evolveHero` FrameInput intent.
export { canEvolveHero, evolveHero, evolutionCost } from "@/engine/systems/evolution";

// Read-only boss-hint data for the UI panel. The sim itself is driven only
// through `step(state, input)`; systems are not part of the public surface.
export { bossHint, type BossHint } from "@/engine/systems/boss";
