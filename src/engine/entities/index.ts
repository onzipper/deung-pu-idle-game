/**
 * Entity type definitions (data only — behaviour lives in `systems/`).
 *
 * Ported to match what the POC actually tracks per entity: flat positions, HP,
 * attack cooldown timers, revive state, and (for projectiles) either a homing
 * target id or a fixed ground-target point. Factories live in `./factory`.
 */

import type { EquippedGear } from "@/engine/config/items";

/**
 * Player hero classes (POC: sword / archer / mage). The NINJA (นินจา, SAVE v18) is the
 * 4th line — a short-range dual-dagger melee bruiser (DEX-primary) with a `dash` reposition
 * primitive. Its tier chain: ninja → จอมนินจา (tier 2) → ราชันเงา (tier 3). Adding it is a
 * pure DOMAIN WIDENING of the union (no new save field), like the v15 tier-3 widening —
 * every `Record<HeroClass, …>` in the engine gains a ninja entry; existing classes are
 * byte-identical (they never read the ninja key). See docs/ninja-design.md.
 */
export type HeroClass = "swordsman" | "archer" | "mage" | "ninja";

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
 * The named town actors (M6 town NPCs, phase 2 — the engine owns their geometry
 * so the layer rule holds: render/ui DERIVE their rigs from `CONFIG.townNpcs`, engine
 * never imports render). `npc:pahpu` = ป้าปุ๊ the merchant (buy/sell/salvage — the ONLY
 * NPC the idle bot transacts with); `npc:lungdueng` = ลุงดึ๋ง the refine smith
 * (player-only; never botted); `npc:elder` = ผู้ใหญ่บ้าน the village head (M8 quest
 * Wave C — opens the Quest Board panel; player-only, never botted, same as the smith).
 * Anchor x + interaction radius live in `CONFIG.townNpcs`.
 */
export type TownNpcId = "npc:pahpu" | "npc:lungdueng" | "npc:elder";

/**
 * NPC-shop consumable ids (M6 "เมืองหลัก + NPC shops", ROADMAP task): bought with
 * gold in TOWN, non-tradable, held as engine-level STACKABLE COUNTS (see
 * `ConsumableCounts`).
 *
 * BOUNDARY NOTE (vs M7 gear): these are deliberately NOT DB `ItemInstance`s. M7's
 * item-instance model (unique id + ownerId + audit, server-authoritative) is for
 * TRADABLE GEAR only; NPC potions are fungible, non-tradable, and cheap, so they
 * live as plain counts in the save (SAVE v9) — no per-item identity to dupe. A
 * The M8 warp scroll ("วาปหาเพื่อน") joins this union (SAVE v17) exactly as designed.
 */
export type ShopItemId = "hpPotion" | "manaPotion" | "returnScroll" | "warpScroll";

