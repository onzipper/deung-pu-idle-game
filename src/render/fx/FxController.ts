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
import { zoneAt } from "@/engine";
import { CONFIG, ENEMY_TYPES, SKILL_TYPES } from "@/engine/config";
import { ITEM_TEMPLATES, isLegendaryTemplate, refineOf, type ItemRarity } from "@/engine/config/items";
import type { Hero, Projectile } from "@/engine/entities";
import type { GameEvent, GameState, HitTargetKind } from "@/engine/state";
import { GROUND_Y, WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";
import {
  BOSS_COLORS,
  HERO_COLORS,
  PALETTE,
  PROJECTILE_COLORS,
  type BossMapId,
} from "@/render/theme";
import { ArenaFlash } from "@/render/fx/arenaFlash";
import { ArmorShardPool } from "@/render/fx/armorShard";
import { ArrowSwarmPool } from "@/render/fx/arrowSwarm";
import { BossEcho } from "@/render/fx/bossEcho";
import { CameraPunch } from "@/render/fx/cameraPunch";
import { CastAuraController } from "@/render/fx/castAura";
import { ChampionAuraController } from "@/render/fx/championAura";
import { TargetLockReticle } from "@/render/fx/commandMarkers";
import { CorpseEchoPool } from "@/render/fx/corpseEcho";
import { CrescentPool } from "@/render/fx/crescent";
import { CurtainSweepPool } from "@/render/fx/curtainSweep";
import { FlashLinePool } from "@/render/fx/flashLines";
import { FloatingTextPool } from "@/render/fx/floatingText";
import { GearSparklePool } from "@/render/fx/gearSparkle";
import { GhostBladePool } from "@/render/fx/ghostBlade";
import { GroundCrackPool } from "@/render/fx/groundCrack";
import { HazardBandOverlay } from "@/render/fx/hazardBand";
import { HitFlashController } from "@/render/fx/hitFlash";
import { ImpactFilterController } from "@/render/fx/impactFilters";
import { LevelUpBurstPool } from "@/render/fx/levelUp";
import { LightPillarPool } from "@/render/fx/lightPillar";
import { MeteorSkyFlash, ScorchPool } from "@/render/fx/meteorScene";
import {
  burst,
  burstDirectional,
  burstInward,
  ParticlePool,
  shower,
} from "@/render/fx/particles";
import { createPixelWeaponFx, type PixelWeaponFx } from "@/render/fx/pixelWeaponFx";
import { PortalPool } from "@/render/fx/portal";
import { GroundArrowPool, RainShadowPool } from "@/render/fx/rainScene";
import { resolveRefineFxRecipe } from "@/render/fx/refineFxRecipes";
import { RefinePrestigeFx } from "@/render/fx/refinePrestige";
import { RingPool } from "@/render/fx/rings";
import { RuneGlyphPool } from "@/render/fx/runeGlyph";
import { ScreenShake } from "@/render/fx/screenShake";
import { ShadowDashPool } from "@/render/fx/shadowDash";
import { SkyDarkenOverlay } from "@/render/fx/skyDarken";
import { SoulWispPool } from "@/render/fx/soulWisp";
import { TracerPool, type TracerStyle } from "@/render/fx/tracer";
import { TravelPortalController } from "@/render/fx/travelPortal";
import { WarCryAuraController } from "@/render/fx/warCryAura";
import { WeaponTrailController, type WeaponTrailFrame } from "@/render/fx/weaponTrail";
import { gateX, isBossZoneIdx } from "@/render/environment/zoneGates";
import { enemyColorFor } from "@/render/views/enemySpecies";
import { WORLD_BOSS_CY } from "@/render/views/worldBossView";
import {
  getArmorAnchorPos,
  getChampionAnchorPos,
  getSwordTipPos,
  getWeaponAnchorPos,
  isCastHolding,
  isHeroAttackSwinging,
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

/** Owner request: War Cry buff aura fades out over the buff's final ~0.5s
 * instead of vanishing the instant `atkBuffTimer` hits 0 (see
 * `updateWarCryFx()`/`fx/warCryAura.ts`). */
const WARCRY_FADE_WINDOW = 0.5;

// ---- M8 party P6 "render the party" — cohort join/leave juice -------------
// A soft ring ping + burst when a hero view FIRST appears (`updatePartyMembership()`
// mirrors `updateEnemySpawns()`'s own first-sight mark-and-sweep convention — no
// dedicated engine event, same reasoning: a whole party can appear in one step),
// a small INWARD-converging puff at the last-known position when one disappears.
// Small/capped, reuses the existing `rings`/`particles` pools — no new pool class.
const PARTY_JOIN_RING_R0 = 4;
const PARTY_JOIN_RING_R1 = 30;
const PARTY_JOIN_RING_DURATION = 0.4;
const PARTY_JOIN_PARTICLE_COUNT = 8;
const PARTY_LEAVE_PARTICLE_COUNT = 6;
const PARTY_LEAVE_PUFF_RADIUS = 20; // burstInward's starting ring radius

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
 * + landing sequence at once — M7.9's STORM tier-3 skill-4 pushes 20 drops
 * per cast (bumped 16->24, matching `rainScene.ts`'s `SHADOW_CAP`/
 * `GROUND_ARROW_CAP` bump, M7.7's BARRAGE was 13 + slack); extra drops beyond
 * the cap are silently skipped (the pools underneath also cap+drop on their
 * own, this just avoids growing an unbounded tracking array). */
const MAX_PENDING_RAIN_ARROWS = 24;
/** Dirt + a few archer-tinted feather motes on landing (small, NOT the boss-
 * slam-sized impact burst — this is a hail of small arrows, not a nuke). */
const RAIN_LAND_DIRT_COUNT = 4;
const RAIN_LAND_FEATHER_COUNT = 3;

// ---- mage: meteor scene (item 11) ------------------------------------------
/** At most 1-2 meteors are ever realistically in flight at once for the
 * signature/cataclysm (12s skill cooldown, <1s flight) — bumped 2->3 (M7.7:
 * cataclysm reuses the SAME `meteor` kind, footgun #6, so a signature
 * meteor's tail end can briefly overlap a cataclysm cast) -> 3->10 (M7.9:
 * APOCALYPSE's tier-3 skill-4 fires an 8-meteor volley in ONE cast — a
 * little slack on top of 8 covers a signature/cataclysm overlap too). */
const MAX_PENDING_METEORS = 10;
const METEOR_RUNE_RADIUS = 46;
const METEOR_RUNE_TICKS = 10;

/** Estimate the mage meteor's real-seconds fall time from its own config
 * (spawn height to impact height, at its skill projectile speed) rather than
 * hand-picking a duration — stays correct if balance retunes those numbers. */
function estimateMeteorFallTime(): number {
  const dropDist =
    CONFIG.layout.groundY -
    CONFIG.layout.heroProjImpactYOffset -
    CONFIG.skills.meteorSpawnY;
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

/** M7.6 ตีบวก — refine +level thresholds that step the M7 gear-wow hooks up
 * one notch early (see `updateGearFx`'s doc). Chosen to land on the spec's own
 * "+7/+10" band language (+7 = the "พลาดลดขั้น" ceiling, +10 = max). */
const REFINE_SPARKLE_THRESHOLD = 7;

/** M7.6+ refine-prestige ladder (owner spec "make +8/+9/+10 visually
 * prestigious") — the "+8: clearly stronger presence" step for the armor
 * sparkle once it's already active per the threshold above; see
 * `gearSparkle.ts`'s `boosted` param doc. The +9/+10 steps are
 * `fx/refinePrestige.ts`'s own thresholds, applied below. Weapon-side +7/+8/
 * +9/+10 escalation now lives entirely inside the M9 pixel-fx recipe ladder
 * (`refineFxRecipes.ts`) instead — see `updateWeaponFx()`. */
const REFINE_PRESTIGE_BOOST_THRESHOLD = 8;

/** M9 pixel-fx weapon port — one `PixelWeaponFx` instance per hero slot,
 * created lazily on first non-null recipe (mobile GPU budget). Same
 * MAX_SLOTS=3 party-cap convention as every other per-hero-slot fx module
 * (`gearSparkle.ts`/`championAura.ts`/`warCryAura.ts`). */
const WEAPON_FX_MAX_SLOTS = 3;
const WEAPON_FX_POOL_SIZE = 140;
/** Constant local origin, reused (never mutated) as the `toLocal` input that
 * resolves `view.weaponArm`'s own pivot point — zero per-frame allocation. */
const WEAPON_FX_ORIGIN = { x: 0, y: 0 };
const WEAPON_FX_PIXEL_SIZE = 2;

// ---- M7.8 "Manual Play" command feedback (tap-to-move / tap-to-attack) ----
// Ground click-marker (`moveOrdered`): 3 concentric fading rings via the
// shared `RingPool` (same started-together-different-radii trick as a sonar
// ping, no dedicated pool needed for a one-shot). Target-lock pulse
// (`targetLocked`): a quick single ring at the locked monster, layered on top
// of `TargetLockReticle`'s own PERSISTENT reticle (continuous per-frame read
// of `hero.command`, see `updateTargetLock()`).
const MOVE_MARKER_RINGS: readonly { r0: number; r1: number; duration: number }[] = [
  { r0: 2, r1: 18, duration: 0.32 },
  { r0: 8, r1: 30, duration: 0.42 },
  { r0: 14, r1: 42, duration: 0.52 },
];
const TARGET_LOCK_PULSE_R0 = 4;
const TARGET_LOCK_PULSE_R1 = 22;
const TARGET_LOCK_PULSE_DURATION = 0.22;
/** Ground-anchored — mirrors every other "entities are effectively 1D on x"
 * convention in this file (see `ITEM_DROP_POP_Y`'s doc). */
const TARGET_LOCK_Y = GROUND_Y - 6;

function itemDropAccentColor(rarity: ItemRarity): number {
  if (rarity === "epic") return PALETTE.gearEpic;
  if (rarity === "rare") return PALETTE.gearRare;
  return PALETTE.steel;
}

// ---- หินเสริมพลัง (enhancement-stone) drop pop — reuses the itemDrop ground-
// pop RECIPE (small ring + burst at a fixed ground y) but with its own fixed
// violet accent (rarity-less — stones don't have a rarity band) and a smaller,
// cheaper footprint since a stone can drop on nearly every kill (unlike gear's
// per-rarity odds). No additive blend (footgun 10) — solid fill only. ----
const STONE_DROP_RING_R0 = 2;
const STONE_DROP_RING_R1 = 15;
const STONE_DROP_RING_DURATION = 0.26;
const STONE_DROP_PARTICLE_COUNT = 4;
const STONE_DROP_PARTICLE_SPEED = 65;
const STONE_DROP_PARTICLE_LIFE = 0.28;
/** Ground-anchored, same convention as `ITEM_DROP_POP_Y`. */
const STONE_DROP_POP_Y = GROUND_Y - 6;

// ---------------------------------------------------------------------------
// M7.7 "Skill Spectacle" — per-class SIGNATURE/UTILITY/ULTIMATE skill fx.
// Every `skillCast` now routes by `ev.skillId` (see `onSkillCast()`), not
// just `ev.heroClass` — the old per-class-only dispatch played the exact same
// beat for a class's signature/utility/ultimate alike, which is exactly the
// "current fx read too alike" gap this pass closes. Per-class VOCABULARY
// (README-binding, jewel-tone-on-desaturated-scenery, footgun-10 flat-alpha):
//   sword   -> crimson slash arcs + ground cracks, hot-metal palette
//   archer  -> emerald/gold horizontal rain-curtain sweeps + feather glints
//   mage    -> arcane violet/azure, sky-level events
// Ultimates (tier-2, FIELD-WIDE) get the biggest shake/punch/sky-event beat
// in the game; each capped at <=1.5s of total spectacle per the task brief.
// Utility skills (warcry/powershot/frostnova) stay modest/legible — no big
// shake, no field-wide dressing, just enough to read as "a different skill".
// ---------------------------------------------------------------------------

// ---- sword: WHIRL signature — a small ground crack under the spin ---------
const WHIRL_CRACK_RADIUS = 55;
const WHIRL_CRACK_LIFE = 0.4;
const WHIRL_IMPACT_SHAKE = 3; // punchy, not disruptive — signature-tier only

// ---- sword: WAR CRY utility (self buff) — modest, no AoE dressing ---------
const WARCRY_RING_R1 = 46;
const WARCRY_PARTICLE_COUNT = 10;

// ---- sword: EARTHQUAKE ultimate (field-wide r460 shockwave) ---------------
const QUAKE_SHAKE = 15; // biggest melee shake in the game (bossSlamLand is 8)
const QUAKE_RING_R1 = 460; // matches SKILLS.sword_quake.radius
const QUAKE_RING_DURATION = 0.6;
/** A handful of extra ground cracks + dust columns scattered across the
 * field (not just at the caster's feet) so the shockwave reads as
 * TRAVELING, staggered over real time via `pendingFieldFx`. */
const QUAKE_SCATTER_COUNT = 4;
const QUAKE_SCATTER_SPAN = 380; // +/- px from the caster
const QUAKE_SCATTER_DURATION = 0.5; // total real seconds the scatter plays over
const QUAKE_DUST_PARTICLE_COUNT = 10;
const QUAKE_CRACK_SCATTER_RADIUS = 90;

// ---- archer: RAIN signature curtain — light dusting ------------------------
const RAIN_CURTAIN_WIDTH = 2;
const RAIN_CURTAIN_ALPHA = 0.5;

// ---- archer: POWER SHOT utility (single nuke) — modest ---------------------
const POWERSHOT_RING_R1 = 18;
const POWERSHOT_STREAK_LEN = 50;

// ---- archer: BARRAGE ultimate (field-wide 13-drop blanket) -----------------
const BARRAGE_CAST_SHAKE = 11;
const BARRAGE_LAND_SHAKE = 4; // a smaller re-punch per landing wave
const BARRAGE_CURTAIN_WIDTH = 3.2;
const BARRAGE_CURTAIN_ALPHA = 0.72;
const BARRAGE_LAND_RING_R1 = 30;
const BARRAGE_LAND_PARTICLE_COUNT = 7;

// ---- mage: FROST NOVA utility (cheap sustained clear) — modest ------------
const FROSTNOVA_RING_R1 = 62;
const FROSTNOVA_PARTICLE_COUNT = 10;

// ---- mage: CATACLYSM ultimate (field-wide r460 sky-fall) -------------------
const CATACLYSM_SHAKE = 17; // the single biggest shake in the game
const CATACLYSM_SKY_ALPHA = 0.42;
const CATACLYSM_RING_R1 = 220; // visual impact ring; the ember scatter below
// sells the rest of the r460 field-wide coverage without a 460px stroked
// circle dominating the whole screen.
const CATACLYSM_EMBER_COUNT = 24;
const CATACLYSM_EMBER_LIFE = 1.1;
const CATACLYSM_SCATTER_SCORCH_SPAN = 240; // +/- px around the true impact x

// ---------------------------------------------------------------------------
// M7.9 "Grand Expansion" tier-3 skill-4 spectacles — each MUST clearly
// OUT-SPECTACLE its own class's tier-2 ultimate above (owner spec). All three
// reuse the SAME mechanisms/pools the tier-2 ultimates already do (field-
// scatter scheduling, rain-arrow tracking, meteor tracking) rather than
// inventing new ones — see each cast handler's doc comment.
// ---------------------------------------------------------------------------

// ---- sword: SKYFALL BLADE ("sword_skyfall") --------------------------------
// A field-wide (r500 > quake's r460) lightning-sword strike: the biggest
// shake in the sword kit, several instant lightning bolts dropping from the
// sky at scattered field positions (not just the caster's feet, since
// `strike` resolves its AoE damage instantly with no projectile to wait on),
// plus a real TIME-FREEZE beat (`timeDirector.ts`'s `FREEZE_SWORD_SKYFALL`) —
// the only tier-3 skill-4 beat that stops SIM time outright rather than just
// camera/shake juice.
const SKYFALL_SHAKE = 20; // above quake's 15 — biggest shake in the sword kit
const SKYFALL_RING_R1 = 500; // matches SKILLS.sword_skyfall.radius
const SKYFALL_RING_DURATION = 0.65;
const SKYFALL_CRACK_RADIUS = 130; // bigger than quake's 90
const SKYFALL_BOLT_COUNT = 5; // lightning bolts scattered across the field
const SKYFALL_BOLT_SPAN = 210; // +/- px per side from the caster
const SKYFALL_BOLT_HEIGHT = 260; // sky-to-ground drop height
/** Extra scatter beats beyond quake's own `QUAKE_SCATTER_COUNT` — a wider,
 * bigger field-scatter selling the r500 reach past quake's r460. */
const SKYFALL_SCATTER_EXTRA = 2;
const SKYFALL_SCATTER_SPAN_MULT = 1.25;

// ---- archer: STORM ("archer_storm") ----------------------------------------
// A SUSTAINED ~4s storm: a green-tinted sky-darken + an arrow-swarm
// silhouette band sweeping the top of the sky (both held for the whole
// storm), 20 rain-arrow drops whose ground-stuck decals linger 4-5s (vs the
// signature's 0.6s default) so the field visibly bristles with arrows by the
// finale — which fires the instant the LAST tracked drop lands: a big
// field-wide ring + closing shake + every ground-stuck arrow glinting then
// fading together (see `onStormFinale()`).
const STORM_CAST_SHAKE = 6; // modest at cast — the spectacle builds over the storm
const STORM_SKY_ALPHA = 0.3;
const STORM_SKY_HOLD = 3.7; // real seconds, matches the ~4s drop spread
const STORM_SWARM_COUNT = 7;
const STORM_SWARM_Y = 26; // near the top of the WORLD_HEIGHT=300 sky band
const STORM_GROUND_ARROW_LIFE = 4.5; // vs the signature/barrage default 0.6s
const STORM_FINALE_SHAKE = 13; // above barrage's 11 cast / 4 land shakes
const STORM_FINALE_RING_R1 = 320; // bigger than barrage's 30 landing ring
const STORM_FINALE_RING_DURATION = 0.65;
const STORM_FINALE_PARTICLE_COUNT = 22;
const STORM_FINALE_FADE_DURATION = 0.55; // every ground arrow glints then fades over this

// ---- mage: APOCALYPSE ("mage_apocalypse") ----------------------------------
// An 8-meteor volley reading as world-ending: the sky-darken HOLDS much
// longer + darker than cataclysm's brief pulse, and each of the 8 landings
// gets its own (smaller than cataclysm's single big) impact beat — repeated
// re-triggers over the volley's landing window read as SUSTAINED devastation
// rather than one flash.
const APOCALYPSE_SKY_ALPHA = 0.56; // darker than cataclysm's 0.42
const APOCALYPSE_SKY_HOLD = 2.6; // vs cataclysm's fixed 0.4
const APOCALYPSE_IMPACT_SHAKE = 9; // per-meteor; retriggered per landing (max policy)
const APOCALYPSE_RING_R1 = 130;
const APOCALYPSE_RUNE_RADIUS = METEOR_RUNE_RADIUS * 1.3;

// ---------------------------------------------------------------------------
// NINJA (นินจา, SAVE v18 render wave, docs/ninja-design.md §7) skill fx — the
// silver/dark-violet jewel-tone family (`PALETTE.ninjaSilver`/`ninjaViolet`/
// `ninjaVioletDark`), deliberately distinct from every other class's fx
// language. The `dash` reposition primitive itself (shared by all 4 skills)
// gets its own dedicated shadow-streak + afterimage module (`shadowDash.ts`,
// driven off the `heroDashed` event — see `onHeroDashed()` below); the
// per-skill handlers here layer each skill's own IMPACT identity on top —
// same "reuse the dash trail, differentiate the strike" split the doc calls
// for (§3: "spectacle ท่า 3/4 ใช้เครื่อง skyDarken/curtain/time-freeze เดิม").
// Footgun 10 everywhere: flat/solid on NORMAL blend + a darker underlayer,
// never additive.
// ---------------------------------------------------------------------------

// ---- ninja: SHADOW BLINK signature ("ninja_dashstrike") — modest ----------
const NINJA_STRIKE_RING_R1 = 26;
const NINJA_STRIKE_PARTICLE_COUNT = 7;
const NINJA_STRIKE_SHAKE = 2; // punchy-but-mild, signature-tier only (matches WHIRL_IMPACT_SHAKE's class)

// ---- ninja: TWIN FANG utility ("ninja_twinfang") — rapid alternating hits +
// a small splash, NOT nuke-ified (kept distinct in role, like powershot). --
const NINJA_FLURRY_HIT_COUNT = 5;
const NINJA_FLURRY_HIT_GAP = 0.05; // real seconds between the 5 flurry slash streaks
const NINJA_FLURRY_STREAK_LEN = 22;
const NINJA_SPLASH_RING_R1 = 80; // matches SKILLS.ninja_twinfang.radius

// ---- ninja: SHADOW MASSACRE ultimate ("ninja_massacre", tier-2) — the chain
// of up to 8 dashes already gets its own streak+afterimage per hop from
// `shadowDash.ts` (fired once per `heroDashed` event); this adds the
// FIELD-WIDE cast punch that sells "this is the ultimate", not just 8 plain
// dashes back to back. -----------------------------------------------------
const NINJA_MASSACRE_SHAKE = 12;
const NINJA_MASSACRE_RING_R1 = 340; // reads across most of the ~900px field

// ---- ninja: ETERNAL SHADOWS tier-3 skill-4 ("ninja_eternal") — MUST clearly
// out-spectacle the massacre ultimate above (owner spec, mirrors every other
// class's tier-3 skill-4): a held violet sky-darken (จอสลัว) + a shadow-clone
// slash streak fired at EVERY live target on the field (reusing
// `shadowDash.ts`'s own streak visual, hero-position -> each target), the
// biggest shake in the ninja kit, then the real body's own centroid-blink
// streak (fired separately via the normal `heroDashed` handler) reads as
// "arriving after the clones already struck".
const NINJA_ETERNAL_SKY_ALPHA = 0.5;
const NINJA_ETERNAL_SKY_HOLD = 0.5;
const NINJA_ETERNAL_SHAKE = 18; // above massacre's 12 — biggest in the ninja kit
const NINJA_ETERNAL_RING_R1 = 480;
const NINJA_ETERNAL_CLONE_MAX = 12; // field-wide but capped, matches other ultimates' caps

// ---------------------------------------------------------------------------
// M7.9 "Grand Expansion" boss-variety MECHANIC telegraphs (charge/summon/
// hazard, maps 4-6) — render follow-up for the events introduced in 993c315
// (see `engine/state/events.ts`'s own doc comment; the engine side already
// shipped, this file was the "unhandled kind -> default no-op" gap). Telegraph
// colors stay the UNIVERSAL `PALETTE.warn` (the same "red = danger" language
// as `bossSlamTelegraph`/`bossView.ts`'s telegraph ring) with a per-map BOSS
// TINT ACCENT (`BOSS_COLORS[mapId].crown`, resolved via `zoneAt(state.location)`
// — same plumbing convention as `bossView.ts`'s own `ctx.mapId`) layered on
// top, so each mechanic still reads as "that boss's own attack". Every beat
// reuses an EXISTING pool (rings/flashLines/particles/runeGlyphs) — the one
// new primitive is `hazardBand.ts`'s field-wide warn overlay, which has no
// existing single-shape effect to repurpose (same reasoning as
// `skyDarken.ts`/`arenaFlash.ts` each earning their own reusable shape).
// ---------------------------------------------------------------------------

// ---- CHARGE (map4 s20, ice-tundra) -----------------------------------------
/** Low, ground-hugging streak from the boss toward the locked dash target —
 * a "look out, it's coming from there" read distinct from the boss's own
 * body (which stays readable, unobscured). */
const CHARGE_STREAK_Y = GROUND_Y - 14;
const CHARGE_STREAK_WIDTH = 3;
const CHARGE_STREAK_ALPHA = 0.55;
/** Boss-side windup flash — a small tightening ring at the boss's own
 * position, echoing `bossSlamTelegraph`'s ring but tighter/faster (a dash
 * windup is quicker than a slam). */
const CHARGE_WINDUP_RING_R0 = 8;
const CHARGE_WINDUP_RING_R1 = 34;
const CHARGE_HIT_SHAKE_CONNECTED = 9;
const CHARGE_HIT_SHAKE_WHIFF = 4;
const CHARGE_HIT_RING_R1_CONNECTED = 80;
const CHARGE_HIT_RING_R1_WHIFF = 42;
const CHARGE_HIT_PARTICLE_COUNT_CONNECTED = 16;
const CHARGE_HIT_PARTICLE_COUNT_WHIFF = 7;

// ---- SUMMON (map5 s25, desert-ruins) ---------------------------------------
/** A brief arcane glyph pulse at the boss (reuses the mage meteor's rune-
 * glyph shape/pool — a "calling forth" read fits the same vocabulary) + a
 * small spawn puff at each add's own arrival point (computed from the SAME
 * `CONFIG.bossBehavior.summon.spawnSpacing` the engine used to place them —
 * no new event field needed). */
const SUMMON_GLYPH_RADIUS = 42;
const SUMMON_GLYPH_LIFE = 0.55;
const SUMMON_PUFF_PARTICLE_COUNT = 6;

// ---- FIELD HAZARD (map6 s30, hell-city) ------------------------------------
/** Warn window uses `hazardBand.ts`'s pulsing ground band/edge glow, held for
 * the engine's own telegraph duration (`CONFIG.bossBehavior.hazard.telegraph`)
 * so the read resolves right as the first strike tick lands. Each strike tick
 * (fires ~3-4x across the 1s strike window) gets its own modest re-punch
 * (shake + a quick arena flash + a small burst at the boss) — NOT the big
 * one-shot beats above, since this one repeats. */
const HAZARD_WARN_PEAK_ALPHA = 0.4;
const HAZARD_STRIKE_SHAKE = 6;
const HAZARD_STRIKE_FLASH_ALPHA = 0.2;
const HAZARD_STRIKE_PARTICLE_COUNT = 10;

// ---------------------------------------------------------------------------
// WORLD BOSS "เสี่ยจ๋อง" (hourly world boss, render wave) — spawn/despawn/defeat
// juice. Its shared combat telegraphs (slam/charge/hazard) reuse the EXISTING
// handlers above unmodified except for the boss's own screen-height anchor
// (see `bossCy()`) and tint (see `resolveBossTint()`) — only these THREE new
// lifecycle events get dedicated beats here. Gated by `isLocalInWorldBossZone()`
// (screen-level beats only fire for a client actually standing in the boss's
// zone — a zone-wide world event, not a POV-hero concern; see that helper's
// doc comment) rather than `povHeroIndex`.
// ---------------------------------------------------------------------------
const WORLD_BOSS_SPAWN_DUST_COUNT = 22;
const WORLD_BOSS_SPAWN_DUST_SPEED = 100;
const WORLD_BOSS_SPAWN_DUST_LIFE = 0.6;
const WORLD_BOSS_SPAWN_DARK_ALPHA = 0.3; // a touch stronger than the stage boss's 0.25
const WORLD_BOSS_SPAWN_SHAKE = 7;

const WORLD_BOSS_DESPAWN_SMOKE_COUNT = 16;
const WORLD_BOSS_DESPAWN_SMOKE_SPEED = 40;
const WORLD_BOSS_DESPAWN_SMOKE_LIFE = 0.9;
const WORLD_BOSS_DESPAWN_RING_R0 = 20;
const WORLD_BOSS_DESPAWN_RING_R1 = 4;
const WORLD_BOSS_DESPAWN_RING_DURATION = 0.5;

/** Bigger than the stage boss's `BOSS_DEATH_STAGE_SPEC` — a world event
 * deserves the biggest gold payoff in the game. */
const WORLD_BOSS_DEFEAT_STAGE_SPEC: readonly BossDeathStageSpec[] = [
  { t: 0, radius: 70, particleCount: 16, speed: 160, color: PALETTE.worldBossGold },
  { t: 0.15, radius: 110, particleCount: 22, speed: 190, color: PALETTE.worldBossGold },
  { t: 0.32, radius: 150, particleCount: 30, speed: 220, color: PALETTE.killGold },
];
const WORLD_BOSS_DEFEAT_SHAKE = 12;
const WORLD_BOSS_DEFEAT_FLASH_ALPHA = 0.3;
const WORLD_BOSS_DEFEAT_SHOWER_COUNT = 40; // a real coin FOUNTAIN, not a shower
const WORLD_BOSS_DEFEAT_SHOWER_WIDTH = 260;

// ---------------------------------------------------------------------------
// ดินแดนอสูร (ASURA endgame v1, docs/endgame-design.md) ELITE roaming-mob beats
// — the PERSISTENT pulsing aura ring lives in `enemyView.ts` (continuous,
// reads `enemy.elite` directly every frame, same "continuous belongs in the
// view" convention as boss enrage tint); these two are the EDGE-TRIGGERED
// beats off `eliteSpawned`/`eliteKilled` (a spawn telegraph + a bigger-than-
// normal kill flourish banking the essence). Both reuse existing pools
// (rings/particles/eventText) — no new pool class needed for a rare beat.
// ---------------------------------------------------------------------------
const ELITE_SPAWN_RING_R0 = 6;
const ELITE_SPAWN_RING_R1 = 70;
const ELITE_SPAWN_RING_DURATION = 0.55;
const ELITE_SPAWN_PARTICLE_COUNT = 12;
const ELITE_SPAWN_FLASH_ALPHA = 0.14; // subtle — a rare-find sting, not a boss-enrage-sized flash

const ELITE_KILL_SHAKE = 6;
const ELITE_KILL_RING_R1 = 100;
const ELITE_KILL_RING_DURATION = 0.5;
const ELITE_KILL_PARTICLE_COUNT = 20;
/** Ground-anchored (the event carries no `kind`, unlike `kill` — see
 * `engine/state/events.ts`'s `eliteKilled` shape), same "entities are
 * effectively 1D on x" convention as `ITEM_DROP_POP_Y`/`STONE_DROP_POP_Y`,
 * pitched a touch taller since an elite is the scaled-up silhouette. */
const ELITE_KILL_POP_Y = GROUND_Y - 30;

// ---------------------------------------------------------------------------
// "ตำราตำนาน" LEGENDARY tome/craft beats (endgame v1.2/v1.3, docs/endgame-
// design.md render wave) — `tomePageFound`/`tomeAssembled`/
// `legendaryCraftRequested` carry no world position of their own (a secret-
// quest/menu-unlock/craft-request, not a combat impact), so every beat below
// anchors at the solo hero's own position (`state.heroes[0]`, or the
// craft-matching class if one exists — see `onLegendaryCraftRequested`'s own
// doc). Escalating weight, same convention as `onLevelUp`/`onEvolve`: page
// find is the smallest ("something fluttered down"), tome assembly is the
// biggest reveal (menu permanently unlocked), craft request sits in between
// (a forge flourish, not a new permanent state flip).
const TOME_PAGE_RING_R0 = 4;
const TOME_PAGE_RING_R1 = 26;
const TOME_PAGE_RING_DURATION = 0.32;
const TOME_PAGE_PARTICLE_COUNT = 7;
const TOME_PAGE_PARTICLE_SPEED = 40;
const TOME_PAGE_PARTICLE_LIFE = 0.4;
const TOME_PAGE_TEXT_DURATION = 0.85;
const TOME_PAGE_TEXT_RISE = 30;

const TOME_ASSEMBLED_PILLAR_HEAD_MARGIN = 30;
const TOME_ASSEMBLED_PILLAR_WIDTH = 20;
const TOME_ASSEMBLED_PILLAR_DURATION = 0.55;
const TOME_ASSEMBLED_BURST_DURATION = 0.7;
const TOME_ASSEMBLED_RING_R0 = 16;
const TOME_ASSEMBLED_RING_R1 = 72;
const TOME_ASSEMBLED_RING_DURATION = 0.6;
const TOME_ASSEMBLED_PARTICLE_COUNT_GOLD = 16;
const TOME_ASSEMBLED_PARTICLE_COUNT_VIOLET = 10;
const TOME_ASSEMBLED_PARTICLE_SPEED = 100;
const TOME_ASSEMBLED_PARTICLE_LIFE = 0.6;
const TOME_ASSEMBLED_FLASH_ALPHA = 0.26;

const LEGENDARY_CRAFT_RING_R0 = 18;
const LEGENDARY_CRAFT_RING_R1 = 90;
const LEGENDARY_CRAFT_RING_DURATION = 0.5;
const LEGENDARY_CRAFT_RING2_R1 = 60;
const LEGENDARY_CRAFT_RING2_DURATION = 0.62;
const LEGENDARY_CRAFT_PARTICLE_COUNT = 18;
const LEGENDARY_CRAFT_PARTICLE_SPEED = 95;
const LEGENDARY_CRAFT_PARTICLE_LIFE = 0.5;
const LEGENDARY_CRAFT_FLASH_ALPHA = 0.28;

interface KnockbackEntry {
  view: Container;
  t: number;
  duration: number;
  mag: number;
}

interface PendingMeteor {
  /** M7.9: tracked by projectile id (not just `tx` proximity) so several
   * concurrent APOCALYPSE drops with nearby target x's can't be confused
   * with one another — the signature/cataclysm single-meteor case still
   * works fine keyed this way too. */
  id: number;
  tx: number;
  /** True for `mage_cataclysm`/`mage_apocalypse` — resolves a bigger-than-
   * signature impact beat instead of the plain scorch-on-landing. */
  isUltimate: boolean;
  /** True ONLY for `mage_apocalypse` (M7.9 tier-3 skill-4) — routes to the
   * per-meteor `onApocalypseMeteorImpact()` beat instead of cataclysm's
   * single big `onCataclysmImpact()`. */
  isApocalypse?: boolean;
  /** M8 party P6 POV gating: whether the CASTING hero was the point-of-view
   * hero at cast time — captured here (not re-derived at landing time, when
   * the caster may have changed slot/died) so the delayed impact beat
   * (`onCataclysmImpact()`/`onApocalypseMeteorImpact()`) can gate its
   * SCREEN-level shake/punch/filter on the caster's identity, not whoever
   * happens to be POV when the meteor actually lands. */
  pov: boolean;
}

/** One in-flight ARROW RAIN drop being tracked from cast to landing — `id`
 * matches it against `state.projectiles` (unlike the single-meteor case,
 * several drops can share a similar `tx`, so id is the reliable key here). */
interface PendingRainArrow {
  id: number;
  tx: number;
  ty: number;
  /** True for `archer_barrage`/`archer_storm` — a bigger landing dirt/feather
   * puff than the signature rain's small one. */
  big: boolean;
  /** True ONLY for `archer_storm` (M7.9 tier-3 skill-4) — routes its landing
   * decal through the much-longer `STORM_GROUND_ARROW_LIFE` and counts down
   * `stormArrowsRemaining` toward the finale beat instead of BARRAGE's
   * per-landing ring/shake. */
  isStorm?: boolean;
  /** M8 party P6 POV gating — see `PendingMeteor.pov`'s doc comment; same
   * reasoning, captured at cast time for the delayed landing beat
   * (`onRainArrowLanded()`'s BARRAGE re-punch shake). */
  pov: boolean;
}

/** One scheduled field-wide beat (M7.7 quake ultimate, M7.9 skyfall) — a
 * ground crack + dust burst fired `t` real seconds after cast, at a fixed
 * `x`, so the shockwave reads as spreading across the field over time rather
 * than everything popping in at once. Capped small (`QUAKE_SCATTER_COUNT`). */
interface PendingFieldFx {
  t: number;
  x: number;
  /** M7.9: a bigger scatter beat for the SKYFALL ultimate (vs quake's plain
   * scatter) — a larger crack/dust/ring at this scheduled point. */
  big?: boolean;
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
  /** NINJA `dash` reposition primitive fx (SAVE v18 render wave) — shadow
   * streak + afterimage, triggered off the `heroDashed` event (see
   * `onHeroDashed()`); shared by every ninja skill that repositions. */
  private readonly shadowDash: ShadowDashPool;
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

  // ---- M7 gear-wow: tier-5+ armor sparkle ----------------------------------
  // Continuous (not event-driven) — driven every frame in `updateGearFx()`
  // from live `GameState`, same convention as `updateWeaponTrail()`/
  // `updateCastAura()`.
  private readonly gearSparkle: GearSparklePool;
  /** M7.6+ refine-prestige ladder's armor-side +9/+10 steps — reuses
   * `this.particles`/`this.rings` (constructed below), adds zero new pooled
   * Graphics of its own. See `updateGearFx()`. (The WEAPON side of this
   * ladder was retired in the M9 pixel-fx port below — `weaponFx`'s recipe
   * system covers +0..+10 on its own.) */
  private readonly refinePrestige: RefinePrestigeFx;

  /** M9 pixel-fx weapon port (owner-approved `/lab` refineLadder look):
   * replaces the OLD `gearAura.ts` tier-6/epic flame aura + `refinePrestige.ts`
   * weapon-side +9/+10 steps + `legendaryFx.ts`'s per-class idle signature/
   * swing trail — for EVERY weapon (normal AND legendary alike; the owner's
   * mid-task amendment retired `legendaryFx.ts` entirely in favor of this same
   * recipe system at `resolveRefineFxRecipe(rarity, refine, true)`). One
   * `PixelWeaponFx` per hero slot, created LAZILY on first non-null recipe
   * (mobile GPU budget — a common/rare +0 weapon never allocates one). Runs
   * the sim SMOOTH 60fps in-game (`setStepFps(60)`) — the module's own
   * stepped-12fps mode exists to match PIXEL-ART sprite hosts; this game's
   * weapons are smooth code-drawn vectors (owner eye-verdict, same call
   * `/lab`'s refineLadder experiment already defaults to). See
   * `updateWeaponFx()`. */
  private readonly weaponFx: (PixelWeaponFx | null)[] = new Array(WEAPON_FX_MAX_SLOTS).fill(
    null,
  );
  /** Rising-edge swing detect per weapon-fx slot (same convention as
   * `legendaryFx.ts`'s old `isHeroAttackSwinging()` sampling) — `notifySwing()`
   * fires once per NEW swing window, not every frame one is active. */
  private readonly weaponFxWasSwinging: boolean[] = new Array(WEAPON_FX_MAX_SLOTS).fill(false);

  /** HOF seasonal rewards (docs/hof-rewards-design.md §3 item 2, render wave):
   * the rank-1 champion gold aura — same continuous-per-frame convention as
   * `gearSparkle`/`warCryAura`. See `updateChampionAura()`. */
  private readonly championAura: ChampionAuraController;
  /** Per-hero-id social badge map (title + champion flag), mirroring
   * `GameRenderer.heroDisplayNames`'s own defensive-read convention — set via
   * `setHeroSocialBadges()`, read every frame in `updateChampionAura()`.
   * `null` (default/unset) means "no champion this season", matching every
   * existing solo/sim call site that never calls the new seam. */
  private heroSocialBadges: ReadonlyMap<
    string,
    { title: string | null; champion: boolean }
  > | null = null;

  /** Owner request: on-character aura while a hero's War Cry ATK buff
   * (`hero.atkBuffTimer`) is active — same continuous-per-frame convention as
   * `weaponFx`/`gearSparkle` above, but keyed off the buff timer instead of
   * equipped-gear tier/rarity. See `updateWarCryFx()`. */
  private readonly warCryAura: WarCryAuraController;

  // ---- M7.7 "Skill Spectacle" per-class skill fx additions -----------------
  // Ground cracks (sword whirl/quake) live in the CORPSE layer (ground decals,
  // bottom of the fx stack, same as `scorches`/`portals`); the rain-curtain
  // sweep (archer rain/barrage) lives in the TRAIL layer (falls like a
  // tracer, same as `rainShadows`) — both deliberately kept toward the BACK
  // of this controller's own z-order so they never fight damage numbers/HP
  // bars for legibility on a busy 21-mob field (the readability guard).
  private readonly groundCracks: GroundCrackPool;
  private readonly curtainStreaks: CurtainSweepPool;
  /** Full-bleed sky-darken overlay for the CATACLYSM/APOCALYPSE ultimates —
   * same "one shared shape, topmost" convention as `meteorSky`/`flash` below. */
  private readonly skyDarken: SkyDarkenOverlay;
  /** M7.9 boss-variety FIELD HAZARD warn overlay (map6) — see the knobs block
   * above and `fx/hazardBand.ts`'s own doc comment. */
  private readonly hazardBand: HazardBandOverlay;

  // ---- M7.9 "Grand Expansion" tier-3 skill-4 additions ---------------------
  /** STORM's arrow-swarm silhouette band — lives alongside `skyDarken` as the
   * "swarm" half of the same sustained sky event (see `onArcherStormCast()`). */
  private readonly arrowSwarm: ArrowSwarmPool;
  /** Countdown toward the STORM finale beat (`onStormFinale()`) — incremented
   * once per tracked drop at cast time, decremented as each lands (see
   * `updateRainArrowTracking()`). Deliberately a flat counter rather than a
   * per-batch id: an overlapping double-cast (3x speed) just merges into one
   * counter and fires one finale once BOTH batches finish landing — a
   * render-only simplification, never a correctness concern. */
  private stormArrowsRemaining = 0;
  /** M8 party P6 POV gating: whether ANY still-in-flight STORM cast that
   * contributed to the current `stormArrowsRemaining` countdown was cast by
   * the POV hero — the finale (`onStormFinale()`) is a single aggregate beat
   * (see `stormArrowsRemaining`'s own doc comment on why overlapping casts
   * merge into one counter), so this is set (never cleared early) whenever a
   * POV cast contributes, and reset once the finale actually fires. Default
   * `false` is correct: solo play never touches this flag before a real POV
   * storm cast sets it (see `onArcherStormCast()`). */
  private stormFinalePov = false;

  /** M8 party P6 "co-op spectacle stays world-anchored, screen beats stay
   * personal": index into `state.heroes` of the LOCAL point-of-view hero.
   * World-anchored fx (particles/rings/ground decals/sky overlays anchored at
   * a caster's position) fire for every co-op skill cast regardless of who
   * cast it; screen-level beats (camera shake/punch, full-viewport sky/flash
   * overlays, `ImpactFilterController` shockwave) are gated to fire ONLY when
   * the casting hero (`skillCast.slot`) matches this index — see
   * `onSkillCast()`. Default 0 + every solo event's `slot` is always 0, so
   * solo play is unaffected (`pov` always true) without this ever being set. */
  private povHeroIndex = 0;

  // ---- M7.8 "Manual Play" command feedback ---------------------------------
  // Continuous per-frame read of `state.heroes[0].command` (same convention
  // as `weaponFx`/`castAura` above) — see `updateTargetLock()`.
  private readonly targetLock: TargetLockReticle;

  // ---- M7.5 world-gate navigation (fast-travel channel swirl) --------------
  private readonly travelPortal: TravelPortalController;
  /** Reused every frame — `getWeaponAnchorPos()`/`getArmorAnchorPos()` write
   * into these instead of allocating a fresh point (zero steady-state
   * allocation), same convention as `tipScratch` above. */
  private readonly weaponAnchorScratch = { x: 0, y: 0 };
  private readonly armorAnchorScratch = { x: 0, y: 0 };
  /** Reused every frame by `updateChampionAura()` — same zero-steady-state-
   * allocation convention as `weaponAnchorScratch`/`armorAnchorScratch`. */
  private readonly championAnchorScratch = { x: 0, y: 0 };
  /** Reused every frame by `updateWarCryFx()` — same chest anchor
   * (`getArmorAnchorPos()`) the armor sparkle already reads, kept as its own
   * scratch point (not reused) so the two effects never stomp each other's
   * in-flight value within the same frame. */
  private readonly warCryAnchorScratch = { x: 0, y: 0 };
  /** Reused every frame by `updateWeaponFx()` — the weapon-arm PIVOT (local
   * origin `(0,0)` of `view.weaponArm`, converted into `view.parent`-local
   * space) that `weaponAnchorScratch − this` gives the blade DIRECTION for
   * `PixelWeaponFx.setAnchor()`'s optional dir args, same technique
   * `/lab/experiments/refineLadder.tsx`'s `updateFxAnchor()` uses. */
  private readonly weaponFxPivotScratch = { x: 0, y: 0 };

  /** Last-seen "does a boss currently exist" — `state.boss` transitions
   * null -> object with no dedicated event (the player's `challengeBoss`
   * input flips it directly; see `engine/systems/boss.ts`), so the entrance
   * beat is detected the same continuous-per-frame way as
   * `updateWeaponTrail()`/`updateCastAura()` below, in `update()`. */
  private hadBoss = false;

  /** WORLD BOSS "เสี่ยจ๋อง": last-seen live position, refreshed every `update()`
   * call while `state.worldBoss.entity` exists. `worldBossDespawned`/
   * `worldBossDefeated` carry only a `windowId` (no x/y — unlike `bossDefeated`,
   * which carries its own position) and the entity is ALREADY nulled by the
   * step that emits them (`systems/worldBoss.ts`'s `retireWorldBoss` clears
   * `entity` before pushing the event), so this cache — populated a frame
   * earlier while the boss was still alive — is the only way those two
   * handlers know where to anchor their beat. Never cleared back to null (the
   * last-known spot stays valid across the one frame the entity disappears). */
  private worldBossLastPos: { x: number; y: number } | null = null;

  /** Render-side mirror of `Pool`'s own mark-and-sweep "first sight" — a
   * whole wave of enemies can appear in ONE engine step, so this is checked
   * every `update()` call (not gated behind `frameEvents.length`) against the
   * live `state.enemies` list. `frameEnemyIdScratch` is cleared and refilled
   * every frame (never a fresh `Set`, so this is zero steady-state
   * allocation, same convention as `Pool.beginFrame()`'s `seen` set). */
  private readonly seenEnemyIds = new Set<number>();
  private readonly frameEnemyIdScratch = new Set<number>();

  /** M8 party P6: same first-sight mark-and-sweep convention as `seenEnemyIds`
   * above, applied to `state.heroes` — a party-join/leave ping has no
   * dedicated engine event (a whole cohort can appear/leave in one step; see
   * `updatePartyMembership()`). Keyed id -> last-seen x (needed for the leave
   * puff, which fires AFTER the hero has already dropped out of
   * `state.heroes` — there's no position left to read from `state` by then). */
  private readonly seenHeroPos = new Map<number, number>();
  private readonly framePartyIdScratch = new Set<number>();

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

  /** Scheduled quake-ultimate scatter beats (ground crack + dust column),
   * capped at `QUAKE_SCATTER_COUNT` — see `onSwordQuakeCast()`/
   * `updatePendingFieldFx()`. */
  private readonly pendingFieldFx: PendingFieldFx[] = [];

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
    // Bumped 6->12 (M7.9): APOCALYPSE's 8-meteor volley + a concurrent
    // signature/cataclysm scorch shouldn't self-evict mid-volley.
    this.scorches = new ScorchPool(this.corpseLayer, 12);
    this.portals = new PortalPool(this.corpseLayer);
    this.armorShards = new ArmorShardPool(this.corpseLayer);
    this.rainShadows = new RainShadowPool(this.corpseLayer);
    this.groundArrows = new GroundArrowPool(this.corpseLayer);
    // Bumped 8->14 (M7.9): SKYFALL's own bigger scatter (`SKYFALL_SCATTER_EXTRA`
    // on top of quake's own count) needs a little more headroom than quake alone.
    this.groundCracks = new GroundCrackPool(this.corpseLayer, 14);
    this.weaponTrail = new WeaponTrailController(this.trailLayer);
    this.tracers = new TracerPool(this.trailLayer);
    // Bumped 24->40 (M7.9): STORM's 20 concurrent falling-curtain streaks
    // (one per drop) need more headroom than BARRAGE's 13 alone did.
    this.curtainStreaks = new CurtainSweepPool(this.trailLayer, 40);
    this.crescents = new CrescentPool(this.heroFxLayer);
    this.ghostBlades = new GhostBladePool(this.heroFxLayer);
    this.shadowDash = new ShadowDashPool(this.heroFxLayer);
    // Bumped 8->24 (M7.9): SKYFALL's scattered lightning bolts (2 strokes
    // each) share this pool with the archer's volley-launch streaks/
    // zone-whoosh/gate-glow beats — more concurrent users need more slots.
    this.flashLines = new FlashLinePool(this.heroFxLayer, 24);
    // Bumped 4->12 (M7.9): APOCALYPSE's 8 concurrent ground rune glyphs (plus
    // the mage's per-orb cast glyph) need far more than the old "a cast
    // glyph or two plus one meteor rune" headroom.
    this.runeGlyphs = new RuneGlyphPool(this.heroFxLayer, 12);
    this.castAura = new CastAuraController(this.heroFxLayer);
    this.gearSparkle = new GearSparklePool(this.heroFxLayer);
    // `weaponFx` slots are NOT constructed here — each is created lazily on
    // first non-null recipe inside `updateWeaponFx()` (mobile GPU budget: a
    // solo common/rare +0 weapon session never allocates one at all).
    this.warCryAura = new WarCryAuraController(this.heroFxLayer);
    this.championAura = new ChampionAuraController(this.heroFxLayer);
    this.arrowSwarm = new ArrowSwarmPool(this.heroFxLayer);
    this.travelPortal = new TravelPortalController(this.heroFxLayer);
    // Manual play (M7.8): the persistent target-lock reticle lives in the
    // rings layer (same z-order family as the transient lock-on pulse below).
    this.targetLock = new TargetLockReticle(this.ringsLayer);
    // Ring pool cap bumped 12->24 (M7.7, BARRAGE) -> 32 (M7.9: SKYFALL's
    // scatter beats + STORM's finale + APOCALYPSE's 8 per-meteor impact
    // rings can now overlap with unrelated concurrent rings on a busy field).
    this.rings = new RingPool(this.ringsLayer, 32);
    this.levelUpBursts = new LevelUpBurstPool(this.ringsLayer);
    this.lightPillars = new LightPillarPool(this.ringsLayer);
    this.particles = new ParticlePool(this.particlesLayer);
    // Reuses the just-constructed `this.particles`/`this.rings` — must come
    // after both (see this field's own doc comment).
    this.refinePrestige = new RefinePrestigeFx(this.particles, this.rings);
    this.soulWisps = new SoulWispPool(this.particlesLayer);
    this.damageNumbers = new FloatingTextPool(this.textLayer, DAMAGE_NUMBER_CAP);
    this.eventText = new FloatingTextPool(this.textLayer, EVENT_TEXT_CAP);
    this.flash = new ArenaFlash(WORLD_WIDTH, WORLD_HEIGHT);
    this.meteorSky = new MeteorSkyFlash(WORLD_WIDTH);
    this.skyDarken = new SkyDarkenOverlay(WORLD_WIDTH, WORLD_HEIGHT);
    this.hazardBand = new HazardBandOverlay(WORLD_WIDTH, WORLD_HEIGHT);
    this.impactFilters = new ImpactFilterController(world);
    fxContainer.addChild(
      this.bossEcho.view,
      this.meteorSky.view,
      this.skyDarken.view,
      this.hazardBand.view,
      this.flash.view,
    );
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

  /** M8 party P6 seam (mirrors `GameRenderer.setHeroDisplayNames()`) —
   * registers which `state.heroes` slot is the LOCAL point-of-view hero, so
   * `onSkillCast()` can gate SCREEN-level beats (shake/punch/sky-darken/
   * impact filters) to that hero's own casts while world-anchored fx keeps
   * firing for every cohort member's casts. Safe to call any time; default 0
   * matches solo's always-slot-0 heroes, so unset behaves identically to
   * before this seam existed. */
  setPovHeroIndex(index: number): void {
    this.povHeroIndex = index;
  }

  /** HOF seasonal rewards seam (mirrors `setPovHeroIndex()`/
   * `GameRenderer.setHeroDisplayNames()`) — registers the per-hero-id social
   * badge map (`title`/`champion`) the champion gold aura reads every frame
   * in `updateChampionAura()`. `null` clears every champion aura. Safe to call
   * any time; unset behaves identically to before this seam existed (no
   * champion aura ever activates). */
  setHeroSocialBadges(
    badges: ReadonlyMap<string, { title: string | null; champion: boolean }> | null,
  ): void {
    this.heroSocialBadges = badges;
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
    if (this.swingThisFrame)
      this.onSwordSwingStart(state, this.swingThisFrame.comboIndex);

    for (const ev of events) {
      switch (ev.type) {
        case "hit":
          this.onHit(ev, state, skillImpactSeen, meleeSparkGuard);
          break;
        case "kill":
          this.onKill(ev, state);
          break;
        case "eliteSpawned":
          this.onEliteSpawned(ev);
          break;
        case "eliteKilled":
          this.onEliteKilled(ev);
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
        case "heroDashed":
          this.onHeroDashed(ev);
          break;
        case "levelUp":
          this.onLevelUp(ev, state);
          break;
        case "evolve":
          this.onEvolve(ev, state);
          break;
        case "bossSlamTelegraph":
          // `bossCy()`: WORLD BOSS "เสี่ยจ๋อง" reuses this same event but sits
          // much taller than the stage boss's fixed `BOSS_CY` (see that
          // helper's doc comment).
          this.rings.spawn({
            x: ev.x,
            y: this.bossCy(state),
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
        case "bossChargeTelegraph":
          this.onBossChargeTelegraph(ev, state);
          break;
        case "bossChargeHit":
          this.onBossChargeHit(ev);
          break;
        case "bossSummon":
          this.onBossSummon(ev, state);
          break;
        case "bossHazardWarn":
          this.onBossHazardWarn(ev, state);
          break;
        case "bossHazardStrike":
          this.onBossHazardStrike(ev);
          break;
        case "bossDefeated":
          this.onBossDefeated(ev);
          break;
        case "worldBossSpawned":
          this.onWorldBossSpawned(state);
          break;
        case "worldBossDespawned":
          this.onWorldBossDespawned(state);
          break;
        case "worldBossDefeated":
          this.onWorldBossDefeated(state);
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
        case "stoneDrop":
          this.onStoneDrop(ev);
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
        case "moveOrdered":
          this.onMoveOrdered(ev.x, ev.heroIdx);
          break;
        case "targetLocked":
          this.onTargetLocked(ev.id, ev.heroIdx, state);
          break;
        case "tomePageFound":
          this.onTomePageFound(ev, state);
          break;
        case "tomeAssembled":
          this.onTomeAssembled(state);
          break;
        case "legendaryCraftRequested":
          this.onLegendaryCraftRequested(ev, state);
          break;
        default:
          // stageCleared / upgradeBought / townArrived / commandCancelled /
          // asuraZoneStoneEarned / asuraSigilClaimed / legendaryCraftBlocked:
          // no fx-layer reaction — `commandCancelled` is covered structurally
          // by `updateTargetLock()`'s continuous read (the reticle eases
          // itself out the instant `hero.command` goes null, see its doc
          // comment); `asuraZoneStoneEarned`/`asuraSigilClaimed` are save-only
          // milestones with no dedicated beat in this v1 render wave
          // (elite/hot-zone/biome/legendary were the asks); a BLOCKED craft
          // request is a UI-toast concern, not a juice beat.
          break;
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
    this.groundCracks.update(dt);
    this.curtainStreaks.update(dt);
    this.skyDarken.update(dt);
    this.hazardBand.update(dt);
    this.bossEcho.update(dt);
    this.rings.update(dt);
    this.levelUpBursts.update(dt);
    this.lightPillars.update(dt);
    this.crescents.update(dt);
    this.ghostBlades.update(dt);
    this.shadowDash.update(dt);
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
    this.updatePartyMembership(state);
    this.updateBossDeathStages(dt);
    this.updatePendingFieldFx(dt);
    this.detectBossEntrance(state);
    this.updateWorldBossTracking(state);
    this.updateGearFx(dt, state);
    this.updateChampionAura(dt, state);
    this.updateWarCryFx(dt, state);
    this.updateTargetLock(dt, state);
    this.travelPortal.update(dt);
    this.arrowSwarm.update(dt);
  }

  destroy(): void {
    this.targetLock.destroy();
    this.hitFlash.destroy();
    this.corpseEcho.destroy();
    this.scorches.destroy();
    this.portals.destroy();
    this.armorShards.destroy();
    this.rainShadows.destroy();
    this.groundArrows.destroy();
    this.groundCracks.destroy();
    this.bossEcho.destroy();
    this.weaponTrail.destroy();
    this.tracers.destroy();
    this.curtainStreaks.destroy();
    this.crescents.destroy();
    this.ghostBlades.destroy();
    this.shadowDash.destroy();
    this.flashLines.destroy();
    this.runeGlyphs.destroy();
    this.meteorSky.destroy();
    this.skyDarken.destroy();
    this.hazardBand.destroy();
    this.castAura.destroy();
    this.gearSparkle.destroy();
    for (const fx of this.weaponFx) fx?.destroy();
    this.championAura.destroy();
    this.warCryAura.destroy();
    this.arrowSwarm.destroy();
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
   * `updateWeaponTrail()`/`updateCastAura()`): per hero slot, drives the M9
   * pixel-fx recipe weapon system (`updateWeaponFx()`, below) and the
   * tier-5+ armor sparkle (`gearSparkle`) when that hero's live view +
   * equipped template say so, else eases the slot back to invisible. Reads
   * `ITEM_TEMPLATES` directly (not `HeroView.gearWeaponTier`/`gearArmorRarity`,
   * though those exist too) since `state.heroes` is already being walked here
   * regardless.
   *
   * M7.6+ refine-prestige ladder (owner spec) still applies to ARMOR: once the
   * sparkle is active at all (+7), `armorRefine` further gates a 3-step
   * escalation — +8 boosts the SAME pooled sparkle in place (`gearSparkle`'s
   * own `boosted` param), +9/+10 add an intermittent crackle / continuous
   * signature beat via `refinePrestige` (zero new pooled Graphics — see that
   * module's doc comment). The WEAPON half of this ladder was retired in the
   * M9 pixel-fx port (`updateWeaponFx()` — `refineFxRecipes.ts` covers the
   * whole +0..+10 weapon ladder on its own, including the +8/+9/+10 steps). */
  private updateGearFx(dt: number, state: GameState): void {
    state.heroes.forEach((h, slot) => {
      const view = h.dead ? null : this.lookupHeroView(h.id);
      const weaponRarity: ItemRarity | undefined = h.equipped.weapon
        ? ITEM_TEMPLATES[h.equipped.weapon]?.rarity
        : undefined;
      const armorTier = h.equipped.armor
        ? (ITEM_TEMPLATES[h.equipped.armor]?.tier ?? 0)
        : 0;
      // M7.6 ตีบวก: a heavily-refined armor piece earns the same sparkle hook
      // a naturally-tier-5+ piece would, one step earlier than the catalog's
      // own +10 max would otherwise imply — a subtle "this thing is special
      // now" readout without any new rig geometry (per spec).
      const weaponRefine = refineOf(h.equipped, "weapon");
      const armorRefine = refineOf(h.equipped, "armor");

      this.updateWeaponFx(slot, view, weaponRarity, weaponRefine, isLegendaryTemplate(h.equipped.weapon));

      const sparkleOn =
        !!view &&
        (armorTier >= 5 || armorRefine >= REFINE_SPARKLE_THRESHOLD) &&
        getArmorAnchorPos(view, this.armorAnchorScratch);
      this.gearSparkle.setSlot(
        slot,
        sparkleOn,
        this.armorAnchorScratch.x,
        this.armorAnchorScratch.y,
        armorRefine >= REFINE_PRESTIGE_BOOST_THRESHOLD,
      );
      this.refinePrestige.update(
        dt,
        `${slot}-armor`,
        sparkleOn ? armorRefine : 0,
        this.armorAnchorScratch.x,
        this.armorAnchorScratch.y,
      );
    });
    this.gearSparkle.update(dt);
    for (const fx of this.weaponFx) fx?.update(dt);
  }

  /** M9 pixel-fx weapon port (owner-approved `/lab` refineLadder look) — see
   * this class's `weaponFx` field doc for the full replacement story
   * (`gearAura.ts` + weapon-side `refinePrestige.ts` + `legendaryFx.ts`, ALL
   * retired in favor of this ONE recipe-driven system for every weapon,
   * normal AND legendary alike). Called once per hero slot per frame from
   * `updateGearFx()`; `fx.update(dt)` itself is batched once at the end of
   * that caller (matching `gearAura.update(dt)`'s old per-frame-once
   * convention), not per-slot here. */
  private updateWeaponFx(
    slot: number,
    view: HeroView | null,
    rarity: ItemRarity | undefined,
    refineLevel: number,
    isLegendary: boolean,
  ): void {
    if (slot < 0 || slot >= WEAPON_FX_MAX_SLOTS) return;

    const anchorOk = !!view && !!rarity && getWeaponAnchorPos(view, this.weaponAnchorScratch);
    const recipe = anchorOk ? resolveRefineFxRecipe(rarity!, refineLevel, isLegendary) : null;

    if (!recipe) {
      this.weaponFx[slot]?.setRecipe(null);
      this.weaponFxWasSwinging[slot] = false;
      return;
    }

    let fx = this.weaponFx[slot];
    if (!fx) {
      fx = createPixelWeaponFx(this.heroFxLayer, { poolSize: WEAPON_FX_POOL_SIZE });
      fx.setGroundY(GROUND_Y);
      fx.setPixelSize(WEAPON_FX_PIXEL_SIZE);
      // Owner eye-verdict: the sim runs SMOOTH 60fps in-game — the module's
      // stepped-12fps mode exists to match PIXEL-ART sprite hosts, but this
      // game's weapons are smooth code-drawn vectors (same default `/lab`'s
      // refineLadder experiment already ships).
      fx.setStepFps(60);
      fx.setDensity(1);
      this.weaponFx[slot] = fx;
    }
    fx.setRecipe(recipe);

    // Direction = anchor − weaponArm pivot (both resolved into `view.parent`-
    // local space, the SAME coordinate frame `this.heroFxLayer` renders in —
    // see `getWeaponAnchorPos()`'s own doc comment), mirroring
    // `/lab/experiments/refineLadder.tsx`'s `updateFxAnchor()` technique.
    view!.parent!.toLocal(WEAPON_FX_ORIGIN, view!.weaponArm, this.weaponFxPivotScratch);
    let dx = this.weaponAnchorScratch.x - this.weaponFxPivotScratch.x;
    let dy = this.weaponAnchorScratch.y - this.weaponFxPivotScratch.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      dx = 1;
      dy = 0;
    } else {
      dx /= len;
      dy /= len;
    }
    fx.setAnchor(this.weaponAnchorScratch.x, this.weaponAnchorScratch.y, dx, dy);

    const swinging = isHeroAttackSwinging(view!);
    if (swinging && !this.weaponFxWasSwinging[slot]) fx.notifySwing();
    this.weaponFxWasSwinging[slot] = swinging;
  }

  /** HOF seasonal rewards (docs/hof-rewards-design.md §3 item 2, render wave):
   * continuous, not event-driven — same convention as `updateGearFx()`. Per
   * hero slot, activates the champion gold aura when `heroSocialBadges` marks
   * that hero id a current champion, else eases the slot back to invisible.
   * `null`/unset badges map (every existing call site) means this is always a
   * no-op loop over `active=false`, so solo/sim output stays byte-identical
   * until `setHeroSocialBadges()` is ever called. */
  private updateChampionAura(dt: number, state: GameState): void {
    state.heroes.forEach((h, slot) => {
      const view = h.dead ? null : this.lookupHeroView(h.id);
      const champion = this.heroSocialBadges?.get(String(h.id))?.champion ?? false;
      const active =
        champion && !!view && getChampionAnchorPos(view, this.championAnchorScratch);
      this.championAura.setSlot(
        slot,
        active,
        this.championAnchorScratch.x,
        this.championAnchorScratch.y,
      );
    });
    this.championAura.update(dt);
  }

  /** Owner request: a visible on-character effect while a hero's War Cry ATK
   * buff (`hero.atkBuffMult`/`atkBuffTimer`) is active — continuous per-frame
   * read, same convention as `updateGearFx()`. Applies to EVERY living hero
   * (party-ready), since the engine now applies the buff to all living heroes,
   * not just the caster. Intensity ramps down over the buff's final
   * `WARCRY_FADE_WINDOW` seconds instead of a hard cutoff at 0 (see
   * `fx/warCryAura.ts`'s module doc). */
  private updateWarCryFx(dt: number, state: GameState): void {
    state.heroes.forEach((h, slot) => {
      const view = h.dead ? null : this.lookupHeroView(h.id);
      let intensity = 0;
      if (view && h.atkBuffTimer > 0) {
        intensity =
          h.atkBuffTimer <= WARCRY_FADE_WINDOW ? h.atkBuffTimer / WARCRY_FADE_WINDOW : 1;
      }
      const anchorOk =
        intensity > 0 && getArmorAnchorPos(view!, this.warCryAnchorScratch);
      this.warCryAura.setSlot(
        slot,
        anchorOk ? intensity : 0,
        this.warCryAnchorScratch.x,
        this.warCryAnchorScratch.y,
      );
    });
    this.warCryAura.update(dt);
  }

  /** Manual play (M7.8): tap-the-ground order — a small "sonar ping" of 3
   * concentric fading rings at the (already-clamped) `moveOrdered.x`, jewel-
   * tone `orderMove` on the shared `RingPool` (flat-alpha stroked circles,
   * never additive — footgun 10). Ground-anchored like every other
   * effectively-1D-on-x beat in this file.
   *
   * POV-gated (owner bug batch A #3, "tap-ring pov-only"): `moveOrdered` fires
   * for WHICHEVER cohort lane the command landed on (every client's `state`
   * carries every member's command — lockstep shares one `GameState`), so
   * without this gate a peer's own ground tap rang on every OTHER member's
   * screen too. Same convention as the skill-spectacle pov gate elsewhere in
   * this file (`ev.slot === this.povHeroIndex`). Solo is always heroIdx 0 ===
   * the default `povHeroIndex` 0 — pixel-identical. */
  private onMoveOrdered(x: number, heroIdx: number): void {
    if (heroIdx !== this.povHeroIndex) return;
    for (const r of MOVE_MARKER_RINGS) {
      this.rings.spawn({
        x,
        y: GROUND_Y,
        r0: r.r0,
        r1: r.r1,
        duration: r.duration,
        width: 2,
        color: PALETTE.orderMove,
      });
    }
  }

  /** Manual play (M7.8): tap-a-monster order — a quick "lock-on" pulse ring
   * at the target's CURRENT position (on top of `updateTargetLock()`'s own
   * persistent reticle, which keeps tracking it every frame after). A no-op
   * if the target already despawned the same instant (render lags the
   * engine by nothing here, but a defensive lookup costs nothing).
   *
   * POV-gated for the same reason as `onMoveOrdered` above — a peer's tap-a-
   * monster order must not pulse-ring on my screen. */
  private onTargetLocked(id: number, heroIdx: number, state: GameState): void {
    if (heroIdx !== this.povHeroIndex) return;
    const enemy = state.enemies.find((e) => e.id === id);
    if (!enemy) return;
    this.rings.spawn({
      x: enemy.x,
      y: TARGET_LOCK_Y,
      r0: TARGET_LOCK_PULSE_R0,
      r1: TARGET_LOCK_PULSE_R1,
      duration: TARGET_LOCK_PULSE_DURATION,
      width: 2,
      color: PALETTE.orderAttack,
    });
  }

  /** Manual play (M7.8): continuous per-frame read of `hero.command` (same
   * convention as `updateGearFx()`/`updateWeaponTrail()`) — while an ATTACK
   * command is active and its target is still alive, the reticle tracks it;
   * otherwise it eases itself out (see `TargetLockReticle.update()`'s doc).
   * Solo-hero read (`state.heroes[0]`), matching `applyManualCommand`'s own
   * scope in `engine/systems/manual.ts`. */
  private updateTargetLock(dt: number, state: GameState): void {
    const cmd = state.heroes[0]?.command;
    const enemy =
      cmd?.kind === "attack"
        ? state.enemies.find((e) => e.id === cmd.targetId)
        : undefined;
    this.targetLock.update(dt, enemy ? { x: enemy.x, y: TARGET_LOCK_Y } : null);
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
   * armor-shard chips. M7.9 "new mob species": `kindColor` is resolved
   * through `enemySpecies.ts`'s `enemyColorFor()` (map1/2/3 fall back to the
   * plain `ENEMY_COLORS[kind]`), same `zoneAt(state.location).mapId`
   * plumbing as `resolveBossTint()`, so a map4/5/6 mob's dissolve burst /
   * soul wisp / armor shards / corpse echo stay tinted to ITS OWN species. */
  private onKill(ev: Extract<GameEvent, { type: "kill" }>, state: GameState): void {
    const size = ENEMY_TYPES[ev.kind]?.size ?? 1;
    const y = GROUND_Y - 20 - 8 * size;
    const kindColor = enemyColorFor(zoneAt(state.location).mapId, ev.kind);

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
    this.corpseEcho.spawn(ev.x, GROUND_Y - 4, kindColor, size);

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

  /** ASURA ELITE spawn telegraph (`eliteSpawned`) — a "something dangerous
   * just appeared" beat layered ON TOP of the ordinary spawn portal every new
   * enemy id already gets from `updateEnemySpawns()`'s mark-and-sweep: a
   * bigger warn-colored ring + a matching violet inner ring, a burst, a rising
   * "ELITE!" callout (reusing `eventText`, same pool the kill-gold/aggro "!"
   * text share), and a subtle full-arena flash (kept well within the README's
   * "~0.2-0.3 peak alpha, never strobing" rule — this is a rare-find sting,
   * not a boss-enrage-sized punch). The PERSISTENT pulsing aura ring itself is
   * `enemyView.ts`'s job (continuous, reads `enemy.elite` every frame). */
  private onEliteSpawned(ev: Extract<GameEvent, { type: "eliteSpawned" }>): void {
    const size = ENEMY_TYPES[ev.kind]?.size ?? 1;
    const y = GROUND_Y - 20 - 8 * size;
    this.rings.spawn({
      x: ev.x,
      y,
      r0: ELITE_SPAWN_RING_R0,
      r1: ELITE_SPAWN_RING_R1,
      duration: ELITE_SPAWN_RING_DURATION,
      width: 3,
      color: PALETTE.eliteAura,
    });
    this.rings.spawn({
      x: ev.x,
      y,
      r0: ELITE_SPAWN_RING_R0 * 0.5,
      r1: ELITE_SPAWN_RING_R1 * 0.6,
      duration: ELITE_SPAWN_RING_DURATION * 1.25,
      width: 2,
      color: PALETTE.eliteAuraCore,
    });
    burst(this.particles, ev.x, y, ELITE_SPAWN_PARTICLE_COUNT, PALETTE.eliteAuraCore, {
      speed: 95,
      life: 0.5,
      radius: 3,
    });
    this.eventText.spawn({
      x: ev.x,
      y: y - 22,
      label: "ELITE!",
      color: PALETTE.eliteAuraCore,
      fontSize: 16,
      duration: 0.65,
      rise: 22,
    });
    this.flash.trigger(PALETTE.eliteAura, ELITE_SPAWN_FLASH_ALPHA);
  }

  /** ASURA ELITE kill flourish (`eliteKilled`) — a bigger-than-normal-kill
   * burst (the elite's own `onKill` fires too, from the same underlying
   * `kill` event; this layers the "you just banked essence" beat on top) + a
   * mild shake + a rising "+N" essence label (a bare number, like `onKill`'s
   * gold label — render has no i18n hookup, see README's zone-name note, so
   * no Thai/English unit text is hardcoded here). Ground-anchored (see
   * `ELITE_KILL_POP_Y`'s doc comment — the event carries no `kind`/size). */
  private onEliteKilled(ev: Extract<GameEvent, { type: "eliteKilled" }>): void {
    const y = ELITE_KILL_POP_Y;
    this.shake.trigger(ELITE_KILL_SHAKE);
    this.rings.spawn({
      x: ev.x,
      y,
      r0: 12,
      r1: ELITE_KILL_RING_R1,
      duration: ELITE_KILL_RING_DURATION,
      width: 4,
      color: PALETTE.eliteAura,
    });
    burst(this.particles, ev.x, y, ELITE_KILL_PARTICLE_COUNT, PALETTE.eliteAuraCore, {
      speed: 170,
      life: 0.55,
      radius: 4,
    });
    this.eventText.spawn({
      x: ev.x,
      y,
      label: `+${ev.essence}`,
      color: PALETTE.eliteAuraCore,
      fontSize: 15,
      duration: 0.8,
      rise: 38,
    });
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
  private onHeroDown(
    ev: Extract<GameEvent, { type: "heroDown" }>,
    state: GameState,
  ): void {
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

  /** NINJA `dash` reposition primitive (SAVE v18 render wave,
   * docs/ninja-design.md §1/§7): the render-side reaction to EVERY
   * `heroDashed` event, regardless of which skill triggered it (เงาพริบ once
   * per cast, เงาสังหาร up to 8x in one cast, พันเงานิรันดร์ once for the body's
   * own centroid blink) — a shadow streak + brief afterimage between the
   * departure and landing points. Both endpoints are drawn at the shared
   * `HERO_MID_Y` band (the same "entities are effectively 1D on x" convention
   * every other position-only event in this file follows — `heroDashed`
   * carries no y). */
  private onHeroDashed(ev: Extract<GameEvent, { type: "heroDashed" }>): void {
    this.shadowDash.trigger(ev.fromX, HERO_MID_Y, ev.toX, HERO_MID_Y);
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

    this.levelUpBursts.spawn({
      x,
      y,
      color: PALETTE.gold,
      duration: LEVEL_UP_BURST_DURATION,
    });
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
    this.levelUpBursts.spawn({
      x,
      y,
      color: PALETTE.gold,
      duration: EVOLVE_BURST_DURATION,
    });
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

  /** "ตำราตำนาน" secret-quest page find (`tomePageFound`) — a small mystical
   * page-flutter at the solo hero's own position: a gentle downward-drifting
   * particle burst (positive gravity, unlike every other "rising energy" beat
   * in this file — reads as a fluttering paper fragment settling, not power
   * surging up) + a soft violet ring pulse + a "page/total" readout. Deliberately
   * the SMALLEST of the three tome beats (see the knobs block's doc comment). */
  private onTomePageFound(
    ev: Extract<GameEvent, { type: "tomePageFound" }>,
    state: GameState,
  ): void {
    const hero = state.heroes[0];
    if (!hero) return;
    const x = hero.x;
    const y = HERO_TOP_Y;
    this.rings.spawn({
      x,
      y,
      r0: TOME_PAGE_RING_R0,
      r1: TOME_PAGE_RING_R1,
      duration: TOME_PAGE_RING_DURATION,
      width: 2,
      color: PALETTE.legendaryViolet,
    });
    burst(this.particles, x, y, TOME_PAGE_PARTICLE_COUNT, PALETTE.legendaryGold, {
      speed: TOME_PAGE_PARTICLE_SPEED,
      life: TOME_PAGE_PARTICLE_LIFE,
      radius: 2,
      gravity: 45, // a fluttering page settling down, not rising energy
      drag: 0.5,
    });
    this.eventText.spawn({
      x,
      y: y - 12,
      label: `${ev.page}/${ev.pagesTotal}`,
      color: PALETTE.legendaryGold,
      fontSize: 13,
      duration: TOME_PAGE_TEXT_DURATION,
      rise: TOME_PAGE_TEXT_RISE,
    });
  }

  /** "ตำราตำนาน" the 3rd page landing (`tomeAssembled`) — the craft menu
   * unlocks PERMANENTLY, so this is the biggest of the three tome beats
   * (mirrors `onEvolve()`'s "big goal-ladder moment" structure: a light
   * pillar + a starburst + a two-tone gold/violet ring + a two-tone particle
   * spread + a brief arena flash), at the solo hero's own position. No text
   * label (canvas `Text` here stays numeric/ASCII per the module's existing
   * convention — see `onLevelUp()`'s doc comment on locale-invariant labels;
   * skipping one entirely is simplest and the reveal is already plenty loud). */
  private onTomeAssembled(state: GameState): void {
    const hero = state.heroes[0];
    if (!hero) return;
    const x = hero.x;
    const y = HERO_TOP_Y;
    const topY = y - TOME_ASSEMBLED_PILLAR_HEAD_MARGIN;
    this.lightPillars.spawn({
      x,
      topY,
      height: GROUND_Y - topY,
      color: PALETTE.legendaryViolet,
      duration: TOME_ASSEMBLED_PILLAR_DURATION,
      width: TOME_ASSEMBLED_PILLAR_WIDTH,
    });
    this.levelUpBursts.spawn({
      x,
      y,
      color: PALETTE.legendaryGold,
      duration: TOME_ASSEMBLED_BURST_DURATION,
    });
    this.rings.spawn({
      x,
      y,
      r0: TOME_ASSEMBLED_RING_R0,
      r1: TOME_ASSEMBLED_RING_R1,
      duration: TOME_ASSEMBLED_RING_DURATION,
      width: 4,
      color: PALETTE.legendaryViolet,
    });
    burst(this.particles, x, y, TOME_ASSEMBLED_PARTICLE_COUNT_GOLD, PALETTE.legendaryGold, {
      speed: TOME_ASSEMBLED_PARTICLE_SPEED,
      life: TOME_ASSEMBLED_PARTICLE_LIFE,
      radius: 3,
      gravity: -30, // rising arcane energy — same read as evolve's own burst
      drag: 0.3,
    });
    burst(this.particles, x, y, TOME_ASSEMBLED_PARTICLE_COUNT_VIOLET, PALETTE.legendaryViolet, {
      speed: TOME_ASSEMBLED_PARTICLE_SPEED * 0.8,
      life: TOME_ASSEMBLED_PARTICLE_LIFE,
      radius: 2.5,
      gravity: -30,
      drag: 0.3,
    });
    // Brief, subtle full-arena flash — README's "~0.2-0.3 peak alpha, never
    // strobing" rule holds even for this bigger moment.
    this.flash.trigger(PALETTE.legendaryViolet, TOME_ASSEMBLED_FLASH_ALPHA);
  }

  /** "ตำราตำนาน" craft request (`legendaryCraftRequested`) — a forge-flash
   * flourish at the crafting class's own hero (falls back to the solo hero if
   * that class isn't in the current roster — e.g. a cohort where only a
   * teammate plays the crafted class). The actual mint lands via the SERVER
   * (this event only means "the engine validated + consumed the recipe"), so
   * this stays a punchy but not permanent-state-flip-sized beat: a bright
   * gold ring + a softer violet echo ring + an upward gold-core shower + a
   * brief flash, sitting between `onTomePageFound`'s small flutter and
   * `onTomeAssembled`'s full reveal. */
  private onLegendaryCraftRequested(
    ev: Extract<GameEvent, { type: "legendaryCraftRequested" }>,
    state: GameState,
  ): void {
    const hero = state.heroes.find((h) => h.cls === ev.cls) ?? state.heroes[0];
    if (!hero) return;
    const x = hero.x;
    const y = HERO_TOP_Y;
    this.flash.trigger(PALETTE.legendaryGold, LEGENDARY_CRAFT_FLASH_ALPHA);
    this.rings.spawn({
      x,
      y,
      r0: LEGENDARY_CRAFT_RING_R0,
      r1: LEGENDARY_CRAFT_RING_R1,
      duration: LEGENDARY_CRAFT_RING_DURATION,
      width: 5,
      color: PALETTE.legendaryGold,
    });
    this.rings.spawn({
      x,
      y,
      r0: LEGENDARY_CRAFT_RING_R0 * 0.6,
      r1: LEGENDARY_CRAFT_RING2_R1,
      duration: LEGENDARY_CRAFT_RING2_DURATION,
      width: 3,
      color: PALETTE.legendaryViolet,
    });
    burst(this.particles, x, y, LEGENDARY_CRAFT_PARTICLE_COUNT, PALETTE.legendaryGoldCore, {
      speed: LEGENDARY_CRAFT_PARTICLE_SPEED,
      life: LEGENDARY_CRAFT_PARTICLE_LIFE,
      radius: 3,
      gravity: -20,
      drag: 0.25,
    });
  }

  private onSkillCast(
    ev: Extract<GameEvent, { type: "skillCast" }>,
    state: GameState,
  ): void {
    const hero = state.heroes[ev.slot];
    const x = hero ? hero.x : 0;
    const colors = HERO_COLORS[ev.heroClass];
    // M8 party P6: co-op spectacle stays world-anchored for everyone, but
    // SCREEN-level beats (camera shake/punch, full-viewport sky/flash
    // overlays, impact filters) only fire when the CASTING hero is the local
    // point-of-view hero — see `setPovHeroIndex()`'s doc comment. Default
    // `povHeroIndex` 0 + solo events always at `slot` 0 means `pov` is always
    // `true` in solo play, so this is a pure no-op there.
    const pov = ev.slot === this.povHeroIndex;
    if (pov) this.punch.trigger("skillCast", x);

    // M7.7 "Skill Spectacle": route by the actual SKILL, not just class —
    // each class's SIGNATURE/UTILITY/ULTIMATE now reads as three distinct
    // beats (the old class-only dispatch played the same beat for all three,
    // which was the "current fx read too alike" gap this pass closes).
    switch (ev.skillId) {
      case "sword_whirl":
        this.onSwordWhirlCast(hero, x, colors.light, pov);
        break;
      case "sword_warcry":
        this.onSwordWarcryCast(x, colors.light);
        break;
      case "sword_quake":
        this.onSwordQuakeCast(x, pov);
        break;
      case "sword_skyfall":
        this.onSwordSkyfallCast(x, pov);
        break;
      case "archer_rain":
        this.onArcherRainCast(x, colors.light, state, false, pov);
        break;
      case "archer_powershot":
        this.onArcherPowershotCast(x, colors.light);
        break;
      case "archer_barrage":
        this.onArcherRainCast(x, colors.light, state, true, pov);
        break;
      case "archer_storm":
        this.onArcherStormCast(x, colors.light, state, pov);
        break;
      case "mage_meteor":
        this.onMageMeteorCast(x, colors.light, state, false, pov);
        break;
      case "mage_frostnova":
        this.onMageFrostNovaCast(x, colors.light);
        break;
      case "mage_cataclysm":
        this.onMageMeteorCast(x, colors.light, state, true, pov);
        break;
      case "mage_apocalypse":
        this.onMageApocalypseCast(x, state, pov);
        break;
      case "ninja_dashstrike":
        this.onNinjaDashstrikeCast(x, pov);
        break;
      case "ninja_twinfang":
        this.onNinjaTwinfangCast(x);
        break;
      case "ninja_massacre":
        this.onNinjaMassacreCast(x, pov);
        break;
      case "ninja_eternal":
        this.onNinjaEternalCast(x, state, pov);
        break;
      default:
        break; // unknown skill id — no fx beat rather than guessing wrong
    }
  }

  /** Ninja SIGNATURE (SHADOW BLINK, "ninja_dashstrike") — the blink's own
   * shadow-streak/afterimage plays via `onHeroDashed()` (the `heroDashed`
   * event fires the SAME step); this just adds the landing strike's impact
   * identity — a small silver-violet ring + burst at the caster's (POST-dash)
   * position, modest per the signature-tier convention. */
  private onNinjaDashstrikeCast(x: number, pov: boolean): void {
    if (pov) this.shake.trigger(NINJA_STRIKE_SHAKE);
    this.rings.spawn({
      x,
      y: HERO_MID_Y,
      r0: 4,
      r1: NINJA_STRIKE_RING_R1,
      duration: 0.18,
      width: 2.4,
      color: PALETTE.ninjaSilver,
    });
    burst(
      this.particles,
      x,
      HERO_MID_Y,
      NINJA_STRIKE_PARTICLE_COUNT,
      PALETTE.ninjaViolet,
      {
        speed: 90,
        life: 0.22,
        radius: 2,
      },
    );
  }

  /** Ninja UTILITY (TWIN FANG, "ninja_twinfang") — a stationary flurry: 5
   * quick alternating L/R slash streaks at the target's own position (no
   * dash involved — `castSkill`'s `multistrike` case never repositions the
   * hero) + a small splash ring for the neighbour cleave. Kept modest (no
   * shake/field dressing), matching the utility-tier convention. */
  private onNinjaTwinfangCast(x: number): void {
    for (let i = 0; i < NINJA_FLURRY_HIT_COUNT; i++) {
      const lead = i % 2 === 0 ? 1 : -1;
      const jitterY = (Math.random() - 0.5) * 6;
      this.flashLines.spawn({
        x1: x - lead * NINJA_FLURRY_STREAK_LEN * 0.5,
        y1: HERO_MID_Y + jitterY - 4,
        x2: x + lead * NINJA_FLURRY_STREAK_LEN * 0.5,
        y2: HERO_MID_Y + jitterY + 4,
        color: i % 2 === 0 ? PALETTE.ninjaSilver : PALETTE.ninjaViolet,
        width: 2,
        life: NINJA_FLURRY_HIT_GAP * 2.4,
        alpha: 0.8,
      });
    }
    burst(this.particles, x, HERO_MID_Y, 6, PALETTE.ninjaViolet, {
      speed: 70,
      life: 0.22,
      radius: 2,
    });
    this.rings.spawn({
      x,
      y: HERO_MID_Y,
      r0: 6,
      r1: NINJA_SPLASH_RING_R1,
      duration: 0.3,
      width: 2,
      color: PALETTE.ninjaVioletDark,
    });
    // Utility tier — no dedicated punch beyond the generic `skillCast` one
    // `onSkillCast()` already fired, matching warcry/frostnova's convention.
  }

  /** Ninja ULTIMATE (SHADOW MASSACRE, "ninja_massacre", tier-2) — the class
   * SIGNATURE: up to 8 chain-dash hops each already get their own streak +
   * afterimage from `onHeroDashed()` (fired per `heroDashed` event, same
   * engine step); this adds the FIELD-WIDE cast punch (biggest shake in the
   * ninja kit so far) that sells "the ultimate", not just 8 plain blinks. */
  private onNinjaMassacreCast(x: number, pov: boolean): void {
    if (pov) {
      this.punch.trigger("ninjaMassacre", x);
      this.shake.trigger(NINJA_MASSACRE_SHAKE);
    }
    this.rings.spawn({
      x,
      y: HERO_MID_Y,
      r0: 12,
      r1: NINJA_MASSACRE_RING_R1,
      duration: 0.45,
      width: 4,
      color: PALETTE.ninjaViolet,
    });
    burst(this.particles, x, HERO_MID_Y, 10, PALETTE.ninjaSilver, {
      speed: 140,
      life: 0.32,
      radius: 2.5,
    });
  }

  /** Ninja tier-3 skill-4 (ETERNAL SHADOWS, "ninja_eternal") — MUST clearly
   * out-spectacle the massacre ultimate above (owner spec, mirrors every
   * other class's tier-3 skill-4): a held violet sky-darken (จอสลัว, reusing
   * the SAME `skyDarken` overlay every other class's ultimate uses) + a
   * shadow-clone slash streak fired at EVERY live target on the field
   * (reusing `shadowDash.ts`'s own streak visual, hero -> each target — the
   * "shadow clones strike everyone" read, since the engine's own damage loop
   * already hits every target instantly) + the biggest shake in the ninja
   * kit. The real body's own centroid-blink streak plays separately via the
   * normal `onHeroDashed()` handler (same engine step), reading as "the real
   * one arrives after the clones already struck". NOTE for wave 4 (UI): a
   * real TIME-FREEZE beat (`timeDirector.ts`'s `FREEZE_SWORD_SKYFALL`
   * pattern) would sell this further, matching every other tier-3 skill-4 —
   * `timeDirector.ts` lives outside `render/`, so wiring `ninja_eternal` into
   * its `skillId` switch is a follow-up, not this wave's to make. */
  private onNinjaEternalCast(x: number, state: GameState, pov: boolean): void {
    if (pov) {
      this.punch.trigger("ninjaEternal", x);
      this.shake.trigger(NINJA_ETERNAL_SHAKE);
      this.skyDarken.trigger(
        PALETTE.ninjaVioletDark,
        NINJA_ETERNAL_SKY_ALPHA,
        NINJA_ETERNAL_SKY_HOLD,
      );
    }
    this.rings.spawn({
      x,
      y: HERO_MID_Y,
      r0: 20,
      r1: NINJA_ETERNAL_RING_R1,
      duration: 0.55,
      width: 5,
      color: PALETTE.ninjaSilver,
    });

    let cloneCount = 0;
    for (const e of state.enemies) {
      if (cloneCount >= NINJA_ETERNAL_CLONE_MAX) break;
      this.shadowDash.trigger(x, HERO_MID_Y, e.x, HERO_MID_Y);
      cloneCount++;
    }
    if (state.boss && cloneCount < NINJA_ETERNAL_CLONE_MAX) {
      this.shadowDash.trigger(x, HERO_MID_Y, state.boss.x, BOSS_CY);
    }
    burst(this.particles, x, HERO_MID_Y, 16, PALETTE.ninjaViolet, {
      speed: 160,
      life: 0.4,
      radius: 3,
    });
  }

  /** Swordsman SIGNATURE (WHIRL SLASH, "sword_whirl") — charge-up glow,
   * whirlwind afterimages + dust ring, crescent-nova shards + a spin-
   * specific stronger camera punch, and (M7.7) a ground crack under the spin
   * + a punchy mild shake. Crimson/hot-metal accents (`PALETTE.swordCrimson`/
   * `swordEmber`) give the sword kit its own fx language, distinct from the
   * archer's emerald/mage's violet — the RIG itself stays the class's own
   * teal (`color`), only the impact/crack accents go hot-metal. */
  private onSwordWhirlCast(
    hero: Hero | undefined,
    x: number,
    color: number,
    pov: boolean,
  ): void {
    // Stronger, spin-specific punch — "strongest wins" against the generic
    // `skillCast` punch already triggered by the caller (see cameraPunch.ts).
    // M8 party P6: SCREEN-level only for the POV hero's own cast.
    if (pov) {
      this.punch.trigger("swordSpin", x);
      this.shake.trigger(WHIRL_IMPACT_SHAKE);
    }

    // Charge-up: front-loaded blade glow + inward-drifting sparkle at the
    // live blade tip (the spin's own 0.4s whirl already runs in heroView;
    // this is just the first ~0.15s's extra shimmer).
    const view = hero ? this.lookupHeroView(hero.id) : null;
    const hasTip = view ? getSwordTipPos(view, this.tipScratch) : false;
    const gx = hasTip ? this.tipScratch.x : x + 12;
    const gy = hasTip ? this.tipScratch.y : HERO_MID_Y;
    burstInward(this.particles, gx, gy, 8, PALETTE.swordCrimson, 26, {
      life: 0.16,
      speed: 90,
      radius: 2,
    });

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
    // Ground crack under the spin (M7.7) — matches the whirl's own radius
    // (`SKILL_TYPES.swordsman` IS the learned `sword_whirl` def).
    this.groundCracks.spawn({
      x,
      y: GROUND_Y,
      radius: WHIRL_CRACK_RADIUS,
      life: WHIRL_CRACK_LIFE,
      darkColor: PALETTE.swordCrackDark,
      glowColor: PALETTE.swordEmber,
    });

    // Crescent nova: the existing expanding ring (now crimson/hot-metal),
    // augmented with jagged shards flying outward while rotating.
    this.rings.spawn({
      x,
      y: HERO_MID_Y,
      r0: 12,
      r1: SKILL_TYPES.swordsman.radius,
      duration: 0.4,
      width: 4,
      color: PALETTE.swordCrimson,
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
        color: i % 2 === 0 ? PALETTE.swordCrimson : PALETTE.steel,
      });
    }
  }

  /** Swordsman UTILITY (WAR CRY, "sword_warcry") — a self ATK-buff steroid;
   * kept deliberately modest (utility skills stay legible, not nuke-ified):
   * a warm crimson ring pulse + a few rising embers at the caster, no AoE
   * shards/afterimages/shake. */
  private onSwordWarcryCast(x: number, color: number): void {
    this.rings.spawn({
      x,
      y: HERO_MID_Y,
      r0: 8,
      r1: WARCRY_RING_R1,
      duration: 0.4,
      width: 3,
      color: PALETTE.swordCrimson,
    });
    burst(this.particles, x, HERO_MID_Y, WARCRY_PARTICLE_COUNT, PALETTE.swordEmber, {
      speed: 70,
      life: 0.4,
      radius: 2.2,
      gravity: -30,
      drag: 0.3,
    });
    // A faint class-colored accent keeps this readable as "the swordsman",
    // not just a generic red pulse.
    burst(this.particles, x, HERO_MID_Y, 4, color, { speed: 50, life: 0.35, radius: 2 });
  }

  /** Swordsman ULTIMATE (EARTHQUAKE, "sword_quake") — a field-wide r460
   * ground shockwave: the biggest shake/punch in the sword kit, a traveling
   * ring out to the skill's own radius, an immediate ground crack at the
   * caster's feet, and a scatter of further cracks + dust columns staggered
   * across the field over real time (queued into `pendingFieldFx`, advanced
   * by `updatePendingFieldFx()`) so the quake reads as SPREADING, not a
   * single point flash. `strike` resolves the AoE damage INSTANTLY (no
   * projectile), so every beat here fires at cast time — there is no
   * separate "impact" moment to wait for. */
  private onSwordQuakeCast(x: number, pov: boolean): void {
    // M8 party P6: SCREEN-level only for the POV hero's own cast; the ground
    // crack/ring/dust/scatter below stays world-anchored for everyone.
    if (pov) {
      this.punch.trigger("swordQuake", x);
      this.shake.trigger(QUAKE_SHAKE);
      this.impactFilters.triggerShockwave(x, GROUND_Y);
    }

    this.rings.spawn({
      x,
      y: GROUND_Y,
      r0: 20,
      r1: QUAKE_RING_R1,
      duration: QUAKE_RING_DURATION,
      width: 6,
      color: PALETTE.swordCrimson,
    });
    this.groundCracks.spawn({
      x,
      y: GROUND_Y,
      radius: QUAKE_CRACK_SCATTER_RADIUS,
      spokes: 8,
      life: 0.7,
      darkColor: PALETTE.swordCrackDark,
      glowColor: PALETTE.swordEmber,
    });
    burst(this.particles, x, GROUND_Y - 6, QUAKE_DUST_PARTICLE_COUNT, PALETTE.muted, {
      speed: 120,
      life: 0.45,
      radius: 3.5,
    });

    // Schedule a scatter of further crack+dust beats across the field
    // (alternating sides, outward), reading as the shockwave TRAVELING away
    // from the caster rather than everything popping in at cast instant.
    this.pendingFieldFx.length = 0;
    for (let i = 0; i < QUAKE_SCATTER_COUNT; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const frac = (Math.floor(i / 2) + 1) / Math.ceil(QUAKE_SCATTER_COUNT / 2);
      const fx = clamp(x + side * frac * QUAKE_SCATTER_SPAN, 0, WORLD_WIDTH);
      this.pendingFieldFx.push({ t: frac * QUAKE_SCATTER_DURATION, x: fx });
    }
  }

  /** Swordsman tier-3 skill-4 (SKYFALL BLADE, "sword_skyfall", M7.9 "Grand
   * Expansion") — a field-wide (r500 > quake's r460) lightning-sword strike:
   * the biggest shake in the sword kit, several instant lightning bolts
   * dropping from the sky at SCATTERED field positions (not just the
   * caster's feet — `strike` resolves its AoE damage instantly, so there is
   * no separate impact moment to wait for, same as quake), a bigger ground
   * crack at the caster's own feet, and the SAME scatter-scheduling
   * mechanism `onSwordQuakeCast()` uses (`pendingFieldFx`, now generalized
   * with a `big` flag for a bigger scatter beat — see
   * `updatePendingFieldFx()`) — plus a real TIME-FREEZE beat
   * (`timeDirector.ts`'s `FREEZE_SWORD_SKYFALL`, wired off this same
   * `skillCast` event) that quake never had, selling "clearly bigger than
   * quake" per the owner's out-spectacle spec. */
  private onSwordSkyfallCast(x: number, pov: boolean): void {
    // M8 party P6: SCREEN-level only for the POV hero's own cast.
    if (pov) {
      this.punch.trigger("swordSkyfall", x);
      this.shake.trigger(SKYFALL_SHAKE);
      this.impactFilters.triggerShockwave(x, GROUND_Y);
    }

    this.rings.spawn({
      x,
      y: GROUND_Y,
      r0: 30,
      r1: SKYFALL_RING_R1,
      duration: SKYFALL_RING_DURATION,
      width: 7,
      color: PALETTE.swordLightningGlow,
    });
    this.groundCracks.spawn({
      x,
      y: GROUND_Y,
      radius: SKYFALL_CRACK_RADIUS,
      spokes: 10,
      life: 0.8,
      darkColor: PALETTE.swordCrackDark,
      glowColor: PALETTE.swordLightningGlow,
    });
    burst(this.particles, x, GROUND_Y - 6, QUAKE_DUST_PARTICLE_COUNT + 4, PALETTE.muted, {
      speed: 140,
      life: 0.5,
      radius: 4,
    });

    // Scattered lightning bolts dropping from the sky at field positions —
    // a glow underlayer (thicker, dimmer) + a bright white-hot core on top,
    // both flat/solid on the default blend, never additive (footgun 10).
    for (let i = 0; i < SKYFALL_BOLT_COUNT; i++) {
      const frac = SKYFALL_BOLT_COUNT <= 1 ? 0 : i / (SKYFALL_BOLT_COUNT - 1) - 0.5;
      const bx = clamp(x + frac * SKYFALL_BOLT_SPAN * 2, 0, WORLD_WIDTH);
      const topY = GROUND_Y - SKYFALL_BOLT_HEIGHT;
      this.flashLines.spawn({
        x1: bx,
        y1: topY,
        x2: bx + (Math.random() - 0.5) * 14,
        y2: GROUND_Y,
        color: PALETTE.swordLightningGlow,
        width: 5,
        life: 0.22,
        alpha: 0.55,
      });
      this.flashLines.spawn({
        x1: bx,
        y1: topY,
        x2: bx + (Math.random() - 0.5) * 6,
        y2: GROUND_Y,
        color: PALETTE.swordLightningCore,
        width: 2,
        life: 0.18,
        alpha: 0.9,
      });
    }

    // Reuse quake's own field-scatter scheduling, just wider/bigger (`big`
    // flag) and with a couple more scatter points — sells the r500 reach
    // past quake's r460 without a single dominating stroked circle.
    this.pendingFieldFx.length = 0;
    const scatterCount = QUAKE_SCATTER_COUNT + SKYFALL_SCATTER_EXTRA;
    for (let i = 0; i < scatterCount; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const frac = (Math.floor(i / 2) + 1) / Math.ceil(scatterCount / 2);
      const fx = clamp(
        x + side * frac * QUAKE_SCATTER_SPAN * SKYFALL_SCATTER_SPAN_MULT,
        0,
        WORLD_WIDTH,
      );
      this.pendingFieldFx.push({ t: frac * QUAKE_SCATTER_DURATION, x: fx, big: true });
    }
  }

  /** Advances the quake/skyfall ultimates' scheduled scatter beats (ground
   * crack + dust burst + a small ring) queued by `onSwordQuakeCast()`/
   * `onSwordSkyfallCast()` — same "small array, real-time countdown,
   * fire-then-remove" shape as `updateBossDeathStages()`. SKYFALL's entries
   * (`entry.big`) get a bigger/brighter version of the same beat (M7.9). */
  private updatePendingFieldFx(dt: number): void {
    if (!this.pendingFieldFx.length) return;
    for (let i = this.pendingFieldFx.length - 1; i >= 0; i--) {
      const entry = this.pendingFieldFx[i];
      entry.t -= dt;
      if (entry.t <= 0) {
        const bigMult = entry.big ? 1.4 : 1;
        const glow = entry.big ? PALETTE.swordLightningGlow : PALETTE.swordEmber;
        this.groundCracks.spawn({
          x: entry.x,
          y: GROUND_Y,
          radius: QUAKE_CRACK_SCATTER_RADIUS * 0.8 * bigMult,
          spokes: entry.big ? 7 : 5,
          life: entry.big ? 0.65 : 0.5,
          darkColor: PALETTE.swordCrackDark,
          glowColor: glow,
        });
        burst(
          this.particles,
          entry.x,
          GROUND_Y - 6,
          Math.round(QUAKE_DUST_PARTICLE_COUNT * bigMult),
          PALETTE.muted,
          {
            speed: entry.big ? 130 : 100,
            life: entry.big ? 0.5 : 0.4,
            radius: entry.big ? 4 : 3,
          },
        );
        this.rings.spawn({
          x: entry.x,
          y: GROUND_Y,
          r0: 8,
          r1: entry.big ? 90 : 60,
          duration: entry.big ? 0.45 : 0.35,
          width: entry.big ? 4 : 3,
          color: glow,
        });
        this.pendingFieldFx.splice(i, 1);
      }
    }
  }

  /** Archer SIGNATURE (ARROW RAIN, "archer_rain") / ULTIMATE (BARRAGE,
   * "archer_barrage") — both reuse this one scene builder (M7.7: BARRAGE
   * reuses the SAME `rainArrow` projectile kind — footgun #6, no new
   * `ProjectileKind` — so it's differentiated here by the `isUltimate` flag
   * `onSkillCast()` derives from `ev.skillId`, never by `kind`). A bow flash
   * + upward "volley launch" streaks at cast time, then a rain-CURTAIN
   * streak PER real drop (its life IS that drop's own fall time, so the
   * curtain visually resolves exactly as each arrow lands) alongside the
   * existing falling-shadow markers + landing tracking, for every drop the
   * engine already pushed synchronously into `state.projectiles` this same
   * step. The ultimate additionally gets its own big shake/punch AT CAST
   * (the "whole field is about to get hit" read) and a bigger/brighter
   * emerald curtain than the signature's paler dusting. */
  private onArcherRainCast(
    x: number,
    color: number,
    state: GameState,
    isUltimate: boolean,
    pov: boolean,
  ): void {
    // Bow flash: quick expanding ring + a tiny release burst at the bow.
    this.rings.spawn({
      x,
      y: HERO_MID_Y,
      r0: 6,
      r1: 11,
      duration: 0.15,
      width: 2,
      color,
    });
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

    // M8 party P6: SCREEN-level only for the POV hero's own cast.
    if (isUltimate && pov) {
      this.punch.trigger("archerBarrage", x);
      this.shake.trigger(BARRAGE_CAST_SHAKE);
    }

    const curtainColor = isUltimate ? PALETTE.archerEmerald : HERO_COLORS.archer.light;
    const curtainWidth = isUltimate ? BARRAGE_CURTAIN_WIDTH : RAIN_CURTAIN_WIDTH;
    const curtainAlpha = isUltimate ? BARRAGE_CURTAIN_ALPHA : RAIN_CURTAIN_ALPHA;

    // The drops (9 signature / 13 barrage) were just pushed synchronously
    // this same engine step (`engine/systems/skills.ts`) — read them back
    // for their exact (tx,ty) + flight time rather than re-deriving either.
    const drops = state.projectiles.filter(
      (p) => p.team === "hero" && p.kind === "rainArrow",
    );
    for (const p of drops) {
      if (this.pendingRainArrows.length >= MAX_PENDING_RAIN_ARROWS) break;
      const fallDist = Math.hypot(p.tx - p.x, p.ty - p.y);
      const fallTime = Math.max(0.1, fallDist / Math.max(1, p.speed));
      this.rainShadows.trySpawn({
        x: p.tx,
        y: p.ty,
        life: fallTime,
        color: curtainColor,
      });
      this.curtainStreaks.spawn({
        x: p.tx,
        topY: HERO_TOP_Y - 50,
        bottomY: p.ty,
        life: fallTime,
        color: curtainColor,
        glintColor: PALETTE.archerGoldGlint,
        width: curtainWidth,
        alpha: curtainAlpha,
      });
      this.pendingRainArrows.push({ id: p.id, tx: p.tx, ty: p.ty, big: isUltimate, pov });
    }
  }

  /** Continuous per-frame check of the ARROW RAIN/BARRAGE/STORM drops queued
   * by `onArcherRainCast()`/`onArcherStormCast()`: the frame a tracked drop's
   * id disappears from `state.projectiles` (i.e. it just resolved on the
   * ground — same "vanished this frame" detection `updateMeteorTracking()`
   * uses), fires the landing puff + ground-stuck-arrow decal, and — for a
   * STORM drop — counts down toward the finale beat (`onStormFinale()`). */
  private updateRainArrowTracking(state: GameState): void {
    if (!this.pendingRainArrows.length) return;
    for (let i = this.pendingRainArrows.length - 1; i >= 0; i--) {
      const entry = this.pendingRainArrows[i];
      const stillFalling = state.projectiles.some((p) => p.id === entry.id);
      if (!stillFalling) {
        this.onRainArrowLanded(entry.tx, entry.ty, entry.big, entry.isStorm, entry.pov);
        this.pendingRainArrows.splice(i, 1);
        if (entry.isStorm) {
          this.stormArrowsRemaining = Math.max(0, this.stormArrowsRemaining - 1);
          if (this.stormArrowsRemaining === 0) this.onStormFinale();
        }
      }
    }
  }

  /** One ARROW RAIN/BARRAGE/STORM drop resolving: a small dirt + feather puff
   * (NOT the bigger AOE impact burst class — this is a hail of small arrows,
   * not a nuke) plus a ground-stuck-arrow decal. BARRAGE (`big`, not
   * `isStorm`) gets a bigger burst + a small emerald impact ring + a mild
   * re-punch shake per landing; STORM (`isStorm`) gets the same bigger burst
   * but SKIPS the per-landing ring/shake (20 of those would be noisy) —
   * instead its decal lingers much longer (`STORM_GROUND_ARROW_LIFE`) so the
   * field bristles with arrows by the time `onStormFinale()` fires the one
   * big field-wide beat. */
  private onRainArrowLanded(
    x: number,
    y: number,
    big: boolean,
    isStorm = false,
    pov = true,
  ): void {
    burst(
      this.particles,
      x,
      y,
      big ? RAIN_LAND_DIRT_COUNT + 2 : RAIN_LAND_DIRT_COUNT,
      PALETTE.muted,
      {
        speed: big ? 75 : 55,
        life: big ? 0.28 : 0.22,
        radius: big ? 2.6 : 2,
      },
    );
    burst(
      this.particles,
      x,
      y,
      big ? BARRAGE_LAND_PARTICLE_COUNT : RAIN_LAND_FEATHER_COUNT,
      HERO_COLORS.archer.light,
      { speed: big ? 55 : 35, life: big ? 0.38 : 0.3, radius: 1.8 },
    );
    this.groundArrows.spawn(
      x,
      y,
      HERO_COLORS.archer.light,
      isStorm ? STORM_GROUND_ARROW_LIFE : undefined,
    );
    if (big && !isStorm) {
      // World-level ring stays unconditional; the re-punch shake (M8 party
      // P6) only fires when the caster who scheduled THIS drop was the POV
      // hero at cast time (`entry.pov`, captured in `onArcherRainCast()`).
      this.rings.spawn({
        x,
        y,
        r0: 4,
        r1: BARRAGE_LAND_RING_R1,
        duration: 0.28,
        width: 2.5,
        color: PALETTE.archerEmerald,
      });
      if (pov) this.shake.trigger(BARRAGE_LAND_SHAKE);
    }
  }

  /** Archer tier-3 skill-4 (STORM, "archer_storm", M7.9 "Grand Expansion") —
   * a SUSTAINED ~4s storm: shares the volley-launch cast cue with the
   * signature/barrage (`onArcherRainCast()`), but adds a green-tinted
   * sky-darken + an arrow-swarm silhouette band (`arrowSwarm`), both HELD for
   * the whole storm (vs cataclysm's brief pulse), and tracks its 20 drops as
   * STORM-flagged entries so `updateRainArrowTracking()` fires
   * `onStormFinale()` the instant the last one lands. */
  private onArcherStormCast(
    x: number,
    color: number,
    state: GameState,
    pov: boolean,
  ): void {
    // Bow flash + volley launch streaks — same cast-time cue as the
    // signature/barrage.
    this.rings.spawn({
      x,
      y: HERO_MID_Y,
      r0: 6,
      r1: 12,
      duration: 0.16,
      width: 2.4,
      color,
    });
    burst(this.particles, x, HERO_MID_Y, 6, color, { speed: 65, life: 0.22, radius: 2 });
    for (let i = 0; i < RAIN_LAUNCH_STREAK_COUNT + 2; i++) {
      const jitter = (Math.random() - 0.5) * RAIN_LAUNCH_STREAK_SPREAD;
      const height = RAIN_LAUNCH_STREAK_HEIGHT * (0.8 + Math.random() * 0.6);
      this.flashLines.spawn({
        x1: x + jitter,
        y1: HERO_MID_Y,
        x2: x + jitter * 1.3,
        y2: HERO_MID_Y - height,
        color,
        width: 1.8,
        life: 0.18,
        alpha: 0.65,
      });
    }

    // M8 party P6: SCREEN-level cast punch/shake + the sky-darken overlay
    // only fire for the POV hero's own cast; the arrow-swarm band below stays
    // world-anchored (positioned relative to the caster, not full-viewport)
    // and plays for everyone. Also latch `stormFinalePov` so the finale beat
    // (fired later, once `stormArrowsRemaining` drains — see that field's own
    // doc comment) knows whether a POV cast contributed to this countdown.
    if (pov) {
      this.punch.trigger("archerStorm", x);
      this.shake.trigger(STORM_CAST_SHAKE);
      this.skyDarken.trigger(PALETTE.archerStormSky, STORM_SKY_ALPHA, STORM_SKY_HOLD);
      this.stormFinalePov = true;
    }

    this.arrowSwarm.spawnBand(
      x,
      STORM_SWARM_COUNT,
      STORM_SWARM_Y,
      PALETTE.archerSwarmDark,
      STORM_SKY_HOLD + 0.6,
    );

    const drops = state.projectiles.filter(
      (p) => p.team === "hero" && p.kind === "rainArrow",
    );
    for (const p of drops) {
      if (this.pendingRainArrows.length >= MAX_PENDING_RAIN_ARROWS) break;
      const fallDist = Math.hypot(p.tx - p.x, p.ty - p.y);
      const fallTime = Math.max(0.1, fallDist / Math.max(1, p.speed));
      this.rainShadows.trySpawn({
        x: p.tx,
        y: p.ty,
        life: fallTime,
        color: PALETTE.archerEmerald,
      });
      this.curtainStreaks.spawn({
        x: p.tx,
        topY: HERO_TOP_Y - 50,
        bottomY: p.ty,
        life: fallTime,
        color: PALETTE.archerEmerald,
        glintColor: PALETTE.archerGoldGlint,
        width: BARRAGE_CURTAIN_WIDTH,
        alpha: BARRAGE_CURTAIN_ALPHA,
      });
      this.pendingRainArrows.push({
        id: p.id,
        tx: p.tx,
        ty: p.ty,
        big: true,
        isStorm: true,
        pov,
      });
      this.stormArrowsRemaining++;
    }
  }

  /** STORM's finale beat (M7.9): fires the instant `stormArrowsRemaining`
   * drains to 0 — one big field-wide ring + a closing shake at the arena
   * center, plus every still-ground-stuck arrow glinting then fading
   * together (`GroundArrowPool.finaleGlintAndFadeAll()`) instead of each
   * fading independently, reading as "the whole battlefield settling at
   * once". */
  private onStormFinale(): void {
    const cx = WORLD_WIDTH / 2;
    // M8 party P6: SCREEN-level punch/shake only if a POV cast contributed
    // to this countdown (`stormFinalePov`, latched in `onArcherStormCast()`);
    // the field-wide ring/particle payout + ground-arrow glint below stays
    // world-anchored and unconditional.
    if (this.stormFinalePov) {
      this.punch.trigger("archerStorm", cx);
      this.shake.trigger(STORM_FINALE_SHAKE);
    }
    this.stormFinalePov = false;
    this.rings.spawn({
      x: cx,
      y: GROUND_Y - 20,
      r0: 40,
      r1: STORM_FINALE_RING_R1,
      duration: STORM_FINALE_RING_DURATION,
      width: 6,
      color: PALETTE.archerEmerald,
    });
    burst(
      this.particles,
      cx,
      GROUND_Y - 20,
      STORM_FINALE_PARTICLE_COUNT,
      PALETTE.archerGoldGlint,
      {
        speed: 170,
        life: 0.5,
        radius: 3,
      },
    );
    this.groundArrows.finaleGlintAndFadeAll(STORM_FINALE_FADE_DURATION);
  }

  /** Archer UTILITY (POWER SHOT, "archer_powershot") — a single high-damage
   * homing arrow (the archer's single-target answer to a lone boss); modest,
   * a brighter release flash + a longer gold streak than the basic shot, no
   * field dressing. The arrow itself reuses the `arrow` projectile kind, so
   * its flight already gets `updateTracers()`'s tracer for free. */
  private onArcherPowershotCast(x: number, color: number): void {
    this.rings.spawn({
      x,
      y: HERO_MID_Y,
      r0: 4,
      r1: POWERSHOT_RING_R1,
      duration: 0.2,
      width: 2.5,
      color,
    });
    this.flashLines.spawn({
      x1: x,
      y1: HERO_MID_Y,
      x2: x + POWERSHOT_STREAK_LEN,
      y2: HERO_MID_Y,
      color: PALETTE.archerGoldGlint,
      width: 2.4,
      life: 0.18,
      alpha: 0.8,
    });
    burst(this.particles, x, HERO_MID_Y, 6, color, {
      speed: 90,
      life: 0.22,
      radius: 2.2,
    });
  }

  /** Mage SIGNATURE (METEOR, "mage_meteor") / ULTIMATE (CATACLYSM,
   * "mage_cataclysm") — both reuse this scene builder (M7.7: CATACLYSM
   * reuses the SAME `meteor` projectile kind — footgun #6 — differentiated
   * here by `isUltimate`, driven off `ev.skillId`): a sky flash + a large
   * glowing ground rune at the target point while it falls; the falling
   * fire tracer is `updateTracers()`'s job, the scorch/impact beat is
   * `updateMeteorTracking()`'s (both already generalize via `PendingMeteor`
   * carrying `isUltimate`). The ultimate additionally darkens the sky for a
   * beat (`skyDarken`, azure-tinted per the mage's arcane sky-event
   * language) and gets a bigger rune/flourish — its shake/impact spectacle
   * lands ON IMPACT, not cast (see `onCataclysmImpact()`), matching how the
   * boss's own slam telegraphs before it lands. */
  private onMageMeteorCast(
    x: number,
    color: number,
    state: GameState,
    isUltimate: boolean,
    pov: boolean,
  ): void {
    // The meteor's fixed ground-target point is `tx` on the projectile the
    // engine pushed synchronously in this same step (see
    // `engine/systems/skills.ts`) — read it back rather than re-deriving it.
    const meteor = state.projectiles.find(
      (p) => p.team === "hero" && p.kind === "meteor",
    );
    const tx = meteor ? meteor.tx : x;

    // M8 party P6: both are full-viewport/near-full-width overlays (same
    // category as `ArenaFlash` — see `meteorScene.ts`'s/`skyDarken.ts`'s own
    // doc comments), so SCREEN-level, gated to the POV hero's own cast. The
    // rune glyph + cast flourish below stay world-anchored, unconditional.
    if (pov) {
      this.meteorSky.trigger(
        isUltimate ? PALETTE.mageAzure : color,
        isUltimate ? 0.34 : 0.22,
      );
      if (isUltimate) this.skyDarken.trigger(PALETTE.skyDarkTint, CATACLYSM_SKY_ALPHA);
    }

    const fallTime = estimateMeteorFallTime();
    this.runeGlyphs.spawn({
      x: tx,
      y: GROUND_Y,
      radius: isUltimate ? METEOR_RUNE_RADIUS * 1.6 : METEOR_RUNE_RADIUS,
      ticks: isUltimate ? METEOR_RUNE_TICKS + 4 : METEOR_RUNE_TICKS,
      color: isUltimate ? PALETTE.mageAzure : color,
      life: fallTime,
      rotationSpeed: isUltimate ? 2.2 : 1.6,
      alpha: 0.5,
      fadeInFrac: 0.15,
    });
    if (this.pendingMeteors.length < MAX_PENDING_METEORS) {
      // `meteor` is guaranteed by the cast guard (`castSkill` requires ≥1
      // target before committing) — the `-1` fallback only matters for a
      // render-side defensive read, never a real gameplay path.
      this.pendingMeteors.push({ id: meteor ? meteor.id : -1, tx, isUltimate, pov });
    }

    // Cast flourish at the staff.
    burst(
      this.particles,
      x,
      HERO_TOP_Y,
      isUltimate ? 10 : 6,
      isUltimate ? PALETTE.mageAzure : color,
      {
        speed: 50,
        life: 0.3,
        radius: 2.5,
      },
    );
  }

  /** Mage tier-3 skill-4 (APOCALYPSE, "mage_apocalypse", M7.9 "Grand
   * Expansion") — an 8-meteor volley reading as world-ending: the sky-darken
   * HOLDS much longer + darker than cataclysm's brief pulse (still the
   * mage's own violet/azure sky-event language), and every one of the 8
   * concurrently-tracked drops gets its own ground rune + (on landing, via
   * `updateMeteorTracking()`) its own smaller impact beat
   * (`onApocalypseMeteorImpact()`) — repeated re-triggers across the
   * volley's staggered landing window read as SUSTAINED devastation rather
   * than cataclysm's one single flash. Tracked by projectile id (not `tx`
   * proximity — several drops can share nearby target x's here). */
  private onMageApocalypseCast(x: number, state: GameState, pov: boolean): void {
    const meteors = state.projectiles.filter(
      (p) => p.team === "hero" && p.kind === "meteor",
    );
    const alreadyTracked = new Set(this.pendingMeteors.map((m) => m.id));

    // M8 party P6: SCREEN-level sky overlays gated to the POV hero's own
    // cast — see `onMageMeteorCast()`'s matching doc comment.
    if (pov) {
      this.meteorSky.trigger(PALETTE.mageAzure, 0.4);
      this.skyDarken.trigger(
        PALETTE.mageVoidTint,
        APOCALYPSE_SKY_ALPHA,
        APOCALYPSE_SKY_HOLD,
      );
    }

    const fallTime = estimateMeteorFallTime();
    for (const m of meteors) {
      if (alreadyTracked.has(m.id)) continue;
      if (this.pendingMeteors.length >= MAX_PENDING_METEORS) break;
      this.runeGlyphs.spawn({
        x: m.tx,
        y: GROUND_Y,
        radius: APOCALYPSE_RUNE_RADIUS,
        ticks: METEOR_RUNE_TICKS + 2,
        color: PALETTE.mageAzure,
        life: fallTime,
        rotationSpeed: 2.4,
        alpha: 0.5,
        fadeInFrac: 0.15,
      });
      this.pendingMeteors.push({
        id: m.id,
        tx: m.tx,
        isUltimate: true,
        isApocalypse: true,
        pov,
      });
    }

    // Cast flourish at the staff — bigger than the signature/cataclysm's,
    // reading as "channeling the whole volley at once".
    burst(this.particles, x, HERO_TOP_Y, 14, PALETTE.mageAzure, {
      speed: 55,
      life: 0.32,
      radius: 2.8,
    });
    if (pov) this.punch.trigger("mageApocalypse", x);
  }

  /** CATACLYSM ultimate's impact beat (M7.7, fired from `updateMeteorTracking()`
   * the frame its tracked drop resolves) — the biggest shake/punch in the
   * game, a big azure impact ring, a scatter of extra scorch patches across
   * the field (selling the r460 field-wide reach without one dominating
   * 460px stroked circle), and lingering embers that drift a moment after
   * everything else has settled. */
  private onCataclysmImpact(tx: number, pov: boolean): void {
    // M8 party P6: SCREEN-level only if the caster who scheduled this drop
    // was the POV hero at cast time (`entry.pov`); the scorch scatter/ring/
    // ember burst below stays world-anchored, unconditional.
    if (pov) {
      this.punch.trigger("mageCataclysm", tx);
      this.shake.trigger(CATACLYSM_SHAKE);
      this.impactFilters.triggerShockwave(tx, GROUND_Y);
    }

    const scatterXs = [
      tx - CATACLYSM_SCATTER_SCORCH_SPAN,
      tx,
      tx + CATACLYSM_SCATTER_SCORCH_SPAN,
    ];
    for (const sx of scatterXs) {
      this.scorches.spawn(clamp(sx, 0, WORLD_WIDTH), GROUND_Y, PALETTE.mageAzure);
    }

    this.rings.spawn({
      x: tx,
      y: GROUND_Y,
      r0: 24,
      r1: CATACLYSM_RING_R1,
      duration: 0.55,
      width: 6,
      color: PALETTE.mageAzure,
    });
    burst(this.particles, tx, GROUND_Y - 10, 20, HERO_COLORS.mage.light, {
      speed: 190,
      life: 0.45,
      radius: 4,
    });
    // Lingering embers — a slow upward drift over a longer life than any
    // other burst in the fx toolkit, reading as "the aftermath hangs a beat".
    burst(this.particles, tx, GROUND_Y - 10, CATACLYSM_EMBER_COUNT, PALETTE.mageAzure, {
      speed: 40,
      life: CATACLYSM_EMBER_LIFE,
      radius: 2.5,
      gravity: -18,
      drag: 0.5,
    });
  }

  /** APOCALYPSE's per-meteor impact beat (M7.9, fired from
   * `updateMeteorTracking()` the frame each tracked drop resolves) — smaller
   * than cataclysm's single big impact, but retriggered up to 8 times across
   * the volley's staggered landing window (`ScreenShake.trigger()`'s "max
   * wins" policy means these don't stack additively — the READ is sustained
   * repeated pulses, not one bigger spike). */
  private onApocalypseMeteorImpact(tx: number, pov: boolean): void {
    // M8 party P6: SCREEN-level only for the POV hero's own cast (`entry.pov`);
    // the scorch/ring/burst below stays world-anchored, unconditional.
    if (pov) {
      this.shake.trigger(APOCALYPSE_IMPACT_SHAKE);
      this.impactFilters.triggerShockwave(tx, GROUND_Y);
    }
    this.scorches.spawn(clamp(tx, 0, WORLD_WIDTH), GROUND_Y, PALETTE.mageAzure);
    this.rings.spawn({
      x: tx,
      y: GROUND_Y,
      r0: 14,
      r1: APOCALYPSE_RING_R1,
      duration: 0.4,
      width: 4,
      color: PALETTE.mageAzure,
    });
    burst(this.particles, tx, GROUND_Y - 8, 12, HERO_COLORS.mage.light, {
      speed: 150,
      life: 0.35,
      radius: 3,
    });
  }

  /** Mage UTILITY (FROST NOVA, "mage_frostnova") — a cheap, fast AoE burst
   * for sustained clearing between meteors; modest icy/azure accents, no
   * big shake/shockwave (utility skills stay legible). Centered on the
   * caster — render has no read on the engine's exact `nearestWithin`
   * target x for an instant `strike`, and a self-centered burst still reads
   * correctly for a "close-range clear" ability. */
  private onMageFrostNovaCast(x: number, color: number): void {
    this.rings.spawn({
      x,
      y: HERO_MID_Y,
      r0: 10,
      r1: FROSTNOVA_RING_R1,
      duration: 0.35,
      width: 3,
      color: PALETTE.mageAzure,
    });
    burst(this.particles, x, HERO_MID_Y, FROSTNOVA_PARTICLE_COUNT, PALETTE.ivory, {
      speed: 90,
      life: 0.32,
      radius: 2.4,
    });
    burst(this.particles, x, HERO_MID_Y, 6, color, { speed: 60, life: 0.3, radius: 2 });
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
  private onProgressUnlocked(
    kind: "zoneUnlocked" | "mapUnlocked",
    state: GameState,
  ): void {
    const hero = state.heroes[0];
    if (!hero) return;
    const big = kind === "mapUnlocked";
    burst(
      this.particles,
      hero.x,
      HERO_TOP_Y,
      big ? MAP_UNLOCK_PARTICLE_COUNT : ZONE_UNLOCK_PARTICLE_COUNT,
      PALETTE.gold,
      {
        speed: 90,
        life: 0.45,
        radius: 2.5,
        gravity: -25,
        drag: 0.3,
      },
    );
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
    burst(
      this.particles,
      ev.x,
      ev.y,
      FASTTRAVEL_ARRIVE_PARTICLE_COUNT,
      PALETTE.travelPortalCore,
      {
        speed: 100,
        life: 0.35,
        radius: 2.5,
      },
    );
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

  /** หินเสริมพลัง drop beat: a small, fixed-violet ground pop wherever
   * `systems/gear`'s `stoneDrop` fired — same "cheap, can fire often" budget
   * as `onItemDrop` above (kill chance is high on deeper maps, so this stays
   * even smaller than the common-gear pop). */
  private onStoneDrop(ev: Extract<GameEvent, { type: "stoneDrop" }>): void {
    const y = STONE_DROP_POP_Y;
    this.rings.spawn({
      x: ev.x,
      y,
      r0: STONE_DROP_RING_R0,
      r1: STONE_DROP_RING_R1,
      duration: STONE_DROP_RING_DURATION,
      width: 2,
      color: PALETTE.stoneMaterial,
    });
    burst(this.particles, ev.x, y, STONE_DROP_PARTICLE_COUNT, PALETTE.stoneMaterial, {
      speed: STONE_DROP_PARTICLE_SPEED,
      life: STONE_DROP_PARTICLE_LIFE,
      radius: 2,
      gravity: -20,
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
    burstDirectional(
      this.particles,
      ev.x,
      ev.y,
      MELEE_SPARK_COUNT_STEEL,
      PALETTE.steel,
      angle,
      {
        speed: 140,
        life: 0.22,
        radius: 2.5,
        spread: 1.4,
      },
    );
    burstDirectional(
      this.particles,
      ev.x,
      ev.y,
      MELEE_SPARK_COUNT_GOLD,
      PALETTE.gold,
      angle,
      {
        speed: 110,
        life: 0.26,
        radius: 2,
        spread: 1.6,
      },
    );
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
      holding && mage
        ? { x: mage.x, y: HERO_MID_Y, color: HERO_COLORS.mage.light }
        : null,
    );
  }

  /** Watches the in-flight mage meteors this controller is tracking (queued
   * by `onMageMeteorCast()`/`onMageApocalypseCast()`) and, the frame one
   * disappears from `state.projectiles` (i.e. it just resolved/hit the
   * ground — matched by projectile `id`, not `tx` proximity, so several
   * concurrent APOCALYPSE drops with nearby target x's can't be confused
   * with one another), spawns the glowing scorch patch at its target point
   * (item 11) — or, for CATACLYSM (M7.7, `entry.isUltimate`), the bigger
   * `onCataclysmImpact()` beat, or for APOCALYPSE (M7.9, `entry.isApocalypse`),
   * the smaller-but-repeated `onApocalypseMeteorImpact()` beat. The existing
   * shockwave/impact-burst on the actual damage `hit` stays unchanged — this
   * only adds the ground decal (+ each ultimate's extra spectacle). */
  private updateMeteorTracking(state: GameState): void {
    if (!this.pendingMeteors.length) return;
    for (let i = this.pendingMeteors.length - 1; i >= 0; i--) {
      const entry = this.pendingMeteors[i];
      const stillFalling = state.projectiles.some((p) => p.id === entry.id);
      if (!stillFalling) {
        if (entry.isApocalypse) {
          this.onApocalypseMeteorImpact(entry.tx, entry.pov);
        } else if (entry.isUltimate) {
          this.onCataclysmImpact(entry.tx, entry.pov);
        } else {
          this.scorches.spawn(entry.tx, GROUND_Y, HERO_COLORS.mage.light);
        }
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
    // M7.9 "new mob species": species-resolved tint (see `onKill`'s doc
    // comment) — computed once per call, not per enemy (every enemy this
    // frame shares the same current-zone map).
    const mapId = zoneAt(state.location).mapId;
    for (const e of state.enemies) {
      this.frameEnemyIdScratch.add(e.id);
      if (!this.seenEnemyIds.has(e.id)) {
        this.seenEnemyIds.add(e.id);
        this.portals.spawn(e.x, GROUND_Y, enemyColorFor(mapId, e.kind), e.size);
      }
    }
    for (const id of this.seenEnemyIds) {
      if (!this.frameEnemyIdScratch.has(id)) this.seenEnemyIds.delete(id);
    }
  }

  /** M8 party P6 juice: render-side mirror of `Pool`'s own hero mark-and-sweep
   * (same convention as `updateEnemySpawns()` above) — a ring ping + burst the
   * instant a hero view FIRST appears (member joined the cohort/zone; the
   * nameplate's own "flash" half of this beat lives in `heroView.ts`, keyed
   * off the SAME first-sight moment via its `!anim.initialized` edge), and a
   * small fade-out puff at the last-known position when one disappears. */
  private updatePartyMembership(state: GameState): void {
    this.framePartyIdScratch.clear();
    for (const h of state.heroes) {
      this.framePartyIdScratch.add(h.id);
      if (!this.seenHeroPos.has(h.id)) this.onHeroJoinedCohort(h.x);
      this.seenHeroPos.set(h.id, h.x);
    }
    for (const [id, lastX] of this.seenHeroPos) {
      if (!this.framePartyIdScratch.has(id)) {
        this.seenHeroPos.delete(id);
        this.onHeroLeftCohort(lastX);
      }
    }
  }

  private onHeroJoinedCohort(x: number): void {
    this.rings.spawn({
      x,
      y: HERO_TOP_Y,
      r0: PARTY_JOIN_RING_R0,
      r1: PARTY_JOIN_RING_R1,
      duration: PARTY_JOIN_RING_DURATION,
      width: 2,
      color: PALETTE.hpGood,
    });
    burst(this.particles, x, HERO_MID_Y, PARTY_JOIN_PARTICLE_COUNT, PALETTE.hpGood, {
      speed: 55,
      life: 0.4,
      radius: 2.2,
    });
  }

  private onHeroLeftCohort(x: number): void {
    burstInward(
      this.particles,
      x,
      HERO_MID_Y,
      PARTY_LEAVE_PARTICLE_COUNT,
      PALETTE.muted,
      PARTY_LEAVE_PUFF_RADIUS,
      {
        speed: 45,
        life: 0.45,
        radius: 2.2,
      },
    );
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

  /** Resolves the CURRENT boss's map-themed accent tint (`BOSS_COLORS[mapId]
   * .crown`, same field `bossThemes.ts` uses for the idle crown/eye look) via
   * `zoneAt(state.location)` — mirrors `bossView.ts`'s own `ctx.mapId`
   * plumbing (render has no engine `Boss.mapId` field to read directly).
   * WORLD BOSS "เสี่ยจ๋อง": its shared charge/hazard telegraphs (see
   * `onBossChargeTelegraph()`/`onBossHazardWarn()` below) reuse this same
   * resolver — checked FIRST so its telegraph rings tint gold (the tycoon's
   * own wealth motif) instead of whatever stage-boss theme happens to belong
   * to the farm zone's map. Falls back to the universal `PALETTE.warn` if the
   * map id is ever outside the configured roster (shouldn't happen — these
   * events only fire while standing in that map's boss room — but keeps this
   * render-only, never a crash). */
  private resolveBossTint(state: GameState): number {
    if (state.worldBoss?.active) return PALETTE.worldBossGold;
    const mapId = zoneAt(state.location).mapId as BossMapId;
    return BOSS_COLORS[mapId]?.crown ?? PALETTE.warn;
  }

  /** WORLD BOSS "เสี่ยจ๋อง": the screen-height anchor shared-event handlers
   * (`bossSlamTelegraph`'s ring, `hitY()`'s damage numbers) should use — the
   * stage boss's fixed `BOSS_CY` (GROUND_Y-30) sits far too low on the much
   * taller tycoon rig (`WORLD_BOSS_CY`, GROUND_Y-74; see `worldBossView.ts`). */
  private bossCy(state: GameState): number {
    return state.worldBoss?.active ? WORLD_BOSS_CY : BOSS_CY;
  }

  /**
   * WORLD BOSS "เสี่ยจ๋อง" zone-wide beats (spawn/despawn/defeat) are a shared
   * world event, not a per-hero skill cast — gating them on `povHeroIndex`
   * would make no sense (nobody "cast" the boss's arrival). Instead this
   * conditions the SCREEN-level part of each beat (shake/flash — the
   * particle/ring burst at the boss's own position always fires, same as
   * every other world-anchored fx in this file) on whether the LOCAL client
   * rendering this frame is actually standing in the boss's zone — i.e.
   * whether the boss would be on THIS screen at all. Solo play: always true
   * at spawn (the spawn intent requires standing there) and true at defeat
   * (dealing the killing blow requires being in-zone); a despawn triggered by
   * the hero walking away resolves `state.location` to the NEW zone, so this
   * correctly comes back false for that case (no shake for a boss you just
   * walked away from). */
  private isLocalInWorldBossZone(
    state: GameState,
    mapId: string,
    zoneIdx: number,
  ): boolean {
    return state.location.mapId === mapId && state.location.zoneIdx === zoneIdx;
  }

  /** Refreshes `worldBossLastPos` every frame while the world boss is alive —
   * see that field's own doc comment for why the despawn/defeat handlers need
   * a frame-earlier cache instead of reading `state.worldBoss.entity` (already
   * null by the time those events are visible). */
  private updateWorldBossTracking(state: GameState): void {
    const entity = state.worldBoss?.entity;
    if (state.worldBoss?.active && entity) {
      this.worldBossLastPos = { x: entity.x, y: entity.y };
    }
  }

  /** `worldBossSpawned`: the entity is ALREADY populated in `state` by the
   * time this event is visible (see `systems/worldBoss.ts`'s `trySpawnWorldBoss`
   * — it sets `state.worldBoss.entity` THEN pushes the event, same step), so
   * this reads position live rather than from the last-known cache. A
   * darken + dust + shake entrance, weightier than the stage boss's own
   * `onBossEntrance()` (a world event announcing itself deserves more than a
   * routine boss-room entry). */
  private onWorldBossSpawned(state: GameState): void {
    const wb = state.worldBoss;
    if (!wb || !wb.entity) return;
    const x = wb.entity.x;
    burst(this.particles, x, GROUND_Y - 4, WORLD_BOSS_SPAWN_DUST_COUNT, PALETTE.muted, {
      speed: WORLD_BOSS_SPAWN_DUST_SPEED,
      life: WORLD_BOSS_SPAWN_DUST_LIFE,
      radius: 4,
    });
    if (!this.isLocalInWorldBossZone(state, wb.mapId, wb.zoneIdx)) return;
    this.flash.trigger(BOSS_ENTRANCE_DARK_TINT, WORLD_BOSS_SPAWN_DARK_ALPHA);
    this.shake.trigger(WORLD_BOSS_SPAWN_SHAKE);
  }

  /** `worldBossDespawned` (lifetime expiry OR the hero left the zone): a
   * smoke-out poof at the last-known position — deliberately QUIET (no shake/
   * flash even when the local client IS in-zone) since this is "he wandered
   * off", not a combat beat. */
  private onWorldBossDespawned(state: GameState): void {
    const wb = state.worldBoss;
    const pos = this.worldBossLastPos;
    if (!wb || !pos) return;
    if (!this.isLocalInWorldBossZone(state, wb.mapId, wb.zoneIdx)) return;
    burst(
      this.particles,
      pos.x,
      GROUND_Y - 10,
      WORLD_BOSS_DESPAWN_SMOKE_COUNT,
      PALETTE.muted,
      {
        speed: WORLD_BOSS_DESPAWN_SMOKE_SPEED,
        life: WORLD_BOSS_DESPAWN_SMOKE_LIFE,
        radius: 6,
        gravity: -30, // rises like smoke, not falling debris
        drag: 0.3,
      },
    );
    this.rings.spawn({
      x: pos.x,
      y: GROUND_Y - 10,
      r0: WORLD_BOSS_DESPAWN_RING_R0,
      r1: WORLD_BOSS_DESPAWN_RING_R1,
      duration: WORLD_BOSS_DESPAWN_RING_DURATION,
      width: 3,
      color: PALETTE.muted,
    });
  }

  /** `worldBossDefeated`: the biggest gold payoff beat in the game — staged
   * escalating pulses (bigger version of `BOSS_DEATH_STAGE_SPEC`) plus a real
   * coin FOUNTAIN (`shower()`, wider + denser than `playBossDefeated`'s own
   * coin-shower SFX texture implies). Gated the same way as spawn/despawn. */
  private onWorldBossDefeated(state: GameState): void {
    const wb = state.worldBoss;
    const pos = this.worldBossLastPos;
    if (!wb || !pos) return;
    if (!this.isLocalInWorldBossZone(state, wb.mapId, wb.zoneIdx)) return;
    this.shake.trigger(WORLD_BOSS_DEFEAT_SHAKE);
    this.punch.trigger("bossDefeated");
    this.flash.trigger(PALETTE.worldBossGold, WORLD_BOSS_DEFEAT_FLASH_ALPHA);
    // Defensive clear (mirrors `onBossDefeated()`) — the stage boss and the
    // world boss never coexist, so this is normally already empty.
    this.bossDeathStages.length = 0;
    for (const spec of WORLD_BOSS_DEFEAT_STAGE_SPEC) {
      this.bossDeathStages.push({ ...spec, x: pos.x, y: WORLD_BOSS_CY });
    }
    shower(
      this.particles,
      pos.x,
      WORLD_BOSS_DEFEAT_SHOWER_WIDTH,
      GROUND_Y - 140,
      WORLD_BOSS_DEFEAT_SHOWER_COUNT,
      PALETTE.worldBossGold,
    );
  }

  // ---- CHARGE (map4 s20, ALSO reused by the world boss): telegraphed dash --
  /** A low ground streak (universal `PALETTE.warn`, the dominant "danger"
   * read) from the boss toward the locked dash target, held for the whole
   * windup, plus a tighter map-tinted windup ring right at the boss so the
   * tell still reads as "this boss's own attack". WORLD BOSS "เสี่ยจ๋อง": its
   * own charge windup is LONGER (`CONFIG.worldBoss.bossBehavior.charge
   * .telegraph`, 1.1s vs the stage boss's 0.85s — see `systems/worldBoss.ts`'s
   * doc comment on the deliberately fairer open-field timing) — using the
   * stage-boss constant unconditionally would end this ring/streak a quarter
   * second before the dash actually launches. */
  private onBossChargeTelegraph(
    ev: Extract<GameEvent, { type: "bossChargeTelegraph" }>,
    state: GameState,
  ): void {
    const windup = state.worldBoss?.active
      ? CONFIG.worldBoss.bossBehavior.charge.telegraph
      : CONFIG.bossBehavior.charge.telegraph;
    this.flashLines.spawn({
      x1: ev.x,
      y1: CHARGE_STREAK_Y,
      x2: ev.targetX,
      y2: CHARGE_STREAK_Y,
      color: PALETTE.warn,
      width: CHARGE_STREAK_WIDTH,
      life: windup,
      alpha: CHARGE_STREAK_ALPHA,
    });
    this.rings.spawn({
      x: ev.x,
      y: this.bossCy(state),
      r0: CHARGE_WINDUP_RING_R0,
      r1: CHARGE_WINDUP_RING_R1,
      duration: windup,
      width: 3,
      color: this.resolveBossTint(state),
    });
  }

  /** Impact burst + shake at the dash's landing point — bigger when it
   * actually `connected` (a whiff still gets a smaller beat so the dash's
   * resolution always reads, even when dodged). */
  private onBossChargeHit(ev: Extract<GameEvent, { type: "bossChargeHit" }>): void {
    this.shake.trigger(
      ev.connected ? CHARGE_HIT_SHAKE_CONNECTED : CHARGE_HIT_SHAKE_WHIFF,
    );
    this.punch.trigger("bossSlamLand", ev.x);
    this.impactFilters.triggerShockwave(ev.x, GROUND_Y);
    this.rings.spawn({
      x: ev.x,
      y: GROUND_Y,
      r0: 14,
      r1: ev.connected ? CHARGE_HIT_RING_R1_CONNECTED : CHARGE_HIT_RING_R1_WHIFF,
      duration: 0.35,
      width: 4,
      color: PALETTE.warn,
    });
    burst(
      this.particles,
      ev.x,
      GROUND_Y - 8,
      ev.connected
        ? CHARGE_HIT_PARTICLE_COUNT_CONNECTED
        : CHARGE_HIT_PARTICLE_COUNT_WHIFF,
      PALETTE.warn,
      { speed: 140, life: 0.3, radius: 3 },
    );
  }

  // ---- SUMMON (map5 s25): add-wave arrival beat -----------------------------
  /** A brief map-tinted arcane glyph pulse at the boss (reuses the mage
   * meteor's rune-glyph shape — "calling forth" fits the same vocabulary) +
   * a small dust puff at each add's own arrival point. The engine's
   * `bossSummon` event carries only `count`, not each add's x — this
   * recomputes the SAME positions `systems/boss.ts` placed them at via the
   * shared `CONFIG.bossBehavior.summon.spawnSpacing` constant (no new event
   * field needed; the adds themselves are normal pooled `enemyView`s that
   * pop in automatically). */
  private onBossSummon(
    ev: Extract<GameEvent, { type: "bossSummon" }>,
    state: GameState,
  ): void {
    this.runeGlyphs.spawn({
      x: ev.x,
      y: BOSS_CY,
      radius: SUMMON_GLYPH_RADIUS,
      color: this.resolveBossTint(state),
      life: SUMMON_GLYPH_LIFE,
      fadeInFrac: 0.15,
    });
    const spacing = CONFIG.bossBehavior.summon.spawnSpacing;
    for (let i = 0; i < ev.count; i++) {
      const x = ev.x - (i + 1) * spacing;
      burst(this.particles, x, GROUND_Y - 4, SUMMON_PUFF_PARTICLE_COUNT, PALETTE.muted, {
        speed: 60,
        life: 0.35,
        radius: 3,
      });
    }
  }

  // ---- FIELD HAZARD (map6 s30): arena-wide warn -> repeated strike ticks ----
  /** `hazardBand.ts`'s pulsing ground band/edge glow, held for the engine's
   * own `hazard.telegraph` window so the read resolves right as the first
   * strike tick lands — plus a small map-tinted echo ring at the boss, same
   * "universal warn + boss-tint accent" split as the charge telegraph above. */
  private onBossHazardWarn(
    ev: Extract<GameEvent, { type: "bossHazardWarn" }>,
    state: GameState,
  ): void {
    // WORLD BOSS "เสี่ยจ๋อง": its own hazard warn window is LONGER
    // (`CONFIG.worldBoss.bossBehavior.hazard.telegraph`, 1.6s vs the stage
    // boss's 1.3s) — same "don't end the tell early" reasoning as the charge
    // telegraph fix above.
    const telegraph = state.worldBoss?.active
      ? CONFIG.worldBoss.bossBehavior.hazard.telegraph
      : CONFIG.bossBehavior.hazard.telegraph;
    this.hazardBand.trigger(PALETTE.warn, HAZARD_WARN_PEAK_ALPHA, telegraph);
    this.rings.spawn({
      x: ev.x,
      y: this.bossCy(state),
      r0: 20,
      r1: 90,
      duration: telegraph,
      width: 3,
      color: this.resolveBossTint(state),
    });
  }

  /** One arena-wide damage tick fired (repeats ~3-4x across the strike
   * window) — a modest re-punch each time (shake + a quick flash + a small
   * burst at the boss), deliberately smaller than the one-shot charge-hit/
   * slam-land beats since this one repeats in quick succession. */
  private onBossHazardStrike(ev: Extract<GameEvent, { type: "bossHazardStrike" }>): void {
    this.shake.trigger(HAZARD_STRIKE_SHAKE);
    this.flash.trigger(PALETTE.warn, HAZARD_STRIKE_FLASH_ALPHA);
    burst(
      this.particles,
      ev.x,
      GROUND_Y - 10,
      HAZARD_STRIKE_PARTICLE_COUNT,
      PALETTE.warn,
      {
        speed: 130,
        life: 0.3,
        radius: 3,
      },
    );
  }

  /** Best-effort "above the head" y for a hit's damage number (entities are
   * drawn from GROUND_Y + fixed per-kind offsets, NOT their raw `y` field —
   * see heroView/enemyView/bossView, which all ignore entity.y the same way).
   * WORLD BOSS "เสี่ยจ๋อง": `bossCy()` swaps in the much-taller rig's own
   * anchor so damage numbers land above ITS head, not the stage boss's. */
  private hitY(target: HitTargetKind, id: number, state: GameState): number {
    if (target === "hero") return HERO_TOP_Y;
    if (target === "boss") return this.bossCy(state) - 44;
    const enemy = state.enemies.find((e) => e.id === id);
    const size = enemy?.size ?? 1;
    return GROUND_Y - 42 - 8 * size - 10;
  }
}
