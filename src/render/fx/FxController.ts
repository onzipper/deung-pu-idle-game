/**
 * The M4 juice orchestrator — the fx container's single owner.
 *
 * One-way, read-only consumer of the engine's per-frame `GameEvent[]` buffer
 * (see `engine/state/events.ts`): `consumeEvents()` reacts to what just
 * happened, `update(dt)` advances every effect by REAL elapsed seconds (never
 * tied to sub-step count, so 3x game speed never speeds up the juice itself).
 * All fx state (particles, numbers, rings, shake, flash) lives HERE, never in
 * `GameState` — the engine never knows this module exists.
 *
 * Persistent/continuous visuals (boss enrage tint, telegraph ring closing in)
 * are intentionally left to the per-entity views (`bossView.ts` etc.), which
 * already read `GameState` directly each frame — only EDGE-TRIGGERED,
 * transient juice (numbers, flashes, pops, shake) is driven from events here.
 */

import { Container as PixiContainer } from "pixi.js";
import type { Container } from "pixi.js";
import { CONFIG, ENEMY_TYPES, SKILL_TYPES } from "@/engine/config";
import { ITEM_TEMPLATES, type ItemRarity } from "@/engine/config/items";
import type { Hero, Projectile } from "@/engine/entities";
import type { GameEvent, GameState, HitTargetKind } from "@/engine/state";
import { GROUND_Y, WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";
import { ENEMY_COLORS, HERO_COLORS, PALETTE, PROJECTILE_COLORS } from "@/render/theme";
import { ArenaFlash } from "@/render/fx/arenaFlash";
import { ArmorShardPool } from "@/render/fx/armorShard";
import { BossEcho } from "@/render/fx/bossEcho";
import { CameraPunch } from "@/render/fx/cameraPunch";
import { CastAuraController } from "@/render/fx/castAura";
import { CorpseEchoPool } from "@/render/fx/corpseEcho";
import { CrescentPool } from "@/render/fx/crescent";
import { FlashLinePool } from "@/render/fx/flashLines";
import { FloatingTextPool } from "@/render/fx/floatingText";
import { GearAuraController } from "@/render/fx/gearAura";
import { GearSparklePool } from "@/render/fx/gearSparkle";
import { GhostBladePool } from "@/render/fx/ghostBlade";
import { HitFlashController } from "@/render/fx/hitFlash";
import { ImpactFilterController } from "@/render/fx/impactFilters";
import { LevelUpBurstPool } from "@/render/fx/levelUp";
import { LightPillarPool } from "@/render/fx/lightPillar";
import { MeteorSkyFlash, ScorchPool } from "@/render/fx/meteorScene";
import { burst, burstDirectional, burstInward, ParticlePool, shower } from "@/render/fx/particles";
import { PortalPool } from "@/render/fx/portal";
import { GroundArrowPool, RainShadowPool } from "@/render/fx/rainScene";
import { RingPool } from "@/render/fx/rings";
import { RuneGlyphPool } from "@/render/fx/runeGlyph";
import { ScreenShake } from "@/render/fx/screenShake";
import { SoulWispPool } from "@/render/fx/soulWisp";
import { TracerPool, type TracerStyle } from "@/render/fx/tracer";
import { TravelPortalController } from "@/render/fx/travelPortal";
import { WeaponTrailController, type WeaponTrailFrame } from "@/render/fx/weaponTrail";
import { gateX, isBossZoneIdx } from "@/render/environment/zoneGates";
import {
  getArmorAnchorPos,
  getSwordTipPos,
  getWeaponAnchorPos,
  isCastHolding,
  isSwordSwinging,
  peekSwordSwing,
  type HeroView,
} from "@/render/views/heroView";

/** Looks up the live Pixi view for an entity id, if one currently exists. */
export type EntityViewLookup = (target: HitTargetKind, id: number) => Container | null;

/** Looks up the live, concretely-typed `HeroView` for a hero id (needed by
 * `weaponTrail.ts`'s rig hooks, which `EntityViewLookup`'s generic `Container`
 * return type can't express). */
export type HeroViewLookup = (id: number) => HeroView | null;

/** Cap on concurrently visible damage numbers (spec: ~40, drop-oldest). */
const DAMAGE_NUMBER_CAP = 40;
/** Cap on the smaller "event text" pool (kill/boss gold, separate bucket so a
 * kill-gold burst never evicts an in-flight damage number or vice versa). */
const EVENT_TEXT_CAP = 16;

// Views ignore each entity's raw `y` field and derive screen position from
// GROUND_Y + fixed per-kind offsets instead (see heroView/enemyView/bossView);
// these mirror that so fx placement lines up with what's actually on screen.
const HERO_TOP_Y = GROUND_Y - 70; // just above the hero's head / HP bar
const HERO_MID_Y = GROUND_Y - 30; // rough body-center, for cast bursts/rings
const BOSS_CY = GROUND_Y - 30; // matches bossView's CY

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// HERO SIGNATURE PASS (86d3k2q8f) knobs — centralized per class below. All
// durations/magnitudes here are render-only; nothing here feeds back into
// `GameState`.
// ---------------------------------------------------------------------------

// ---- swordsman: slash crescent (item 2) ------------------------------------
/** Local sweep-center angle (radians) per combo index — must mirror
 * `heroView.ts`'s combo semantics (0=up-slash, 1=down-slash, 2=thrust). */
const SWING_CRESCENT_ANGLE: readonly number[] = [-0.9, 0.9, 0];
const SWING_CRESCENT_SWEEP: readonly number[] = [1.15, 1.15, 0.5];

// ---- swordsman: melee impact spark + knockback jitter (item 3) ------------
const MELEE_SPARK_COUNT_STEEL = 5;
const MELEE_SPARK_COUNT_GOLD = 3;
const KNOCKBACK_DURATION = 0.12; // real seconds
const KNOCKBACK_MAG = 2.6; // px — spec: "2-3px"
/** A handful of concurrent knockback nudges is plenty (only the swordsman's
 * ~0.5s-cd basic attack drives these). */
const MAX_KNOCKBACK = 6;

// ---- archer: ARROW RAIN skill scene (86d3k2t18) ----------------------------
// Replaces the old "triple shot" cast fx (3 fan flash-lines toward the
// nearest targets + a brighter-tracer window on new `arrow` tracks) now that
// the skill is a field-wide AoE rain of 9 `rainArrow` drops instead — see
// `onArcherRainCast()`/`updateRainArrowTracking()` below.
/** A few upward light streaks off the bow at cast time ("volley launch" cue,
 * before the rain telegraphs its landing zone below) — kept to a handful,
 * short-lived, reusing the generic `FlashLinePool`. */
const RAIN_LAUNCH_STREAK_COUNT = 4;
const RAIN_LAUNCH_STREAK_HEIGHT = 30;
const RAIN_LAUNCH_STREAK_SPREAD = 10;
/** Clutter guard: at most this many drops are tracked for the falling-shadow
 * + landing sequence at once — 9 drops per cast + a little slack for 3x-speed
 * volley overlap; extra drops beyond the cap are silently skipped (the
 * pools underneath also cap+drop on their own, this just avoids growing an
 * unbounded tracking array). */
const MAX_PENDING_RAIN_ARROWS = 12;
/** Dirt + a few archer-tinted feather motes on landing (small, NOT the boss-
 * slam-sized impact burst — this is a hail of small arrows, not a nuke). */
const RAIN_LAND_DIRT_COUNT = 4;
const RAIN_LAND_FEATHER_COUNT = 3;

// ---- mage: meteor scene (item 11) ------------------------------------------
/** At most 1-2 meteors are ever realistically in flight at once (12s skill
 * cooldown, <1s flight) — capped small regardless. */
const MAX_PENDING_METEORS = 2;
const METEOR_RUNE_RADIUS = 46;
const METEOR_RUNE_TICKS = 10;

/** Estimate the mage meteor's real-seconds fall time from its own config
 * (spawn height to impact height, at its skill projectile speed) rather than
 * hand-picking a duration — stays correct if balance retunes those numbers. */
function estimateMeteorFallTime(): number {
  const dropDist =
    CONFIG.layout.groundY - CONFIG.layout.heroProjImpactYOffset - CONFIG.skills.meteorSpawnY;
  return Math.max(0.2, dropDist / Math.max(1, SKILL_TYPES.mage.projSpeed));
}

// ---------------------------------------------------------------------------
// DEATH & SPAWN DRAMA (86d3k2qjk) knobs — centralized per beat below. Engine
// untouched; every one of these is render-only, driven by `state`/events the
// engine already exposes (see the event-wiring table in the module doc
// comment above each handler).
// ---------------------------------------------------------------------------

// ---- enemy death v2: kind-colored dissolve burst + soul wisp + tank shards -
/** Bigger, slower-drifting than the existing gold kill-pop above it. */
const DEATH_DISSOLVE_COUNT = 14;
const DEATH_DISSOLVE_SPEED = 55;
const DEATH_DISSOLVE_LIFE = 0.6;
const DEATH_DISSOLVE_RADIUS = 4;
/** Slight negative "gravity" (an upward drift) — reads as dissolving away,
 * not falling debris (that's the tank-shard job below). */
const DEATH_DISSOLVE_GRAVITY = -35;
const DEATH_DISSOLVE_DRAG = 0.4;

const SOUL_WISP_ENEMY_RADIUS = 2.5;
const SOUL_WISP_ENEMY_RISE = 40; // spec: "~40px"
const SOUL_WISP_ENEMY_LIFE = 0.9;

/** Launch cone (radians) around straight-up for tank armor shards. */
const TANK_SHARD_SPREAD = 1.8;
const TANK_SHARD_SPEED = 100;
const TANK_SHARD_LIFE = 0.5;

// ---- hero death v2: soul wisp + contracting ring ---------------------------
const SOUL_WISP_HERO_RADIUS = 4.5; // "slightly larger" than the enemy wisp
const SOUL_WISP_HERO_RISE = 50;
const SOUL_WISP_HERO_LIFE = 1.1;
/** `RingPool` just linearly interpolates r0 -> r1 — passing r0 > r1 is
 * exactly the "dim ring CONTRACTS around the body" read the spec asks for,
 * no new ring-direction concept needed. Both already run through
 * `safeRadius()` inside `rings.ts`. */
const HERO_DEATH_RING_R0 = 46;
const HERO_DEATH_RING_R1 = 6;
const HERO_DEATH_RING_DURATION = 0.45;

// ---- hero revive v2: light pillar + brighter sparkle burst -----------------
const REVIVE_SPARKLE_COUNT = 16;
const REVIVE_SPARKLE_SPEED = 70;
const REVIVE_SPARKLE_LIFE = 0.55;
const REVIVE_PILLAR_HEAD_MARGIN = 26; // px above HERO_TOP_Y the beam starts
const REVIVE_PILLAR_WIDTH = 16;
const REVIVE_PILLAR_DURATION = 0.35;

// ---- hero level-up (M5 "Character XP + Level system", 86d3jv7m3) ----------
// Golden, jewel-tone-against-desaturated-scenery beat (README art direction):
// a starburst pop (bespoke shape, `levelUp.ts`) + a quick golden ring pulse +
// a small upward sparkle burst + a rising "LEVEL UP" label, all at the
// leveling hero's own position. Deliberately NOT a shake/arena-flash — this
// fires per-hero, potentially several times a minute early in a run, so it
// stays a contained, readable pop rather than competing with combat's own
// juice budget.
const LEVEL_UP_BURST_DURATION = 0.5;
const LEVEL_UP_RING_R0 = 14;
const LEVEL_UP_RING_R1 = 50;
const LEVEL_UP_RING_DURATION = 0.5;
const LEVEL_UP_PARTICLE_COUNT = 12;
const LEVEL_UP_PARTICLE_SPEED = 85;
const LEVEL_UP_PARTICLE_LIFE = 0.5;
const LEVEL_UP_TEXT_DURATION = 0.9;
const LEVEL_UP_TEXT_RISE = 42;

// ---- hero class-advancement / evolution (M5 "ปลดคลาส evolution", 86d3jv7m3) -
// A mid-tier GOAL-LADDER moment (permanent tier-2 flip, gold-gated, rare —
// at most once per hero for the whole M5 run) — deliberately bigger/grander
// than `levelUp`'s contained pop above: a light pillar dropping from above
// (reuses `lightPillars.ts`, same vocabulary as hero revive but taller/wider/
// longer), a bigger starburst (reuses `levelUp.ts`'s bespoke shape at a
// larger scale), a two-tone (gold + the hero's own class color) ring pulse +
// particle burst, and a BRIEF arena flash (kept within the README's "subtle
// ~0.2-0.3 peak alpha, no strobing" rule even for a big moment) — plays
// through a `timeDirector` freeze/slow-mo exactly like every other `fx/`
// effect (real `dt`, never sub-step count).
const EVOLVE_PILLAR_HEAD_MARGIN = 34; // taller than revive's — a grander descent
const EVOLVE_PILLAR_WIDTH = 22;
const EVOLVE_PILLAR_DURATION = 0.55;
const EVOLVE_BURST_DURATION = 0.7; // longer hang-time than levelUp's starburst
const EVOLVE_RING_R0 = 16;
const EVOLVE_RING_R1 = 70;
const EVOLVE_RING_DURATION = 0.6;
const EVOLVE_PARTICLE_COUNT_GOLD = 16;
const EVOLVE_PARTICLE_COUNT_CLASS = 10;
const EVOLVE_PARTICLE_SPEED = 100;
const EVOLVE_PARTICLE_LIFE = 0.6;
const EVOLVE_FLASH_ALPHA = 0.26;
const EVOLVE_TEXT_DURATION = 1.1;
const EVOLVE_TEXT_RISE = 50;

// ---- M6 "World & Town" zone/map navigation beats -------------------------
// Zone whoosh (`zoneEntered`, farm/town arrivals): a handful of quick, faint
// full-width horizontal streaks + the softest camera punch in the palette —
// sells "you just walked somewhere" without a screen-filling effect, and
// stays legible since it plays over `Environment`'s own ~1s biome crossfade
// (now triggered by every zone change, not just every ~5 stages).
const ZONE_WHOOSH_STREAK_COUNT = 5;
const ZONE_WHOOSH_STREAK_GAP = 22;
const ZONE_WHOOSH_STREAK_LIFE = 0.22;

// Boss-room entrance (`bossRoomEntered`): a dedicated, weightier beat — the
// room itself is already visually distinct all fight (see `bossArena.ts` +
// each map's dedicated `*_BOSS` biome in `environment/biomes.ts`); this is
// just the one-shot "you just walked through the gate" punctuation.
const BOSS_ROOM_ENTER_SHAKE = 5;
const BOSS_ROOM_ENTER_FLASH_ALPHA = 0.24;
const BOSS_ROOM_ENTER_RING_R0 = 140;
const BOSS_ROOM_ENTER_RING_R1 = 30;
const BOSS_ROOM_ENTER_RING_DURATION = 0.55;

// Zone/map unlocked (`zoneUnlocked`/`mapUnlocked`): a small congratulatory
// sparkle at the hero's own position — `mapUnlocked` is the rarer, bigger
// milestone (crossing into a whole new map's theme) so it gets the brighter,
// bigger-radius version of the same beat.
const ZONE_UNLOCK_PARTICLE_COUNT = 8;
const MAP_UNLOCK_PARTICLE_COUNT = 16;
const ZONE_UNLOCK_RING_R1 = 40;
const MAP_UNLOCK_RING_R1 = 64;

// ---- M7.5 world-gate navigation beats --------------------------------------
// Ground height the gate/door props sit at (a touch above the ground line,
// roughly arch-post height) — mirrors `HERO_TOP_Y`'s "just above the head"
// convention so gate glows read at the archway, not at ankle height.
const GATE_GLOW_Y = GROUND_Y - 36;

// zoneGateEnter (a walk transit's departure-edge gate): a small LOCALIZED
// glow, distinct from `onZoneEntered()`'s full-width whoosh (which plays
// separately, later, on arrival) — "you just stepped through the gate".
const GATE_ENTER_RING_R1 = 30;
const GATE_ENTER_RING_DURATION = 0.3;
const GATE_ENTER_PARTICLE_COUNT = 6;

// zoneGateExit (the arrival-edge gate): a softer arrival flash — the
// destination zone's own crossfade + (if it's a farm/town zone) whoosh
// already sold the "you arrived" beat; this is just the gate-side polish.
const GATE_EXIT_RING_R1 = 22;
const GATE_EXIT_RING_DURATION = 0.26;
const GATE_EXIT_PARTICLE_COUNT = 4;

// fastTravelArrive: a brighter, portal-tinted pop at the destination gate
// (distinct color from the plain ivory zoneGate glows above, so a fast-travel
// hop reads as "arcane", not "a plain walk").
const FASTTRAVEL_ARRIVE_RING_R1 = 34;
const FASTTRAVEL_ARRIVE_PARTICLE_COUNT = 10;

// Boss-door unlock beat (extends the M6 `bossRoomEntered`/arena-entrance
// vocabulary — the door is the OUTSIDE face of that same gate): fires once,
// the instant a map's boss room unlocks, at the door's own world position
// (not the hero's) so it reads as "that gate over there just opened", even
// if the hero is standing mid-field when the kill quota ticks over.
const BOSS_DOOR_UNLOCK_RING_R1 = 90;
const BOSS_DOOR_UNLOCK_RING_DURATION = 0.6;
const BOSS_DOOR_UNLOCK_PARTICLE_COUNT = 14;

// ---- boss entrance (state.boss null -> object): dust + dark tint + shake --
const BOSS_ENTRANCE_DUST_COUNT = 16;
const BOSS_ENTRANCE_DUST_SPEED = 90;
const BOSS_ENTRANCE_DUST_LIFE = 0.5;
const BOSS_ENTRANCE_DARK_TINT = 0x000000;
const BOSS_ENTRANCE_DARK_ALPHA = 0.25; // spec: "subtle ~0.25"
const BOSS_ENTRANCE_SHAKE = 4; // mild — he's stomping in, not slamming yet

// ---- boss death v2: staged escalating pulses BEFORE the gold shower/echo --
interface BossDeathStageSpec {
  /** Real seconds after `bossDefeated` this pulse fires. */
  t: number;
  radius: number;
  particleCount: number;
  speed: number;
  color: number;
}
/** 3 pulses, 0.15s apart (spec), escalating in size/color toward the gold
 * payout that follows — total staged-pulse span is 0.3s, keeping the whole
 * "boss going down in stages" beat (pulses + the existing ~0.5s collapse
 * echo that follows) under the spec's ~0.8s budget. */
const BOSS_DEATH_STAGE_SPEC: readonly BossDeathStageSpec[] = [
  { t: 0, radius: 50, particleCount: 10, speed: 140, color: PALETTE.warn },
  { t: 0.15, radius: 76, particleCount: 14, speed: 170, color: PALETTE.warn },
  { t: 0.3, radius: 104, particleCount: 18, speed: 200, color: PALETTE.killGold },
];
const BOSS_DEATH_STAGE_SHAKE = 5;

interface BossDeathStage extends BossDeathStageSpec {
  x: number;
  y: number;
}

// ---- M7 gear-wow: itemDrop ground pop (task "Drop beat in the field") ----
// A small, rarity-tinted ground sparkle/pop wherever `systems/gear`'s
// `itemDrop` event fires (farm kill or the boss's guaranteed roll) — kept
// deliberately small/cheap since farm drops can fire often on a busy field;
// epic gets a visibly bigger version so the milestone reads as special.
const ITEM_DROP_RING_R0 = { common: 2, rare: 3, epic: 4 } as const;
const ITEM_DROP_RING_R1 = { common: 16, rare: 20, epic: 27 } as const;
const ITEM_DROP_RING_DURATION = { common: 0.28, rare: 0.32, epic: 0.42 } as const;
const ITEM_DROP_PARTICLE_COUNT = { common: 5, rare: 7, epic: 11 } as const;
const ITEM_DROP_PARTICLE_SPEED = { common: 70, rare: 85, epic: 105 } as const;
const ITEM_DROP_PARTICLE_LIFE = { common: 0.32, rare: 0.4, epic: 0.5 } as const;
/** Ground-anchored — the raw `itemDrop.y` field is near-unused engine state
 * (entities are effectively 1D on `x`; see `FxController`'s own note above
 * about views deriving screen position from `GROUND_Y` + fixed offsets), so
 * this reads as "a small pop right where the kill happened" rather than
 * trusting `ev.y`. */
const ITEM_DROP_POP_Y = GROUND_Y - 6;

function itemDropAccentColor(rarity: ItemRarity): number {
  if (rarity === "epic") return PALETTE.gearEpic;
  if (rarity === "rare") return PALETTE.gearRare;
  return PALETTE.steel;
}

interface KnockbackEntry {
  view: Container;
  t: number;
  duration: number;
  mag: number;
}

interface PendingMeteor {
  tx: number;
}

/** One in-flight ARROW RAIN drop being tracked from cast to landing — `id`
 * matches it against `state.projectiles` (unlike the single-meteor case,
 * several drops can share a similar `tx`, so id is the reliable key here). */
interface PendingRainArrow {
  id: number;
  tx: number;
  ty: number;
}

export class FxController {
  private readonly corpseLayer: Container;
  private readonly trailLayer: Container;
  private readonly heroFxLayer: Container;
  private readonly ringsLayer: Container;
  private readonly particlesLayer: Container;
  private readonly textLayer: Container;

  private readonly corpseEcho: CorpseEchoPool;
  private readonly bossEcho = new BossEcho();
  private readonly rings: RingPool;
  private readonly levelUpBursts: LevelUpBurstPool;
  private readonly particles: ParticlePool;
  private readonly damageNumbers: FloatingTextPool;
  private readonly eventText: FloatingTextPool;
  private readonly hitFlash = new HitFlashController();
  private readonly shake = new ScreenShake();
  private readonly punch = new CameraPunch();
  private readonly flash: ArenaFlash;
  private readonly impactFilters: ImpactFilterController;
  private readonly weaponTrail: WeaponTrailController;
  /** Reused every frame — `getSwordTipPos()` writes into this instead of
   * allocating a fresh point (zero steady-state allocation). */
  private readonly tipScratch = { x: 0, y: 0 };
  /** Reused every frame and passed to `WeaponTrailController.update()`; its
   * nested `tip` always points at `tipScratch`. */
  private readonly trailFrame: WeaponTrailFrame = {
    tip: this.tipScratch,
    swinging: false,
    bodyX: 0,
    color: HERO_COLORS.swordsman.light,
  };

  // ---- HERO SIGNATURE PASS (86d3k2q8f) additions ---------------------------
  // (all constructed in the constructor BODY, once their backing layer
  // Containers exist — see the field-initializer-ordering note there.)
  private readonly crescents: CrescentPool;
  private readonly ghostBlades: GhostBladePool;
  private readonly tracers: TracerPool;
  private readonly flashLines: FlashLinePool;
  private readonly runeGlyphs: RuneGlyphPool;
  private readonly meteorSky: MeteorSkyFlash;
  private readonly scorches: ScorchPool;
  private readonly castAura: CastAuraController;

  // ---- ARROW RAIN skill scene (86d3k2t18) ----------------------------------
  private readonly rainShadows: RainShadowPool;
  private readonly groundArrows: GroundArrowPool;

  // ---- DEATH & SPAWN DRAMA (86d3k2qjk) additions ---------------------------
  private readonly portals: PortalPool;
  private readonly armorShards: ArmorShardPool;
  private readonly soulWisps: SoulWispPool;
  private readonly lightPillars: LightPillarPool;

  // ---- M7 gear-wow: tier-6/epic weapon aura + tier-5+ armor sparkle -------
  // Continuous (not event-driven) — driven every frame in `updateGearFx()`
  // from live `GameState`, same convention as `updateWeaponTrail()`/
  // `updateCastAura()`.
  private readonly gearAura: GearAuraController;
  private readonly gearSparkle: GearSparklePool;

  // ---- M7.5 world-gate navigation (fast-travel channel swirl) --------------
  private readonly travelPortal: TravelPortalController;
  /** Reused every frame — `getWeaponAnchorPos()`/`getArmorAnchorPos()` write
   * into these instead of allocating a fresh point (zero steady-state
   * allocation), same convention as `tipScratch` above. */
  private readonly weaponAnchorScratch = { x: 0, y: 0 };
  private readonly armorAnchorScratch = { x: 0, y: 0 };

  /** Last-seen "does a boss currently exist" — `state.boss` transitions
   * null -> object with no dedicated event (the player's `challengeBoss`
   * input flips it directly; see `engine/systems/boss.ts`), so the entrance
   * beat is detected the same continuous-per-frame way as
   * `updateWeaponTrail()`/`updateCastAura()` below, in `update()`. */
  private hadBoss = false;

  /** Render-side mirror of `Pool`'s own mark-and-sweep "first sight" — a
   * whole wave of enemies can appear in ONE engine step, so this is checked
   * every `update()` call (not gated behind `frameEvents.length`) against the
   * live `state.enemies` list. `frameEnemyIdScratch` is cleared and refilled
   * every frame (never a fresh `Set`, so this is zero steady-state
   * allocation, same convention as `Pool.beginFrame()`'s `seen` set). */
  private readonly seenEnemyIds = new Set<number>();
  private readonly frameEnemyIdScratch = new Set<number>();

  /** In-flight staged boss-defeat pulses + the deferred "final" payout beat —
   * see `onBossDefeated()`/`updateBossDeathStages()`. */
  private readonly bossDeathStages: BossDeathStage[] = [];
  private bossDeathFinal: Extract<GameEvent, { type: "bossDefeated" }> | null = null;

  /** Edge-detection for the swordsman's per-swing crescent (item 2) —
   * compared against `peekSwordSwing()`'s monotonic `seq` every frame a
   * `consumeEvents()` call runs. */
  private lastSwordSwingSeq = -1;
  /** Set once at the top of EVERY `consumeEvents()` call to "a fresh
   * swordsman swing started THIS frame" (or `null`) — consumed by both the
   * crescent spawn and the melee impact-spark/knockback correlation in
   * `onHit()` (the melee `hit` event fires the SAME engine step the swing
   * starts, so this doubles as "was this hit the swordsman's basic attack"). */
  private swingThisFrame: { comboIndex: number } | null = null;

  /** In-flight mage meteors being tracked for the ground-rune / scorch-on-
   * impact sequence (item 11) — see `updateMeteorTracking()`. */
  private readonly pendingMeteors: PendingMeteor[] = [];

  /** In-flight ARROW RAIN drops being tracked from cast to landing (86d3k2t18)
   * — see `onArcherRainCast()`/`updateRainArrowTracking()`. Capped at
   * `MAX_PENDING_RAIN_ARROWS`; extra drops beyond that are silently skipped. */
  private readonly pendingRainArrows: PendingRainArrow[] = [];

  /** "This view has a decaying position nudge" entries (item 3) — reaches
   * directly into the SAME `Container` `hitFlash.ts` already reaches into
   * for its filter, never touching `enemyView.ts`/`bossView.ts`. */
  private readonly knockback: KnockbackEntry[] = [];

  /** Rolling average hit magnitude, used to scale damage-number font size. */
  private avgHit = 20;

  constructor(
    fxContainer: Container,
    world: Container,
    private readonly lookupView: EntityViewLookup,
    private readonly lookupHeroView: HeroViewLookup,
  ) {
    // Sub-layers in z-order: corpse echoes (bottom, "the body collapsing" +
    // ground scorch marks + spawn portals + tank armor shards — all
    // ground/body-adjacent decals) -> weapon trail + projectile tracers ->
    // the hero-signature bits (crescents/ghost blades/fan flashes/rune
    // glyphs/cast aura) -> rings (+ revive light pillars) -> particles
    // (+ soul wisps) -> text -> full-arena flash (top), so numbers stay
    // readable over bursts and the flash never hides them.
    this.corpseLayer = new PixiContainer();
    this.trailLayer = new PixiContainer();
    this.heroFxLayer = new PixiContainer();
    this.ringsLayer = new PixiContainer();
    this.particlesLayer = new PixiContainer();
    this.textLayer = new PixiContainer();
    fxContainer.addChild(
      this.corpseLayer,
      this.trailLayer,
      this.heroFxLayer,
      this.ringsLayer,
      this.particlesLayer,
      this.textLayer,
    );

    this.corpseEcho = new CorpseEchoPool(this.corpseLayer);
    this.scorches = new ScorchPool(this.corpseLayer);
    this.portals = new PortalPool(this.corpseLayer);
    this.armorShards = new ArmorShardPool(this.corpseLayer);
    this.rainShadows = new RainShadowPool(this.corpseLayer);
    this.groundArrows = new GroundArrowPool(this.corpseLayer);
    this.weaponTrail = new WeaponTrailController(this.trailLayer);
    this.tracers = new TracerPool(this.trailLayer);
    this.crescents = new CrescentPool(this.heroFxLayer);
    this.ghostBlades = new GhostBladePool(this.heroFxLayer);
    this.flashLines = new FlashLinePool(this.heroFxLayer);
    this.runeGlyphs = new RuneGlyphPool(this.heroFxLayer);
    this.castAura = new CastAuraController(this.heroFxLayer);
    this.gearAura = new GearAuraController(this.heroFxLayer);
    this.gearSparkle = new GearSparklePool(this.heroFxLayer);
    this.travelPortal = new TravelPortalController(this.heroFxLayer);
    this.rings = new RingPool(this.ringsLayer);
    this.levelUpBursts = new LevelUpBurstPool(this.ringsLayer);
    this.lightPillars = new LightPillarPool(this.ringsLayer);
    this.particles = new ParticlePool(this.particlesLayer);
    this.soulWisps = new SoulWispPool(this.particlesLayer);
    this.damageNumbers = new FloatingTextPool(this.textLayer, DAMAGE_NUMBER_CAP);
    this.eventText = new FloatingTextPool(this.textLayer, EVENT_TEXT_CAP);
    this.flash = new ArenaFlash(WORLD_WIDTH, WORLD_HEIGHT);
    this.meteorSky = new MeteorSkyFlash(WORLD_WIDTH);
    this.impactFilters = new ImpactFilterController(world);
    fxContainer.addChild(this.bossEcho.view, this.meteorSky.view, this.flash.view);
  }

  get shakeOffset(): { x: number; y: number } {
    return this.shake.offset;
  }

  /** Multiplicative scale factor from the in-flight camera punch (1 = idle) —
   * `GameRenderer.applyWorldTransform()` composes this onto `baseTransform.scale`. */
  get punchScale(): number {
    return this.punch.scale;
  }

  /** Additive world-space nudge from the in-flight camera punch — composed
   * onto the letterbox offset + screenshake offset. */
  get punchOffset(): { x: number; y: number } {
    return this.punch.offset;
  }

  /** React to this frame's (already-collected, cross-sub-step) events. */
  consumeEvents(events: GameEvent[], state: GameState): void {
    // Per-frame de-dupe for AOE skill impacts: several targets hit by the same
    // spin/meteor in the same instant would otherwise stack N overlapping
    // impact bursts at nearly the same spot.
    const skillImpactSeen = new Set<string>();
    // "Already sparked a melee impact this frame" guard (item 3) — a
    // swordsman basic swing produces exactly one `hit`, but if another
    // hero's ranged hit happens to resolve the SAME rendered frame, this
    // keeps the spark/knockback correlation to at most one hit instead of
    // firing on every "attack"-sourced hit that frame.
    const meleeSparkGuard = { done: false };

    // Continuous (not event-derived) per-frame read of the swordsman's live
    // `HeroView` — detects "a NEW basic swing started THIS frame" (item 2's
    // slash crescent) via `peekSwordSwing()`'s monotonic `seq`. The melee
    // `hit` event fires the SAME engine step the swing starts, so this same
    // flag also identifies (heuristically — render-only, never affects game
    // logic) which `hit` below was the swordsman's basic attack landing.
    this.swingThisFrame = this.detectSwordSwingStart(state);
    if (this.swingThisFrame) this.onSwordSwingStart(state, this.swingThisFrame.comboIndex);

    for (const ev of events) {
      switch (ev.type) {
        case "hit":
          this.onHit(ev, state, skillImpactSeen, meleeSparkGuard);
          break;
        case "kill":
          this.onKill(ev);
          break;
        case "heroDown":
          this.shake.trigger(3); // mild
          this.impactFilters.triggerRgbSplit();
          this.onHeroDown(ev, state);
          break;
        case "heroRevived":
          this.onHeroRevived(ev);
          break;
        case "skillCast":
          this.onSkillCast(ev, state);
          break;
        case "levelUp":
          this.onLevelUp(ev, state);
          break;
        case "evolve":
          this.onEvolve(ev, state);
          break;
        case "bossSlamTelegraph":
          this.rings.spawn({
            x: ev.x,
            y: BOSS_CY,
            r0: 30,
            r1: 100,
            duration: 0.5,
            width: 3,
            color: PALETTE.warn,
          });
          break;
        case "bossSlamLand":
          this.shake.trigger(8); // strong
          this.punch.trigger("bossSlamLand", ev.x);
          this.impactFilters.triggerShockwave(ev.x, GROUND_Y);
          this.rings.spawn({
            x: ev.x,
            y: GROUND_Y,
            r0: 20,
            r1: 150,
            duration: 0.4,
            width: 5,
            color: PALETTE.warn,
          });
          burst(this.particles, ev.x, GROUND_Y - 10, 14, PALETTE.warn, {
            speed: 150,
            life: 0.35,
            radius: 3,
          });
          break;
        case "bossEnraged":
          this.flash.trigger(PALETTE.enrageAura, 0.28);
          break;
        case "bossDefeated":
          this.onBossDefeated(ev);
          break;
        case "mobAggroed":
          // M6 "สนามล่ามอน" follow-up (open hunting field): an aggressive mob just
          // aggroed onto the hero — a small "alert" beat at the mob: a brief,
          // localized flash-ring (NOT the full-arena `flash` — this can fire
          // often on a busy field, so it stays a small local pulse) + a tiny
          // upward "!" spark (reuses the same pooled text the damage numbers/
          // kill-gold use) on top of the original puff, all kept subtle/short
          // per the render brief. Aggro's growl SFX lives in `audio/sfxMap.ts`.
          burst(this.particles, ev.x, GROUND_Y - 18, 5, PALETTE.enrageAura, {
            speed: 55,
            life: 0.28,
            radius: 2,
          });
          this.rings.spawn({
            x: ev.x,
            y: GROUND_Y - 18,
            r0: 3,
            r1: 16,
            duration: 0.22,
            width: 1.5,
            color: PALETTE.enrageAura,
          });
          this.eventText.spawn({
            x: ev.x,
            y: GROUND_Y - 30,
            label: "!",
            color: PALETTE.warn,
            fontSize: 15,
            duration: 0.35,
            rise: 12,
            driftX: 0,
          });
          break;
        case "stageAdvanced":
          this.flash.trigger(PALETTE.gold, 0.22);
          break;
        case "projectileSpawn":
          this.onProjectileSpawn(ev);
          break;
        case "zoneEntered":
          // Boss-room arrivals get their own grander beat (`bossRoomEntered`,
          // fired the SAME step) — skip the generic whoosh so the two never
          // double up. Zone display names are locale text; render has no
          // i18n hookup (see art-direction rule elsewhere in this file), so
          // that's a UI-layer toast's job — this stays purely visual.
          if (ev.kind !== "boss") this.onZoneEntered();
          break;
        case "bossRoomEntered":
          this.onBossRoomEntered();
          break;
        case "zoneUnlocked":
          this.onProgressUnlocked(ev.type, state);
          if (isBossZoneIdx(ev.mapId, ev.zoneIdx)) this.onBossDoorUnlocked(ev.mapId);
          break;
        case "mapUnlocked":
          this.onProgressUnlocked(ev.type, state);
          break;
        case "itemDrop":
          this.onItemDrop(ev);
          break;
        case "zoneGateEnter":
          this.onZoneGateEnter(ev);
          break;
        case "zoneGateExit":
          this.onZoneGateExit(ev);
          break;
        case "fastTravelCastStart":
          this.travelPortal.startChannel(ev.x, ev.y, CONFIG.travel.fastTravelCastSeconds);
          break;
        case "fastTravelArrive":
          this.onFastTravelArrive(ev);
          break;
        case "fastTravelBlocked":
          // Any reason ends an in-flight channel with a fizzle (no-op if none
          // was running — e.g. tapping a locked zone never started one).
          this.travelPortal.cancelChannel();
          break;
        default:
          break; // stageCleared / upgradeBought / townArrived: no fx-layer reaction
      }
    }
  }

  /** Advance every effect by `dt` REAL seconds (never sub-step count). */
  update(dt: number, state: GameState): void {
    this.hitFlash.update(dt);
    this.shake.update(dt);
    this.punch.update(dt);
    this.corpseEcho.update(dt);
    this.scorches.update(dt);
    this.portals.update(dt);
    this.armorShards.update(dt);
    this.rainShadows.update(dt);
    this.groundArrows.update(dt);
    this.bossEcho.update(dt);
    this.rings.update(dt);
    this.levelUpBursts.update(dt);
    this.lightPillars.update(dt);
    this.crescents.update(dt);
    this.ghostBlades.update(dt);
    this.flashLines.update(dt);
    this.runeGlyphs.update(dt);
    this.meteorSky.update(dt);
    this.particles.update(dt);
    this.soulWisps.update(dt);
    this.damageNumbers.update(dt);
    this.eventText.update(dt);
    this.flash.update(dt);
    this.impactFilters.update(dt);
    this.updateWeaponTrail(dt, state);
    this.updateTracers(dt, state);
    this.updateCastAura(dt, state);
    this.updateMeteorTracking(state);
    this.updateRainArrowTracking(state);
    this.updateKnockback(dt);
    this.updateEnemySpawns(state);
    this.updateBossDeathStages(dt);
    this.detectBossEntrance(state);
    this.updateGearFx(dt, state);
    this.travelPortal.update(dt);
  }

  destroy(): void {
    this.hitFlash.destroy();
    this.corpseEcho.destroy();
    this.scorches.destroy();
    this.portals.destroy();
    this.armorShards.destroy();
    this.rainShadows.destroy();
    this.groundArrows.destroy();
    this.bossEcho.destroy();
    this.weaponTrail.destroy();
    this.tracers.destroy();
    this.crescents.destroy();
    this.ghostBlades.destroy();
    this.flashLines.destroy();
    this.runeGlyphs.destroy();
    this.meteorSky.destroy();
    this.castAura.destroy();
    this.gearAura.destroy();
    this.gearSparkle.destroy();
    this.travelPortal.destroy();
    this.impactFilters.destroy();
    this.rings.destroy();
    this.levelUpBursts.destroy();
    this.lightPillars.destroy();
    this.particles.destroy();
    this.soulWisps.destroy();
    this.damageNumbers.destroy();
    this.eventText.destroy();
    this.flash.destroy();
    this.corpseLayer.destroy();
    this.trailLayer.destroy();
    this.heroFxLayer.destroy();
    this.ringsLayer.destroy();
    this.particlesLayer.destroy();
    this.textLayer.destroy();
  }

  /** M7 gear-wow (continuous, not event-driven — same convention as
   * `updateWeaponTrail()`/`updateCastAura()`): per hero slot, activates the
   * tier-6/epic weapon aura (`gearAura`) and/or tier-5+ armor sparkle
   * (`gearSparkle`) when that hero's live view + equipped template say so,
   * else eases the slot back to invisible. Reads `ITEM_TEMPLATES` directly
   * (not `HeroView.gearWeaponTier`/`gearArmorRarity`, though those exist too)
   * since `state.heroes` is already being walked here regardless. */
  private updateGearFx(dt: number, state: GameState): void {
    state.heroes.forEach((h, slot) => {
      const view = h.dead ? null : this.lookupHeroView(h.id);
      const weaponRarity: ItemRarity | undefined = h.equipped.weapon
        ? ITEM_TEMPLATES[h.equipped.weapon]?.rarity
        : undefined;
      const armorTier = h.equipped.armor ? (ITEM_TEMPLATES[h.equipped.armor]?.tier ?? 0) : 0;

      const auraOn = !!view && weaponRarity === "epic" && getWeaponAnchorPos(view, this.weaponAnchorScratch);
      this.gearAura.setSlot(
        slot,
        auraOn,
        this.weaponAnchorScratch.x,
        this.weaponAnchorScratch.y,
        PALETTE.auraFlame,
      );

      const sparkleOn = !!view && armorTier >= 5 && getArmorAnchorPos(view, this.armorAnchorScratch);
      this.gearSparkle.setSlot(slot, sparkleOn, this.armorAnchorScratch.x, this.armorAnchorScratch.y);
    });
    this.gearAura.update(dt);
    this.gearSparkle.update(dt);
  }

  /** Continuous (not event-driven) per-frame read of `state.heroes` +
   * the swordsman's live `HeroView` rig — see `weaponTrail.ts`'s doc comment
   * for why this doesn't fit the edge-triggered `consumeEvents()` shape. */
  private updateWeaponTrail(dt: number, state: GameState): void {
    const swordsman = state.heroes.find((h) => h.cls === "swordsman" && !h.dead);
    const view = swordsman ? this.lookupHeroView(swordsman.id) : null;
    const hasTip = swordsman && view ? getSwordTipPos(view, this.tipScratch) : false;

    if (swordsman && view && hasTip) {
      this.trailFrame.swinging = isSwordSwinging(view);
      this.trailFrame.bodyX = swordsman.x;
      this.weaponTrail.update(dt, this.trailFrame);
    } else {
      this.weaponTrail.update(dt, null);
    }
  }

  // -------------------------------------------------------------------------

  private onHit(
    ev: Extract<GameEvent, { type: "hit" }>,
    state: GameState,
    skillImpactSeen: Set<string>,
    meleeSparkGuard: { done: boolean },
  ): void {
    const view = this.lookupView(ev.target, ev.id);
    if (view) this.hitFlash.trigger(view);

    // Swordsman basic-melee impact spark + knockback jitter (item 3) — see
    // `swingThisFrame`'s doc comment for the same-step correlation this
    // relies on. Guarded to at most once per frame.
    if (
      !meleeSparkGuard.done &&
      this.swingThisFrame &&
      ev.target !== "hero" &&
      ev.source === "attack"
    ) {
      meleeSparkGuard.done = true;
      this.onSwordMeleeImpact(ev, state, view);
    }

    // EMA so a single huge hit doesn't stay "the new normal" forever.
    this.avgHit = this.avgHit * 0.92 + ev.amount * 0.08;
    const scale = clamp(ev.amount / Math.max(1, this.avgHit), 0.65, 2.2);
    const y = this.hitY(ev.target, ev.id, state);

    if (ev.target === "hero") {
      this.damageNumbers.spawn({
        x: ev.x,
        y,
        label: `-${Math.round(ev.amount)}`,
        color: PALETTE.dmgHeroTaken,
        fontSize: Math.round((ev.source === "slam" ? 16 : 13) * scale),
      });
      return;
    }

    const isSkill = ev.source === "skill";
    this.damageNumbers.spawn({
      x: ev.x,
      y,
      label: `${Math.round(ev.amount)}`,
      color: isSkill ? PALETTE.dmgSkill : PALETTE.dmgNormal,
      fontSize: Math.round((isSkill ? 16 : 12) * scale),
    });

    if (isSkill) {
      // One impact burst (+ shockwave ripple) per AOE moment, not one per
      // target it happens to hit — covers both the mage's meteor and the
      // swordsman's spin, whichever landed several hits in the same instant.
      const key = `${Math.round(ev.x / 24)}:${Math.round(y / 24)}`;
      if (!skillImpactSeen.has(key)) {
        skillImpactSeen.add(key);
        burst(this.particles, ev.x, y, 8, PALETTE.dmgSkill, {
          speed: 130,
          life: 0.35,
          radius: 3,
        });
        this.impactFilters.triggerShockwave(ev.x, y);
      }
    }
  }

  /** Enemy death v2 (DEATH & SPAWN DRAMA item 1): the existing gold kill-pop
   * + corpse-crumple base layer, PLUS a bigger kind-colored "dissolving"
   * burst, a rising soul wisp (skipped outright if the wisp pool is
   * saturated — see `soulWisp.ts`), and — tank only — a couple of arcing
   * armor-shard chips. */
  private onKill(ev: Extract<GameEvent, { type: "kill" }>): void {
    const size = ENEMY_TYPES[ev.kind]?.size ?? 1;
    const y = GROUND_Y - 20 - 8 * size;
    const kindColor = ENEMY_COLORS[ev.kind];

    burst(this.particles, ev.x, y, 10, PALETTE.killGold, {
      speed: 110,
      life: 0.45,
      radius: 3,
    });
    // Kind-colored dissolve burst — bigger + slower than the gold pop above,
    // with a slight upward drift so it reads as "breaking apart", not just
    // more of the same gold sparkle.
    burst(this.particles, ev.x, y, DEATH_DISSOLVE_COUNT, kindColor, {
      speed: DEATH_DISSOLVE_SPEED,
      life: DEATH_DISSOLVE_LIFE,
      radius: DEATH_DISSOLVE_RADIUS,
      gravity: DEATH_DISSOLVE_GRAVITY,
      drag: DEATH_DISSOLVE_DRAG,
    });
    this.eventText.spawn({
      x: ev.x,
      y,
      label: `+${ev.goldGained}`,
      color: PALETTE.killGold,
      fontSize: 14,
      duration: 0.7,
      rise: 34,
    });
    // The engine removes the dead enemy from state this same step, so
    // `enemyView.ts`'s pooled view is already gone — this brief crumple
    // echo (kept subtle; the burst above already covers the "impact") is
    // the render-side stand-in for a death animation.
    this.corpseEcho.spawn(ev.x, GROUND_Y - 4, ev.kind, size);

    this.soulWisps.trySpawn({
      x: ev.x,
      y: y - 6,
      color: kindColor,
      radius: SOUL_WISP_ENEMY_RADIUS,
      rise: SOUL_WISP_ENEMY_RISE,
      life: SOUL_WISP_ENEMY_LIFE,
    });

    if (ev.kind === "tank") {
      const shardCount = 2 + Math.floor(Math.random() * 2); // 2 or 3
      for (let i = 0; i < shardCount; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * TANK_SHARD_SPREAD;
        this.armorShards.spawn({
          x: ev.x,
          y,
          angle,
          speed: TANK_SHARD_SPEED * (0.8 + Math.random() * 0.4),
          color: kindColor,
          w: 8,
          h: 6,
          life: TANK_SHARD_LIFE,
        });
      }
    }
  }

  /** Hero death v2 (item 3): a class-colored soul wisp + a dim ring that
   * CONTRACTS around the body (kept alongside the existing fall — see
   * `heroView.ts`'s `DEATH_FALL_*`, untouched). M6 "World & Town": a FULL
   * wipe (every hero dead) is what now triggers `world.respawnToTown`'s
   * walk-home — repurposing the old (dormant) `bossRetreat` beat into a
   * one-shot "somber" dim pulse layered on top of the per-hero beat above,
   * instead of the boss "turning away and sliding out" it used to play (see
   * `bossEcho.ts`'s cleanup note). Solo play means every `heroDown` IS a
   * wipe today, but the `state.heroes.every` check keeps this correct once
   * M8 party makes a partial-down non-wipe possible. */
  private onHeroDown(ev: Extract<GameEvent, { type: "heroDown" }>, state: GameState): void {
    const colors = HERO_COLORS[ev.cls];
    this.soulWisps.spawn({
      x: ev.x,
      y: HERO_TOP_Y,
      color: colors.light,
      radius: SOUL_WISP_HERO_RADIUS,
      rise: SOUL_WISP_HERO_RISE,
      life: SOUL_WISP_HERO_LIFE,
    });
    this.rings.spawn({
      x: ev.x,
      y: HERO_MID_Y,
      r0: HERO_DEATH_RING_R0,
      r1: HERO_DEATH_RING_R1,
      duration: HERO_DEATH_RING_DURATION,
      width: 3,
      color: PALETTE.deadHero,
    });

    const wiped = state.heroes.length > 0 && state.heroes.every((h) => h.dead);
    if (wiped) {
      // Deliberately muted/desaturated (not another red "ouch" flash) — this
      // is a setback beat, not more combat feedback; kept within the
      // README's "~0.2-0.3 peak alpha, never strobing" rule.
      this.flash.trigger(PALETTE.deadHero, 0.18);
    }
  }

  /** Hero revive v2 (item 4): a light pillar dropping from above + a radial
   * sparkle burst (kept from the original, punched up) + a brief bright
   * flash pulse on the body itself (reuses `hitFlash.ts`'s white
   * `ColorMatrixFilter` flash — same "punch to white" read as a landed hit,
   * here standing in for "life snapping back in") — alongside the existing
   * spring-bounce in `heroView.ts` (untouched). */
  private onHeroRevived(ev: Extract<GameEvent, { type: "heroRevived" }>): void {
    const colors = HERO_COLORS[ev.cls];

    const view = this.lookupView("hero", ev.id);
    if (view) this.hitFlash.trigger(view);

    burst(this.particles, ev.x, HERO_TOP_Y, REVIVE_SPARKLE_COUNT, colors.light, {
      speed: REVIVE_SPARKLE_SPEED,
      life: REVIVE_SPARKLE_LIFE,
      radius: 2.5,
    });

    const topY = HERO_TOP_Y - REVIVE_PILLAR_HEAD_MARGIN;
    this.lightPillars.spawn({
      x: ev.x,
      topY,
      height: GROUND_Y - topY,
      color: colors.light,
      duration: REVIVE_PILLAR_DURATION,
      width: REVIVE_PILLAR_WIDTH,
    });
  }

  /** Hero level-up (M5): golden starburst + ring pulse + sparkle burst +
   * rising "LEVEL UP" label at the hero's own position — see the
   * `LEVEL_UP_*` knobs block above for timings/magnitudes. `state.heroes`
   * still contains the hero this same step (levels are applied in-place, the
   * hero entity is never removed), so a lookup miss here would only mean a
   * genuinely stale id and is skipped rather than guessed at. */
  private onLevelUp(ev: Extract<GameEvent, { type: "levelUp" }>, state: GameState): void {
    const hero = state.heroes.find((h) => h.id === ev.id);
    if (!hero) return;
    const x = hero.x;
    const y = HERO_TOP_Y;

    this.levelUpBursts.spawn({ x, y, color: PALETTE.gold, duration: LEVEL_UP_BURST_DURATION });
    this.rings.spawn({
      x,
      y,
      r0: LEVEL_UP_RING_R0,
      r1: LEVEL_UP_RING_R1,
      duration: LEVEL_UP_RING_DURATION,
      width: 3,
      color: PALETTE.gold,
    });
    burst(this.particles, x, y, LEVEL_UP_PARTICLE_COUNT, PALETTE.gold, {
      speed: LEVEL_UP_PARTICLE_SPEED,
      life: LEVEL_UP_PARTICLE_LIFE,
      radius: 2.5,
      gravity: -30, // slight upward drift — "rising" energy, not falling debris
      drag: 0.3,
    });
    // "Lv." is a literal, locale-invariant prefix in this game's own i18n
    // (see messages/th.json + en.json's `common.levelBadge`: identical in
    // both) — render/ has no i18n hookup at all (canvas text elsewhere is
    // numeric-only, e.g. damage/gold labels), so this stays consistent with
    // that convention instead of hardcoding an English "LEVEL UP" phrase.
    this.eventText.spawn({
      x,
      y: y - 14,
      label: `Lv.${ev.level} ▲`,
      color: PALETTE.gold,
      fontSize: 14,
      duration: LEVEL_UP_TEXT_DURATION,
      rise: LEVEL_UP_TEXT_RISE,
    });
  }

  /** Hero class-advancement / evolution (M5): the "big" goal-ladder beat —
   * pillar of light + a bigger two-tone starburst/ring/particle spread +
   * a brief arena flash + a rising "TIER 2!" label, all at the evolving
   * hero's own position. See the `EVOLVE_*` knobs block above for
   * timings/magnitudes and why this is deliberately grander than
   * `onLevelUp()`. Same "hero still in `state.heroes` this step" lookup
   * contract as `onLevelUp()` (evolution flips the entity in place, never
   * removes it). */
  private onEvolve(ev: Extract<GameEvent, { type: "evolve" }>, state: GameState): void {
    const hero = state.heroes.find((h) => h.id === ev.id);
    if (!hero) return;
    const x = hero.x;
    const y = HERO_TOP_Y;
    const classColor = HERO_COLORS[ev.cls].light;

    const topY = y - EVOLVE_PILLAR_HEAD_MARGIN;
    this.lightPillars.spawn({
      x,
      topY,
      height: GROUND_Y - topY,
      color: PALETTE.gold,
      duration: EVOLVE_PILLAR_DURATION,
      width: EVOLVE_PILLAR_WIDTH,
    });
    this.levelUpBursts.spawn({ x, y, color: PALETTE.gold, duration: EVOLVE_BURST_DURATION });
    this.rings.spawn({
      x,
      y,
      r0: EVOLVE_RING_R0,
      r1: EVOLVE_RING_R1,
      duration: EVOLVE_RING_DURATION,
      width: 4,
      color: classColor,
    });
    burst(this.particles, x, y, EVOLVE_PARTICLE_COUNT_GOLD, PALETTE.gold, {
      speed: EVOLVE_PARTICLE_SPEED,
      life: EVOLVE_PARTICLE_LIFE,
      radius: 3,
      gravity: -30, // rising energy, not falling debris — same read as levelUp's
      drag: 0.3,
    });
    burst(this.particles, x, y, EVOLVE_PARTICLE_COUNT_CLASS, classColor, {
      speed: EVOLVE_PARTICLE_SPEED * 0.8,
      life: EVOLVE_PARTICLE_LIFE,
      radius: 2.5,
      gravity: -30,
      drag: 0.3,
    });
    // Brief, subtle full-arena flash — README's "~0.2-0.3 peak alpha, never
    // strobing" rule holds even for this bigger moment.
    this.flash.trigger(PALETTE.gold, EVOLVE_FLASH_ALPHA);
    // "TIER" is a literal, locale-invariant label (render/ has no i18n hookup
    // — see `onLevelUp()`'s doc comment for the same convention).
    this.eventText.spawn({
      x,
      y: y - 16,
      label: `TIER ${ev.tier} ▲`,
      color: PALETTE.gold,
      fontSize: 16,
      duration: EVOLVE_TEXT_DURATION,
      rise: EVOLVE_TEXT_RISE,
    });
  }

  private onSkillCast(
    ev: Extract<GameEvent, { type: "skillCast" }>,
    state: GameState,
  ): void {
    const hero = state.heroes[ev.slot];
    const x = hero ? hero.x : 0;
    const colors = HERO_COLORS[ev.heroClass];
    this.punch.trigger("skillCast", x);

    if (ev.heroClass === "swordsman") {
      this.onSwordSpinCast(hero, x, colors.light);
    } else if (ev.heroClass === "archer") {
      this.onArcherRainCast(x, colors.light, state);
    } else {
      this.onMageMeteorCast(x, colors.light, state);
    }
  }

  /** Swordsman skill (spin) — charge-up glow (item 4), whirlwind afterimages
   * + dust ring (item 5), and the crescent-nova shards + a spin-specific
   * stronger camera punch (item 6). */
  private onSwordSpinCast(hero: Hero | undefined, x: number, color: number): void {
    // Stronger, spin-specific punch — "strongest wins" against the generic
    // `skillCast` punch already triggered by the caller (see cameraPunch.ts).
    this.punch.trigger("swordSpin", x);

    // Charge-up: front-loaded blade glow + inward-drifting sparkle at the
    // live blade tip (the spin's own 0.4s whirl already runs in heroView;
    // this is just the first ~0.15s's extra shimmer).
    const view = hero ? this.lookupHeroView(hero.id) : null;
    const hasTip = view ? getSwordTipPos(view, this.tipScratch) : false;
    const gx = hasTip ? this.tipScratch.x : x + 12;
    const gy = hasTip ? this.tipScratch.y : HERO_MID_Y;
    burstInward(this.particles, gx, gy, 8, color, 26, { life: 0.16, speed: 90, radius: 2 });

    // Whirlwind afterimages + a dust-ring kick-up at the feet.
    this.ghostBlades.triggerSpin(x, HERO_MID_Y, color);
    this.rings.spawn({
      x,
      y: GROUND_Y - 2,
      r0: 6,
      r1: 34,
      duration: 0.35,
      width: 3,
      color: PALETTE.muted,
    });

    // Crescent nova: the existing expanding ring, augmented with jagged
    // shards flying outward while rotating.
    this.rings.spawn({
      x,
      y: HERO_MID_Y,
      r0: 12,
      r1: SKILL_TYPES.swordsman.radius,
      duration: 0.4,
      width: 4,
      color,
    });
    const shardCount = 6;
    for (let i = 0; i < shardCount; i++) {
      const angle = (Math.PI * 2 * i) / shardCount;
      this.crescents.spawnShard({
        x,
        y: HERO_MID_Y,
        angle,
        speed: 170,
        rotationSpeed: 7,
        radius: 8,
        thickness: 3,
        life: 0.4,
        color: i % 2 === 0 ? color : PALETTE.steel,
      });
    }
  }

  /** Archer skill (ARROW RAIN, 86d3k2t18) — a bow flash + a handful of
   * upward "volley launch" streaks at cast time, then seeds the falling
   * shadow markers (+ landing tracking) for all 9 drops the engine already
   * pushed synchronously into `state.projectiles` this same step (same
   * readback convention as `onMageMeteorCast()`'s single meteor, generalized
   * to N drops). The old "3 fan flash-lines toward the nearest targets" read
   * no longer matches the skill (it now blankets a whole zone, not 3 picked
   * targets), so that beat is replaced outright rather than kept alongside. */
  private onArcherRainCast(x: number, color: number, state: GameState): void {
    // Bow flash: quick expanding ring + a tiny release burst at the bow.
    this.rings.spawn({ x, y: HERO_MID_Y, r0: 6, r1: 11, duration: 0.15, width: 2, color });
    burst(this.particles, x, HERO_MID_Y, 5, color, { speed: 60, life: 0.2, radius: 2 });

    // Volley launch: a few quick streaks firing upward off the bow, reading
    // as "arrows loosed skyward" before the rain telegraphs its landing zone.
    for (let i = 0; i < RAIN_LAUNCH_STREAK_COUNT; i++) {
      const jitter = (Math.random() - 0.5) * RAIN_LAUNCH_STREAK_SPREAD;
      const height = RAIN_LAUNCH_STREAK_HEIGHT * (0.7 + Math.random() * 0.5);
      this.flashLines.spawn({
        x1: x + jitter,
        y1: HERO_MID_Y,
        x2: x + jitter * 1.3,
        y2: HERO_MID_Y - height,
        color,
        width: 1.6,
        life: 0.16,
        alpha: 0.6,
      });
    }

    // The 9 `rainArrow` drops were just pushed synchronously this same
    // engine step (`engine/systems/skills.ts`) — read them back for their
    // exact (tx,ty) + flight time rather than re-deriving either.
    const drops = state.projectiles.filter((p) => p.team === "hero" && p.kind === "rainArrow");
    for (const p of drops) {
      if (this.pendingRainArrows.length >= MAX_PENDING_RAIN_ARROWS) break;
      const fallDist = Math.hypot(p.tx - p.x, p.ty - p.y);
      const fallTime = Math.max(0.1, fallDist / Math.max(1, p.speed));
      this.rainShadows.trySpawn({ x: p.tx, y: p.ty, life: fallTime, color });
      this.pendingRainArrows.push({ id: p.id, tx: p.tx, ty: p.ty });
    }
  }

  /** Continuous per-frame check of the ARROW RAIN drops queued by
   * `onArcherRainCast()`: the frame a tracked drop's id disappears from
   * `state.projectiles` (i.e. it just resolved on the ground — same
   * "vanished this frame" detection `updateMeteorTracking()` uses), fires
   * the landing puff + ground-stuck-arrow decal. */
  private updateRainArrowTracking(state: GameState): void {
    if (!this.pendingRainArrows.length) return;
    for (let i = this.pendingRainArrows.length - 1; i >= 0; i--) {
      const entry = this.pendingRainArrows[i];
      const stillFalling = state.projectiles.some((p) => p.id === entry.id);
      if (!stillFalling) {
        this.onRainArrowLanded(entry.tx, entry.ty);
        this.pendingRainArrows.splice(i, 1);
      }
    }
  }

  /** One ARROW RAIN drop resolving: a small dirt + feather puff (NOT the
   * bigger AOE impact burst class — this is a hail of small arrows, not a
   * nuke) plus a brief arrow-stuck-in-ground decal. */
  private onRainArrowLanded(x: number, y: number): void {
    burst(this.particles, x, y, RAIN_LAND_DIRT_COUNT, PALETTE.muted, {
      speed: 55,
      life: 0.22,
      radius: 2,
    });
    burst(this.particles, x, y, RAIN_LAND_FEATHER_COUNT, HERO_COLORS.archer.light, {
      speed: 35,
      life: 0.3,
      radius: 1.6,
    });
    this.groundArrows.spawn(x, y, HERO_COLORS.archer.light);
  }

  /** Mage skill (meteor) — "the meteor is a scene" (item 11): a sky flash +
   * a large glowing ground rune at the meteor's fixed target point while it
   * falls; the falling fire tracer is handled continuously by
   * `updateTracers()`, and the scorch-on-impact by `updateMeteorTracking()`. */
  private onMageMeteorCast(x: number, color: number, state: GameState): void {
    // The meteor's fixed ground-target point is `tx` on the projectile the
    // engine pushed synchronously in this same step (see
    // `engine/systems/skills.ts`) — read it back rather than re-deriving it.
    const meteor = state.projectiles.find((p) => p.team === "hero" && p.kind === "meteor");
    const tx = meteor ? meteor.tx : x;

    this.meteorSky.trigger(color, 0.22);
    const fallTime = estimateMeteorFallTime();
    this.runeGlyphs.spawn({
      x: tx,
      y: GROUND_Y,
      radius: METEOR_RUNE_RADIUS,
      ticks: METEOR_RUNE_TICKS,
      color,
      life: fallTime,
      rotationSpeed: 1.6,
      alpha: 0.5,
      fadeInFrac: 0.15,
    });
    if (this.pendingMeteors.length < MAX_PENDING_METEORS) {
      this.pendingMeteors.push({ tx });
    }

    // Cast flourish at the staff.
    burst(this.particles, x, HERO_TOP_Y, 6, color, { speed: 50, life: 0.3, radius: 2.5 });
  }

  /** `projectileSpawn` reactions that aren't already covered by the
   * `skillCast` handlers above: the archer's tiny bow-release glint (item 7)
   * and the mage's small rotating cast glyph on every basic orb (item 10). */
  private onProjectileSpawn(ev: Extract<GameEvent, { type: "projectileSpawn" }>): void {
    if (ev.kind === "arrow") {
      burst(this.particles, ev.x, ev.y, 3, HERO_COLORS.archer.light, {
        speed: 40,
        life: 0.14,
        radius: 1.6,
      });
    } else if (ev.kind === "orb") {
      this.runeGlyphs.spawn({
        x: ev.x,
        y: ev.y,
        radius: 10,
        ticks: 5,
        color: HERO_COLORS.mage.light,
        life: 0.3,
        rotationSpeed: 5,
        alpha: 0.6,
      });
    }
  }

  /** Zone whoosh (M6): full-width, faint, quick — see the `ZONE_WHOOSH_*`
   * knobs above. No world position on `zoneEntered` (nor does one make sense
   * for a full-width beat), so this takes no event payload. */
  private onZoneEntered(): void {
    this.punch.trigger("zoneWhoosh");
    const midY = HERO_TOP_Y;
    const span = (ZONE_WHOOSH_STREAK_COUNT - 1) * ZONE_WHOOSH_STREAK_GAP;
    for (let i = 0; i < ZONE_WHOOSH_STREAK_COUNT; i++) {
      const y = midY - span / 2 + i * ZONE_WHOOSH_STREAK_GAP;
      this.flashLines.spawn({
        x1: -20,
        y1: y,
        x2: WORLD_WIDTH + 20,
        y2: y,
        color: PALETTE.ivory,
        width: 1.4,
        life: ZONE_WHOOSH_STREAK_LIFE,
        alpha: 0.16,
      });
    }
  }

  /** Boss-room entrance (M6): shake + a subtle warm flash + a ring CLOSING in
   * (r0 > r1, same "contract" trick `HERO_DEATH_RING_*` uses) toward the
   * arena center — reads as "the gate shutting behind you". The room's own
   * dedicated dark biome + `bossArena.ts` framing (already active by the
   * time this fires — `arriveAtZone` sets `state.location` before pushing
   * this event) carries the rest of "this is a place" for the whole fight. */
  private onBossRoomEntered(): void {
    const cx = WORLD_WIDTH / 2;
    this.punch.trigger("bossRoomEntered");
    this.shake.trigger(BOSS_ROOM_ENTER_SHAKE);
    this.flash.trigger(PALETTE.enrageAura, BOSS_ROOM_ENTER_FLASH_ALPHA);
    this.rings.spawn({
      x: cx,
      y: GROUND_Y - 40,
      r0: BOSS_ROOM_ENTER_RING_R0,
      r1: BOSS_ROOM_ENTER_RING_R1,
      duration: BOSS_ROOM_ENTER_RING_DURATION,
      width: 4,
      color: PALETTE.boss,
    });
  }

  /** Zone/map unlocked (M6): a small congratulatory sparkle at the (solo)
   * hero's own current position — `mapUnlocked` (crossing into a whole new
   * map) gets the bigger of the two, `zoneUnlocked` (next farm zone/boss room
   * opened up) the smaller. Skipped outright if no hero exists to anchor on. */
  private onProgressUnlocked(kind: "zoneUnlocked" | "mapUnlocked", state: GameState): void {
    const hero = state.heroes[0];
    if (!hero) return;
    const big = kind === "mapUnlocked";
    burst(this.particles, hero.x, HERO_TOP_Y, big ? MAP_UNLOCK_PARTICLE_COUNT : ZONE_UNLOCK_PARTICLE_COUNT, PALETTE.gold, {
      speed: 90,
      life: 0.45,
      radius: 2.5,
      gravity: -25,
      drag: 0.3,
    });
    this.rings.spawn({
      x: hero.x,
      y: HERO_TOP_Y,
      r0: 8,
      r1: big ? MAP_UNLOCK_RING_R1 : ZONE_UNLOCK_RING_R1,
      duration: 0.45,
      width: 3,
      color: PALETTE.gold,
    });
  }

  /** `zoneGateEnter` (M7.5): a small localized glow at the departure-edge gate
   * — distinct from `onZoneEntered()`'s full-width whoosh (which plays
   * separately, later, once the destination zone actually arrives). Reuses
   * the `zoneWhoosh` camera-punch id rather than adding a new one ("extend,
   * don't duplicate" per the feel spec) and adds no new SFX (the existing
   * zone-move whoosh stays visual-only, same as `zoneEntered`). */
  private onZoneGateEnter(ev: Extract<GameEvent, { type: "zoneGateEnter" }>): void {
    this.rings.spawn({
      x: ev.x,
      y: GATE_GLOW_Y,
      r0: 4,
      r1: GATE_ENTER_RING_R1,
      duration: GATE_ENTER_RING_DURATION,
      width: 2.5,
      color: PALETTE.ivory,
    });
    burst(this.particles, ev.x, GATE_GLOW_Y, GATE_ENTER_PARTICLE_COUNT, PALETTE.ivory, {
      speed: 70,
      life: 0.3,
      radius: 2,
    });
    this.punch.trigger("zoneWhoosh", ev.x);
  }

  /** `zoneGateExit` (M7.5): a softer arrival flash at the destination gate —
   * the zone itself already gets `Environment`'s biome crossfade + (for a
   * farm/town arrival) `onZoneEntered()`'s whoosh; this is just "the gate you
   * just emerged from" polish, so it's deliberately smaller than the enter
   * beat above. */
  private onZoneGateExit(ev: Extract<GameEvent, { type: "zoneGateExit" }>): void {
    this.rings.spawn({
      x: ev.x,
      y: GATE_GLOW_Y,
      r0: 6,
      r1: GATE_EXIT_RING_R1,
      duration: GATE_EXIT_RING_DURATION,
      width: 2,
      color: PALETTE.ivory,
    });
    burst(this.particles, ev.x, GATE_GLOW_Y, GATE_EXIT_PARTICLE_COUNT, PALETTE.ivory, {
      speed: 50,
      life: 0.25,
      radius: 1.8,
    });
  }

  /** `fastTravelArrive` (M7.5): collapses the origin-side channel swirl
   * cleanly, then pops a brighter, portal-tinted burst at the destination
   * gate (`ev.x`/`ev.y` are the arrival point the engine already computed). */
  private onFastTravelArrive(ev: Extract<GameEvent, { type: "fastTravelArrive" }>): void {
    this.travelPortal.completeChannel();
    this.rings.spawn({
      x: ev.x,
      y: ev.y,
      r0: 6,
      r1: FASTTRAVEL_ARRIVE_RING_R1,
      duration: 0.3,
      width: 3,
      color: PALETTE.travelPortal,
    });
    burst(this.particles, ev.x, ev.y, FASTTRAVEL_ARRIVE_PARTICLE_COUNT, PALETTE.travelPortalCore, {
      speed: 100,
      life: 0.35,
      radius: 2.5,
    });
    this.punch.trigger("zoneWhoosh", ev.x);
  }

  /** Boss-door unlock beat (M7.5 item 3): the outside face of the M6 boss-
   * room entrance beat — fires once, the instant a map's boss room unlocks,
   * AT THE DOOR (`gateX(mapId, "right")`), not the hero's own position, so
   * "that gate over there just opened" reads correctly even mid-field. The
   * door prop itself (`environment/bossDoor.ts`) reads `isZoneUnlocked` live
   * every frame for its continuous open/glow transform — this is just the
   * one-shot punctuation layered on top, same relationship
   * `onBossRoomEntered()` has to `bossArena.ts`'s persistent framing. */
  private onBossDoorUnlocked(mapId: string): void {
    const x = gateX(mapId, "right");
    const y = GATE_GLOW_Y;
    this.rings.spawn({
      x,
      y,
      r0: 10,
      r1: BOSS_DOOR_UNLOCK_RING_R1,
      duration: BOSS_DOOR_UNLOCK_RING_DURATION,
      width: 4,
      color: PALETTE.boss,
    });
    burst(this.particles, x, y, BOSS_DOOR_UNLOCK_PARTICLE_COUNT, PALETTE.bossLight, {
      speed: 90,
      life: 0.5,
      radius: 3,
      gravity: -20,
      drag: 0.3,
    });
    this.flash.trigger(PALETTE.boss, 0.16);
  }

  /** M7 gear-wow "drop beat" (task 4): a small, rarity-tinted ground
   * sparkle/pop wherever `systems/gear`'s `itemDrop` fired — a farm kill can
   * emit these often on a busy field, so this stays cheap/subtle; the boss's
   * guaranteed roll is always epic-tier-or-better on-curve gear via
   * `bossDropTableForStage`, so it isn't specially distinguished here beyond
   * whatever rarity it actually rolled. The chime lives in
   * `audio/sfxMap.ts`'s `playItemDrop` (`AudioController` reads the same
   * `ITEM_TEMPLATES` lookup independently). */
  private onItemDrop(ev: Extract<GameEvent, { type: "itemDrop" }>): void {
    const rarity: ItemRarity = ITEM_TEMPLATES[ev.templateId]?.rarity ?? "common";
    const color = itemDropAccentColor(rarity);
    const y = ITEM_DROP_POP_Y;

    this.rings.spawn({
      x: ev.x,
      y,
      r0: ITEM_DROP_RING_R0[rarity],
      r1: ITEM_DROP_RING_R1[rarity],
      duration: ITEM_DROP_RING_DURATION[rarity],
      width: rarity === "epic" ? 2.5 : 2,
      color,
    });
    burst(this.particles, ev.x, y, ITEM_DROP_PARTICLE_COUNT[rarity], color, {
      speed: ITEM_DROP_PARTICLE_SPEED[rarity],
      life: ITEM_DROP_PARTICLE_LIFE[rarity],
      radius: rarity === "epic" ? 3 : 2.2,
      gravity: -20, // slight rise — a "loot glimmer", not falling debris
      drag: 0.3,
    });
  }

  /** Detect "a NEW swordsman swing started THIS frame" via `peekSwordSwing()`'s
   * monotonic `seq` (item 2) — continuous read of the live rig, not an event. */
  private detectSwordSwingStart(state: GameState): { comboIndex: number } | null {
    const swordsman = state.heroes.find((h) => h.cls === "swordsman" && !h.dead);
    const view = swordsman ? this.lookupHeroView(swordsman.id) : null;
    if (!view) return null;
    const snap = peekSwordSwing(view);
    if (!snap || snap.seq === this.lastSwordSwingSeq) return null;
    this.lastSwordSwingSeq = snap.seq;
    return { comboIndex: snap.comboIndex };
  }

  /** Slash-crescent flash along the swing's path (item 2) — a small,
   * semi-transparent flash, deliberately subtle since basic attacks fire
   * roughly every 0.5s. */
  private onSwordSwingStart(state: GameState, comboIndex: number): void {
    const swordsman = state.heroes.find((h) => h.cls === "swordsman" && !h.dead);
    const view = swordsman ? this.lookupHeroView(swordsman.id) : null;
    if (!swordsman || !view) return;
    const hasTip = getSwordTipPos(view, this.tipScratch);
    const x = hasTip ? this.tipScratch.x : swordsman.x + 12;
    const y = hasTip ? this.tipScratch.y : HERO_MID_Y;
    this.crescents.spawnSlash({
      x,
      y,
      angle: SWING_CRESCENT_ANGLE[comboIndex] ?? 0,
      sweep: SWING_CRESCENT_SWEEP[comboIndex] ?? 1.1,
      radius: 20,
      thickness: 5,
      life: 0.15,
      color: HERO_COLORS.swordsman.light,
      alpha: 0.5,
    });
  }

  /** Directional mini-burst (steel/gold) + a brief decaying knockback nudge
   * on the struck view (item 3) — see `swingThisFrame`'s doc comment for how
   * this correlates a `hit` event with the swordsman's basic attack. */
  private onSwordMeleeImpact(
    ev: Extract<GameEvent, { type: "hit" }>,
    state: GameState,
    view: Container | null,
  ): void {
    const angle = 0; // heroes always face +x; a forward-ish cone reads fine
    burstDirectional(this.particles, ev.x, ev.y, MELEE_SPARK_COUNT_STEEL, PALETTE.steel, angle, {
      speed: 140,
      life: 0.22,
      radius: 2.5,
      spread: 1.4,
    });
    burstDirectional(this.particles, ev.x, ev.y, MELEE_SPARK_COUNT_GOLD, PALETTE.gold, angle, {
      speed: 110,
      life: 0.26,
      radius: 2,
      spread: 1.6,
    });
    if (view) {
      const swordsman = state.heroes.find((h) => h.cls === "swordsman" && !h.dead);
      const dirSign = swordsman && ev.x < swordsman.x ? -1 : 1;
      this.triggerKnockback(view, dirSign);
    }
  }

  private triggerKnockback(view: Container, dirSign: number): void {
    if (this.knockback.length >= MAX_KNOCKBACK) this.knockback.shift();
    this.knockback.push({
      view,
      t: 0,
      duration: KNOCKBACK_DURATION,
      mag: KNOCKBACK_MAG * dirSign,
    });
  }

  /** Advance every decaying knockback nudge, additively nudging each view's
   * position ON TOP of whatever its owning entity view already set THIS
   * frame (entity views always run before `FxController.update()` in
   * `GameRenderer.draw()`) — never mutates `enemyView.ts`/`bossView.ts`. */
  private updateKnockback(dt: number): void {
    for (let i = this.knockback.length - 1; i >= 0; i--) {
      const k = this.knockback[i];
      if (k.view.destroyed) {
        this.knockback.splice(i, 1);
        continue;
      }
      k.t += dt;
      if (k.t >= k.duration) {
        this.knockback.splice(i, 1);
        continue;
      }
      const frac = k.t / k.duration;
      const decay = 1 - frac;
      // A couple of quick back-and-forth wobbles as it settles — a "jitter",
      // not a one-directional shove.
      const wobble = Math.cos(frac * Math.PI * 3);
      k.view.position.x += k.mag * decay * wobble;
    }
  }

  /** Continuous per-frame sync of every tracked hero projectile's light-trail
   * tracer (items 7/10/11) against the live `state.projectiles` list. */
  private updateTracers(dt: number, state: GameState): void {
    this.tracers.syncFrame(state.projectiles, (p) => this.tracerStyleFor(p), dt);
  }

  /** `TracerStyle` per projectile — only hero arrow/orb/meteor are tracked;
   * everything else (enemy bolts) returns `null` and is skipped. */
  private tracerStyleFor(p: Projectile): TracerStyle | null {
    if (p.team !== "hero") return null;
    if (p.kind === "arrow") {
      return { color: HERO_COLORS.archer.light, width: 2, alpha: 0.5 };
    }
    if (p.kind === "rainArrow") {
      // Archer-green, thinner/dimmer than the meteor's fire trail — a hail
      // of falling arrows, not one big streak.
      return { color: PROJECTILE_COLORS.rainArrow, width: 2.4, alpha: 0.55 };
    }
    if (p.kind === "orb") {
      return { color: HERO_COLORS.mage.light, width: 3, alpha: 0.6 };
    }
    if (p.kind === "meteor") {
      return { color: PALETTE.warn, width: 7, alpha: 0.5 };
    }
    return null;
  }

  /** Orbiting cast-aura sparkles around the mage while `castHold` plays
   * (item 12) — continuous read of the live rig, like `updateWeaponTrail()`. */
  private updateCastAura(dt: number, state: GameState): void {
    const mage = state.heroes.find((h) => h.cls === "mage" && !h.dead);
    const view = mage ? this.lookupHeroView(mage.id) : null;
    const holding = !!mage && !!view && isCastHolding(view);
    this.castAura.update(
      dt,
      holding && mage ? { x: mage.x, y: HERO_MID_Y, color: HERO_COLORS.mage.light } : null,
    );
  }

  /** Watches the in-flight mage meteors this controller is tracking (queued
   * by `onMageMeteorCast()`) and, the frame one disappears from
   * `state.projectiles` (i.e. it just resolved/hit the ground), spawns the
   * glowing scorch patch at its target point (item 11). The existing
   * shockwave/impact-burst on the actual damage `hit` stays unchanged — this
   * only adds the ground decal. */
  private updateMeteorTracking(state: GameState): void {
    if (!this.pendingMeteors.length) return;
    for (let i = this.pendingMeteors.length - 1; i >= 0; i--) {
      const entry = this.pendingMeteors[i];
      const stillFalling = state.projectiles.some(
        (p) => p.team === "hero" && p.kind === "meteor" && Math.abs(p.tx - entry.tx) < 0.5,
      );
      if (!stillFalling) {
        this.scorches.spawn(entry.tx, GROUND_Y, HERO_COLORS.mage.light);
        this.pendingMeteors.splice(i, 1);
      }
    }
  }

  /** Boss death v2 (item 6): queues 3 escalating explosion pulses (particle
   * burst + ring each), 0.15s apart, and DEFERS the existing gold-shower/
   * echo payout beat until they finish — "going down in stages" before the
   * celebration. Runs on real time (`updateBossDeathStages()`, called from
   * `update(dt, ...)`), so it plays through the 120ms hit-stop + 0.25x
   * slow-mo `TimeDirector` applies on this same event — that's correct and
   * desired (see the module's DEATH & SPAWN DRAMA knobs block for the
   * timing/budget notes). */
  private onBossDefeated(ev: Extract<GameEvent, { type: "bossDefeated" }>): void {
    this.bossDeathStages.length = 0;
    for (const spec of BOSS_DEATH_STAGE_SPEC) {
      this.bossDeathStages.push({ ...spec, x: ev.x, y: BOSS_CY });
    }
    this.bossDeathFinal = ev;
  }

  /** Advances the staged boss-defeat pulses queued by `onBossDefeated()`;
   * once all have fired, plays the (unchanged) gold-shower/echo finale once. */
  private updateBossDeathStages(dt: number): void {
    if (!this.bossDeathStages.length && !this.bossDeathFinal) return;
    for (let i = this.bossDeathStages.length - 1; i >= 0; i--) {
      const stage = this.bossDeathStages[i];
      stage.t -= dt;
      if (stage.t <= 0) {
        this.fireBossDeathStage(stage);
        this.bossDeathStages.splice(i, 1);
      }
    }
    if (!this.bossDeathStages.length && this.bossDeathFinal) {
      this.fireBossDeathFinal(this.bossDeathFinal);
      this.bossDeathFinal = null;
    }
  }

  private fireBossDeathStage(stage: BossDeathStage): void {
    burst(this.particles, stage.x, stage.y, stage.particleCount, stage.color, {
      speed: stage.speed,
      life: 0.32,
      radius: 4,
    });
    this.rings.spawn({
      x: stage.x,
      y: stage.y,
      r0: 10,
      r1: stage.radius,
      duration: 0.3,
      width: 4,
      color: stage.color,
    });
    this.shake.trigger(BOSS_DEATH_STAGE_SHAKE);
  }

  /** The pre-existing boss-defeated payout beat (gold burst + shower +
   * "+gold" text + collapse echo) — unchanged, just now fired AFTER the
   * staged pulses above instead of immediately on the event. */
  private fireBossDeathFinal(ev: Extract<GameEvent, { type: "bossDefeated" }>): void {
    this.flash.trigger(PALETTE.killGold, 0.32);
    // Symmetric punch (no `worldX` bias) — a boss-defeated beat isn't "toward
    // a point", it's the whole arena celebrating.
    this.punch.trigger("bossDefeated");
    this.impactFilters.triggerShockwave(ev.x, BOSS_CY);
    burst(this.particles, ev.x, BOSS_CY, 26, PALETTE.killGold, {
      speed: 200,
      life: 0.6,
      radius: 4,
    });
    shower(this.particles, ev.x, WORLD_WIDTH * 0.6, 0, 24, PALETTE.killGold);
    this.eventText.spawn({
      x: ev.x,
      y: BOSS_CY - 40,
      label: `+${ev.goldGained}`,
      color: PALETTE.killGold,
      fontSize: 20,
      duration: 1.1,
      rise: 46,
    });
    // `state.boss` is already null by the time this event is seen (the live
    // BossView is destroyed this same frame) — the collapse-forward plays on
    // this one-shot echo instead (see bossEcho.ts).
    this.bossEcho.trigger(ev.x, BOSS_CY);
  }

  /** Enemy spawn v2 (item 2): render-side mirror of `Pool`'s own "first
   * sight" mark-and-sweep (see the `seenEnemyIds` field doc comment) — opens
   * a ground portal at each newly-seen enemy's spawn point. Called every
   * `update()` (NOT gated behind `frameEvents.length`), since a whole wave
   * can appear in one engine step with no accompanying event beyond the
   * once-per-wave `waveSpawn`. */
  private updateEnemySpawns(state: GameState): void {
    this.frameEnemyIdScratch.clear();
    for (const e of state.enemies) {
      this.frameEnemyIdScratch.add(e.id);
      if (!this.seenEnemyIds.has(e.id)) {
        this.seenEnemyIds.add(e.id);
        this.portals.spawn(e.x, GROUND_Y, ENEMY_COLORS[e.kind], e.size);
      }
    }
    for (const id of this.seenEnemyIds) {
      if (!this.frameEnemyIdScratch.has(id)) this.seenEnemyIds.delete(id);
    }
  }

  /** Boss entrance (item 5): `state.boss` has no dedicated "challenge
   * started" event (the player's `challengeBoss` input flips the field
   * directly — see `engine/systems/boss.ts`), so this is a continuous
   * null -> object edge-check, same shape as `updateMeteorTracking()`. */
  private detectBossEntrance(state: GameState): void {
    const hasBoss = !!state.boss;
    if (hasBoss && !this.hadBoss && state.boss) {
      this.onBossEntrance(state.boss.x);
    }
    this.hadBoss = hasBoss;
  }

  /** Dust wave at his spawn edge + a brief ambient darkening + a mild
   * ground-shake as he stomps in — `x` only (the dust wave belongs at
   * `GROUND_Y`, not the boss's own `y`, same convention `bossSlamLand`
   * already uses). */
  private onBossEntrance(x: number): void {
    burst(this.particles, x, GROUND_Y - 4, BOSS_ENTRANCE_DUST_COUNT, PALETTE.muted, {
      speed: BOSS_ENTRANCE_DUST_SPEED,
      life: BOSS_ENTRANCE_DUST_LIFE,
      radius: 3.5,
    });
    // Ambient darkening — the same reusable full-bleed flash used for
    // enrage/defeat/stage-advanced, just tinted dark instead of bright.
    this.flash.trigger(BOSS_ENTRANCE_DARK_TINT, BOSS_ENTRANCE_DARK_ALPHA);
    this.shake.trigger(BOSS_ENTRANCE_SHAKE);
  }

  /** Best-effort "above the head" y for a hit's damage number (entities are
   * drawn from GROUND_Y + fixed per-kind offsets, NOT their raw `y` field —
   * see heroView/enemyView/bossView, which all ignore entity.y the same way). */
  private hitY(target: HitTargetKind, id: number, state: GameState): number {
    if (target === "hero") return HERO_TOP_Y;
    if (target === "boss") return BOSS_CY - 44;
    const enemy = state.enemies.find((e) => e.id === id);
    const size = enemy?.size ?? 1;
    return GROUND_Y - 42 - 8 * size - 10;
  }
}
