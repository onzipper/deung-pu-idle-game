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
import type { GameEvent, GameState, HitTargetKind } from "@/engine/state";
import { GROUND_Y, WORLD_HEIGHT, WORLD_WIDTH } from "@/render/layout";
import { HERO_COLORS, PALETTE } from "@/render/theme";
import { ArenaFlash } from "@/render/fx/arenaFlash";
import { BossEcho } from "@/render/fx/bossEcho";
import { CameraPunch } from "@/render/fx/cameraPunch";
import { CorpseEchoPool } from "@/render/fx/corpseEcho";
import { FloatingTextPool } from "@/render/fx/floatingText";
import { HitFlashController } from "@/render/fx/hitFlash";
import { ImpactFilterController } from "@/render/fx/impactFilters";
import { burst, ParticlePool, shower } from "@/render/fx/particles";
import { RingPool } from "@/render/fx/rings";
import { ScreenShake } from "@/render/fx/screenShake";
import { WeaponTrailController, type WeaponTrailFrame } from "@/render/fx/weaponTrail";
import { getSwordTipPos, isSwordSwinging, type HeroView } from "@/render/views/heroView";

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

export class FxController {
  private readonly corpseLayer: Container;
  private readonly trailLayer: Container;
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

  /** Rolling average hit magnitude, used to scale damage-number font size. */
  private avgHit = 20;

  constructor(
    fxContainer: Container,
    world: Container,
    private readonly lookupView: EntityViewLookup,
    private readonly lookupHeroView: HeroViewLookup,
  ) {
    // Sub-layers in z-order: corpse echoes (bottom, "the body collapsing")
    // -> weapon trail -> rings -> particles -> text -> full-arena flash (top),
    // so numbers stay readable over bursts and the flash never hides them.
    this.corpseLayer = new PixiContainer();
    this.trailLayer = new PixiContainer();
    this.ringsLayer = new PixiContainer();
    this.particlesLayer = new PixiContainer();
    this.textLayer = new PixiContainer();
    fxContainer.addChild(
      this.corpseLayer,
      this.trailLayer,
      this.ringsLayer,
      this.particlesLayer,
      this.textLayer,
    );

    this.corpseEcho = new CorpseEchoPool(this.corpseLayer);
    this.weaponTrail = new WeaponTrailController(this.trailLayer);
    this.rings = new RingPool(this.ringsLayer);
    this.particles = new ParticlePool(this.particlesLayer);
    this.damageNumbers = new FloatingTextPool(this.textLayer, DAMAGE_NUMBER_CAP);
    this.eventText = new FloatingTextPool(this.textLayer, EVENT_TEXT_CAP);
    this.flash = new ArenaFlash(WORLD_WIDTH, WORLD_HEIGHT);
    this.impactFilters = new ImpactFilterController(world);
    fxContainer.addChild(this.bossEcho.view, this.flash.view);
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

    for (const ev of events) {
      switch (ev.type) {
        case "hit":
          this.onHit(ev, state, skillImpactSeen);
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
        default:
          break; // projectileSpawn / stageCleared / upgradeBought: no fx-layer reaction
      }
    }
  }

  /** Advance every effect by `dt` REAL seconds (never sub-step count). */
  update(dt: number, state: GameState): void {
    this.hitFlash.update(dt);
    this.shake.update(dt);
    this.punch.update(dt);
    this.corpseEcho.update(dt);
    this.bossEcho.update(dt);
    this.rings.update(dt);
    this.particles.update(dt);
    this.damageNumbers.update(dt);
    this.eventText.update(dt);
    this.flash.update(dt);
    this.impactFilters.update(dt);
    this.updateWeaponTrail(dt, state);
  }

  destroy(): void {
    this.hitFlash.destroy();
    this.corpseEcho.destroy();
    this.bossEcho.destroy();
    this.weaponTrail.destroy();
    this.impactFilters.destroy();
    this.rings.destroy();
    this.particles.destroy();
    this.damageNumbers.destroy();
    this.eventText.destroy();
    this.flash.destroy();
    this.corpseLayer.destroy();
    this.trailLayer.destroy();
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
  ): void {
    const view = this.lookupView(ev.target, ev.id);
    if (view) this.hitFlash.trigger(view);

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
      this.rings.spawn({
        x,
        y: HERO_MID_Y,
        r0: 12,
        r1: SKILL_TYPES.swordsman.radius,
        duration: 0.4,
        width: 4,
        color: colors.light,
      });
    } else if (ev.heroClass === "archer") {
      burst(this.particles, x, HERO_MID_Y, 5, colors.light, {
        speed: 70,
        life: 0.25,
        radius: 2,
      });
    } else {
      // mage: cast flourish only — the meteor's own impact burst fires from
      // onHit's `isSkill` branch when it actually lands.
      burst(this.particles, x, HERO_TOP_Y, 6, colors.light, {
        speed: 50,
        life: 0.3,
        radius: 2.5,
      });
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
