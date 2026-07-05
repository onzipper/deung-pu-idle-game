/**
 * Fantasy meadow parallax background at MMX3 energy — vivid saturated bands,
 * bold hard-edged cloud shapes, two layered hill silhouettes, a chunky grass
 * foreground strip. Everything is built ONCE as flat-color Graphics (no
 * canvas gradients — layered flat rects approximate the sky gradient) and
 * only repositioned per frame (`chunk.x -= speed*dt`, wrap when off-screen) —
 * the same "build once, transform only" vocabulary as
 * `src/render/environment/ParallaxLayer.ts`, reimplemented locally since this
 * route may not import `src/render`.
 */

import { Container, Graphics } from "pixi.js";
import { PROTO_PALETTE as P, safeRadius } from "./palette";

const WORLD_W = 480;
const WORLD_H = 270;
const GROUND_Y = 220;

interface WrapLayer {
  root: Container;
  chunkWidth: number;
  chunks: Container[];
  speed: number;
}

function buildWrapLayer(
  chunkWidth: number,
  count: number,
  speed: number,
  build: (c: Container, seed: number) => void,
): WrapLayer {
  const root = new Container();
  const chunks: Container[] = [];
  for (let i = 0; i < count; i++) {
    const c = new Container();
    c.x = i * chunkWidth;
    build(c, i);
    root.addChild(c);
    chunks.push(c);
  }
  return { root, chunkWidth, chunks, speed };
}

function updateWrapLayer(layer: WrapLayer, dt: number): void {
  const total = layer.chunkWidth * layer.chunks.length;
  for (const c of layer.chunks) {
    c.x -= layer.speed * dt;
    if (c.x <= -layer.chunkWidth) c.x += total;
  }
}

function buildSky(): Container {
  const c = new Container();
  const g = new Graphics();
  // Flat stacked bands approximating a vertical gradient — never
  // createRadialGradient/addColorStop (POC crash class).
  const bands: [number, number, number][] = [
    [0, 70, P.skyTop],
    [70, 130, P.skyMid],
    [130, 175, P.skyLow],
    [175, 200, P.skyHorizon],
  ];
  for (const [y0, y1, color] of bands) {
    g.rect(0, y0, WORLD_W, y1 - y0).fill({ color });
  }
  // Warm horizon glow sliver, flat alpha only.
  g.rect(0, 190, WORLD_W, 20).fill({ color: P.horizonGlow, alpha: 0.35 });
  c.addChild(g);
  return c;
}

function drawCloudPuff(g: Graphics, x: number, y: number, scale: number): void {
  const w = 26 * scale;
  const h = 12 * scale;
  // Bold, hard-edged cumulus silhouette built from overlapping rounded lumps
  // sampled as a poly fan (never a filled `.arc()` — the stale-pen-position
  // footgun) so the cloud reads as one solid hard-edged shape.
  const lumps = [
    { dx: -w * 0.5, dy: 0, r: h * 0.7 },
    { dx: -w * 0.1, dy: -h * 0.35, r: h },
    { dx: w * 0.35, dy: -h * 0.1, r: h * 0.85 },
    { dx: w * 0.55, dy: h * 0.15, r: h * 0.6 },
  ];
  g.moveTo(x - w, y + h * 0.5);
  for (const l of lumps) {
    const cx = x + l.dx;
    const cy = y + l.dy;
    const r = safeRadius(l.r);
    const pts: number[] = [];
    for (let a = Math.PI; a <= Math.PI * 2; a += Math.PI / 6) {
      pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    for (let i = 0; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  }
  g.lineTo(x + w, y + h * 0.5);
  g.closePath();
  g.fill({ color: P.cloudFill });
  // Flat shadow underside band (no gradient — a second lower-alpha shape).
  g.moveTo(x - w * 0.7, y + h * 0.35);
  g.lineTo(x + w * 0.7, y + h * 0.35);
  g.lineTo(x + w * 0.5, y + h * 0.6);
  g.lineTo(x - w * 0.5, y + h * 0.6);
  g.closePath();
  g.fill({ color: P.cloudShade, alpha: 0.8 });
  g.stroke({ color: P.cloudOutline, width: 1.5, alpha: 0.5 });
}

function buildClouds(): WrapLayer {
  const chunkW = 240;
  return buildWrapLayer(chunkW, 3, 6, (c, seed) => {
    const g = new Graphics();
    const rnd = mulberry(seed + 11);
    const n = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      drawCloudPuff(
        g,
        20 + rnd() * (chunkW - 40),
        20 + rnd() * 30,
        0.7 + rnd() * 0.6,
      );
    }
    c.addChild(g);
  });
}

function hillSilhouette(
  chunkW: number,
  baseY: number,
  amp: number,
  color: number,
  shadeColor: number,
): Graphics {
  const g = new Graphics();
  const steps = 8;
  const pts: number[] = [0, WORLD_H];
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * chunkW;
    const y = baseY - Math.sin((i / steps) * Math.PI * 1.3) * amp - amp * 0.3;
    pts.push(x, y);
  }
  pts.push(chunkW, WORLD_H);
  g.poly(pts).fill({ color });
  // Flat darker "shade" band along the base — jewel-tone-adjacent trick from
  // the shipped game's silhouette vocabulary, done here as a second flat fill.
  g.rect(0, baseY + amp * 0.5, chunkW, WORLD_H - baseY).fill({ color: shadeColor, alpha: 0.5 });
  return g;
}

