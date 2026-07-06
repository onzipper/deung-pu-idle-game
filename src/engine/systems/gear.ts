/**
 * M7 Gear & Drops — equip mutation + deterministic drop rolls.
 *
 * DROP ROLLS are STATELESS + deterministic: each kill hashes the persisted
 * `(lootSalt, lootCounter)` (see core/hash.ts) — it NEVER draws from the seeded
 * wave-composition RNG stream (reserved; CLAUDE.md), so rolling can't perturb any
 * existing hunt/world stream. The counter increments once per kill-roll and
 * persists (SAVE v10), so an offline replay reproduces the identical roll ids and
 * a reload continues monotonically (claim idempotency covers server retries).
 *
 * EQUIP is applied only through `step()` (the `equip` FrameInput intent). The
 * engine TRUSTS the client's templateId (ownership is server-enforced) but still
 * validates the SHAPE: the template must exist, its slot must match, and its
 * classReq must match the hero's class — a mismatch is a no-op.
 */

import {
  ITEM_TEMPLATES,
  bossDropTableForStage,
  dropTableForStage,
  refineOf,
  type GearSlot,
} from "@/engine/config/items";
import { clampRefine } from "@/engine/config/refine";
import { lootFloat } from "@/engine/core/hash";
import { clamp } from "@/engine/core/math";
import { heroMaxHpOf } from "@/engine/systems/stats";
import type { Hero, Enemy, Boss } from "@/engine/entities";
import type { GameState } from "@/engine/state";

// ---------------------------------------------------------------------------
// Equip
// ---------------------------------------------------------------------------

/**
 * Recompute a hero's cached max HP after an equipment change and reconcile
 * current HP: equipping HP armor heals the added headroom (like a level-up);
 * unequipping clamps current HP down to the new (smaller) max. Never revives.
 */
function reconcileMaxHp(hero: Hero): void {
  const newMax = heroMaxHpOf(hero);
  const delta = newMax - hero.maxHp;
  hero.maxHp = newMax;
  if (delta > 0) hero.hp += delta;
  else hero.hp = Math.min(hero.hp, newMax);
}

/** A loadout's refine map (defaulted so `equipItem` can spread it safely). */
function refineMap(hero: Hero): { weapon: number; armor: number } {
  return {
    weapon: refineOf(hero.equipped, "weapon"),
    armor: refineOf(hero.equipped, "armor"),
  };
}

/**
 * Equip (or, with `templateId === null`, UNEQUIP) the hero's `slot`. Validated:
 * the template must exist, sit in `slot`, and satisfy classReq (null = any
 * class). Any failing check is a silent no-op. Honoured across phases.
 *
 * `refineLevel` (M7.6 ตีบวก) is the SERVER-authoritative refine of the equipped
 * instance (the engine never rolls it — config/refine.ts); it is clamped and
 * stored per slot so the equipped item's stats scale by +N. Unequip resets the
 * slot's refine to +0.
 */
export function equipItem(
  state: GameState,
  hero: Hero,
  slot: GearSlot,
  templateId: string | null,
  refineLevel = 0,
): void {
  if (!hero) return;
  if (templateId === null) {
    if (hero.equipped[slot] === null) return; // already empty
    hero.equipped = { ...hero.equipped, [slot]: null, refine: { ...refineMap(hero), [slot]: 0 } };
    reconcileMaxHp(hero);
    return;
  }
  const t = ITEM_TEMPLATES[templateId];
  if (!t || t.slot !== slot) return; // unknown template / wrong slot
  if (t.classReq && t.classReq !== hero.cls) return; // class mismatch — reject
  const refine = clampRefine(refineLevel);
  // No change only if BOTH the template AND its refine level are unchanged (a
  // re-equip of the same item at a NEW +N — e.g. after a server-side refine —
  // must re-derive stats/HP).
  if (hero.equipped[slot] === templateId && refineOf(hero.equipped, slot) === refine) return;
  hero.equipped = { ...hero.equipped, [slot]: templateId, refine: { ...refineMap(hero), [slot]: refine } };
  reconcileMaxHp(hero);
}

// ---------------------------------------------------------------------------
// Drop rolls
// ---------------------------------------------------------------------------

/**
 * Roll a FARM drop for one killed enemy. Consumes exactly one loot-counter tick
 * (monotonic, whether or not anything drops). On a hit, pushes an `itemDrop`
 * event tagged with the stable per-save `rollId` (= the counter value used); the
 * server claim key is `${characterId}:${rollId}` (docs/persistence-m7.md).
 */
export function rollEnemyDrop(state: GameState, e: Enemy): void {
  const rollId = String(state.lootCounter);
  const r = lootFloat(state.lootSalt, state.lootCounter);
  state.lootCounter++;
  const table = dropTableForStage(state.stage);
  let acc = 0;
  for (const entry of table) {
    acc += entry.chance;
    if (r < acc) {
      state.events.push({
        type: "itemDrop",
        rollId,
        templateId: entry.templateId,
        x: e.x,
        y: e.y,
        mobId: e.id,
      });
      return;
    }
  }
  // r >= summed chance → no drop this kill.
}

/**
 * Roll a GUARANTEED boss drop (the boss milestone reward). The boss table is a
 * WEIGHTED pool — the hash is scaled into the total weight so exactly one item is
 * always minted (better tiers weighted heavier). Consumes one loot-counter tick.
 */
export function rollBossDrop(state: GameState, boss: Boss): void {
  const rollId = String(state.lootCounter);
  const r = lootFloat(state.lootSalt, state.lootCounter);
  state.lootCounter++;
  const table = bossDropTableForStage(state.stage);
  if (table.length === 0) return;
  const total = table.reduce((a, entry) => a + entry.chance, 0);
  const pick = clamp(r, 0, 0.999999) * total;
  let acc = 0;
  for (const entry of table) {
    acc += entry.chance;
    if (pick < acc) {
      state.events.push({
        type: "itemDrop",
        rollId,
        templateId: entry.templateId,
        x: boss.x,
        y: boss.y,
        mobId: boss.id,
      });
      return;
    }
  }
  // Numeric guard (float edge): fall back to the last entry so a boss ALWAYS drops.
  const last = table[table.length - 1];
  state.events.push({
    type: "itemDrop",
    rollId,
    templateId: last.templateId,
    x: boss.x,
    y: boss.y,
    mobId: boss.id,
  });
}
