/**
 * Owner's hand-drawn pixel llama (fun/off-theme town decor, owner request,
 * 2026-07-08) — a single ambient actor that mostly sits in a small patch of
 * the town ground line, occasionally stands and shuffles a few px left/right,
 * then sits back down. PURE DECORATION: zero engine/state involvement, this
 * module is never imported by anything under `engine/` and never mutates
 * `GameState` — same one-way-read convention as every other render-only prop.
 *
 * File contract (owner drops these into `public/lab-assets/`, may not exist
 * yet — this whole feature is a graceful no-op until they do):
 *   `llama_sit_01.png` / `llama_sit_02.png`     (sit loop, 2 frames)
 *   `llama_stand_01.png` .. `llama_stand_04.png` (stand/step loop, 4 frames)
 *
 * Failure handling: every load failure (file 404, decode/malformed-image
 * error, or the whole `lab-assets/` folder not existing yet) is caught and
 * resolves that frame SET to `null` — never throws, never retries within a
 * session (see `loadLlamaFrames()`). The actor also works with only ONE of
 * the two sets present: sit-only never stands (see `advancePhase()`),
 * stand-only never sits (idles in the stand pose, still shuffling its patch).
 * If BOTH sets fail to load, the actor is permanently disabled — no
 * `AnimatedSprite` is ever constructed, `view` stays empty, `update()` is a
 * cheap early-out no-op. Exactly one instance is ever created (see
 * `createTownLlamaActor()` / `GameRenderer.ts`'s single `llama` field) — the
 * "cap: exactly one llama" requirement holds by construction, not a counter.
 *
 * Layering: built once and added to `GameRenderer`'s `background` layer,
 * which is entirely behind `entities` (heroes/enemies/boss/town NPCs) in the
 * scene's z-order — see `render/README.md`'s "Scene layers" section — so the
 * llama reads as ground-level scenery, never in front of the hero or the
 * named town NPCs, without needing any manual z-index bookkeeping here.
 *
 * Footgun compliance (CLAUDE.md / render/README.md): nearest-neighbor
 * `scaleMode` on every loaded texture so the pixel art stays crisp (never
 * smoothed/blurred); no hand-built canvas gradients; no `Graphics` radius (no
 * `Graphics` at all — pure sprite); no `pivot`-based rotation (only
 * `position.x` shuffle + a `scale.x` flip toward movement + a tiny sine bob,
 * so footgun #1's pivot/path-coordinate trap never applies); solid sprite on
 * the DEFAULT blend mode (never `"add"`) so it never white-outs against the
 * bright town sky (footgun #10).
 */

import { AnimatedSprite, Assets, Container, type Texture } from "pixi.js";
import { GROUND_Y } from "@/render/layout";

// ---- knobs ------------------------------------------------------------
const FRAME_BASE = "/lab-assets/";
const SIT_FRAMES = ["llama_sit_01.png", "llama_sit_02.png"];
const STAND_FRAMES = [
  "llama_stand_01.png",
  "llama_stand_02.png",
  "llama_stand_03.png",
  "llama_stand_04.png",
];

/** World-x center of the llama's little patch (engine/render shared world
 * units, `render/layout.ts`'s space) — clear of both town NPC anchors
 * (`CONFIG.townNpcs`: ป้าปุ๊ x=230 / ลุงดึ๋ง x=560, each `radius: 42`, see
 * `render/townNpcs.ts`) and the town zone's right-edge gate archway. */
const PATCH_CENTER_X = 690;
const PATCH_HALF_WIDTH = 40;

const SIT_ANIM_FPS = 2; // slow, calm 2-frame sit-breathing loop
const STAND_ANIM_FPS = 6; // livelier step cadence

const SIT_MIN_S = 2.0;
const SIT_MAX_S = 4.0;
const STAND_MIN_S = 1.6;
const STAND_MAX_S = 3.0;

/** How fast it shuffles toward a freshly-picked patch target, world px/s. */
const SHUFFLE_SPEED_PX_S = 14;
/** Below this distance the shuffle is considered "arrived" (no jitter). */
const SHUFFLE_ARRIVE_EPS = 0.5;

const BOB_SPEED = Math.PI * 1.1;
const BOB_AMPLITUDE_STAND = 1.6;
const BOB_AMPLITUDE_SIT = 0.8; // calmer while sitting

