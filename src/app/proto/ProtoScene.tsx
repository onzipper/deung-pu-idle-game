"use client";

/**
 * M6.5 art-direction prototype ROUND 2 — the paper-doll gear decision demo.
 * Owns its own tiny Pixi `Application` (never imports `src/render` — that
 * layer is mid-surgery by other agents right now) so this can be deleted
 * wholesale once the owner has made a decision without touching the shipped
 * renderer.
 *
 * Round 1's pixel-mode pipeline is GONE (owner decision, `docs/GDD.md` "Art
 * Direction": smooth vector rendering only, pixel rejected). This round's
 * decision points are the CHARACTER (anime/RO-proportioned swordsman, not
 * the old MMX3 chibi rig) and the GEAR (3-tier paper-doll — same body,
 * swapped armor/weapon layers — with the tier-3 "ระดับเทพ" weapon aura as
 * the wow beat). The passed background composition is reused unchanged.
 *
 * Per-frame animation state (poses, walk/chase AI, particles, screenshake,
 * hitstop) lives entirely in plain closures driven by the Pixi ticker — NOT
 * React state (`CLAUDE.md`'s no-per-frame-state-in-React rule). The gear-tier
 * buttons only flip a low-frequency UI toggle, applied directly to the Pixi
 * scene via a small imperative API stashed in a ref (no polling).
 */

import { useEffect, useRef, useState } from "react";
import { Application, Container } from "pixi.js";
import { buildBackground, PROTO_WORLD } from "./scene/background";
import {
  buildHero,
  SWING_SEQUENCE,
  SWING_IMPACT_POSE,
  WALK_SEQUENCE,
  HERO_HEIGHT,
  type GearTier,
} from "./scene/hero";
import { buildEnemy } from "./scene/enemy";
import { buildHud } from "./scene/hud";
import { ParticlePool, burst } from "./scene/particlePool";
import { PROTO_PALETTE as P } from "./scene/palette";

const { WORLD_W, WORLD_H, GROUND_Y } = PROTO_WORLD;
const HERO_START_X = 90;
const ENEMY_CENTER_X = 280;
const ENEMY_RANGE = 90;
const HIT_DIST = 72;
const ARRIVE_DIST = 36;
const WALK_SPEED = 60;

const IDLE_HOLD = 0.26;
const WALK_HOLD = 0.12;
const SWING_HOLD = 0.09;
const SWING_COOLDOWN_MIN = 0.35;
const SWING_COOLDOWN_MAX = 0.7;
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
  setGearTier(tier: GearTier): void;
}

/** Mirrors `src/render/GameRenderer.ts`'s pre-init probe (reimplemented
 * locally — this route may not import `src/render`): fail with a clear,
 * catchable message instead of letting a bad `Application.init()` reject
 * into an unhandled-promise silence (the iOS Safari bug this file fixes). */
function isWebGL2Available(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!canvas.getContext("webgl2");
  } catch {
    return false;
  }
}

/** Poll (via rAF) until `el` has a real laid-out size, or give up after ~0.5s
 * and proceed anyway — a container that's still 0x0 on the very first tick
 * (e.g. iOS Safari settling `aspect-ratio` layout after mount) shouldn't make
 * `renderer.resize(0, 0)` the FIRST thing that happens to a fresh canvas. */
function waitForLayout(el: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    let tries = 0;
    function check(): void {
      if ((el.clientWidth > 0 && el.clientHeight > 0) || tries++ > 30) {
        resolve();
        return;
      }
      requestAnimationFrame(check);
    }
    check();
  });
}

/** Self-diagnosing HUD strip (dev tool, not part of the art-direction pitch)
 * — surfaces exactly the facts needed to tell "silent iOS render failure"
 * apart from "actually broken elsewhere" from a single screenshot. */
interface DiagSnapshot {
  rendererType: string;
  bufferW: number;
  bufferH: number;
  cssW: number;
  cssH: number;
  tickerStarted: boolean;
  frames: number;
  lastError: string | null;
  /** `performance.now()` at mount — 0 means "not mounted yet". */
  mountedAt: number;
  /** `performance.now()` as of the last snapshot copy (NOT read during
   * render — React's purity rules forbid that — this is stamped once per
   * snapshot inside the low-frequency diag interval below instead). */
  now: number;
}

