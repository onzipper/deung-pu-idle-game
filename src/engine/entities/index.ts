/**
 * Entity type definitions (data only — behaviour lives in `systems/`).
 *
 * Ported to match what the POC actually tracks per entity: flat positions, HP,
 * attack cooldown timers, revive state, and (for projectiles) either a homing
 * target id or a fixed ground-target point. Factories live in `./factory`.
 */

import type { EquippedGear } from "@/engine/config/items";

/** Player hero classes (POC: sword / archer / mage). */
export type HeroClass = "swordsman" | "archer" | "mage";

/**
 * Base-stat axes (M5 "Base stats", 86d3jv7m3 — RO-flavoured but lean):
 *  - str: melee attack power (the swordsman's damage stat).
 *  - dex: ranged attack power (the archer's damage stat) + a small universal
 *    attack-SPEED factor (faster attacks for any class).
 *  - int: magic attack power (the mage's damage stat); the future mana pool
 *    (task 4) will also key off int — the hook is designed, not built.
 *  - vit: max HP (universal). A defense/mitigation factor is left as a future
 *    hook — the combat engine has no mitigation concept yet, so VIT is HP-only.
 *
 * A class's DAMAGE scales off its PRIMARY stat only (sword=str, archer=dex,
 * mage=int); an off-affinity damage stat (e.g. str on an archer) is inert. The
 * universal effects (dex→atk-speed, vit→HP) apply to every class.
 */
export type StatKey = "str" | "dex" | "int" | "vit";

/** A hero's allocated base-stat block (absolute values = class base + spent). */
export interface HeroStats {
  str: number;
  dex: number;
  int: number;
  vit: number;
}

/** Enemy kinds (POC: grunt / runner / tank / shooter). */
export type EnemyKind = "normal" | "fast" | "tank" | "ranged";

/** How a hero deals damage. */
export type AttackKind = "melee" | "arrow" | "aoe";

/** How an enemy engages. */
export type EnemyBehavior = "melee" | "ranged";

/**
 * Projectile flavours.
 *  - arrow / bolt: HOME on a live target id.
 *  - orb / meteor / rainArrow: POINT-target — fall/travel to a fixed (tx,ty) and
 *    resolve as an AoE there. `rainArrow` is one drop of the archer's ARROW RAIN
 *    skill (many small arrows falling from the sky over the enemy cluster); it
 *    reuses the meteor's falling-point mechanic but is a distinct kind so render
 *    can draw a small arrow instead of a meteor.
 */
export type ProjectileKind = "arrow" | "orb" | "meteor" | "bolt" | "rainArrow";

/** Which side fired a projectile / owns an entity. */
export type Team = "hero" | "enemy";

/**
 * A skill id (M5 "skill framework v2"). Keyed into the `SKILLS` catalog
 * (`engine/config`). Class-namespaced strings (e.g. `sword_whirl`), so a skill
 * unambiguously identifies its owning class.
 */
export type SkillId = string;

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * World zone kinds (M6 "World & Town"):
 *  - "town": the safe hub + respawn point (no spawns). NPC shops hook here later.
 *  - "farm": a stage's wave content, farmed to its kill quota to unlock the next.
 *  - "boss": the map's special BOSS ROOM (entering starts the boss encounter).
 */
export type ZoneKind = "town" | "farm" | "boss";

/**
 * A hero's world position: which map + which zone index within it (M6). Zone
 * content/kind is DERIVED from CONFIG.world (see systems/world.ts `zoneAt`), so
 * only the address is stored/persisted. Persisted (SAVE v8).
 */
export interface WorldLocation {
  mapId: string;
  zoneIdx: number;
}

/**
 * NPC-shop consumable ids (M6 "เมืองหลัก + NPC shops", ROADMAP task): bought with
 * gold in TOWN, non-tradable, held as engine-level STACKABLE COUNTS (see
 * `ConsumableCounts`).
 *
 * BOUNDARY NOTE (vs M7 gear): these are deliberately NOT DB `ItemInstance`s. M7's
 * item-instance model (unique id + ownerId + audit, server-authoritative) is for
 * TRADABLE GEAR only; NPC potions are fungible, non-tradable, and cheap, so they
 * live as plain counts in the save (SAVE v9) — no per-item identity to dupe. A
 * future warp/party-summon item (M8) can join this union without a schema change.
 */
export type ShopItemId = "hpPotion" | "manaPotion" | "returnScroll";

/** Held stack counts of each NPC consumable (M6, SAVE v9). Persisted. */
export interface ConsumableCounts {
  hpPotion: number;
  manaPotion: number;
  returnScroll: number;
}