/** Frames are ~100px hand-drawn pixel art; scale down to roughly NPC-sized
 * (NPC rigs stand ~50px feet-to-head tall, see `npcView.ts`'s FEET_Y/HEAD_Y),
 * slightly smaller per the task spec. */
const SPRITE_SCALE = 0.5;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

interface LoadedFrames {
  sit: Texture[] | null;
  stand: Texture[] | null;
}

/** `Assets.load` signature, narrowed to what this module calls — the shape a
 * test double needs to satisfy (see `townLlama.test.ts`). */
export type AssetLoader = (
  urls: { src: string; data?: { scaleMode?: string } },
) => Promise<Texture>;

/**
 * Loads both frame sets independently and NEVER throws — any failure (404,
 * decode error, a mocked loader rejecting) resolves that set to `null`
 * instead of rejecting the whole call, so a caller never needs its own
 * try/catch. Exported standalone (no `Assets` import required by the test)
 * so the "resolves to disabled on missing files" unit test can pass a
 * trivial rejecting stub without touching real Pixi texture loading.
 */
export async function loadLlamaFrames(
  loader: AssetLoader = (urls) => Assets.load<Texture>(urls),
): Promise<LoadedFrames> {
  const loadSet = async (files: string[]): Promise<Texture[] | null> => {
    try {
      const textures = await Promise.all(
        files.map((f) => loader({ src: FRAME_BASE + f, data: { scaleMode: "nearest" } })),
      );
      if (textures.some((t) => !t)) return null;
      return textures;
    } catch {
      return null;
    }
  };
  const [sit, stand] = await Promise.all([loadSet(SIT_FRAMES), loadSet(STAND_FRAMES)]);
  return { sit, stand };
}

type LlamaBehaviorState = "sit" | "stand";

/**
 * The town llama actor. Built once, kept for the whole session (same
 * lifecycle convention as `GameRenderer.ts`'s `npcViews` — never pooled by
 * id, there's only ever one). `load()` is fire-and-forget from the caller's
 * perspective (`create()` does not `await` it, so a slow/failed asset fetch
 * never blocks the renderer's own async setup) and leaves the actor disabled
 * on any failure.
 */
export class TownLlamaActor {
  readonly view = new Container();
  private sitSprite: AnimatedSprite | null = null;
  private standSprite: AnimatedSprite | null = null;
  private enabled = false;
  private state: LlamaBehaviorState = "sit";
  private phaseT = 0;
  private phaseDuration = SIT_MIN_S;
  private shuffleTargetX = PATCH_CENTER_X;
  private bobPhase = Math.random() * Math.PI * 2;
  /** Elapsed seconds feeding each sprite's manually-driven frame index (see
   * `update()`) — deliberately NOT Pixi's own `AnimatedSprite.play()`/shared
   * `Ticker`, which (a) needs a browser `requestAnimationFrame` (breaks
   * headless Vitest) and (b) would animate on Pixi's own clock instead of
   * the real-dt this module is handed, unlike every other render module in
   * this codebase (`ParallaxLayer`, `npcView.ts`, ...). */
  private sitFrameT = 0;
  private standFrameT = 0;

  constructor() {
    this.view.position.set(PATCH_CENTER_X, GROUND_Y);
    this.view.visible = false; // hidden until BOTH textures resolve and we're in town
  }

  /** Kick off the async texture load. Safe to call at most once (idempotent
   * no-op if already enabled/loading isn't re-entered by the caller). */
  async load(loader?: AssetLoader): Promise<void> {
    const { sit, stand } = await loadLlamaFrames(loader);
    if (!sit && !stand) return; // both sets absent/broken — permanent no-op

    if (sit) {
      this.sitSprite = buildLoopSprite(sit);
      this.view.addChild(this.sitSprite);
    }
    if (stand) {
      this.standSprite = buildLoopSprite(stand);
      this.view.addChild(this.standSprite);
    }

    this.state = sit ? "sit" : "stand";
    this.phaseT = 0;
    this.phaseDuration =
      this.state === "sit" ? rand(SIT_MIN_S, SIT_MAX_S) : rand(STAND_MIN_S, STAND_MAX_S);
    if (this.state === "stand") this.pickShuffleTarget();
    this.enabled = true;
    this.syncVisibleSprite();
  }