const DIAG_DEFAULT: DiagSnapshot = {
  rendererType: "?",
  bufferW: 0,
  bufferH: 0,
  cssW: 0,
  cssH: 0,
  tickerStarted: false,
  frames: 0,
  lastError: null,
  mountedAt: 0,
  now: 0,
};

const GEAR_TIERS: Array<{ tier: GearTier; label: string; accent: string }> = [
  { tier: 1, label: "ธรรมดา", accent: "border-white/25 bg-[#151a30] text-white" },
  { tier: 2, label: "หายาก", accent: "border-[#3a6fd8] bg-[#3a6fd8] text-white" },
  { tier: 3, label: "ระดับเทพ", accent: "border-[#f2b134] bg-[#f2b134] text-black" },
];

export function ProtoScene() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneApiRef = useRef<SceneApi | null>(null);
  const [gearTier, setGearTierState] = useState<GearTier>(3);
  const [initError, setInitError] = useState<string | null>(null);
  const [diag, setDiag] = useState<DiagSnapshot>(DIAG_DEFAULT);

  useEffect(() => {
    const mountCandidate = mountRef.current;
    if (!mountCandidate) return;
    // Re-bind to a non-nullable-typed const: `mountRef.current` itself is
    // `HTMLDivElement | null`, and TS's control-flow narrowing above doesn't
    // carry into the async IIFE's nested closures below.
    const mount: HTMLDivElement = mountCandidate;

    // Mutable diagnostics live in a plain object updated every tick (never
    // React state per-frame — `CLAUDE.md`'s rule); a low-frequency interval
    // below stamps `now`/copies snapshots into `diag` for display. Reading
    // `performance.now()` is only ever done here (effect/interval/ticker
    // callbacks), never during render — React's purity rule.
    const diagState: DiagSnapshot = { ...DIAG_DEFAULT, mountedAt: performance.now() };

    let destroyed = false;
    const cleanupFns: Array<() => void> = [];
    const app = new Application();

    (async () => {
      try {
        await initScene();
      } catch (err) {
        if (!destroyed) {
          const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          console.error("[proto] Pixi scene init failed:", err);
          diagState.lastError = message;
          diagState.now = performance.now();
          setInitError(message);
          setDiag({ ...diagState });
        }
        app.destroy(true);
      }
    })();

    async function initScene(): Promise<void> {
      if (!isWebGL2Available()) {
        throw new Error(
          "อุปกรณ์/เบราว์เซอร์นี้ไม่รองรับ WebGL2 — พรีวิวนี้ต้องใช้ WebGL2 (ลองเบราว์เซอร์อื่นหรืออุปกรณ์อื่น)",
        );
      }
      // Don't let `renderer.resize()`'s FIRST call ever see a 0x0 container
      // (iOS Safari has been seen to still be settling `aspect-ratio` layout
      // the instant this effect runs).
      await waitForLayout(mount);
      if (destroyed) return;

      await app.init({
        backgroundColor: P.skyTop,
        clearBeforeRender: true,
        antialias: true,
        // Forced to 1 + autoDensity off for this prototype: on iOS (DPR=3)
        // the resolution*autoDensity interplay has been implicated in blank
        // canvases elsewhere in the pixi.js issue tracker. We manage the
        // canvas's CSS size ourselves below instead (explicit 100%/100%), so
        // the drawing buffer is just 1:1 with the CSS pixels we resize() to.
        resolution: 1,
        autoDensity: false,
        // Force WebGL explicitly — same well-exercised path as the shipped
        // `GameRenderer`, and what this whole prototype was built/tested
        // against (iOS Safari has been observed auto-picking WebGPU otherwise).
        preference: "webgl",
      });
      if (destroyed) {
        app.destroy(true);
        return;
      }
      // `app.init()` auto-starts the ticker by default, but be explicit and
      // record it — "ticker never started" is one of the diagnostic strip's
      // load-bearing facts.
      app.start();
      diagState.tickerStarted = app.ticker.started;
      diagState.rendererType =
        app.renderer.type === 1 ? "webgl" : app.renderer.type === 2 ? "webgpu" : "canvas";

      mount.appendChild(app.canvas);
      // Belt-and-suspenders CSS so the canvas element itself always fills its
      // parent box even for the one frame before the first resize() lands.
      app.canvas.style.width = "100%";
      app.canvas.style.height = "100%";
      app.canvas.style.display = "block";

      // ---- scene graph (built once, logical 480x270 space), drawn straight
      // to the screen at native resolution — smooth vector edges, no pixel
      // pipeline (round 1's RenderTexture/nearest-neighbor path is gone). ----
      const world = new Container();
      const background = buildBackground();
      const enemy = buildEnemy(ENEMY_CENTER_X, GROUND_Y, ENEMY_RANGE);
      const hero = buildHero();
      hero.container.position.set(HERO_START_X, GROUND_Y);
      const hitFxLayer = new Container();
      const hud = buildHud();

      world.addChild(background.container, enemy.container, hero.container, hitFxLayer, hud.container);
      app.stage.addChild(world);

      const hitSparks = new ParticlePool(hitFxLayer, 16);

      function applyFit(): void {
        const fit = computeFit(app.screen.width, app.screen.height);
        world.scale.set(fit.scale);
        world.position.set(fit.x, fit.y);
      }

      function handleResize(): void {
        const w = mount.clientWidth;
        const h = mount.clientHeight;
        if (w > 0 && h > 0) app.renderer.resize(w, h);
        applyFit();
        diagState.bufferW = app.canvas.width;
        diagState.bufferH = app.canvas.height;
        diagState.cssW = mount.clientWidth;
        diagState.cssH = mount.clientHeight;
      }

      const resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(mount);
      handleResize();

      // ---- hero AI: idle-breathe <-> walk-to-mob <-> two-handed swing.
      // This is the "hunt model" teaser the brief calls for: the hero walks
      // over to the wandering mob and swings, rather than standing still. ----
      type AnimState = "idle" | "walk" | "swing";
      let animState: AnimState = "idle";
      let heroX = HERO_START_X;
      let facing = 1;
      let idleFrame: 0 | 1 = 0;
      let idleTimer = 0;
      let walkIndex = 0;
      let walkTimer = 0;
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
      let currentGearTier: GearTier = gearTier;
      hero.setGearTier(currentGearTier);

      function triggerImpact(): void {
        const dist = Math.abs(enemy.x - heroX);
        if (dist > HIT_DIST) return; // swing missed — still looks alive
        const fromLeft = heroX < enemy.x;
        enemy.takeHit(fromLeft);
        const hitX = heroX + (fromLeft ? HIT_DIST * 0.6 : -HIT_DIST * 0.6);
        const hitY = GROUND_Y - HERO_HEIGHT * 0.55;
        burst(hitSparks, hitX, hitY, 10, P.hitSpark, { speed: 150, life: 0.22, radius: 2.4 });
        burst(hitSparks, hitX, hitY, 6, P.hitSparkGold, { speed: 100, life: 0.3, radius: 2.6 });
        hitStopTimer = 0.05;
        shakeAmp = 3;
        shakeAngle = Math.random() * Math.PI * 2;
      }

      const gold = { value: 1240 };

      app.ticker.add((ticker) => {
        const rawDt = Math.min(ticker.deltaMS / 1000, MAX_FRAME_SECONDS);

        // Hit-stop shapes ONLY the hero/enemy pose-progression clock — fx
        // (particles/weapon aura/background) stay real-time so a freeze
        // still reads as "impact," not "the whole game paused."
        let logicDt = rawDt;
        if (hitStopTimer > 0) {
          hitStopTimer -= rawDt;
          logicDt = 0;
        }

        background.update(rawDt);
        enemy.update(logicDt);

        // ---- facing: always face the mob, except mid-swing (frozen so the
        // chop doesn't flip halfway through). ----
        const dx = enemy.x - heroX;
        if (animState !== "swing" && Math.abs(dx) > 0.5) {
          facing = dx > 0 ? 1 : -1;
        }
        hero.container.scale.x = facing;

        // ---- hero state machine ----
        if (animState === "idle") {
          idleTimer += logicDt;
          if (idleTimer >= IDLE_HOLD) {
            idleTimer = 0;
            idleFrame = idleFrame === 0 ? 1 : 0;
            hero.setPose(idleFrame === 0 ? "idleA" : "idleB");
          }
          if (Math.abs(dx) > ARRIVE_DIST) {
            animState = "walk";
            walkIndex = 0;
            walkTimer = 0;
            hero.setPose(WALK_SEQUENCE[0]);
          } else {
            swingCooldown -= logicDt;
            if (swingCooldown <= 0) {
              animState = "swing";
              swingIndex = 0;
              swingHoldTimer = 0;
              hero.setPose(SWING_SEQUENCE[0]);
            }
          }
        } else if (animState === "walk") {
          heroX += Math.sign(dx || facing) * WALK_SPEED * logicDt;
          walkTimer += logicDt;
          if (walkTimer >= WALK_HOLD) {
            walkTimer = 0;
            walkIndex = (walkIndex + 1) % WALK_SEQUENCE.length;
            hero.setPose(WALK_SEQUENCE[walkIndex]);
          }
          if (Math.abs(enemy.x - heroX) <= ARRIVE_DIST) {
            animState = "idle";
            idleFrame = 0;
            idleTimer = 0;
            hero.setPose("idleA");
            swingCooldown =
              SWING_COOLDOWN_MIN + Math.random() * (SWING_COOLDOWN_MAX - SWING_COOLDOWN_MIN) * 0.6;
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

        hero.container.position.x = heroX;
        // Continuous gear fx (sheen/flicker/sparkle/flame) always advance in
        // real time, independent of the pose state machine above.
        hero.update(rawDt);
        hitSparks.update(rawDt);

        // ---- screenshake decay, composed on top of the current fit ----
        shakeAmp = Math.max(0, shakeAmp - rawDt * 24);
        shakeAngle += rawDt * 40;
        const shakeX = Math.cos(shakeAngle) * shakeAmp;
        const shakeY = Math.sin(shakeAngle * 1.3) * shakeAmp;
        const fit = computeFit(app.screen.width, app.screen.height);
        world.position.set(fit.x + shakeX, fit.y + shakeY);

        // ---- HUD mock (static-ish HP, a slow idle-game gold trickle) ----
        gold.value += rawDt * 6;
        hud.update(0.78, gold.value);

        diagState.frames += 1;
      });

      // One-shot content check ~1.2s in: if the stage still reads back as a
      // single flat color (no sky-band/cloud/hill variance at all),
      // something rendered "successfully" (no throw) but drew nothing.
      const contentCheckTimer = setTimeout(() => {
        if (destroyed) return;
        try {
          const { pixels } = app.renderer.extract.pixels({ target: app.stage });
          const r0 = pixels[0];
          const g0 = pixels[1];
          const b0 = pixels[2];
          let variance = 0;
          for (let i = 0; i < pixels.length; i += 4 * 37) {
            variance += Math.abs(pixels[i] - r0) + Math.abs(pixels[i + 1] - g0) + Math.abs(pixels[i + 2] - b0);
          }
          if (variance < 40) {
            diagState.lastError = "content-check: stage read back as flat/blank";
          }
        } catch (err) {
          diagState.lastError = `content-check: ${err instanceof Error ? err.message : String(err)}`;
        }
      }, 1200);

      const diagInterval = setInterval(() => {
        diagState.now = performance.now();
        setDiag({ ...diagState });
      }, 300);

      sceneApiRef.current = {
        setGearTier(tier: GearTier) {
          currentGearTier = tier;
          hero.setGearTier(tier);
        },
      };

      cleanupFns.push(() => {
        sceneApiRef.current = null;
        clearTimeout(contentCheckTimer);
        clearInterval(diagInterval);
        resizeObserver.disconnect();
        hitSparks.destroy();
        app.destroy(true, { children: true, texture: true });
      });
    }

    return () => {
      destroyed = true;
      for (const fn of cleanupFns) fn();
    };
    // Mount-once: the ticker reads gear-tier state via `sceneApiRef`'s
    // imperative setter (wired to the buttons below), never through this
    // effect's own closure, so it never needs to re-run.
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
            paper-doll gear demo — สวมชุด/อาวุธจริงบนตัวละครเดียวกัน
          </div>
        </div>

        {/* Version marker — so the owner can confirm he's looking at a fresh
            bundle, not a stale cached one, when reporting bugs. Bump the
            string on any meaningful change to this prototype. */}
        <div className="pointer-events-none absolute bottom-1 right-1.5 select-none text-[9px] font-mono text-white/30">
          proto v4
        </div>
      </div>

      {/* Init failure — rendered VISIBLY instead of failing silently (the iOS
          Safari bug this box exists to surface): `Application.init()` or any
          synchronous scene-build step can throw, and an uncaught rejection
          inside the mount effect's async IIFE would otherwise leave the
          canvas area blank with zero diagnostics. */}
      {initError && (
        <div className="w-full max-w-3xl rounded-md border border-red-500 bg-red-950/80 p-2 font-mono text-xs text-red-200">
          Pixi init error: {initError}
        </div>
      )}

      {/* Self-diagnosing strip (dev tool) — a stalled `frames` counter (still
          0 a couple seconds after mount, with no thrown init error) is
          EXACTLY the "renders without throwing but nothing appears" failure
          mode reported on iOS Safari; this turns the next screenshot into a
          precise diagnosis instead of a guess. */}
      <DiagStrip diag={diag} />

      <div className="flex flex-wrap items-center justify-center gap-2">
        {GEAR_TIERS.map(({ tier, label, accent }) => (
          <button
            key={tier}
            type="button"
            onClick={() => {
              setGearTierState(tier);
              sceneApiRef.current?.setGearTier(tier);
            }}
            className={`rounded-md border px-3 py-1.5 text-sm font-semibold active:scale-95 ${
              gearTier === tier ? accent : "border-white/20 bg-[#151a30] text-white"
            }`}
            style={{ fontFamily: "var(--font-display)" }}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="proto-kanit max-w-xl text-center text-xs text-white/60">
        ชุดเดียวกัน ตัวละครเดียวกัน — สลับ 3 ระดับของสวมใส่: ธรรมดา (ผ้า/เหล็กเรียบ) → หายาก
        (ชุดเกราะ + ดาบใหญ่ขึ้น) → ระดับเทพ (เกราะระยิบระยับ + ดาบใหญ่ + ออร่าลุกโชนแบบซุปเปอร์ไซย่า)
      </p>
    </div>
  );
}

/** Renders `diag` as one always-visible monospace line; turns red once
 * `frames` has stayed at 0 for >2s past mount with no thrown init error —
 * that combination is exactly "rendered without throwing but drew nothing". */
function DiagStrip({ diag }: { diag: DiagSnapshot }) {
  const stalled = diag.frames === 0 && diag.mountedAt > 0 && diag.now - diag.mountedAt > 2000;
  return (
    <div
      className={`w-full max-w-3xl rounded-md border px-2 py-1 font-mono text-[10px] leading-tight ${
        stalled
          ? "border-red-500 bg-red-950/70 text-red-200"
          : "border-white/15 bg-black/40 text-white/50"
      }`}
    >
      renderer={diag.rendererType} buffer={diag.bufferW}x{diag.bufferH} css={diag.cssW}x
      {diag.cssH} ticker={diag.tickerStarted ? "started" : "STOPPED"} frames={diag.frames}
      {diag.lastError ? ` lastError=${diag.lastError}` : ""}
      {stalled ? " — STALLED (0 frames after 2s)" : ""}
    </div>
  );
}
