/**
 * Town NPC interaction reads (M6 town NPCs, phase 2 — engine owns the geometry).
 *
 * The ENGINE is the single source of truth for where the two named town actors stand
 * (`CONFIG.townNpcs`): render derives its rigs from it and phase-3 UI gates tap-to-talk
 * on `npcInRange` below, so the layer rule holds (engine never imports render). The idle
 * bot's town-trip walk (systems/bots.ts) also uses these to arm its transactions ONLY
 * once the hero has reached ป้าปุ๊ the merchant.
 *
 * PURITY / DETERMINISM: pure state derivation — no RNG (the seeded stream stays
 * wave-composition only), no wall-clock.
 */

import { CONFIG } from "@/engine/config";
import { zoneAt } from "@/engine/systems/world";
import type { TownNpcId } from "@/engine/entities";
import type { GameState } from "@/engine/state";

/**
 * A resolved town-NPC anchor: id + world-x feet position + interaction half-width + the
 * deterministic ground-plane depth row `planeY` (world-y OFFSET, same axis as `Entity.planeY`;
 * FREE-FIELD Phase 3). NPCs are PLACED (design constants in `CONFIG.townNpcs`), never
 * hash-scattered — so all clients agree with no RNG draw. `planeY` is presentation depth ONLY:
 * `npcInRange` gates on `x` alone, so it never affects tap-to-talk or the bot walk.
 */
export interface TownNpcAnchor {
  id: TownNpcId;
  x: number;
  radius: number;
  planeY: number;
}

/** The config anchor for `id` (throws on an unknown id — the union is closed). */
export function townNpcConfig(id: TownNpcId): TownNpcAnchor {
  const a = CONFIG.townNpcs.find((n) => n.id === id);
  if (!a) throw new Error(`unknown town npc id: ${id}`);
  return a;
}

/**
 * True iff the solo hero stands within `id`'s interaction radius WHILE in a town zone
 * — the phase-3 UI tap-to-talk gate and the idle bot's "arm the transaction" test.
 * False in any non-town zone (the anchors are meaningless positions elsewhere) or with
 * no hero. Pure/deterministic.
 */
export function npcInRange(state: GameState, id: TownNpcId): boolean {
  if (zoneAt(state.location).kind !== "town") return false;
  const hero = state.heroes[0];
  if (!hero) return false;
  const a = townNpcConfig(id);
  return Math.abs(hero.x - a.x) <= a.radius;
}
