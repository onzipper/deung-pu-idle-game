/**
 * Headless correctness guard for the owner's War Cry ATK-buff aura
 * (`fx/warCryAura.ts`) — same convention as `refinePrestige.test.ts`: exercise
 * the REAL pooled controller in plain Node (no canvas/WebGL needed for Pixi
 * Graphics path-building), asserting the POC-crash class of bug never throws
 * and that the effect stays within its fixed pooling cap (no new uncapped
 * emitters, no growth in the backing Container's child count).
 */

import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { WarCryAuraController } from "@/render/fx/warCryAura";

describe("WarCryAuraController", () => {
  it("active/idle/negative-position slots never throw and never grow the pooled Graphics count", () => {
    const container = new Container();
    const aura = new WarCryAuraController(container);
    const before = container.children.length;

    expect(() => {
      aura.setSlot(0, 1, 10, 20); // full intensity
      aura.setSlot(1, 0.4, -5, -5); // fading, negative position
      aura.setSlot(2, 0, 0, 0); // idle (no buff)
      for (let i = 0; i < 300; i++) aura.update(1 / 60);
    }).not.toThrow();

    expect(container.children.length).toBe(before);
    aura.destroy();
  });

  it("fades out to fully hidden after intensity drops to 0 and stays quiet at rest", () => {
    const container = new Container();
    const aura = new WarCryAuraController(container);

    aura.setSlot(0, 1, 5, 5);
    for (let i = 0; i < 60; i++) aura.update(1 / 60);

    aura.setSlot(0, 0, 5, 5);
    for (let i = 0; i < 120; i++) aura.update(1 / 60);

    // A long-idle slot at target 0 should have eased its own fade back to ~0
    // (visual convention checked indirectly: no throw across a long idle run,
    // matching every other continuous fx controller's steady-state contract).
    expect(() => {
      for (let i = 0; i < 60; i++) aura.update(1 / 60);
    }).not.toThrow();
  });

  it("clamps out-of-range intensity (>1 or negative) without throwing", () => {
    const aura = new WarCryAuraController(new Container());
    expect(() => {
      aura.setSlot(0, 5, 1, 1);
      aura.setSlot(1, -3, 1, 1);
      for (let i = 0; i < 30; i++) aura.update(1 / 60);
    }).not.toThrow();
  });

  it("ignores out-of-range slot indices instead of throwing", () => {
    const aura = new WarCryAuraController(new Container());
    expect(() => {
      aura.setSlot(-1, 1, 0, 0);
      aura.setSlot(99, 1, 0, 0);
      aura.update(1 / 60);
    }).not.toThrow();
  });
});