/** Held stack counts of each NPC consumable (M6, SAVE v9; `warpScroll` SAVE v17). Persisted. */
export interface ConsumableCounts {
  hpPotion: number;
  manaPotion: number;
  returnScroll: number;
  /**
   * "วาปหาเพื่อน" warp scroll (M8, SAVE v17): consumed to fast-travel to ANY already-
   * unlocked, non-boss zone (a party "warp to a friend" fantasy — the social/party
   * validation is a UI/server concern; the engine only enforces zone legality). Reuses
   * the fast-travel channel (same cast time + death-cancel). NEVER used by the idle bot.
   */
  warpScroll: number;
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
export type QuestObjectiveType =
  | "kill"
  | "killBoss"
  // ---- M8 DAILY-quest objective types (Wave A) ----
  // Counted at the SAME deterministic emission choke points as kill/killBoss, but on
  // the per-hero `dailies` roster (below) instead of an evolution quest. Each is a
  // "presence" objective (design doc §2 — reward being AROUND, never optimal-play):
  //  - killAnywhere : any mob kill in any unlocked zone (combat resolve).
  //  - refineOnce   : a server-confirmed refine attempt (the `refined` FrameInput).
  //  - buyPotions   : hp/mana potions bought at the NPC (buyShopItem).
  //  - spendGold    : gold spent at the NPC (shop purchase + refine cost).
  //  - clearAnyBoss : any boss room cleared (onBossKilled).
  | "killAnywhere"
  | "refineOnce"
  | "buyPotions"
  | "spendGold"
  | "clearAnyBoss";

/** The subset of `QuestObjectiveType` a DAILY-quest template may use (M8, Wave A). */
export type DailyObjectiveType =
  | "killAnywhere"
  | "refineOnce"
  | "buyPotions"
  | "spendGold"
  | "clearAnyBoss";

/** One objective line of a quest def: reach `count` of the counted event `type`. */
export interface QuestObjective {
  type: QuestObjectiveType;
  count: number;
  /**
   * Optional MAP SCOPE (M7.9 tier-3 quest): when set, the objective only counts an
   * event that happens while the hero is in this map (`state.location.mapId`). The
   * tier-3 quest uses it to require kills in MAP3 + a REPEAT MAP2-boss defeat; the
   * tier-2 class-change quest leaves it unset (counts anywhere — unchanged behaviour).
   */
  mapId?: string;
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
 * One DAILY-quest instance on a hero's roster (M8 Wave A). The objective TYPE, TARGET
 * count and REWARD are NOT stored here — they resolve from the `CONFIG.dailyQuests`
 * catalog by `id` (so daily content scales with a config+i18n entry, never a logic/
 * SAVE change; design doc §5). Only the mutable per-hero counters persist:
 *  - `progress` : deterministic count toward the catalog target (capped at it).
 *  - `claimed`  : whether the reward has been granted (survives the save).
 */
export interface DailyQuest {
  id: string;
  progress: number;
  claimed: boolean;
}

/**
 * A hero's DAILY-quest block (M8 Wave A, SAVE v17). The roster of 3 is chosen SERVER-
 * side (seeded from serverDay + user material — the engine never computes calendar
 * time, keeping purity) and fed in via the `setDailies` intent; the engine only COUNTS
 * progress at the emission choke points + validates claims client-side (server re-
 * validates at claim). `serverDay` is an opaque integer day-epoch: when a `setDailies`
 * carries a NEW `serverDay` the roster resets (fresh progress/claims). Persisted per hero.
 */
export interface HeroDailies {
  serverDay: number;
  quests: DailyQuest[];
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

/**
 * Per-hero SIM-AFFECTING automation config (M8 party P1b). These toggles/thresholds
 * used to live as GLOBAL `GameState` fields mirrored from the UI store each frame —
 * fine for solo, but a desync trap in a SHARED cohort sim (client A enabling autoCast
 * for its own hero while client B doesn't → the field diverges; design doc §2). They
 * now live PER HERO so each cohort member's automation is part of the replicated
 * shared state, changed only via the `setHeroConfig` replicated intent.
 *
 * SOLO fast path (design §2 "one code path, no divergence"): the outer layers still
 * feed the store-mirrored GLOBALS (`state.autoCast` …); when the zone holds exactly
 * ONE hero, `step()` mirrors those globals onto `heroes[0].config` through the SAME
 * `applyHeroConfig` the intent uses — so a 1-hero run is byte-identical and there is a
 * single write path. In a cohort (≥2 heroes) the mirror is skipped and config comes
 * only from replicated `setHeroConfig` intents (canonical, no "local player" leak).
 *
 * TRANSIENT — NOT persisted (the globals it mirrors carry their own save fields where
 * they had them: `autoHunt` SAVE v12, the rest are UI-owned). Rebuilt on load; no
 * SAVE_VERSION bump. Navigation toggles (`autoReturn`/`autoAdvance`) deliberately stay
 * GLOBAL — zone travel is a cohort-level action (re-seed at the boundary, design §3),
 * not a per-hero combat decision, so they are not moved here.
 */
export interface HeroConfig {
  /** Auto-cast this hero's slotted skills (was global `state.autoCast`). */
  autoCast: boolean;
  /** Auto-allocate this hero's stat points to its class ratio (was `autoAllocate`). */
  autoAllocate: boolean;
  /** Auto-acquire new hunt targets (was `state.autoHunt`; combat-affecting per hero). */
  autoHunt: boolean;
  /** Auto-drink an hp potion below `autoHpThreshold` (was `state.autoHpPotion`). */
  autoHpPotion: boolean;
  /** Auto-drink a mana potion below `autoManaThreshold` (was `state.autoManaPotion`). */
  autoManaPotion: boolean;
  /** Auto hp-potion fires below this fraction of MAX HP (0..1). */
  autoHpThreshold: number;
  /** Auto mana-potion fires below this fraction of MAX MANA (0..1). */
  autoManaThreshold: number;
}

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
   *
   * M7.9 "Grand Expansion": a THIRD tier (3 = จอมอัศวิน/ราชันพราน/อาร์คเมจ) is added.
   * The tier-2 -> tier-3 change is gated by the tier-3 quest (kills in map3 + a repeat
   * map2-boss defeat) and grants a further multiplicative atk/hp spike (the s15-wall
   * breaker) + a 4th auto-cast slot + skill-4. `evolveHero` increments the tier.
   */
  tier: 1 | 2 | 3;
  /**
   * Active class-change quest instance (M5 task 5), or null. `null` while below the
   * level gate, once evolved (tier 2, quest consumed), OR when the quest is
   * OFFERED-but-not-yet-accepted (the offer is DERIVED — see
   * systems/quests `isClassChangeQuestOffered` — so a fresh offer needs no stored
   * object). Set to the accepted instance by the `acceptQuest` intent. Persisted. */
  quest: HeroQuest | null;
  /**
   * MAIN-quest chapters whose reward has been CLAIMED (M8 Wave A, SAVE v17) — chapter
   * ids from `CONFIG.mainQuest.chapters`. The main line itself is DERIVED (a chapter is
   * "complete" purely from progression — `systems/mainQuest`), so this is the ONLY main-
   * quest state that persists: it guards against double-claiming the reward across the
   * server's migrate-on-every-save. The v16→v17 migration prefills this with every
   * ALREADY-COMPLETED chapter (mark-done, NO backpay — mirrors v16 `goldEarned=0`), so an
   * existing deep character starts claiming from its NEXT chapter only. Persisted per hero.
   */
  mainClaimed: string[];
  /**
   * DAILY-quest roster + progress (M8 Wave A, SAVE v17) — see `HeroDailies`. Empty
   * `{serverDay:0, quests:[]}` until the server feeds a roster via `setDailies`; all
   * new-path mutations are inert until then (so the balance sim, which never sets
   * dailies, is byte-identical). Persisted per hero.
   */
  dailies: HeroDailies;
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
  /**
   * Per-hero automation config (M8 party P1b) — see `HeroConfig`. In solo it is
   * mirrored from the store-fed GLOBALS each step (`step()` → `syncPrimaryHeroConfig`);
   * in a cohort it is set by the replicated `setHeroConfig` intent. TRANSIENT (never
   * persisted — no SAVE bump; rebuilt from the globals/intents on load).
   */
  config: HeroConfig;
  /**
   * SHADOW-BODY flag (M8 party P2 — "ร่างเงา", design §9). `true` while this hero's
   * owning player is DISCONNECTED past grace / was offline when the cohort formed: the
   * hero keeps fighting via the SAME autonomous systems (auto-hunt / auto-cast / auto-
   * potion) on its FROZEN `config`, but MANUAL intents on its lane are ignored
   * deterministically (`step()` neutralizes a shadowed lane — defense against a stale/
   * haunted client injecting inputs). Flipped ONLY by the replicated `setShadowed`
   * intent, which the ROOM (relay) synthesizes on the slot's lane when the owner drops
   * (→ true) and again on reconnect (→ false); every client applies it identically, so
   * the flag is part of the shared sim (it IS in `stateHash`). SOLO-GUARDED: a 1-hero
   * zone can never be shadowed (the intent no-ops at `heroes.length === 1`).
   *
   * TRANSIENT — NOT persisted (no SAVE bump; rebuilt `false` on load). Income needs NO
   * special handling: each player persists their OWN hero from their OWN client, so an
   * offline owner's earnings remain their normal offline-idle pool on return; the shadow
   * exists socially/visually in the cohort, its on-field gold/xp is the peers' co-op
   * credit, never cross-credited back to the absent owner.
   */
  shadowed: boolean;
  /**
   * This step's COMBAT AIM — the world-x of whatever the hero is engaging this
   * step (the basic-attack / hunt target, a manual attack-command target, the
   * boss, or a skill's primary target/centroid), or `null` when the hero is not
   * fighting (idle / merely walking to a move order / in town / traveling).
   *
   * OBSERVER STATE for `render/` only: it drives the rig FACING so a kiting
   * ranged hero faces (and fires at) its target while retreating the other way,
   * instead of flipping to its velocity direction (the "spin when surrounded" +
   * "shoots backwards" bugs). The sim never reads it — zero effect on
   * combat/movement, so enabling it is byte-identical for balance.
   *
   * Fully TRANSIENT, like `command`: reset to `null` every `step()` and
   * re-derived deterministically (pure state read, NO RNG) by the combat/skill
   * pass. NOT persisted (no SAVE bump), rebuilt `null` on load. When a target
   * dies/vanishes and nothing replaces it, this goes `null` and the renderer
   * HOLDS the last facing (the documented reason the view keeps no live target
   * ref) rather than snapping to velocity.
   */
  aimX: number | null;
  /**
   * DASH-EVADE runtime (NINJA FEEL RETUNE 2026-07-08) — three per-hero TRANSIENT counters that
   * drive the auto dash-evade (systems/combat `tryNinjaEvade`, only for a `dashEvade` class):
   *   - `evadeCd`     : seconds until the next auto-evade is allowed (a fixed cooldown so the
   *                     ninja never dash-spams). Ticks down by fixed dt; set on each evade.
   *   - `evadeHpMark` : hp SNAPSHOT at the start of the current damage-sampling window — the
   *                     baseline the "hp lost in the last window" burst-trigger compares against.
   *   - `evadeMarkCd` : seconds until the next `evadeHpMark` snapshot (the window length).
   *
   * TRANSIENT — NOT persisted (no SAVE bump; rebuilt on load) and DELIBERATELY EXCLUDED from
   * `stateHash` (like `aimX`): they are a PURE deterministic function of already-hashed shared
   * state (hp / enemy positions / fixed dt), so they evolve identically on every lockstep client,
   * and the observable they steer — `hero.x` — IS hashed, so any real divergence is still caught.
   * For a non-`dashEvade` class they stay at their init values forever (never read/written), which
   * is why sword/archer/mage movement + the canonical stateHash are byte-identical.
   */
  evadeCd: number;
  evadeHpMark: number;
  evadeMarkCd: number;
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
 * A boss signature-mechanic tag (M7.9 "Grand Expansion" behavior wave). Every
 * boss carries the base `slam`+`enrage` kit; maps 4-6 LAYER one extra mechanic:
 * `charge` (map4 s20), `summon` (map5 s25), `hazard` (map6 s30). Bosses s5/s10/s15
 * carry only `slam`+`enrage`, so `systems/boss.updateBoss`'s classic path is
 * byte-identical for them. Drives the config `bossVariety` table + `bossBehavior`.
 */
export type BossBehavior = "slam" | "enrage" | "charge" | "summon" | "hazard";

/**
 * Per-boss signature-mechanic RUNTIME state (M7.9). Fully TRANSIENT — the boss is
 * never persisted (rebuilt each fight by `makeBoss`, nulled between fights), so
 * these fields carry NO save-shape implication. Deterministic: no field is driven
 * by the RNG stream (fixed timing/threshold tables in `CONFIG.bossBehavior`).
 * OPTIONAL on `Boss` (below) so pre-M7.9 boss literals in the outer layers (e.g.
 * the render rig test) stay valid; the engine's live boss always populates it.
 */
export interface BossVarietyState {
  /** The mechanics this boss runs (snapshot of `CONFIG.bossVariety[stage]`). */
  behaviors: BossBehavior[];
  // ---- CHARGE (map4 s20): telegraphed dash at the hero, then a heavy hit ----
  /** Seconds until the next charge may launch (from the idle phase). */
  chargeCd: number;
  chargePhase: "idle" | "windup" | "dash";
  /** Wind-up countdown while `chargePhase === "windup"`. */
  chargeTimer: number;
  /** Locked dash destination x (set at telegraph time — a fair, dodgeable read). */
  chargeTargetX: number;
  // ---- SUMMON (map5 s25): fixed add waves at descending HP thresholds ----
  /** How many summon waves have already fired (index into the threshold table). */
  summonsFired: number;
  // ---- FIELD HAZARD (map6 s30): telegraphed arena-wide danger windows ----
  /** Seconds until the next hazard channel (from the idle phase). */
  hazardCd: number;
  hazardPhase: "idle" | "warn" | "strike";
  /** Countdown for the current warn / strike window. */
  hazardTimer: number;
  /** Countdown to the next damage tick during the strike window. */
  hazardTickTimer: number;
  /** Remaining damage ticks in the current strike window. */
  hazardTicksLeft: number;
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
  /**
   * M7.9 signature-mechanic state (charge/summon/hazard for maps 4-6). Always set
   * by `makeBoss`; OPTIONAL on the type only so pre-M7.9 boss literals in the
   * outer layers remain valid. Transient (the boss is never persisted).
   */
  variety?: BossVarietyState;
}

/**
 * WORLD BOSS "เสี่ยจ๋อง" runtime state (hourly world boss — engine wave). Fully
 * TRANSIENT: never persisted (toSaveData/SaveData untouched, no SAVE bump), rebuilt
 * null on load. Spawned by the `spawnWorldBoss` FrameInput intent (the client computes
 * the wall-clock schedule; the engine never reads a clock), it lives alongside the
 * normal farm field during the BATTLE phase and reuses the enemy pipeline (targeting/
 * hits) + the M7.9 boss-mechanic machinery. Sim-affecting → it IS in `stateHash`.
 *
 *  - `windowId`  : the hour-window this boss belongs to (`worldBossWindowId`). Once a
 *    windowId has been spawned/handled this session the record persists (entity nulled
 *    on despawn/defeat) so a re-injected `spawnWorldBoss` for the SAME window is a no-op
 *    (idempotent — a cohort's several members may all inject it; first-wins).
 *  - `mapId`/`zoneIdx` : the farm zone it spawned in — leaving that zone despawns it.
 *  - `active`    : the entity is present + alive (drives getTargets/findById inclusion).
 *  - `defeated`  : set once it dies (emits `worldBossDefeated`; blocks respawn same window).
 *  - `countdown` : seconds until the lifetime despawn (seeded from the intent's
 *    `remainingSeconds`, decremented per FIXED_DT battle step).
 *  - `entity`    : the Boss entity (null when inactive) — a Boss with `variety` mechanics.
 */
export interface WorldBossState {
  windowId: number;
  mapId: string;
  zoneIdx: number;
  active: boolean;
  defeated: boolean;
  countdown: number;
  entity: Boss | null;
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
