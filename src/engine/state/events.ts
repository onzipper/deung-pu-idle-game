/**
 * Per-step EVENT BUFFER — the engine's one-way "what just happened" channel.
 *
 * `GameState.events` is filled during a `step()` (cleared at the very start of
 * each step) and drained by render/audio AFTER the step to drive transient juice
 * (damage numbers, hit flashes, screenshake, SFX, kill pops). It is:
 *
 *  - TRANSIENT: never persisted (`toSaveData` picks only progress/economy),
 *  - ONE-WAY: engine systems never READ it (events flow engine -> outside only),
 *  - DETERMINISTIC: same `(state, dt, input, seed)` produces the same event
 *    stream, so it is safe to leave inside the byte-compared state in tests.
 *
 * Payloads are intentionally tiny (ids, positions, amounts) so pushing one is a
 * single plain-object allocation per game moment.
 */

import type {
  EnemyKind,
  HeroClass,
  ProjectileKind,
  ShopItemId,
  StatKey,
  ZoneKind,
} from "@/engine/entities";

/** Which side of the board a damaged target belongs to. */
export type HitTargetKind = "hero" | "enemy" | "boss";

/** What dealt a hit — lets render pick a flavour (weapon vs spell vs slam). */
export type HitSource = "attack" | "skill" | "slam" | "bolt";

/**
 * Discriminated union of everything a frame's render/audio layer may want to
 * react to. Discriminant is `type`. Positions are engine (logical) coordinates.
 */