  /** `inTown`: same "only while standing in the town zone" gate
   * `updateNpcView()` uses (`zoneAt(state.location).kind === "town"`) — a
   * cheap early-out everywhere else, and the actor stays invisible until
   * BOTH the load resolved successfully AND the zone is town. */
  update(dt: number, inTown: boolean): void {
    this.view.visible = this.enabled && inTown;
    if (!this.enabled || !inTown) return;
    const d = Math.max(0, dt);

    this.phaseT += d;
    if (this.phaseT >= this.phaseDuration) this.advancePhase();

    if (this.state === "stand" && this.standSprite) {
      const dx = this.shuffleTargetX - this.view.position.x;
      if (Math.abs(dx) > SHUFFLE_ARRIVE_EPS) {
        const dir = Math.sign(dx);
        const step = Math.min(Math.abs(dx), SHUFFLE_SPEED_PX_S * d);
        this.view.position.x += dir * step;
        const facing = dir >= 0 ? 1 : -1;
        this.standSprite.scale.set(facing * SPRITE_SCALE, SPRITE_SCALE);
      }
    }

    this.bobPhase += d * BOB_SPEED;
    if (this.sitSprite) {
      this.sitSprite.position.y = Math.sin(this.bobPhase) * BOB_AMPLITUDE_SIT;
      this.sitFrameT += d;
      this.sitSprite.currentFrame =
        Math.floor(this.sitFrameT * SIT_ANIM_FPS) % this.sitSprite.totalFrames;
    }
    if (this.standSprite) {
      this.standSprite.position.y = Math.sin(this.bobPhase) * BOB_AMPLITUDE_STAND;
      this.standFrameT += d;
      this.standSprite.currentFrame =
        Math.floor(this.standFrameT * STAND_ANIM_FPS) % this.standSprite.totalFrames;
    }
  }

  /** Full teardown — safe even if `load()` never resolved / left the actor
   * disabled. Called alongside the rest of `GameRenderer.destroy()`'s
   * session-scoped teardown (no leak across zone transitions or unmount). */
  destroy(): void {
    this.view.destroy({ children: true });
    this.sitSprite = null;
    this.standSprite = null;
    this.enabled = false;
  }

  private syncVisibleSprite(): void {
    if (this.sitSprite) this.sitSprite.visible = this.state === "sit";
    if (this.standSprite) this.standSprite.visible = this.state === "stand";
  }

  private advancePhase(): void {
    this.phaseT = 0;
    const canSit = !!this.sitSprite;
    const canStand = !!this.standSprite;

    if (this.state === "sit") {
      if (canStand) {
        this.state = "stand";
        this.phaseDuration = rand(STAND_MIN_S, STAND_MAX_S);
        this.pickShuffleTarget();
      } else {
        this.phaseDuration = rand(SIT_MIN_S, SIT_MAX_S); // sit-only set: keep sitting
      }
    } else if (canSit) {
      this.state = "sit";
      this.phaseDuration = rand(SIT_MIN_S, SIT_MAX_S);
    } else {
      this.phaseDuration = rand(STAND_MIN_S, STAND_MAX_S); // stand-only set: keep shuffling
      this.pickShuffleTarget();
    }
    this.syncVisibleSprite();
  }

  private pickShuffleTarget(): void {
    this.shuffleTargetX = PATCH_CENTER_X + rand(-PATCH_HALF_WIDTH, PATCH_HALF_WIDTH);
  }
}

/** `autoUpdate: false` — this sprite's `currentFrame` is driven manually from
 * `update()`'s real-dt accumulator (see the class doc comment above), never
 * Pixi's own shared `Ticker`/`.play()`. */
function buildLoopSprite(frames: Texture[]): AnimatedSprite {
  const sprite = new AnimatedSprite({ textures: frames, autoUpdate: false, autoPlay: false });
  sprite.anchor.set(0.5, 1); // feet-anchored, GROUND_Y-relative like every other town prop
  sprite.scale.set(SPRITE_SCALE);
  return sprite;
}

/** Builds the actor and fires off its (never-throwing) texture load without
 * blocking the caller — see `GameRenderer.create()`. */
export function createTownLlamaActor(loader?: AssetLoader): TownLlamaActor {
  const actor = new TownLlamaActor();
  void actor.load(loader);
  return actor;
}
