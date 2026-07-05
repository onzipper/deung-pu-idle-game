"use client";

/**
 * M6.5 art-direction prototype — a throwaway, self-contained demo page. Owns
 * its own tiny Pixi `Application` (never imports `src/render` — that layer is
 * mid-surgery by other agents right now) so this can be deleted wholesale
 * once the owner has made a decision without touching the shipped renderer.
 *
 * The decision aid is the "Pixel mode" toggle:
 *  - Pixel mode ON: the whole 480x270 logical scene is rendered into a
 *    low-res `RenderTexture` (nearest-neighbor `scaleMode`, pixi.js 8.19's
 *    `TextureSourceOptions.scaleMode: "nearest"`) and that texture is
 *    upscaled via a `Sprite` to fill the container — blocky, MMX3-faithful.
 *  - Pixel mode OFF: the SAME scene graph is instead scaled up directly and
 *    drawn straight to the screen at native/device resolution — smooth
 *    vector edges, no pixelation. Comparing the two IS the point.
 *
 * Per-frame animation state (poses, particles, aura, parallax, screenshake,
 * hitstop) lives entirely in plain closures driven by the Pixi ticker — NOT
 * React state (`CLAUDE.md`'s no-per-frame-state-in-React rule). The four
 * buttons only flip low-frequency UI toggles, applied directly to the Pixi
 * scene via a small imperative API stashed in a ref (no polling).
 */

import { useEffect, useRef, useState } from "react";
import { Application, Container, RenderTexture, Sprite } from "pixi.js";
import { buildBackground, PROTO_WORLD } from "./scene/background";
import { buildHero, SWING_SEQUENCE, SWING_IMPACT_POSE, HERO_HEIGHT } from "./scene/hero";
import { buildEnemy } from "./scene/enemy";
import { buildAura, type AuraTier } from "./scene/aura";
import { buildHud } from "./scene/hud";
import { ParticlePool, burst } from "./scene/particlePool";
import { PROTO_PALETTE as P } from "./scene/palette";

const { WORLD_W, WORLD_H, GROUND_Y } = PROTO_WORLD;
const HERO_X = 150;
const ENEMY_CENTER_X = 245;
const ENEMY_RANGE = 55;
const SWORD_REACH = 130;

const IDLE_HOLD = 0.26;
const SWING_HOLD = 0.09;
const SWING_COOLDOWN_MIN = 1.5;
const SWING_COOLDOWN_MAX = 2.1;
/** Real-time clamp so a tab-away/debugger stall never dumps a huge dt burst. */
const MAX_FRAME_SECONDS = 0.1;

interface Fit {
  scale: number;
  x: number;
  y: number;
}

function computeFit(screenW: number, screenH: number): Fit {
  const w = Math.max(1, screenW);
  const h = Math.max(1, screenH);
  const scale = Math.max(0.0001, Math.min(w / WORLD_W, h / WORLD_H));
  return { scale, x: (w - WORLD_W * scale) / 2, y: (h - WORLD_H * scale) / 2 };
}

interface SceneApi {
  setPixelMode(pixel: boolean): void;
  setAuraTier(tier: AuraTier): void;
}

