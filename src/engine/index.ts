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
