/**
 * Headless correctness guard for the M7.6+ refine-prestige ladder (+8/+9/+10)
 * — same convention as `skillSpectacle.test.ts`: exercise the REAL pool/
 * controller code in plain Node (no canvas/WebGL needed for Pixi Graphics
 * path-building), asserting the POC-crash class of bug (negative/zero radius)
 * never throws and that every effect stays within its existing pooling cap
 * (no new uncapped emitters, per the mobile-GPU constraint).
 */

import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { GearAuraController } from "@/render/fx/gearAura";
import { GearSparklePool } from "@/render/fx/gearSparkle";
import { ParticlePool } from "@/render/fx/particles";
import { RefinePrestigeFx } from "@/render/fx/refinePrestige";
import { RingPool } from "@/render/fx/rings";

describe("gearAura boosted (+8 refine-prestige step)", () => {
  it("boosted vs. plain slots never throw and never grow the pooled Graphics count", () => {
    const container = new Container();
    const aura = new GearAuraController(container);
    const before = container.children.length;

    expect(() => {
      aura.setSlot(0, true, 10, 20, 0xff7a1a, false); // +7 plain
      aura.setSlot(1, true, -5, -5, 0xff7a1a, true); // +8 boosted, negative pos
      for (let i = 0; i < 30; i++) aura.update(1 / 60);
    }).not.toThrow();

    expect(container.children.length).toBe(before);
    aura.destroy();
  });
});

describe("gearSparkle boosted (+8 refine-prestige step)", () => {
  it("boosted vs. plain slots never throw and never grow the pooled Graphics count", () => {
    const container = new Container();
    const sparkle = new GearSparklePool(container);
    const before = container.children.length;

    expect(() => {
      sparkle.setSlot(0, true, 10, 20, false); // +7 plain
      sparkle.setSlot(1, true, -5, -5, true); // +8 boosted, negative pos
      for (let i = 0; i < 30; i++) sparkle.update(1 / 60);
    }).not.toThrow();

    expect(container.children.length).toBe(before);
    sparkle.destroy();
  });
});

describe("RefinePrestigeFx (+9/+10 refine-prestige steps)", () => {
  it("adds zero new pooled Graphics — reuses the shared ParticlePool/RingPool caps", () => {
    const particlesContainer = new Container();
    const ringsContainer = new Container();
    const particles = new ParticlePool(particlesContainer, 40);
    const rings = new RingPool(ringsContainer, 8);
    const beforeParticles = particlesContainer.children.length;
    const beforeRings = ringsContainer.children.length;

    const fx = new RefinePrestigeFx(particles, rings);

    // Simulate several seconds at +10 (the busiest tier: crackle + ember
    // trickle + halo pulse + ground shimmer all active) across two anchors
    // (weapon + armor, mirroring FxController's `${slot}-weapon`/`-armor`
    // keys) — long enough for every timer to fire multiple times.
    expect(() => {
      for (let i = 0; i < 600; i++) {
        fx.update(1 / 60, "0-weapon", 10, 12, -20);
        fx.update(1 / 60, "0-armor", 10, 8, -18);
        particles.update(1 / 60);
        rings.update(1 / 60);
      }
    }).not.toThrow();

    expect(particlesContainer.children.length).toBe(beforeParticles);
    expect(ringsContainer.children.length).toBe(beforeRings);

    particles.destroy();
    rings.destroy();
  });

  it("a zero/negative anchor position and refineLevel 0 (idle) never throw", () => {
    const particles = new ParticlePool(new Container(), 10);
    const rings = new RingPool(new Container(), 4);
    const fx = new RefinePrestigeFx(particles, rings);

    expect(() => {
      for (let i = 0; i < 60; i++) {
        fx.update(1 / 60, "1-weapon", 0, -100, -100);
        particles.update(1 / 60);
        rings.update(1 / 60);
      }
    }).not.toThrow();
  });

  it("+9 crackle-only (below the +10 signature threshold) never throws and stays capped", () => {
    const particlesContainer = new Container();
    const particles = new ParticlePool(particlesContainer, 20);
    const rings = new RingPool(new Container(), 4);
    const before = particlesContainer.children.length;
    const fx = new RefinePrestigeFx(particles, rings);

    expect(() => {
      for (let i = 0; i < 300; i++) {
        fx.update(1 / 60, "2-armor", 9, 5, 5);
        particles.update(1 / 60);
      }
    }).not.toThrow();

    expect(particlesContainer.children.length).toBe(before);
  });
});