/**
 * Idle-automation "bot" settings (M7.5 "Sell, Bots & Inventory UX"). Persisted
 * (SAVE v11), engine-owned (NOT a UI-mirrored transient like `autoReturn`): the
 * bot triggers are deterministic, engine-side, and their config round-trips
 * through the save so the automation survives a reload. See systems/bots.ts.
 *
 *  - `enabled`         : the POTION-RESTOCK bot (trip to town when potions dip
 *                        below target, buy up to targets, auto-return to farming).
 *  - `sellTripEnabled` : the SELL-trip bot (trip to town when the client-fed
 *                        inventory count hits `INVENTORY_CAP`; the client fires
 *                        the sell API off the `townArrived` event).
 *  - `hpPotionTarget` / `mpPotionTarget` : restock target stack counts.
 *  - `scrollReserve`   : the return-scroll restock target (also the bot's warp
 *                        fuel — any held scroll is spent to warp home, and the
 *                        trip tops the stock back up toward this reserve).
 *  - `goldReserve`     : a spending FLOOR — restock only ever spends gold ABOVE
 *                        this, so the bot never drains the player dry.
 */
export interface BotSettings {
  enabled: boolean;
  sellTripEnabled: boolean;
  hpPotionTarget: number;
  mpPotionTarget: number;
  scrollReserve: number;
  goldReserve: number;
}

/**
 * Quest framework v1 (M5 "เปลี่ยนคลาสผ่านเควส", ROADMAP task 5). Deliberately
 * LEAN — exactly what the class-change quest needs — but forward-compatible with
 * the full quest system in M8.
 *
 * EXTENSION POINTS (M8, documented not built): more objective types (`collect`,
 * `reach`, `talk`, …) join the `QuestObjectiveType` union; a quest gains rewards /
 * prerequisites / a chain id; a hero holds a LIST of active quests (a quest log)
 * rather than the single `Hero.quest` slot v1 uses. The `{id, objectives}` def +
 * `{id, accepted, progress[]}` instance split already anticipates all of that.
 */
export type QuestObjectiveType = "kill" | "killBoss";

/** One objective line of a quest def: reach `count` of the counted event `type`. */
export interface QuestObjective {
  type: QuestObjectiveType;
  count: number;
}

/** A static quest definition (catalog data — see systems/quests `classChangeQuestFor`). */
export interface QuestDef {
  id: string;
  objectives: QuestObjective[];
}

/**
 * A hero's active quest INSTANCE (v1: at most one, in `Hero.quest`). `progress`
 * is a per-objective counter parallel to the def's `objectives`. `accepted` gates
 * counting: an un-accepted (future "assigned but not taken") quest tracks nothing.
 * Persisted per hero (SAVE v7).
 */
export interface HeroQuest {
  id: string;
  accepted: boolean;
  progress: number[];
}

/**
 * A player-issued MANUAL command (M7.8 "Manual Play"), or null when the hero is on
 * AUTO. RO-style: the player taps the ground (`move` — walk to `x`, ignoring
 * huntable targets) or taps a monster (`attack` — close to range + fight
 * `targetId` until it dies / the command is cancelled or replaced). All commands
 * arrive as `FrameInput` intents (moveTo / attackTarget / cancelCommand) and paving
 * M8 lockstep. TRANSIENT — lives on the (never-persisted) live hero, cleared on any
 * zone arrival (world.reviveHeroesFull) and never written to `SaveData`.
 */
export type ManualCommand =
  | { kind: "move"; x: number }
  | { kind: "attack"; targetId: number };