function buildHillsFar(): WrapLayer {
  const chunkW = 200;
  return buildWrapLayer(chunkW, 3, 14, (c) => {
    c.addChild(hillSilhouette(chunkW, GROUND_Y - 40, 22, P.hillFar, P.hillFarShade));
  });
}

function buildHillsNear(): WrapLayer {
  const chunkW = 220;
  return buildWrapLayer(chunkW, 3, 26, (c) => {
    c.addChild(hillSilhouette(chunkW, GROUND_Y - 14, 16, P.hillNear, P.hillNearShade));
  });
}

function buildGroundBand(): Container {
  const c = new Container();
  const g = new Graphics();
  g.rect(0, GROUND_Y, WORLD_W, WORLD_H - GROUND_Y).fill({ color: P.grassBase });
  // Chunky jagged top-edge notches — hard pixel-art edge, no anti-aliased curve.
  const teeth = 24;
  const toothW = WORLD_W / teeth;
  const pts: number[] = [];
  for (let i = 0; i <= teeth; i++) {
    const x = i * toothW;
    const y = GROUND_Y + (i % 2 === 0 ? 0 : 4);
    pts.push(x, y);
  }
  pts.push(WORLD_W, GROUND_Y + 10, 0, GROUND_Y + 10);
  g.poly(pts).fill({ color: P.grassHighlight, alpha: 0.9 });
  g.rect(0, GROUND_Y + 10, WORLD_W, WORLD_H - GROUND_Y - 10).fill({ color: P.dirt, alpha: 0.35 });
  c.addChild(g);
  return c;
}

function buildGrassTufts(): WrapLayer {
  const chunkW = 60;
  return buildWrapLayer(chunkW, 9, 40, (c, seed) => {
    const g = new Graphics();
    const rnd = mulberry(seed + 5);
    const n = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const x = rnd() * chunkW;
      const y = GROUND_Y + 2 + rnd() * 6;
      const w = 5 + rnd() * 4;
      const h = 6 + rnd() * 5;
      g.poly([x - w / 2, y, x, y - h, x + w / 2, y]).fill({ color: P.grassShade });
    }
    c.addChild(g);
  });
}

/** Deterministic tiny PRNG so re-mounts (StrictMode) look identical, no Math.random churn per build. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Background {
  container: Container;
  update(dt: number): void;
}

export function buildBackground(): Background {
  const container = new Container();
  const sky = buildSky();
  const clouds = buildClouds();
  const hillsFar = buildHillsFar();
  const hillsNear = buildHillsNear();
  const ground = buildGroundBand();
  const tufts = buildGrassTufts();

  container.addChild(
    sky,
    clouds.root,
    hillsFar.root,
    hillsNear.root,
    ground,
    tufts.root,
  );

  return {
    container,
    update(dt: number) {
      updateWrapLayer(clouds, dt);
      updateWrapLayer(hillsFar, dt);
      updateWrapLayer(hillsNear, dt);
      updateWrapLayer(tufts, dt);
    },
  };
}

export const PROTO_WORLD = { WORLD_W, WORLD_H, GROUND_Y };
