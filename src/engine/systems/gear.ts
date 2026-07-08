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

import { CONFIG } from "@/engine/config";
import {
  DROP_GATED_CLASSES,
  ITEM_TEMPLATES,
  bossDropTableForStage,
  dropTableForStage,
  refineOf,
  type GearSlot,
} from "@/engine/config/items";
import { clampRefine } from "@/engine/config/refine";
import { lootFloat, stoneFloat } from "@/engine/core/hash";
import { clamp } from "@/engine/core/math";
import { heroMaxHpOf } from "@/engine/systems/stats";
import type { Hero, HeroClass, Enemy, Boss } from "@/engine/entities";
import type { GameState } from "@/engine/state";

/**
 * The drop-gated class (if any) present in this state's hero roster — the value the
 * roll sites pass into `dropTableForStage`/`bossDropTableForStage` so gated lines
 * (ninja daggers) enter the candidate pool. Semantics: ANY roster member of a gated
 * class admits that class's line into the SHARED table — in a cohort the rotating
 * drop assignment may then hand one to a non-matching member (sellable, exactly like
 * the historical cross-class weapon drops). Solo non-gated rosters return undefined
 * → the table stays byte-identical to the pre-ninja catalog. Deterministic: reads
 * only `state.heroes` order, which is lockstep state. First match wins (the set has
 * one member today; revisit if a second gated class ever lands).
 */
function gatedLootClass(state: GameState): HeroClass | undefined {
  for (const h of state.heroes) if (DROP_GATED_CLASSES.has(h.cls)) return h.cls;
  return undefined;
}

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
 * Which of the world's ordered maps a content `stage` sits in (1-based): map1 =
 * s1-5, map2 = s6-10, … map6 = s26-30. Clamped to the real map count so an
 * out-of-band stage never over-scales. Drives the stone drop's depth scaling.
 */
function mapTierForStage(stage: number): number {
  const maps = CONFIG.world.maps.length;
  return Math.max(1, Math.min(maps, Math.ceil(stage / 5)));
}

/**
 * "หินเสริมพลัง" ENHANCEMENT-STONE roll for one kill (M7.6 follow-up). INDEPENDENT of
 * the gear roll: it hashes the stone stream (core/hash.stoneFloat) off the SAME
 * `(lootSalt, lootCounter)` the caller is about to consume for its gear roll —
 * WITHOUT touching the counter here (the caller owns the single tick), so the
 * gear-drop sequence stays byte-identical. `rollId` is that shared counter value;
 * the server claim key is `${characterId}:stone:${rollId}` (namespaced apart from
 * gear's `${characterId}:${rollId}`) so materials credit idempotently. A boss kill
 * (`isBoss`) grants a GUARANTEED scaled bonus; a normal kill drops on a depth-scaled
 * chance. Whole stones only. Deterministic (hashed, no RNG draw).
 */
function rollStoneDrop(
  state: GameState,
  x: number,
  y: number,
  mobId: number,
  rollId: string,
  isBoss: boolean,
  elite: boolean,
  qtyMult: number,
): void {
  const cfg = CONFIG.stoneDrops;
  const tier = mapTierForStage(state.stage);
  if (isBoss) {
    const qty = cfg.bossBonusBase + (tier - 1) * cfg.bossBonusPerMapTier;
    if (qty > 0) {
      state.events.push({ type: "stoneDrop", rollId, qty, x, y, mobId });
    }
    return;
  }
  // ONE stoneDrop event per kill (the server claim key `…:stone:${rollId}` is per-kill idempotent),
  // so an ELITE's guaranteed burst + the normal chance roll are COMBINED into a single qty. The
  // stone stream is STILL consumed identically per counter (elite or not), so the sequence for a
  // given (salt, counter) is unchanged; `qtyMult` (the ดินแดนอสูร hot-zone bonus, 1 elsewhere)
  // scales the qty. All asura-only inputs are inert for s1-30 → byte-identical there.
  let qty = 0;
  if (elite) qty += Math.round(CONFIG.asura.elite.stoneBonus * qtyMult);
  const chance = cfg.baseChance + (tier - 1) * cfg.chancePerMapTier;
  if (stoneFloat(state.lootSalt, state.lootCounter) < chance) {
    qty += Math.round((cfg.qtyBase + (tier - 1) * cfg.qtyPerMapTier) * qtyMult);
  }
  if (qty > 0) state.events.push({ type: "stoneDrop", rollId, qty, x, y, mobId });
}

/**
 * Roll a FARM drop for one killed enemy. Consumes exactly one loot-counter tick
 * (monotonic, whether or not anything drops). On a hit, pushes an `itemDrop`
 * event tagged with the stable per-save `rollId` (= the counter value used); the
 * server claim key is `${characterId}:${rollId}` (docs/persistence-m7.md).
 *
 * Also rolls an INDEPENDENT enhancement-stone drop (rollStoneDrop) off the same
 * `rollId` — sharing this kill's single counter tick, so the gear sequence is
 * unchanged (the stone stream is a separate domain-tagged hash).
 */
export function rollEnemyDrop(
  state: GameState,
  e: Enemy,
  opts?: { stoneQtyMult?: number },
): void {
  const rollId = String(state.lootCounter);
  rollStoneDrop(state, e.x, e.y, e.id, rollId, false, e.elite === true, opts?.stoneQtyMult ?? 1);
  const r = lootFloat(state.lootSalt, state.lootCounter);
  state.lootCounter++;
  const table = dropTableForStage(state.stage, gatedLootClass(state));
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
  rollStoneDrop(state, boss.x, boss.y, boss.id, rollId, true, false, 1);
  const r = lootFloat(state.lootSalt, state.lootCounter);
  state.lootCounter++;
  const table = bossDropTableForStage(state.stage, gatedLootClass(state));
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