export interface Hero {
  id: number;
  cls: HeroClass;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Attack cooldown timer, seconds until the next attack is allowed. */
  cd: number;
  dead: boolean;
  /** Seconds until revival while `dead`. */
  reviveTimer: number;
  /**
   * Per-SKILL cooldown timers (M5 "skill framework v2"), keyed by skill id;
   * seconds until that skill may be cast again. A missing/≤0 entry means ready.
   * Decayed by `combat.decayHeroTimers`. Transient runtime state (rebuilt on
   * load — cooldowns are not persisted).
   */
  skillCds: Record<SkillId, number>;
  /**
   * Current mana (M5 "mana + skill framework v2"). Spent by casting skills;
   * regenerated each step (`combat.decayHeroTimers`) toward `maxMana`. Persisted
   * per hero (cheap; a reasonable snapshot of caster resource state).
   */
  mana: number;
  /**
   * Max mana pool — derived from class base + INT allocation
   * (`stats.heroMaxManaOf`). Cached here (mirrors `maxHp`) and refreshed each
   * step / on INT allocation. Not persisted (re-derived on load).
   */
  maxMana: number;
  /**
   * Active self ATK buff multiplier (M5 war-cry style skills). 1 = no buff.
   * Applied to `heroAtkOf` while `atkBuffTimer > 0`. Transient (not persisted).
   */
  atkBuffMult: number;
  /** Remaining seconds on the ATK buff (0 = inactive). Transient. */
  atkBuffTimer: number;
  /**
   * Auto-cast slot assignments (M5): skill id in each slot, or null (empty).
   * Length is `CONFIG.autoSlots.max`; a slot only fires if its index is unlocked
   * by the hero's level (`unlockedAutoSlotCount`). Persisted per hero (player
   * loadout choice).
   */
  autoSlots: (SkillId | null)[];
  /**
   * Per-hero level (M5). Starts at 1, capped at `CONFIG.leveling.levelCap`. Grants
   * a small atk/hp bonus that compounds with the upgrade lines. Persisted per hero.
   */
  level: number;
  /** XP banked toward the NEXT level (resets on level-up by `xpToLevel(level)`). */
  xp: number;
  /**
   * Class-advancement tier (M5 "ปลดคลาส evolution"). 1 = base, 2 = evolved. A
   * PLAYER-TRIGGERED class change flips this to 2 once the hero COMPLETES its
   * class-change quest (M5 task 5 — the quest EFFORT replaced the old gold gate;
   * see systems/quests + systems/evolution). It grants a permanent atk/hp
   * multiplier that compounds with levels + stats. Persisted per hero. Single path
   * in M5.
   */
  tier: 1 | 2;
  /**
   * Active class-change quest instance (M5 task 5), or null. `null` while below the
   * level gate, once evolved (tier 2, quest consumed), OR when the quest is
   * OFFERED-but-not-yet-accepted (the offer is DERIVED — see
   * systems/quests `isClassChangeQuestOffered` — so a fresh offer needs no stored
   * object). Set to the accepted instance by the `acceptQuest` intent. Persisted. */
  quest: HeroQuest | null;
  /**
   * Unspent base-stat points (M5 "Base stats"). Each level-up grants
   * `CONFIG.stats.pointsPerLevel`; the player allocates them via the
   * `allocateStat` intent (or the auto-allocate toggle dumps them into the
   * class primary stat). Persisted per hero.
   */
  statPoints: number;
  /**
   * Allocated base-stat block (absolute values). Starts at the class base
   * (`CONFIG.stats.base[cls]`); allocation only ever raises a value. The
   * DAMAGE/HP/speed bonuses are computed from the amount ABOVE the class base
   * (so a fresh, unallocated hero sits exactly on its class baseline). Persisted.
   */
  stats: HeroStats;
  /**
   * Equipped gear loadout (M7): one weapon + one armor templateId, or null.
   * Stats (atk/def/hp) resolve through `ITEM_TEMPLATES` and apply while equipped
   * (systems/stats `equip*Of`, combat def mitigation). classReq is enforced at
   * the equip intent (a class-mismatch is rejected). Persisted per save (SAVE
   * v10) as a SIM CACHE — the DB item ledger is authoritative, boot payload wins.
   */
  equipped: EquippedGear;
  /**
   * Active MANUAL command (M7.8 "Manual Play"), or null when auto. Set by the
   * moveTo / attackTarget FrameInput intents (systems/manual), honoured by the
   * hunt movement/attack in systems/combat, and OVERRIDDEN by the boss phase's
   * forced combat (exactly like the AUTO-off toggle). Transient — NEVER persisted
   * (rebuilt null on load, cleared on any zone arrival).
   */
  command: ManualCommand | null;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  speed: number;
  size: number;
  behavior: EnemyBehavior;
  /** Attack range for ranged behaviour (0 for melee). */
  range: number;
  /** Attack cooldown timer. */
  cd: number;
  /** Per-enemy jitter so melee attackers don't stack on the exact same x. */
  engageOffset: number;
  /**
   * Wander anchor (M6 "สนามล่ามอน"): the spawn point a not-yet-engaged mob idly
   * drifts around (deterministic, no RNG). Transient (mobs are never persisted).
   */
  homeX: number;
  /**
   * Temperament (M6): AGGRESSIVE mobs engage when the hero enters `aggroRadius`;
   * PASSIVE mobs (`aggressive=false`, `aggroRadius=0`) never initiate and only
   * fight back once HIT (combat sets `engaged`). Set at spawn from the zone's
   * per-map aggro ramp (`world.maps[].hunt`). Transient.
   */
  aggressive: boolean;
  /** Aggro radius for an aggressive mob (0 for passive). Transient. */
  aggroRadius: number;
  /**
   * Latched once this mob is FIGHTING the hero (aggro-triggered, or retaliating
   * after a hit): it then approaches + attacks like the old march-model enemy.
   * Before that it idle-wanders. Transient.
   */
  engaged: boolean;
}

/**
 * Boss entity. Populated by `makeBoss` and driven by the boss system in Phase B;
 * kept here so `GameState` and the save/render layers already know its shape.
 */
export interface Boss {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  cd: number;
  skillCd: number;
  /** Slam wind-up timer; > 0 means a telegraphed AoE is incoming. */
  telegraph: number;
  enraged: boolean;
}

export interface Projectile {
  id: number;
  team: Team;
  kind: ProjectileKind;
  x: number;
  y: number;
  damage: number;
  speed: number;
  /** Homing target id (arrow/bolt); null for point-target projectiles. */
  targetId: number | null;
  /** Fixed ground-target point (orb/meteor); unused by homing kinds. */
  tx: number;
  ty: number;
  /** AoE radius (orb/meteor); 0 for single-target projectiles. */
  aoe: number;
}

/** Anything a hero attack / projectile can damage. */
export type CombatTarget = Enemy | Boss;

export * from "@/engine/entities/factory";
