/**
 * Tunable balance constants.
 *
 * This is the home for the POC `CONFIG` block once the engine is ported. Keep
 * ALL magic numbers here (and nowhere in the systems) so the balance-sim harness
 * can sweep them. Values below are placeholders to establish the shape.
 */

export const CONFIG = {
  /** Speed multipliers the player can toggle. */
  speeds: [1, 2, 3] as const,

  /** Offline idle earnings are capped to this many hours (anti-cheat). */
  offlineCapHours: 8,

  /** Throttle for engine -> UI (Zustand) state sync, in Hz. */
  uiSyncHz: 10,
} as const;

export type SpeedMultiplier = (typeof CONFIG.speeds)[number];
