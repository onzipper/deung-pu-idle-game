/**
 * The GRAND boss door (M7.5 "ประตูคือตัวกลาง" item 3) — the outside face of
 * the boss-room gate, standing at the RIGHT edge of each map's LAST farm zone
 * (`zoneGates.ts`'s `isLastFarmZone`/`gateX`). Bigger + more ornamented than a
 * plain `gateArch.ts` archway, with a real LOCKED (chained, dim) -> UNLOCKED
 * (open, glowing) state read live off `isZoneUnlocked` every frame — unlike a
 * normal archway, this state CAN change while the player is still standing in
 * the same zone (grinding the kill quota that unlocks it).
 *
 * Perf/footgun discipline: every Graphics shape is built ONCE in the
 * constructor; `update()` only mutates `rotation`/`scale`/`alpha`/`visible` on
 * those pre-built objects (never re-walks a path) — same build-once/
 * transform-only convention as `gearAura.ts`. The two door leaves hinge at
 * their OWN local origin (drawn already offset from x=0, not pivoted), so
 * "opening" is a plain `rotation` set with no pivot-subtraction math to get
 * wrong (footgun 1's class of bug never applies here by construction).
 */

import { Container, Graphics } from "pixi.js";
import type { BiomeDef } from "@/render/environment/biomes";
import type { GateFamily } from "@/render/environment/zoneGates";
import { PALETTE, safeRadius } from "@/render/theme";

const POST_WIDTH = 22;
const POST_HEIGHT = 96;
const OPENING_WIDTH = 60; // clear space between posts — each leaf is half this
const LEAF_HEIGHT = 86;
const FRAME_TOP_HEIGHT = 16;

/** How far (radians) each leaf swings by the time it's fully open. */
const OPEN_ANGLE = 0.55;
/** Per-second lerp rate easing `openness` toward its 0/1 target. */
const OPEN_RATE = 1.4;
/** Ominous locked flicker + unlocked glow-pulse speed (rad/s). */
const GLOW_PULSE_SPEED = 1.1;

interface DoorPalette {
  frame: number;
  leaf: number;
  leafDark: number;
  glow: number;
}

function paletteFor(family: GateFamily, biome: BiomeDef): DoorPalette {
  const glow = biome.far.glowRim ?? biome.ground.accent;
  if (family === "map2") {
    return { frame: biome.ground.band, leaf: biome.ground.base, leafDark: 0x0a0507, glow };
  }
  if (family === "map3") {
    return { frame: biome.ground.band, leaf: biome.ground.base, leafDark: 0x1a120a, glow };
  }
  // map1 (and any frontier-overflow biome reusing map1's family) — carved
  // stone; town never routes here (boss doors only exist on farm zones).
  return { frame: biome.ground.band, leaf: biome.ground.base, leafDark: PALETTE.outline, glow };
}

/** One leaf's local rect spans x in [0, halfWidth] (hinge at the LOCAL
 * origin, on the side nearer the opening's center) — building it already
 * offset like this means "open" is just `rotation`, no pivot math. */
function buildLeaf(color: number, dark: number, hingeSign: 1 | -1): Graphics {
  const g = new Graphics();
  const w = OPENING_WIDTH / 2;
  const x0 = hingeSign > 0 ? 0 : -w;
  g.rect(x0, -LEAF_HEIGHT, safeRadius(w), safeRadius(LEAF_HEIGHT)).fill({ color, alpha: 0.92 });
  // A couple of plank/panel seams for texture.
  for (let i = 1; i < 3; i++) {
    const y = -LEAF_HEIGHT + (LEAF_HEIGHT / 3) * i;
    g.rect(x0, y, safeRadius(w), 2).fill({ color: dark, alpha: 0.4 });
  }
  g.rect(x0, -LEAF_HEIGHT, safeRadius(w), safeRadius(LEAF_HEIGHT)).stroke({
    width: 1.5,
    color: dark,
    alpha: 0.7,
  });
  return g;
}

export class BossDoorProp {
  readonly view = new Container();
  private readonly leftLeaf: Container;
  private readonly rightLeaf: Container;
  private readonly chains: Graphics;
  private readonly glowRim: Graphics;

  private openness = 0; // 0 = fully shut, 1 = fully open (eased toward `unlocked`)
  private unlocked = false;
  private glowPhase = Math.random() * Math.PI * 2;