export type GameEvent =
  | {
      type: "hit";
      /** Which board side the victim is on. */
      target: HitTargetKind;
      /** Victim entity id. */
      id: number;
      x: number;
      y: number;
      /** Damage dealt this hit (post-rounding). */
      amount: number;
      source: HitSource;
    }
  | { type: "kill"; kind: EnemyKind; x: number; y: number; goldGained: number }
  | { type: "heroDown"; id: number; cls: HeroClass; x: number; y: number }
  | { type: "heroRevived"; id: number; cls: HeroClass; x: number; y: number }
  | { type: "levelUp"; id: number; cls: HeroClass; level: number }
  | { type: "evolve"; id: number; cls: HeroClass; tier: number }
  | { type: "statAllocated"; id: number; stat: StatKey; amount: number }
  | { type: "skillCast"; heroClass: HeroClass; slot: number; skillId: string }
  | { type: "projectileSpawn"; kind: ProjectileKind; x: number; y: number }
  | { type: "bossSlamTelegraph"; x: number; y: number }
  | { type: "bossSlamLand"; x: number; y: number }
  | { type: "bossEnraged"; x: number; y: number }
  | { type: "bossDefeated"; x: number; y: number; goldGained: number }
  | { type: "bossRetreat"; x: number; y: number }
  // M7.9 "Grand Expansion" boss-variety mechanics (maps 4-6). Render wiring is a
  // FOLLOW-UP: an as-yet-unhandled kind falls to the FxController/audio switch
  // DEFAULT (a no-op) + partial `SFX_PARAMS` maps, so these degrade gracefully (no
  // crash). Payloads are minimal + positional; deterministic (no RNG draw).
  //  - bossChargeTelegraph: map4 boss winds up a dash; `targetX` = the locked rush x.
  //  - bossChargeHit: the dash lands at `x`; `connected` = it caught a hero.
  //  - bossSummon: map5 boss spawned `count` adds (normal Enemy entities) near `x`.
  //  - bossHazardWarn: map6 boss telegraphs an arena-wide danger window (`x` = boss).
  //  - bossHazardStrike: one arena-wide hazard damage tick fired (`x` = boss).
  | { type: "bossChargeTelegraph"; x: number; targetX: number }
  | { type: "bossChargeHit"; x: number; connected: boolean }
  | { type: "bossSummon"; x: number; count: number }
  | { type: "bossHazardWarn"; x: number }
  | { type: "bossHazardStrike"; x: number }
  // A mob AGGROED onto the hero (M6 "สนามล่ามอน"): an aggressive mob's aggro radius
  // triggered, so it starts hunting the hero. One-way (render may hook a growl/alert
  // beat). Replaces the retired march-model `waveSpawn` (there are no waves now).
  | { type: "mobAggroed"; id: number; kind: EnemyKind; x: number; y: number }
  | { type: "stageCleared"; stage: number }
  | { type: "stageAdvanced"; stage: number }
  // Class-change quest lifecycle (M5 task 5 — for UI + future juice). All carry
  // the solo hero id + the quest id; progress fires ONLY on a real increment.
  | { type: "questAccepted"; id: number; questId: string }
  | {
      type: "questObjectiveProgress";
      id: number;
      questId: string;
      /** Which objective advanced (index into the quest def's objectives). */
      objectiveIndex: number;
      /** New progress count for that objective (post-increment). */
      progress: number;
      /** The objective's target count (for a "n/N" readout). */
      count: number;
    }
  | { type: "questCompleted"; id: number; questId: string }
  // World navigation lifecycle (M6 "World & Town" — for UI + future render juice).
  // One-way like every event; the engine never reads them back.
  | { type: "zoneEntered"; mapId: string; zoneIdx: number; kind: ZoneKind; stage: number }
  | { type: "zoneUnlocked"; mapId: string; zoneIdx: number }
  | { type: "mapUnlocked"; mapId: string }
  | { type: "bossRoomEntered"; mapId: string; stage: number }
  // Frontier reached (M6): the last map's boss room was cleared and there is no
  // further map yet (map4 doesn't exist). Signals the graceful "สุดเขตแดนตอนนี้"
  // end-state instead of a stall/crash. One-way (UI reads it for a banner).
  | { type: "frontierCleared"; mapId: string }
  // NPC shop / consumables lifecycle (M6 "เมืองหลัก" — for UI + future render juice).
  // `shopPurchase`: a town buy went through (post-clamp qty + total gold cost).
  // `consumableUsed`: a potion was used (type-keyed by item). `townReturned`: a
  // return scroll teleported the hero to town (render may hook a warp fx later).
  | { type: "shopPurchase"; item: ShopItemId; qty: number; cost: number }
  | { type: "consumableUsed"; item: ShopItemId }
  | { type: "townReturned"; mapId: string }
  // Idle-bot town trip completed (M7.5): the potion-restock and/or sell-trip bot
  // arrived in town. `reason` reports which chores this visit performs — the CLIENT
  // fires the sell/salvage sweep when `reason` involves selling ("sell" /
  // "restockSell"). Restock buying is fully engine-side (done before this fires).
  // `sellTriggered` distinguishes a GENUINE full-bag sell trigger (true) from an
  // OPPORTUNISTIC sweep tacked onto another trip (false, e.g. a potions-only trip
  // that clears the bag too) — the client only shows the "nothing to dispose" notice
  // when true, since a tidy-bag potions run giving up is normal, not a stuck bot.
  | { type: "townArrived"; reason: "restock" | "sell" | "restockSell"; sellTriggered: boolean }
  // Fast travel lifecycle (M7.5): a short damage-cancellable channel to any
  // UNLOCKED zone, then an instant FREE hop arriving at the zone's gate-side x.
  // Positions are included so render can place the warp-portal fx. `fastTravelBlocked`
  // fires (with a reason) when the intent is rejected — locked zone / aggro / dead /
  // already there / mid-transit / boss phase / invalid target, or a mid-cast cancel.
  | { type: "fastTravelCastStart"; x: number; y: number; mapId: string; zoneIdx: number }
  | { type: "fastTravelArrive"; x: number; y: number; mapId: string; zoneIdx: number }
  | {
      type: "fastTravelBlocked";
      reason: "locked" | "aggro" | "dead" | "same" | "traveling" | "boss" | "invalid" | "damaged";
    }
  // Zone-gate transit polish (M7.5): a walk between adjacent zones passes THROUGH a
  // themed archway — the hero enters the departure-edge gate (`zoneGateEnter`) and
  // emerges from the arrival-edge gate (`zoneGateExit`). `side` is which edge of the
  // zone the gate sits on; `x` is its position. Render places the archway prop +
  // whoosh; the props/fx themselves are the render zone, not the engine's.
  | { type: "zoneGateEnter"; x: number; side: "left" | "right" }
  | { type: "zoneGateExit"; x: number; side: "left" | "right" }
  // M7 gear DROP (systems/gear): a kill rolled an item. `rollId` is the stable,
  // per-save monotonic loot-counter value used for this roll (the server claim
  // key is `${characterId}:${rollId}`, docs/persistence-m7.md); `templateId` is a
  // key into `ITEM_TEMPLATES`; `mobId` is the enemy/boss that dropped it. One-way
  // (render pops a pickup; the ui queues a server claim). Deterministic (hashed,
  // no RNG draw — the seeded stream stays wave-composition only).
  | {
      type: "itemDrop";
      rollId: string;
      templateId: string;
      x: number;
      y: number;
      mobId: number;
    }
  // Manual play (M7.8 "Manual Play"): the player issued a tap command. One-way like
  // every event — the engine NEVER reads these back (the command state lives on the
  // hero); render adds consumers (a ground click-marker at `moveOrdered.x`, a lock
  // ring on `targetLocked.id`, a fade on `commandCancelled`). `moveOrdered.x` is the
  // CLAMPED walkable x actually commanded.
  | { type: "moveOrdered"; x: number }
  | { type: "targetLocked"; id: number }
  | { type: "commandCancelled" };
