/**
 * THE AURA — the star of the M6.5 art-direction prototype. Four tiers,
 * additive-blended, layered FLAT alpha only (no gradients — POC bug rule),
 * every particle drawn from the shared pooled `ParticlePool` (capped, real-dt).
 *
 *  - none:  nothing.
 *  - tier1: soft gold under-glow, a slow pulsing additive ellipse pair.
 *  - tier2: tier1 + brighter double-layer glow + a ring of orbiting particles.
 *  - tier3: BLAZING — multi-layer flame tongues + rising sparks + an
 *    occasional lightning-tick accent + a bright ground light pool. The
 *    "หนุ่ม ๆ ต้องว้าว" tier.
 */

import { Container, Graphics } from "pixi.js";
import { PROTO_PALETTE as P, safeRadius } from "./palette";
import { ParticlePool } from "./particlePool";

export type AuraTier = 0 | 1 | 2 | 3;

export interface Aura {
  container: Container;
  setTier(tier: AuraTier): void;
  update(dt: number, anchorX: number, anchorY: number): void;
}

const ORBIT_COUNT = 10;
const FLAME_TONGUE_COUNT = 9;

export function buildAura(): Aura {
  const container = new Container();
  container.blendMode = "add";

  const glow = new Graphics(); // tier 1+2 under-glow ellipses
  const groundPool = new Graphics(); // tier 3 ground light
  const orbitG = new Graphics(); // tier 2 orbit dots (drawn manually, not pooled — fixed small count, deterministic ring)
  const lightning = new Graphics(); // tier 3 occasional bolt
  container.addChild(glow, groundPool, orbitG, lightning);

  // Shared pooled particles for tier-3 flame tongues + rising sparks — capped
  // low (this file's whole budget) so many concurrent aura demos would still
  // stay smooth on a mid phone.
  const flamePool = new ParticlePool(container, 24);
  const sparkPool = new ParticlePool(container, 24);

  let tier: AuraTier = 0;
  let t = 0;
  let lightningTimer = randLightningDelay();
  let lightningLife = 0;

  function randLightningDelay(): number {
    return 1.5 + Math.random() * 1.5;
  }

  return {
    container,
    setTier(next: AuraTier) {
      tier = next;
      container.visible = tier > 0;
      if (tier === 0) {
        glow.clear();
        groundPool.clear();
        orbitG.clear();
        lightning.clear();
      }
    },
    update(dt: number, ax: number, ay: number) {
      if (tier === 0) return;
      t += dt;
      container.position.set(ax, ay);

      // ---- glow (tier 1+) ----
      const pulse = 0.75 + Math.sin(t * 3.2) * 0.25;
      glow.clear();
      const baseR = tier >= 2 ? 16 : 12;
      const baseAlpha = (tier >= 2 ? 0.32 : 0.22) * pulse;
      glow
        .ellipse(0, 2, safeRadius(baseR), safeRadius(baseR * 0.45))
        .fill({ color: P.auraGoldDeep, alpha: baseAlpha });
      glow
        .ellipse(0, 2, safeRadius(baseR * 0.55), safeRadius(baseR * 0.25))
        .fill({ color: P.auraGold, alpha: baseAlpha * 1.3 });
      if (tier >= 2) {
        // Brighter double-layer glow — a second, tighter/hotter core.
        glow
          .ellipse(0, 0, safeRadius(baseR * 0.35), safeRadius(baseR * 0.55))
          .fill({ color: P.flameWhite, alpha: 0.22 * pulse });
      }

      // ---- tier 2: orbiting particles ----
      orbitG.clear();
      if (tier >= 2) {
        for (let i = 0; i < ORBIT_COUNT; i++) {
          const phase = (i / ORBIT_COUNT) * Math.PI * 2 + t * 2.4;
          const rx = 15;
          const ry = 20;
          const ox = Math.cos(phase) * rx;
          const oy = -6 + Math.sin(phase) * ry * 0.4 - Math.abs(Math.sin(phase)) * 4;
          const depthAlpha = 0.4 + Math.max(0, Math.sin(phase)) * 0.6;
          orbitG
            .circle(ox, oy, safeRadius(1.4))
            .fill({ color: P.auraGold, alpha: depthAlpha });
        }
      }

      // ---- tier 3: blazing ----
      groundPool.clear();
      if (tier >= 3) {
        const gp = 0.7 + Math.sin(t * 5) * 0.3;
        groundPool
          .ellipse(0, 1, safeRadius(20), safeRadius(5))
          .fill({ color: P.flameOrange, alpha: 0.28 * gp });
        groundPool
          .ellipse(0, 1, safeRadius(11), safeRadius(3))
          .fill({ color: P.flameWhite, alpha: 0.3 * gp });

        // Rising flame tongues — spawned continuously, capped by the pool size.
        if (Math.random() < FLAME_TONGUE_COUNT * dt * 3) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 0.9;
          const speed = 26 + Math.random() * 18;
          flamePool.spawn({
            x: (Math.random() - 0.5) * 14,
            y: 2,
            vx: Math.cos(a) * speed * 0.3,
            vy: Math.sin(a) * speed,
            life: 0.35 + Math.random() * 0.25,
            radius: 2 + Math.random() * 1.6,
            color: Math.random() < 0.5 ? P.flameOrange : P.flameRed,
            gravity: -20,
            drag: 0.3,
            shape: 1,
          });
        }
        // Rising sparks — thinner, faster, whiter, travel higher.
        if (Math.random() < 10 * dt) {
          sparkPool.spawn({
            x: (Math.random() - 0.5) * 18,
            y: 0,
            vx: (Math.random() - 0.5) * 8,
            vy: -30 - Math.random() * 25,
            life: 0.5 + Math.random() * 0.4,
            radius: 1,
            color: P.sparkWhite,
            gravity: -6,
            drag: 0.15,
          });
        }

        // Occasional lightning-tick accent.
        lightningTimer -= dt;
        if (lightningTimer <= 0 && lightningLife <= 0) {
          lightningLife = 0.09;
          lightningTimer = randLightningDelay();
        }
        lightning.clear();
        if (lightningLife > 0) {
          lightningLife -= dt;
          const jag: number[] = [0, -30];
          let cx = 0;
          let cy = -30;
          for (let i = 0; i < 4; i++) {
            cx += (Math.random() - 0.5) * 8;
            cy += 8;
            jag.push(cx, cy);
          }
          lightning.poly(jag).stroke({ color: P.lightning, width: 1.6, alpha: 0.9 });
          lightning.poly(jag).stroke({ color: P.flameWhite, width: 0.7, alpha: 1 });
        }
      } else {
        lightning.clear();
      }

      flamePool.update(dt);
      sparkPool.update(dt);
    },
  };
}