  constructor(x: number, groundY: number, family: GateFamily, biome: BiomeDef) {
    this.view.position.set(x, groundY);
    const pal = paletteFor(family, biome);

    // Static outer frame: two posts + a top lintel — never changes.
    const frame = new Graphics();
    const leftPostX = -(OPENING_WIDTH / 2 + POST_WIDTH);
    const rightPostX = OPENING_WIDTH / 2;
    frame.rect(leftPostX, -POST_HEIGHT, safeRadius(POST_WIDTH), safeRadius(POST_HEIGHT)).fill({
      color: pal.frame,
      alpha: 0.92,
    });
    frame.rect(rightPostX, -POST_HEIGHT, safeRadius(POST_WIDTH), safeRadius(POST_HEIGHT)).fill({
      color: pal.frame,
      alpha: 0.92,
    });
    const lintelW = OPENING_WIDTH + POST_WIDTH * 2 + 10;
    frame
      .roundRect(-lintelW / 2, -POST_HEIGHT - FRAME_TOP_HEIGHT, safeRadius(lintelW), safeRadius(FRAME_TOP_HEIGHT + 8), 6)
      .fill({ color: pal.frame, alpha: 0.92 });
    this.view.addChild(frame);

    // Hinged leaves — hinge at LOCAL origin (see `buildLeaf`'s doc comment).
    const leftLeafG = buildLeaf(pal.leaf, pal.leafDark, 1);
    const rightLeafG = buildLeaf(pal.leaf, pal.leafDark, -1);
    this.leftLeaf = new Container();
    this.leftLeaf.addChild(leftLeafG);
    this.leftLeaf.position.set(leftPostX + POST_WIDTH, 0);
    this.rightLeaf = new Container();
    this.rightLeaf.addChild(rightLeafG);
    this.rightLeaf.position.set(rightPostX, 0);
    this.view.addChild(this.leftLeaf, this.rightLeaf);

    // Locked-look chain overlay — a simple zigzag stroke across both leaves,
    // hidden once the door starts opening.
    this.chains = new Graphics();
    const midY = -LEAF_HEIGHT * 0.55;
    this.chains
      .moveTo(-OPENING_WIDTH / 2, midY - 10)
      .lineTo(0, midY + 8)
      .lineTo(OPENING_WIDTH / 2, midY - 10)
      .stroke({ width: 3, color: PALETTE.doorChain, alpha: 0.85 });
    this.chains
      .moveTo(-OPENING_WIDTH / 2, midY + 14)
      .lineTo(0, midY - 4)
      .lineTo(OPENING_WIDTH / 2, midY + 14)
      .stroke({ width: 3, color: PALETTE.doorChain, alpha: 0.85 });
    this.view.addChild(this.chains);

    // Accent glow rim along the lintel underside — dim ominous flicker while
    // locked, a brighter pulse once open (both alpha-only, never rebuilt).
    this.glowRim = new Graphics();
    this.glowRim
      .rect(-lintelW / 2 + 6, -POST_HEIGHT - 2, safeRadius(lintelW - 12), safeRadius(3))
      .fill({ color: pal.glow, alpha: 1 });
    this.view.addChild(this.glowRim);
  }

  /** Continuous read (`FxController`/`BiomeScene` convention): the caller
   * re-checks `isZoneUnlocked` every frame and just tells us the answer. */
  setUnlocked(unlocked: boolean): void {
    this.unlocked = unlocked;
  }

  update(dt: number): void {
    const target = this.unlocked ? 1 : 0;
    this.openness += (target - this.openness) * Math.min(1, dt * OPEN_RATE);
    this.leftLeaf.rotation = -OPEN_ANGLE * this.openness;
    this.rightLeaf.rotation = OPEN_ANGLE * this.openness;
    // A little foreshortening as the leaves swing "away" (a flat-2D stand-in
    // for perspective, transform-only — no path rebuild).
    const foldScale = 1 - 0.35 * this.openness;
    this.leftLeaf.scale.x = foldScale;
    this.rightLeaf.scale.x = foldScale;

    this.chains.alpha = Math.max(0, 1 - this.openness * 3);

    this.glowPhase += dt * GLOW_PULSE_SPEED;
    const pulse = 0.5 + 0.5 * Math.sin(this.glowPhase);
    this.glowRim.alpha = this.unlocked ? 0.35 + 0.35 * pulse : 0.06 + 0.05 * pulse;
    // Whole door dims slightly while locked — subtle, plain-alpha, no filter.
    this.view.alpha = 0.86 + 0.14 * this.openness;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