export function ProtoScene() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneApiRef = useRef<SceneApi | null>(null);
  const [pixelMode, setPixelModeState] = useState(true);
  const [auraTier, setAuraTierState] = useState<AuraTier>(2);

  useEffect(() => {
    const mountCandidate = mountRef.current;
    if (!mountCandidate) return;
    // Re-bind to a non-nullable-typed const: `mountRef.current` itself is
    // `HTMLDivElement | null`, and TS's control-flow narrowing above doesn't
    // carry into the async IIFE's nested closures below.
    const mount: HTMLDivElement = mountCandidate;

    let destroyed = false;
    const cleanupFns: Array<() => void> = [];
    const app = new Application();

    (async () => {
      await app.init({
        backgroundColor: P.skyTop,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        preference: "webgl",
      });
      if (destroyed) {
        app.destroy(true);
        return;
      }
      mount.appendChild(app.canvas);

      // ---- scene graph (built once, logical 480x270 space) ----
      const world = new Container();
      const background = buildBackground();
      const enemy = buildEnemy(ENEMY_CENTER_X, GROUND_Y, ENEMY_RANGE);
      const hero = buildHero();
      hero.container.position.set(HERO_X, GROUND_Y);
      const aura = buildAura();
      const hitFxLayer = new Container();
      const hud = buildHud();

      world.addChild(
        background.container,
        aura.container,
        enemy.container,
        hero.container,
        hitFxLayer,
        hud.container,
      );

      const hitSparks = new ParticlePool(hitFxLayer, 16);

      // ---- pixel-mode pipeline: render `world` into a low-res RenderTexture,
      // upscaled nearest-neighbor via a Sprite. `scaleMode: "nearest"` on the
      // texture SOURCE (pixi.js 8.19's `TextureSourceOptions`, itself layering
      // `TextureStyleOptions`) is the exact mechanism — a plain Sprite scaled
      // up then samples it with point filtering, i.e. blocky/crisp instead of
      // smoothed. ----
      const pixelRT = RenderTexture.create({
        width: WORLD_W,
        height: WORLD_H,
        resolution: 1,
        scaleMode: "nearest",
        antialias: false,
      });
      const pixelSprite = new Sprite(pixelRT);
      app.stage.addChild(pixelSprite);

      let pixelModeOn = true;
      let worldAttached = false;

      function setPixelMode(pixel: boolean): void {
        pixelModeOn = pixel;
        if (pixel) {
          if (worldAttached) {
            app.stage.removeChild(world);
            worldAttached = false;
          }
          world.scale.set(1);
          world.position.set(0, 0);
          pixelSprite.visible = true;
        } else {
          if (!worldAttached) {
            app.stage.addChildAt(world, 0);
            worldAttached = true;
          }
          pixelSprite.visible = false;
        }
        applyFit();
      }

      function applyFit(): void {
        const fit = computeFit(app.screen.width, app.screen.height);
        if (pixelModeOn) {
          pixelSprite.scale.set(fit.scale);
          pixelSprite.position.set(fit.x, fit.y);
        } else {
          world.scale.set(fit.scale);
          world.position.set(fit.x, fit.y);
        }
      }

      function handleResize(): void {
        const w = mount.clientWidth;
        const h = mount.clientHeight;
        if (w > 0 && h > 0) app.renderer.resize(w, h);
        applyFit();
      }

      const resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(mount);
      setPixelMode(pixelMode);
      handleResize();

      // ---- hero animation state machine (idle breathing <-> sword swing) ----
      type AnimState = "idle" | "swing";
      let animState: AnimState = "idle";
      let idleFrame: 0 | 1 = 0;
      let idleTimer = 0;
      let swingIndex = 0;
      let swingHoldTimer = 0;
      let swingCooldown =
        SWING_COOLDOWN_MIN + Math.random() * (SWING_COOLDOWN_MAX - SWING_COOLDOWN_MIN);

      // ---- juice: screenshake + hitstop (real-time; the vocabulary mirrors
      // `src/render/fx/screenShake.ts` / the engine's `timeDirector`, but this
      // page has no sim so both are plain local closures). ----
      let shakeAmp = 0;
      let shakeAngle = 0;
      let hitStopTimer = 0;
      let currentAuraTier: AuraTier = auraTier;

      function triggerImpact(): void {
        const dist = Math.abs(enemy.x - HERO_X);
        if (dist > SWORD_REACH) return; // swing missed — still looks alive
        const fromLeft = HERO_X < enemy.x;
        enemy.takeHit(fromLeft);
        const hitX = HERO_X + (fromLeft ? SWORD_REACH * 0.55 : -SWORD_REACH * 0.55);
        const hitY = GROUND_Y - HERO_HEIGHT * 0.55;
        burst(hitSparks, hitX, hitY, 10, P.hitSpark, { speed: 130, life: 0.22, radius: 2 });
        burst(hitSparks, hitX, hitY, 6, P.hitSparkGold, { speed: 90, life: 0.3, radius: 2.2 });
        hitStopTimer = 0.05;
        shakeAmp = 3;
        shakeAngle = Math.random() * Math.PI * 2;
      }

      const gold = { value: 1240 };

      app.ticker.add((ticker) => {
        const rawDt = Math.min(ticker.deltaMS / 1000, MAX_FRAME_SECONDS);

        // Hit-stop shapes ONLY the hero/enemy pose-progression clock — fx
        // (particles/aura/background) stay real-time so a freeze still reads
        // as "impact", not "the whole game paused".
        let logicDt = rawDt;
        if (hitStopTimer > 0) {
          hitStopTimer -= rawDt;
          logicDt = 0;
        }

        background.update(rawDt);
        enemy.update(logicDt);

        // ---- hero pose stepping ----
        if (animState === "idle") {
          idleTimer += logicDt;
          if (idleTimer >= IDLE_HOLD) {
            idleTimer = 0;
            idleFrame = idleFrame === 0 ? 1 : 0;
            hero.setPose(idleFrame === 0 ? "idleA" : "idleB");
          }
          swingCooldown -= rawDt;
          if (swingCooldown <= 0) {
            animState = "swing";
            swingIndex = 0;
            swingHoldTimer = 0;
            hero.setPose(SWING_SEQUENCE[0]);
          }
        } else {
          swingHoldTimer += logicDt;
          if (swingHoldTimer >= SWING_HOLD) {
            swingHoldTimer = 0;
            swingIndex += 1;
            if (swingIndex >= SWING_SEQUENCE.length) {
              animState = "idle";
              idleFrame = 0;
              idleTimer = 0;
              hero.setPose("idleA");
              swingCooldown =
                SWING_COOLDOWN_MIN + Math.random() * (SWING_COOLDOWN_MAX - SWING_COOLDOWN_MIN);
            } else {
              const pose = SWING_SEQUENCE[swingIndex];
              hero.setPose(pose);
              if (pose === SWING_IMPACT_POSE) triggerImpact();
            }
          }
        }

        // ---- aura (real-time, follows hero's feet) ----
        aura.setTier(currentAuraTier);
        aura.update(rawDt, HERO_X, GROUND_Y);
        hitSparks.update(rawDt);

        // ---- screenshake decay, composed on top of the current fit ----
        shakeAmp = Math.max(0, shakeAmp - rawDt * 24);
        shakeAngle += rawDt * 40;
        const shakeX = Math.cos(shakeAngle) * shakeAmp;
        const shakeY = Math.sin(shakeAngle * 1.3) * shakeAmp;
        const fit = computeFit(app.screen.width, app.screen.height);
        if (pixelModeOn) {
          pixelSprite.position.set(fit.x + shakeX, fit.y + shakeY);
        } else {
          world.position.set(fit.x + shakeX, fit.y + shakeY);
        }

        // ---- HUD mock (static-ish HP, a slow idle-game gold trickle) ----
        gold.value += rawDt * 6;
        hud.update(0.78, gold.value);

        // ---- pixel-mode pipeline: one extra render pass into the low-res
        // texture (skipped entirely in native mode — perf is part of the
        // aesthetic). ----
        if (pixelModeOn) {
          app.renderer.render({ container: world, target: pixelRT });
        }
      });

      sceneApiRef.current = {
        setPixelMode(pixel: boolean) {
          setPixelMode(pixel);
        },
        setAuraTier(tier: AuraTier) {
          currentAuraTier = tier;
        },
      };

      cleanupFns.push(() => {
        sceneApiRef.current = null;
        resizeObserver.disconnect();
        hitSparks.destroy();
        app.destroy(true, { children: true, texture: true });
      });
    })();

    return () => {
      destroyed = true;
      for (const fn of cleanupFns) fn();
    };
    // Mount-once: the ticker reads pixel-mode/aura-tier state via
    // `sceneApiRef`'s imperative setters (wired to the buttons below), never
    // through this effect's own closure, so it never needs to re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex w-full flex-1 flex-col items-center gap-3 p-3">
      <div
        ref={mountRef}
        className="relative aspect-video w-full max-w-3xl overflow-hidden rounded-lg border-2 border-[#0d1030] shadow-[0_12px_32px_-14px_rgba(0,0,0,0.7)]"
      >
        {/* Zone name card — DOM overlay, Chakra Petch header (already the
            app-wide `--font-display`, see root layout.tsx) + Kanit body line
            (loaded scoped to this route only, see `layout.tsx` in this dir). */}
        <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-white/15 bg-black/55 px-3 py-1.5 backdrop-blur-sm">
          <div
            className="text-sm font-bold tracking-wide text-white"
            style={{ fontFamily: "var(--font-display)" }}
          >
            ทุ่งหญ้าเริ่มต้น
          </div>
          <div className="proto-kanit text-[11px] leading-tight text-white/80">
            หนุ่ม ๆ ต้องว้าว เสียเวลาเพื่อให้ได้มัน — M6.5 art-direction prototype
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => {
            setPixelModeState((v) => {
              const next = !v;
              sceneApiRef.current?.setPixelMode(next);
              return next;
            });
          }}
          className="rounded-md border border-white/20 bg-[#151a30] px-3 py-1.5 text-sm font-semibold text-white active:scale-95"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Pixel mode: {pixelMode ? "ON" : "OFF"}
        </button>
        <div className="mx-1 h-6 w-px bg-white/20" />
        {(
          [
            { tier: 0 as AuraTier, label: "ไม่มีออร่า" },
            { tier: 1 as AuraTier, label: "Tier 1" },
            { tier: 2 as AuraTier, label: "Tier 2" },
            { tier: 3 as AuraTier, label: "Tier 3" },
          ]
        ).map(({ tier, label }) => (
          <button
            key={tier}
            type="button"
            onClick={() => {
              setAuraTierState(tier);
              sceneApiRef.current?.setAuraTier(tier);
            }}
            className={`rounded-md border px-3 py-1.5 text-sm font-semibold active:scale-95 ${
              auraTier === tier
                ? "border-[#f2b134] bg-[#f2b134] text-black"
                : "border-white/20 bg-[#151a30] text-white"
            }`}
            style={{ fontFamily: "var(--font-display)" }}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="proto-kanit max-w-xl text-center text-xs text-white/60">
        เปรียบเทียบ Pixel mode ON/OFF เพื่อดูว่าโหมดพิกเซลต่ำ + ขยายแบบ nearest-neighbor
        ให้ความรู้สึกแบบ Mega Man X3 มากกว่าการเรนเดอร์ตรงแบบเรียบ (native) หรือไม่
      </p>
    </div>
  );
}
