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
import type { Hero, Projectile } from "@/engine/entities";
import type { GameEvent, GameState, HitTargetKind } from "@/engine/state";
import { GROUND_Y, WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";
import { HERO_COLORS, PALETTE } from "@/render/theme";
import { ArenaFlash } from "@/render/fx/arenaFlash";
import { BossEcho } from "@/render/fx/bossEcho";
import { CameraPunch } from "@/render/fx/cameraPunch";
import { CastAuraController } from "@/render/fx/castAura";
import { CorpseEchoPool } from "@/render/fx/corpseEcho";
import { CrescentPool } from "@/render/fx/crescent";
import { FlashLinePool } from "@/render/fx/flashLines";
import { FloatingTextPool } from "@/render/fx/floatingText";
import { GhostBladePool } from "@/render/fx/ghostBlade";
import { HitFlashController } from "@/render/fx/hitFlash";
import { ImpactFilterController } from "@/render/fx/impactFilters";
import { MeteorSkyFlash, ScorchPool } from "@/render/fx/meteorScene";
import { burst, burstDirectional, burstInward, ParticlePool, shower } from "@/render/fx/particles";
import { RingPool } from "@/render/fx/rings";
import { RuneGlyphPool } from "@/render/fx/runeGlyph";
import { ScreenShake } from "@/render/fx/screenShake";
import { TracerPool, type TracerStyle } from "@/render/fx/tracer";
import { WeaponTrailController, type WeaponTrailFrame } from "@/render/fx/weaponTrail";
import {
  getSwordTipPos,
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

// ---- archer: skill "brighter tracer" window (item 9) -----------------------
/** Real seconds after an archer `skillCast` during which any NEW arrow
 * tracer track gets the boosted (brighter/thicker) style — long enough to
 * cover all 3 staggered releases (see heroView's `TRIPLE_DURATION`). */
const ARCHER_SKILL_TRACER_BOOST_WINDOW = 0.45;

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

interface KnockbackEntry {
  view: Container;
  t: number;
  duration: number;
  mag: number;
}

interface PendingMeteor {
  tx: number;
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

  /** Real seconds remaining on the archer's "just cast triple" brighter-
   * tracer window (item 9) — any arrow tracer track BOUND while this is > 0
   * gets the boosted style for its whole life. */
  private archerSkillBoostT = 0;

  /** In-flight mage meteors being tracked for the ground-rune / scorch-on-
   * impact sequence (item 11) — see `updateMeteorTracking()`. */
  private readonly pendingMeteors: PendingMeteor[] = [];

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
    // ground scorch marks) -> weapon trail + projectile tracers -> the new
    // hero-signature bits (crescents/ghost blades/fan flashes/rune glyphs/
    // cast aura) -> rings -> particles -> text -> full-arena flash (top), so
    // numbers stay readable over bursts and the flash never hides them.
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
    this.weaponTrail = new WeaponTrailController(this.trailLayer);
    this.tracers = new TracerPool(this.trailLayer);
    this.crescents = new CrescentPool(this.heroFxLayer);
    this.ghostBlades = new GhostBladePool(this.heroFxLayer);
    this.flashLines = new FlashLinePool(this.heroFxLayer);
    this.runeGlyphs = new RuneGlyphPool(this.heroFxLayer);
    this.castAura = new CastAuraController(this.heroFxLayer);
    this.rings = new RingPool(this.ringsLayer);
    this.particles = new ParticlePool(this.particlesLayer);
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
          break;
        case "heroRevived":
          this.onHeroRevived(ev);
          break;
        case "skillCast":
          this.onSkillCast(ev, state);
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
        case "bossRetreat":
          burst(this.particles, ev.x, BOSS_CY, 10, PALETTE.muted, {
            speed: 70,
            life: 0.4,
            radius: 3,
          });
          // `state.boss` is already null by the time this event is seen (the
          // live BossView is destroyed this same frame) — the turn-away
          // slide-out plays on this one-shot echo instead (see bossEcho.ts).
          this.bossEcho.trigger("retreat", ev.x, BOSS_CY);
          break;
        case "waveSpawn":
          burst(this.particles, CONFIG.spawnX, GROUND_Y - 16, 6, PALETTE.muted, {
            speed: 40,
            life: 0.3,
            radius: 2,
          });
          break;
        case "stageAdvanced":
          this.flash.trigger(PALETTE.gold, 0.22);
          break;
        case "projectileSpawn":
          this.onProjectileSpawn(ev);
          break;
        default:
          break; // stageCleared / upgradeBought: no fx-layer reaction
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
    this.bossEcho.update(dt);
    this.rings.update(dt);
    this.crescents.update(dt);
    this.ghostBlades.update(dt);
    this.flashLines.update(dt);
    this.runeGlyphs.update(dt);
    this.meteorSky.update(dt);
    this.particles.update(dt);
    this.damageNumbers.update(dt);
    this.eventText.update(dt);
    this.flash.update(dt);
    this.impactFilters.update(dt);
    this.updateWeaponTrail(dt, state);
    this.updateTracers(dt, state);
    this.updateCastAura(dt, state);
    this.updateMeteorTracking(state);
    this.updateKnockback(dt);
    this.archerSkillBoostT = Math.max(0, this.archerSkillBoostT - dt);
  }

  destroy(): void {
    this.hitFlash.destroy();
    this.corpseEcho.destroy();
    this.scorches.destroy();
    this.bossEcho.destroy();
    this.weaponTrail.destroy();
    this.tracers.destroy();
    this.crescents.destroy();
    this.ghostBlades.destroy();
    this.flashLines.destroy();
    this.runeGlyphs.destroy();
    this.meteorSky.destroy();
    this.castAura.destroy();
    this.impactFilters.destroy();
    this.rings.destroy();
    this.particles.destroy();
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

  private onKill(ev: Extract<GameEvent, { type: "kill" }>): void {
    const size = ENEMY_TYPES[ev.kind]?.size ?? 1;
    const y = GROUND_Y - 20 - 8 * size;
    burst(this.particles, ev.x, y, 10, PALETTE.killGold, {
      speed: 110,
      life: 0.45,
      radius: 3,
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
  }

  private onHeroRevived(ev: Extract<GameEvent, { type: "heroRevived" }>): void {
    burst(this.particles, ev.x, HERO_TOP_Y, 10, HERO_COLORS[ev.cls].light, {
      speed: 60,
      life: 0.5,
      radius: 2.5,
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
      this.onArcherTripleCast(x, colors.light, state);
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

  /** Archer skill (triple shot) — brief draw-and-hold glow (item 9's front
   * half; the hold itself is heroView's `triple` anim lead-in), the
   * brighter-tracer boost window, and 3 fan-direction flash lines toward the
   * skill's own target selection. */
  private onArcherTripleCast(x: number, color: number, state: GameState): void {
    this.rings.spawn({ x, y: HERO_MID_Y, r0: 6, r1: 11, duration: 0.15, width: 2, color });
    burst(this.particles, x, HERO_MID_Y, 5, color, { speed: 60, life: 0.2, radius: 2 });

    this.archerSkillBoostT = ARCHER_SKILL_TRACER_BOOST_WINDOW;

    // Mirrors `castSkill()`'s own "nearest `sk.targets`" target pick
    // (`engine/systems/skills.ts`) — read-only, for fx placement only, never
    // feeds back into game logic.
    const candidates: { x: number }[] = [...state.enemies];
    if (state.boss) candidates.push(state.boss);
    const near = candidates.sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x)).slice(0, 3);
    for (const t of near) {
      this.flashLines.spawn({
        x1: x,
        y1: HERO_MID_Y,
        x2: t.x,
        y2: HERO_MID_Y,
        color,
        width: 1.6,
        life: 0.14,
        alpha: 0.65,
      });
    }
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
      const boosted = this.archerSkillBoostT > 0;
      return {
        color: HERO_COLORS.archer.light,
        width: boosted ? 3.4 : 2,
        alpha: boosted ? 0.85 : 0.5,
      };
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

  private onBossDefeated(ev: Extract<GameEvent, { type: "bossDefeated" }>): void {
    this.flash.trigger(PALETTE.killGold, 0.32);
    // Symmetric punch (no `worldX` bias) — a boss-defeated beat isn't "toward
    // a point", it's the whole arena celebrating.
    this.punch.trigger("bossDefeated");
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
    this.bossEcho.trigger("defeat", ev.x, BOSS_CY);
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
